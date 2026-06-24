# UbiPlus local server - static files + direct TCP "raw" session against UBiFiX units
# Usage: .\server.ps1 [-NoLaunch]
param([switch]$NoLaunch)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$port = 8093
$prefix = "http://localhost:$port/"

# ---------- direct TCP session against a UBiFiX unit ----------
# Replaces the earlier plink-based transport (2026-06-24, second iteration). The
# plink-based flow died because plink closed the socket immediately after stdin EOF -
# the unit ACK'd the username and printed the password prompt, but plink was already
# gone before the unit could process the password (the firmware takes ~30-50s per
# command to ACK per the OSP PuTTY capture). Doing the I/O directly via TcpClient
# lets us wait for each prompt, send the next line only when it arrives, and bail as
# soon as we have the sector data. No plink dependency, faster on healthy units, plain
# TCP = the PuTTY "Raw" connection type that was verified to work on the OSP.
function Invoke-UbiSession {
    param(
        [Parameter(Mandatory)][string]$Ip,
        [Parameter(Mandatory)][int]$Port,
        [string]$User = '',
        [string]$Pass = '',
        [Parameter(Mandatory)][string]$Cmd,
        [int]$ConnectTimeoutMs = 4000,
        [int]$StageTimeoutSec  = 75,    # per-prompt wait; the unit takes 30-50s/command
        [int]$TotalTimeoutSec  = 300    # absolute ceiling on the whole exchange
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    $log = [System.Text.StringBuilder]::new()
    $stream = $null
    $buf = New-Object byte[] 4096
    $totalDeadline = (Get-Date).AddSeconds($TotalTimeoutSec)

    # Helper scriptblocks. They read $stream / $log / $buf / $totalDeadline from this
    # function's scope via PowerShell's dynamic-scope lookup at invocation time, so
    # they must be invoked AFTER the stream is connected.
    $readUntil = {
        param([string]$pattern, [int]$stageSec)
        $stageDeadline = (Get-Date).AddSeconds($stageSec)
        while (((Get-Date) -lt $stageDeadline) -and ((Get-Date) -lt $totalDeadline)) {
            if ($stream.DataAvailable) {
                $n = $stream.Read($buf, 0, $buf.Length)
                if ($n -le 0) { return $false }
                [void]$log.Append([Text.Encoding]::ASCII.GetString($buf, 0, $n))
                $clean = $log.ToString() -replace '\x1b\[[0-9;]*[A-Za-z]', '' `
                                         -replace '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', ''
                if ($clean -match $pattern) { return $true }
            } else {
                Start-Sleep -Milliseconds 80
            }
        }
        return $false
    }

    $sendLine = {
        param([string]$text)
        $bytes = [Text.Encoding]::ASCII.GetBytes("$text`n")
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
    }

    try {
        # Connect (fast TCP probe)
        try {
            $task = $client.ConnectAsync($Ip, $Port)
            if (-not $task.Wait($ConnectTimeoutMs)) {
                try { $client.Close() } catch {}
                return @{ error = "No TCP answer on ${Ip}:${Port} ($([math]::Round($ConnectTimeoutMs/1000))s) - unit unreachable" }
            }
        } catch {
            try { $client.Close() } catch {}
            return @{ error = "TCP connect to ${Ip}:${Port} failed: $($_.Exception.Message)" }
        }
        $stream = $client.GetStream()

        # 1) Username prompt
        if ($User) {
            if (-not (& $readUntil 'Enter your user name--->' $StageTimeoutSec)) {
                return @{ error = 'No username prompt within stage timeout'; output = (Clean-Output $log.ToString()) }
            }
            & $sendLine $User
        }

        # 2) Password prompt
        if ($Pass) {
            if (-not (& $readUntil 'Enter your pasword--->' $StageTimeoutSec)) {
                return @{ error = 'Username sent, no password prompt within stage timeout'; output = (Clean-Output $log.ToString()) }
            }
            & $sendLine $Pass
        }

        # 3) Wait for the terminal prompt (login complete)
        if (-not (& $readUntil '--GEN4 TERMINALL -->' $StageTimeoutSec)) {
            return @{ error = 'Password sent, no terminal prompt (bad credentials? slow unit?)'; output = (Clean-Output $log.ToString()) }
        }

        # 4) Send the command
        & $sendLine $Cmd

        # 5) Wait for the response we actually care about, then bail
        if ($Cmd -match '^\s*get\s+status\s*$') {
            # Wait for the sector line (the one thing the parser needs)
            [void](& $readUntil '(?im)^[ \t]*(inline|bypass|transparent)([ \t]*--[ \t]*(inline|bypass|transparent))*[ \t]*$' $StageTimeoutSec)
        } else {
            # For SET commands etc, the unit echoes "--Server ACK" when it accepts the line
            [void](& $readUntil '--Server ACK' $StageTimeoutSec)
        }

        # 6) Clean exit (best-effort - we already have what we need)
        try { & $sendLine 'exit' } catch {}
        Start-Sleep -Milliseconds 250

        return @{ ok = $true; output = (Clean-Output $log.ToString()) }
    } catch {
        return @{ error = "Session error: $($_.Exception.Message)"; output = (Clean-Output $log.ToString()) }
    } finally {
        try { $client.Close() } catch {}
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

# ---------- HTTP listener ----------
$listener = New-Object Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
    $listener.Start()
} catch {
    # HttpListener is disposed after a failed Start() — recreate and retry once.
    Write-Host "Port $port busy, retrying in 2s..." -ForegroundColor Yellow
    Start-Sleep -Seconds 2
    $listener = New-Object Net.HttpListener
    $listener.Prefixes.Add($prefix)
    $listener.Start()
}
Write-Host "UbiPlus server running at ${prefix}ubiplus/" -ForegroundColor Green
Write-Host "Transport: direct TCP (no plink)" -ForegroundColor DarkGray

if (-not $NoLaunch) { Start-Process "${prefix}ubiplus/" }

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')

    try {
        if ($req.HttpMethod -eq 'GET' -and $path -eq 'ubi/ping') {
            Send-Json $res @{ ok = $true; root = $root; transport = 'tcp' }
        }
        elseif ($req.HttpMethod -eq 'POST' -and ($path -eq 'ubi/status' -or $path -eq 'ubi/power')) {
            $body = Read-JsonBody $req
            if (-not $body -or -not $body.ip) {
                Send-Json $res @{ error = 'Missing ip' } 400
            } else {
                $tport = if ($body.port) { [int]$body.port } else { 10001 }
                $isStatus = $path -eq 'ubi/status'
                $cmd = if ($isStatus) {
                    if ($body.cmd) { [string]$body.cmd } else { 'get status' }
                } else {
                    [string]$body.cmd
                }
                if (-not $isStatus -and -not $cmd) {
                    Send-Json $res @{ error = 'Missing cmd for power action' } 400
                } else {
                    Write-Host "[$([DateTime]::Now.ToString('HH:mm:ss'))] /$path -> $($body.ip):$tport  cmd=$cmd" -ForegroundColor Cyan
                    $result = Invoke-UbiSession `
                        -Ip ([string]$body.ip) -Port $tport `
                        -User ([string]$body.user) -Pass ([string]$body.pass) `
                        -Cmd $cmd
                    Send-Json $res $result
                }
            }
        }
        else {
            # ---------- static files (Interfex pattern) ----------
            $file = Join-Path $root ($path.Replace('/', [IO.Path]::DirectorySeparatorChar))
            if ([IO.Directory]::Exists($file)) { $file = Join-Path $file 'index.html' }

            if ([IO.File]::Exists($file)) {
                $ct = switch ([IO.Path]::GetExtension($file).ToLower()) {
                    '.html'  { 'text/html; charset=utf-8' }
                    '.js'    { 'application/javascript' }
                    '.css'   { 'text/css' }
                    '.json'  { 'application/json' }
                    '.png'   { 'image/png' }
                    '.jpg'   { 'image/jpeg' }
                    '.jpeg'  { 'image/jpeg' }
                    '.svg'   { 'image/svg+xml' }
                    '.woff2' { 'font/woff2' }
                    '.ico'   { 'image/x-icon' }
                    default  { 'application/octet-stream' }
                }
                $res.StatusCode = 200
                $res.ContentType = $ct
                $res.ContentLength64 = (Get-Item $file).Length
                $fs = [IO.File]::OpenRead($file)
                $fs.CopyTo($res.OutputStream)
                $fs.Close()
            } else {
                $res.StatusCode = 404
            }
        }
    } catch { $res.StatusCode = 500 }
    try { $res.OutputStream.Close() } catch {}
}
