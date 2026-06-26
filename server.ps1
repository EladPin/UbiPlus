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

# ============================================================================
# UbiView NMS client (HTTP) - reverse-engineered from a real OSP HAR capture
# ============================================================================
# UbiView (the vendor NMS at 172.19.15.51/NMS) is a PHP web app with a two-stage
# login and an RPC-style endpoint (`adminservice.php`) that returns the data
# behind the TD Graphs, Spectrograms, OPTiX, Device Info tabs. The unit-level
# telnet ACL doesn't restrict our `idfuser` here - it's a different door with
# different (broader) permissions for `idfuser1` on the web.
#
# Two-stage login (verified from OSP HAR):
#   1. POST http://<host>/NMS/  body: access_login=<outerUser>&access_password=<outerPass>&Submit=Submit
#      -> sets cookies `verify=...` and `PHPSESSID=...`
#   2. POST http://<host>/NMS/adminservice.php body: method=user_login&username=<innerUser>&password=<innerPass>
#      -> returns {isAuth: true, hash: '...', userData: {...}}, marks the PHPSESSID as logged in
#
# All subsequent data calls POST form-urlencoded to /NMS/adminservice.php with
# method=<methodName>&...params. Cookies carry the session.
#
# Discovered methods (from HAR):
#   - getTreeData                  -> full fleet hierarchy with IP <-> ucuXXXX mapping
#   - getUbifixRRDData             -> TD Graph time-series (wb_power, in/out per channel, alarms)
#   - getUbifixInoutData           -> Spectrogram (per-bin power arrays, ~120 bins)
#   - getUbifixOptixModeData       -> OPTiX mode timeline per sector
#   - getDeviceInfo                -> static device metadata (part #, SW/HW versions, frequencies)

$script:UvState = [hashtable]::Synchronized(@{
    Session        = $null      # Microsoft.PowerShell.Commands.WebRequestSession (cookie jar)
    BaseUrl        = $null      # e.g. http://172.19.15.51/NMS
    OuterUser      = $null
    OuterPass      = $null
    InnerUser      = $null
    InnerPass      = $null
    LastLogin      = [DateTime]::MinValue
    LoggedIn       = $false
    UserData       = $null      # parsed userData from user_login response
})

# Normalise the base URL: strip trailing slash, prepend http:// if missing
function _NormaliseUvBase {
    param([string]$u)
    if (-not $u) { return $null }
    $u = $u.Trim().TrimEnd('/')
    if ($u -notmatch '^https?://') { $u = "http://$u" }
    return $u
}

# Force a fresh two-stage login regardless of current session state.
function Invoke-UvLogin {
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][string]$OuterUser,
        [Parameter(Mandatory)][string]$OuterPass,
        [Parameter(Mandatory)][string]$InnerUser,
        [Parameter(Mandatory)][string]$InnerPass
    )
    $BaseUrl = _NormaliseUvBase $BaseUrl
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

    # Stage 1: outer login (POST /NMS/) -> sets `verify` and `PHPSESSID` cookies
    $body1 = "access_login=$([Uri]::EscapeDataString($OuterUser))&access_password=$([Uri]::EscapeDataString($OuterPass))&Submit=Submit"
    try {
        $null = Invoke-WebRequest -Uri "$BaseUrl/" -Method POST -Body $body1 `
            -ContentType 'application/x-www-form-urlencoded' `
            -WebSession $session `
            -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
    } catch {
        return @{ ok = $false; stage = 'outer'; error = "Outer login failed: $($_.Exception.Message)" }
    }
    if ($session.Cookies.Count -eq 0) {
        return @{ ok = $false; stage = 'outer'; error = 'Outer login set no cookies (wrong outer credentials?)' }
    }

    # Stage 2: inner login (POST /NMS/adminservice.php method=user_login)
    $body2 = "method=user_login&username=$([Uri]::EscapeDataString($InnerUser))&password=$([Uri]::EscapeDataString($InnerPass))"
    try {
        $r2 = Invoke-WebRequest -Uri "$BaseUrl/adminservice.php" -Method POST -Body $body2 `
            -ContentType 'application/x-www-form-urlencoded; charset=UTF-8' `
            -WebSession $session `
            -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
    } catch {
        return @{ ok = $false; stage = 'inner'; error = "Inner login HTTP failed: $($_.Exception.Message)" }
    }

    $parsed = $null
    try { $parsed = $r2.Content | ConvertFrom-Json } catch {
        $snippet = if ($r2.Content) { $r2.Content.Substring(0, [Math]::Min(160, $r2.Content.Length)) } else { '(empty)' }
        return @{ ok = $false; stage = 'inner'; error = "Inner login response was not JSON: $snippet" }
    }
    if (-not $parsed.isAuth) {
        return @{ ok = $false; stage = 'inner'; error = "Inner login rejected (isAuth=false). Wrong UbiView username/password?" }
    }

    # *** Critical *** UbiView's frontend JS reads the user_login response and
    # sets a third cookie itself: uid=<uid>|<hash>. Without it, getTreeData and
    # every other data call comes back EMPTY (server treats the session as
    # half-authenticated). PowerShell's cookie jar doesn't pick this up
    # automatically because the cookie isn't in a Set-Cookie header - the JS
    # frontend writes it via document.cookie. We replicate that here.
    if ($parsed.uid -and $parsed.hash) {
        try {
            $uri = [Uri]$BaseUrl
            $cookie = New-Object System.Net.Cookie('uid', "$($parsed.uid)|$($parsed.hash)", '/', $uri.Host)
            $session.Cookies.Add($cookie)
            Write-Host "[UV] uid cookie set: uid=$($parsed.uid)|$($parsed.hash.Substring(0,8))..." -ForegroundColor DarkGray
        } catch {
            Write-Host "[UV] WARNING: failed to set uid cookie: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "[UV] WARNING: user_login response had no uid/hash - subsequent calls may return empty" -ForegroundColor Yellow
    }

    $script:UvState.Session   = $session
    $script:UvState.BaseUrl   = $BaseUrl
    $script:UvState.OuterUser = $OuterUser
    $script:UvState.OuterPass = $OuterPass
    $script:UvState.InnerUser = $InnerUser
    $script:UvState.InnerPass = $InnerPass
    $script:UvState.LastLogin = Get-Date
    $script:UvState.LoggedIn  = $true
    $script:UvState.UserData  = $parsed.userData
    Write-Host "[UV] Logged in as $InnerUser (uid=$($parsed.uid))" -ForegroundColor Green
    return @{ ok = $true; userData = $parsed.userData }
}

# Ensure we have an active session. Re-login if creds changed, or if no session
# exists, or if last login was >2h ago (PHP sessions usually last longer but
# this gives us auto-refresh).
function Ensure-UvSession {
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][string]$OuterUser,
        [Parameter(Mandatory)][string]$OuterPass,
        [Parameter(Mandatory)][string]$InnerUser,
        [Parameter(Mandatory)][string]$InnerPass
    )
    $BaseUrl = _NormaliseUvBase $BaseUrl
    $needLogin = (-not $script:UvState.LoggedIn) -or
                 ($script:UvState.BaseUrl  -ne $BaseUrl) -or
                 ($script:UvState.OuterUser -ne $OuterUser) -or
                 ($script:UvState.OuterPass -ne $OuterPass) -or
                 ($script:UvState.InnerUser -ne $InnerUser) -or
                 ($script:UvState.InnerPass -ne $InnerPass) -or
                 ((Get-Date) - $script:UvState.LastLogin).TotalMinutes -gt 120
    if ($needLogin) {
        return Invoke-UvLogin -BaseUrl $BaseUrl -OuterUser $OuterUser -OuterPass $OuterPass `
                              -InnerUser $InnerUser -InnerPass $InnerPass
    }
    return @{ ok = $true; userData = $script:UvState.UserData }
}

# Call adminservice.php with the given form-urlencoded body. Re-login on
# session-expired response (UbiView returns HTML instead of JSON when the
# PHPSESSID is dead). Returns @{ ok; raw } - we pass the raw JSON string back
# to the browser to avoid double-parse cost on huge responses (RRD can be 250KB+).
function Invoke-UvCall {
    param(
        [Parameter(Mandatory)][string]$Body,
        [int]$TimeoutSec = 45
    )
    if (-not $script:UvState.LoggedIn) {
        return @{ ok = $false; error = 'No active UbiView session - call /ubi/uv/login first' }
    }
    $url = "$($script:UvState.BaseUrl)/adminservice.php"
    try {
        $r = Invoke-WebRequest -Uri $url -Method POST -Body $Body `
            -ContentType 'application/x-www-form-urlencoded; charset=UTF-8' `
            -WebSession $script:UvState.Session -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
    } catch {
        return @{ ok = $false; error = "UV HTTP call failed: $($_.Exception.Message)" }
    }
    $text = $r.Content
    if ($text -and $text.TrimStart().StartsWith('<')) {
        # Session expired -> re-login once and retry the call
        $relog = Invoke-UvLogin -BaseUrl $script:UvState.BaseUrl `
            -OuterUser $script:UvState.OuterUser -OuterPass $script:UvState.OuterPass `
            -InnerUser $script:UvState.InnerUser -InnerPass $script:UvState.InnerPass
        if (-not $relog.ok) {
            return @{ ok = $false; error = "Session expired and re-login failed: $($relog.error)" }
        }
        try {
            $r = Invoke-WebRequest -Uri $url -Method POST -Body $Body `
                -ContentType 'application/x-www-form-urlencoded; charset=UTF-8' `
                -WebSession $script:UvState.Session -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
            $text = $r.Content
        } catch {
            return @{ ok = $false; error = "UV retry after re-login failed: $($_.Exception.Message)" }
        }
    }
    return @{ ok = $true; raw = $text }
}

# Helper: build form-urlencoded body from a hashtable of params.
function _UvFormBody {
    param([hashtable]$Params)
    $pairs = @()
    foreach ($k in $Params.Keys) {
        $v = $Params[$k]
        if ($null -eq $v) { continue }
        $pairs += "$([Uri]::EscapeDataString($k))=$([Uri]::EscapeDataString([string]$v))"
    }
    return ($pairs -join '&')
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

# Like Send-Json but accepts a pre-formatted JSON string and writes it verbatim.
# Used for the /ubi/uv/* data endpoints because their responses (tree, rrd, inout)
# are already valid JSON from UbiView - wrapping them in another @{ok;raw} object
# forces ConvertTo-Json to escape 100KB+ strings which is both slow in PS 5.1 and
# was producing output the browser couldn't parse. With this helper, the body IS
# the upstream JSON, and the HTTP status code carries the ok/error signal.
function Send-Raw {
    param($Response, [string]$Body, [int]$Code = 200)
    if (-not $Body) { $Body = '' }
    $buf = [Text.Encoding]::UTF8.GetBytes($Body)
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
        # ====================================================================
        # UbiView proxy endpoints (HTTP wrapper over the NMS adminservice.php)
        # ====================================================================
        elseif ($req.HttpMethod -eq 'POST' -and $path -like 'ubi/uv/*') {
            $body = Read-JsonBody $req
            # Defaulting (PS 5.1 hashtable initializers don't accept inline `if`)
            $baseUrl   = if ($body.baseUrl)   { [string]$body.baseUrl }   else { 'http://172.19.15.51/NMS' }
            $outerUser = if ($body.outerUser) { [string]$body.outerUser } else { '' }
            $outerPass = if ($body.outerPass) { [string]$body.outerPass } else { '' }
            $innerUser = if ($body.innerUser) { [string]$body.innerUser } else { '' }
            $innerPass = if ($body.innerPass) { [string]$body.innerPass } else { '' }

            if (-not $outerUser -or -not $outerPass -or -not $innerUser -or -not $innerPass) {
                Send-Json $res @{ error = 'Missing UbiView credentials (outerUser/outerPass/innerUser/innerPass required)' } 400
            } else {
                $sub = $path.Substring('ubi/uv/'.Length)
                Write-Host "[$([DateTime]::Now.ToString('HH:mm:ss'))] /ubi/uv/$sub" -ForegroundColor Magenta

                $loginResult = Ensure-UvSession -BaseUrl $baseUrl -OuterUser $outerUser -OuterPass $outerPass `
                                                -InnerUser $innerUser -InnerPass $innerPass
                if (-not $loginResult.ok) {
                    Send-Json $res @{ error = $loginResult.error; stage = $loginResult.stage } 502
                } else {
                    switch ($sub) {
                        'login' {
                            # Force-refresh: report the active session's userData
                            Send-Json $res @{ ok = $true; userData = $loginResult.userData }
                        }
                        'tree' {
                            $r = Invoke-UvCall -Body 'method=getTreeData'
                            if ($r.ok) { Send-Raw $res $r.raw }
                            else       { Send-Json $res @{ error = $r.error } 502 }
                        }
                        'rrd' {
                            $numOfAnts    = if ($null -ne $body.numOfAnts)    { $body.numOfAnts }    else { 0 }
                            $presetPeriod = if ($body.presetPeriod)           { $body.presetPeriod } else { 'last1hour' }
                            $secPerPixel  = if ($null -ne $body.secPerPixel)  { $body.secPerPixel }  else { 20 }
                            $antsCombo    = if ($null -ne $body.antsCombo)    { $body.antsCombo }    else { 0 }
                            $params = @{
                                method         = 'getUbifixRRDData'
                                childId        = $body.childId
                                customTreeId   = $body.customTreeId
                                nodeName       = $body.nodeName
                                numOfAnts      = $numOfAnts
                                presetPeriod   = $presetPeriod
                                secPerPixel    = $secPerPixel
                                antsCombo      = $antsCombo
                                isSuspectedPim = 0
                            }
                            $r = Invoke-UvCall -Body (_UvFormBody $params)
                            if ($r.ok) { Send-Raw $res $r.raw }
                            else       { Send-Json $res @{ error = $r.error } 502 }
                        }
                        'inout' {
                            $numOfAnts    = if ($null -ne $body.numOfAnts)    { $body.numOfAnts }    else { 2 }
                            $presetPeriod = if ($body.presetPeriod)           { $body.presetPeriod } else { 'last1hour' }
                            $secPerPixel  = if ($null -ne $body.secPerPixel)  { $body.secPerPixel }  else { 60 }
                            $params = @{
                                method                       = 'getUbifixInoutData'
                                childId                      = $body.childId
                                customTreeId                 = $body.customTreeId
                                nodeName                     = $body.nodeName
                                numOfAnts                    = $numOfAnts
                                presetPeriod                 = $presetPeriod
                                isAvg                        = 0
                                secPerPixel                  = $secPerPixel
                                isFdeq                       = 0
                                isSpectrogramDisplay2Columns = 0
                            }
                            $r = Invoke-UvCall -Body (_UvFormBody $params)
                            if ($r.ok) { Send-Raw $res $r.raw }
                            else       { Send-Json $res @{ error = $r.error } 502 }
                        }
                        'optix' {
                            $presetPeriod = if ($body.presetPeriod) { $body.presetPeriod } else { 'last6hours' }
                            $params = @{
                                method       = 'getUbifixOptixModeData'
                                childrenData = $body.childrenData
                                presetPeriod = $presetPeriod
                            }
                            $r = Invoke-UvCall -Body (_UvFormBody $params)
                            if ($r.ok) { Send-Raw $res $r.raw }
                            else       { Send-Json $res @{ error = $r.error } 502 }
                        }
                        'devinfo' {
                            $isUCU = if ($null -ne $body.isUCU) { [string]$body.isUCU } else { 'false' }
                            $params = @{
                                method            = 'getDeviceInfo'
                                isUCU             = $isUCU
                                deviceDisplayName = $body.deviceDisplayName
                            }
                            $r = Invoke-UvCall -Body (_UvFormBody $params)
                            if ($r.ok) { Send-Raw $res $r.raw }
                            else       { Send-Json $res @{ error = $r.error } 502 }
                        }
                        default {
                            Send-Json $res @{ error = "Unknown UV subpath: $sub" } 404
                        }
                    }
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
