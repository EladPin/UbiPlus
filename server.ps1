# UbiPlus local server - static files + plink telnet proxy
# Usage: .\server.ps1 [-NoLaunch]
param([switch]$NoLaunch)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$port = 8090
$prefix = "http://localhost:$port/"

# ---------- plink discovery ----------
function Find-Plink {
    $cmd = Get-Command plink.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        'C:\Program Files\PuTTY\plink.exe',
        'C:\PuTTY\plink.exe',
        'C:\tools\plink.exe',
        "$env:USERPROFILE\Desktop\plink.exe",
        "$env:USERPROFILE\Downloads\plink.exe"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    $putty = Get-Command putty.exe -ErrorAction SilentlyContinue
    if ($putty) {
        $p = Join-Path (Split-Path $putty.Source) 'plink.exe'
        if (Test-Path $p) { return $p }
    }
    return $null
}

# ---------- telnet runner ----------
# Writes a commands file with Unix \n endings, feeds it to plink -telnet via stdin,
# captures stdout+stderr concurrently (avoids pipe deadlock), strips ANSI codes.
function Invoke-UbiTelnet {
    param([string]$Ip, [int]$TelnetPort, [string[]]$Lines, [int]$TimeoutSec = 30)

    $plink = Find-Plink
    if (-not $plink) { return @{ error = 'plink.exe not found. Place it at C:\tools\plink.exe' } }

    $cmdFile = Join-Path $env:TEMP "ubiplus_cmds_$([guid]::NewGuid().ToString('N')).txt"
    # CRITICAL: Unix \n endings only - remote PTY icrnl turns \r\n into a double newline
    [IO.File]::WriteAllText($cmdFile, (($Lines -join "`n") + "`n"))

    try {
        $psi = New-Object Diagnostics.ProcessStartInfo
        $psi.FileName = $plink
        $psi.Arguments = "-telnet $Ip -P $TelnetPort"
        $psi.UseShellExecute = $false
        $psi.RedirectStandardInput = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true

        $proc = [Diagnostics.Process]::Start($psi)
        $stdin = $proc.StandardInput.BaseStream
        $bytes = [IO.File]::ReadAllBytes($cmdFile)
        $stdin.Write($bytes, 0, $bytes.Length)
        $stdin.Flush(); $stdin.Close()

        $outTask = $proc.StandardOutput.ReadToEndAsync()
        $errTask = $proc.StandardError.ReadToEndAsync()

        if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
            try { $proc.Kill() } catch {}
            $partial = ''
            try { $partial = $outTask.Result } catch {}
            if ($partial) {
                # Got output before the timeout - the unit answered but never closed the session
                return @{ ok = $true; output = (Clean-Output $partial); timedOut = $true }
            }
            return @{ error = "Timeout after ${TimeoutSec}s - unit unreachable" }
        }

        $stdout = $outTask.Result
        $stderr = $errTask.Result
        if (-not $stdout -and $stderr) { return @{ error = ($stderr.Trim() -split "`n")[0] } }
        return @{ ok = $true; output = (Clean-Output $stdout) }
    } catch {
        return @{ error = $_.Exception.Message }
    } finally {
        Remove-Item $cmdFile -ErrorAction SilentlyContinue
    }
}

function Clean-Output {
    param([string]$s)
    if (-not $s) { return '' }
    $s = $s -replace '\x1b\[[0-9;]*[A-Za-z]', ''
    $s = $s -replace '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', ''
    return $s
}

# ---------- request body / response helpers ----------
function Read-JsonBody {
    param($Request)
    $reader = New-Object IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
    $raw = $reader.ReadToEnd(); $reader.Close()
    if (-not $raw) { return $null }
    return $raw | ConvertFrom-Json
}

function Send-Json {
    param($Response, $Obj, [int]$Code = 200)
    $json = $Obj | ConvertTo-Json -Depth 5
    $buf = [Text.Encoding]::UTF8.GetBytes($json)
    $Response.StatusCode = $Code
    $Response.ContentType = 'application/json; charset=utf-8'
    $Response.ContentLength64 = $buf.Length
    $Response.OutputStream.Write($buf, 0, $buf.Length)
    $Response.OutputStream.Close()
}

$mime = @{
    '.html'='text/html'; '.css'='text/css'; '.js'='application/javascript'
    '.json'='application/json'; '.png'='image/png'; '.svg'='image/svg+xml'
    '.woff2'='font/woff2'; '.ico'='image/x-icon'
}

# ---------- HTTP listener ----------
$listener = New-Object Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "UbiPlus server running at ${prefix}ubiplus/" -ForegroundColor Green
$plinkPath = Find-Plink
if ($plinkPath) { Write-Host "plink: $plinkPath" -ForegroundColor DarkGray }
else { Write-Host "plink.exe NOT FOUND - telnet features disabled (demo mode still works)" -ForegroundColor Yellow }

if (-not $NoLaunch) { Start-Process "${prefix}ubiplus/" }

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $path = $req.Url.AbsolutePath

    try {
        if ($req.HttpMethod -eq 'POST' -and ($path -eq '/ubi/status' -or $path -eq '/ubi/power')) {
            $body = Read-JsonBody $req
            if (-not $body -or -not $body.ip) { Send-Json $res @{ error = 'Missing ip' } 400; continue }

            $tport = 23
            if ($body.port) { $tport = [int]$body.port }

            # Build the interactive line sequence: optional credentials, then the command(s)
            $lines = @()
            if ($body.user) { $lines += [string]$body.user }
            if ($body.pass) { $lines += [string]$body.pass }
            if ($path -eq '/ubi/status') {
                $cmd = 'get status'
                if ($body.cmd) { $cmd = [string]$body.cmd }
                $lines += $cmd
            } else {
                if (-not $body.cmd) { Send-Json $res @{ error = 'Missing cmd for power action' } 400; continue }
                $lines += [string]$body.cmd
            }
            $lines += 'exit'

            Write-Host "[$([DateTime]::Now.ToString('HH:mm:ss'))] $path -> $($body.ip):$tport" -ForegroundColor Cyan
            $result = Invoke-UbiTelnet -Ip ([string]$body.ip) -TelnetPort $tport -Lines $lines
            Send-Json $res $result
            continue
        }

        # ---------- static files ----------
        if ($path -eq '/') { $path = '/ubiplus/' }
        if ($path.EndsWith('/')) { $path += 'index.html' }
        $file = Join-Path $root ($path -replace '/', '\').TrimStart('\')
        if ((Test-Path $file) -and (Resolve-Path $file).Path.StartsWith($root)) {
            $ext = [IO.Path]::GetExtension($file).ToLower()
            $ct = $mime[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
            $buf = [IO.File]::ReadAllBytes($file)
            $res.ContentType = $ct
            $res.ContentLength64 = $buf.Length
            $res.OutputStream.Write($buf, 0, $buf.Length)
            $res.OutputStream.Close()
        } else {
            $res.StatusCode = 404
            $buf = [Text.Encoding]::UTF8.GetBytes('404')
            $res.OutputStream.Write($buf, 0, $buf.Length)
            $res.OutputStream.Close()
        }
    } catch {
        try { Send-Json $res @{ error = $_.Exception.Message } 500 } catch {}
    }
}
