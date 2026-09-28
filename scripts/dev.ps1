<#
.SYNOPSIS
    Starts, stops and inspects the Ruchita Interiors development servers.

.DESCRIPTION
    The backend and the Vite dev server are long-lived services. They must not be
    tied to the lifetime of whatever shell happens to launch them, so this script
    starts them detached: each process is created through WMI (`Win32_Process.Create`),
    which parents it to the WMI service host rather than to the calling shell. A
    process started with `Start-Process` is a child of that shell and dies with it,
    which is the bug this script exists to fix.

    Two other rules the script enforces, because getting them wrong is easy:

    - Never kill a process just because a port is busy. The port is checked first,
      and an existing healthy server is reused.
    - Only ever stop a process this project owns: a PID recorded in `.dev/`, or a
      listener whose command line points inside this repository. A process we do not
      recognise is reported, not terminated.

    Stopping is graceful first (`taskkill /T`), escalating to a forced kill only if
    the tree is still alive after the grace period.

.PARAMETER Action
    start | stop | restart | status, optionally suffixed with `:api` or `:web`.

.EXAMPLE
    .\scripts\dev.ps1 start
    .\scripts\dev.ps1 status
    .\scripts\dev.ps1 stop:web
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string] $Action = 'status'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot    = Split-Path -Parent $PSScriptRoot
$BackendDir  = Join-Path $RepoRoot 'backend'
$FrontendDir = Join-Path $RepoRoot 'frontend'
$StateDir    = Join-Path $RepoRoot '.dev'
$LogDir      = Join-Path $StateDir 'logs'

$ApiPort = 5000
$WebPort = 5173
$ApiHost = '127.0.0.1'
$WebHost = '127.0.0.1'

$Services = @{
    api = @{
        Name    = 'api'
        Port    = $ApiPort
        Host    = $ApiHost
        Health  = "http://$ApiHost`:$ApiPort/api/v1/health"
        WorkDir = $BackendDir
        Cmd     = 'run-api.cmd'
    }
    web = @{
        Name    = 'web'
        Port    = $WebPort
        Host    = $WebHost
        Health  = "http://$WebHost`:$WebPort/"
        # Vite's host default resolved to `::1` on this machine, so a 127.0.0.1 probe
        # failed against a perfectly healthy server. vite.config.js now pins the
        # host, and these extra URLs keep the check honest either way.
        HealthUrls = @("http://127.0.0.1:$WebPort/", "http://localhost:$WebPort/")
        WorkDir = $FrontendDir
        Cmd     = 'run-web.cmd'
    }
}

# ----------------------------------------------------------------------------
# Output helpers
# ----------------------------------------------------------------------------

function Write-Info    { param($Message) Write-Host "  $Message" -ForegroundColor Gray }
function Write-Ok      { param($Message) Write-Host "  $Message" -ForegroundColor Green }
function Write-Warn    { param($Message) Write-Host "  $Message" -ForegroundColor Yellow }
function Write-Failure { param($Message) Write-Host "  $Message" -ForegroundColor Red }
function Write-Head    { param($Message) Write-Host "`n$Message" -ForegroundColor Cyan }

# ----------------------------------------------------------------------------
# Port and process inspection
# ----------------------------------------------------------------------------

function Get-Listener {
    <#
    PIDs recorded in the TCP table as listening on a port, from `netstat -ano`.

    Deliberately *not* filtered for liveness, and deliberately not treated as proof
    that a service is running. Two Windows behaviours make that unreliable:

    - The table attributes a listening socket to the process that created it. The
      Flask debug reloader creates the socket in the parent, which then exits, so
      netstat keeps naming a dead PID while a live child still serves the port.
      Filtering those rows out reported a healthy API as "stopped".
    - Rows outlive the processes they name.

    `netstat` is used over `Get-NetTCPConnection` because the latter is WMI-backed
    and was returning both stale and missing rows.

    Liveness is decided by `Test-Healthy`. These PIDs are only used to find
    candidates to stop, and every candidate is re-verified before being killed.
    #>
    param([int] $Port)

    $pattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"

    $pids = foreach ($line in (& netstat -ano 2>$null)) {
        if ($line -notmatch $pattern) { continue }
        [int] $Matches[1]
    }

    return @($pids | Sort-Object -Unique)
}

function Get-LiveProjectProcess {
    <#
    Live processes belonging to a service, found by command line rather than by
    port. This is what makes stopping reliable: the reloader child that actually
    holds the port is not the PID the TCP table names, so the tree is located
    through the launcher and through the command line instead.

    A process qualifies only when its command line points inside this repository, so
    nothing unrelated is ever selected.
    #>
    param([string] $Pattern)

    $matches = foreach ($process in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
        if (-not $process.CommandLine) { continue }
        if ($process.CommandLine -notlike "*$RepoRoot*") { continue }
        if ($process.CommandLine -notmatch $Pattern) { continue }

        [pscustomobject] @{
            Pid         = [int] $process.ProcessId
            ParentPid   = [int] $process.ParentProcessId
            ProcessName = $process.Name
            CommandLine = $process.CommandLine
        }
    }

    return @($matches | Sort-Object Pid)
}

function Get-ServiceProcessPattern {
    <# Matches this project's processes for a service, excluding other services. #>
    param([hashtable] $Service)

    if ($Service.Name -eq 'api') {
        # `run.py` is the launcher; the reloader child repeats the same command line.
        return 'run\.py'
    }
    return 'vite'
}

function Test-Healthy {
    <#
    True when the service answers one of its health URLs with 2xx. A service may
    list more than one URL: the dev server is reachable on 127.0.0.1 but binds IPv6
    loopback in some setups, and probing only one of them would report a healthy
    server as broken.
    #>
    param([hashtable] $Service)

    $urls = if ($Service.ContainsKey('HealthUrls') -and $Service.HealthUrls) {
        $Service.HealthUrls
    } else {
        @($Service.Health)
    }

    foreach ($url in $urls) {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { return $true }
        } catch {
            # Try the next URL.
        }
    }

    return $false
}

function Get-RecordedPid {
    param([string] $Name)

    $pidFile = Join-Path $StateDir "$Name.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) { return $null }

    $recorded = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    if ($recorded -match '^\d+$') { return [int] $recorded }
    return $null
}

function Save-Pid {
    param([string] $Name, [int] $ProcessId)

    Set-Content -LiteralPath (Join-Path $StateDir "$Name.pid") -Value $ProcessId -Encoding ascii
}

function Remove-PidFile {
    param([string] $Name)

    $pidFile = Join-Path $StateDir "$Name.pid"
    if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
}

# ----------------------------------------------------------------------------
# Detached start
# ----------------------------------------------------------------------------

function Resolve-Python {
    <# The project interpreter, preferring the checked-in virtualenv. #>
    foreach ($candidate in @('venv\Scripts\python.exe', '.venv\Scripts\python.exe')) {
        $path = Join-Path $BackendDir $candidate
        if (Test-Path -LiteralPath $path) { return $path }
    }

    $onPath = Get-Command python -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    throw "No Python interpreter found. Create backend\venv or install Python 3.12+."
}

function New-Launcher {
    <#
    Writes the .cmd wrapper the detached process runs. Regenerated on every start
    so it can never hold a stale path or port, and kept on disk so the exact
    command is inspectable after the fact.
    #>
    param([hashtable] $Service, [string] $Interpreter, [string] $Port)

    $logFile = Join-Path $LogDir "$($Service.Name).log"
    $body = switch ($Service.Name) {
        'api' {
            @(
                '@echo off',
                "cd /d `"$($Service.WorkDir)`"",
                "`"$Interpreter`" run.py >> `"$logFile`" 2>&1"
            )
        }
        'web' {
            $vite = Join-Path $FrontendDir 'node_modules\vite\bin\vite.js'
            @(
                '@echo off',
                "cd /d `"$($Service.WorkDir)`"",
                "`"$Interpreter`" `"$vite`" --port $Port --strictPort >> `"$logFile`" 2>&1"
            )
        }
    }

    $launcher = Join-Path $StateDir $Service.Cmd
    Set-Content -LiteralPath $launcher -Value ($body -join "`r`n") -Encoding ascii
    return $launcher
}

function Start-Detached {
    <#
    Creates a process through WMI so it is parented to the WMI service host and
    survives the shell that launched it. Start-Process cannot do this: its child
    dies when the caller's session is torn down.
    #>
    param([string] $Launcher)

    $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = "cmd /c `"$Launcher`""
    }

    if ($result.ReturnValue -ne 0) {
        throw "Failed to create process (WMI return $($result.ReturnValue))"
    }

    return [int] $result.ProcessId
}

function Wait-Healthy {
    param([hashtable] $Service, [int] $TimeoutSeconds = 45)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Healthy -Service $Service) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

# ----------------------------------------------------------------------------
# Actions
# ----------------------------------------------------------------------------

function Start-Service {
    param([hashtable] $Service)

    Write-Head "$($Service.Name)  http://$($Service.Host):$($Service.Port)"

    $healthy = Test-Healthy -Service $Service
    $ours = @(Get-LiveProjectProcess -Pattern (Get-ServiceProcessPattern -Service $Service))

    if ($healthy) {
        Write-Ok "already running and healthy - reusing"
        return $true
    }

    # Not serving. A port can be held by something outside this project: that is
    # reported and never stopped, because it is not ours to kill.
    $foreign = @(Get-NetTCPConnection -State Listen -LocalPort $Service.Port -ErrorAction SilentlyContinue |
        ForEach-Object { Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" -ErrorAction SilentlyContinue } |
        Where-Object { $_ -and $_.CommandLine -and $_.CommandLine -notlike "*$RepoRoot*" } |
        Sort-Object ProcessId -Unique)
    if ($foreign) {
        Write-Failure "port $($Service.Port) is held by a process outside this project:"
        foreach ($process in $foreign) {
            Write-Info "pid $($process.ProcessId) $($process.Name)"
            Write-Info $process.CommandLine
        }
        Write-Failure 'refusing to stop it. Free the port and re-run.'
        return $false
    }

    if ($ours.Count -gt 0) {
        Write-Warn "$($ours.Count) process(es) of this project are alive but not serving - stopping them"
    }

    # Stop the recorded launcher first: it is the ancestor of the reloader child that
    # owns the port, so killing it takes the whole tree.
    $recorded = Get-RecordedPid -Name $Service.Name
    if ($recorded -and (Get-Process -Id $recorded -ErrorAction SilentlyContinue)) {
        Stop-ProcessTree -ProcessId $recorded
    }
    foreach ($process in $ours) {
        if (Get-Process -Id $process.Pid -ErrorAction SilentlyContinue) {
            Stop-ProcessTree -ProcessId $process.Pid
        }
    }

    $interpreter = if ($Service.Name -eq 'api') { Resolve-Python } else { (Get-Command node -ErrorAction Stop).Source }
    $launcher = New-Launcher -Service $Service -Interpreter $interpreter -Port $Service.Port
    $processId = Start-Detached -Launcher $launcher
    Save-Pid -Name $Service.Name -ProcessId $processId

    if (Wait-Healthy -Service $Service) {
        Write-Ok "started (pid $processId) and healthy"
        return $true
    }

    Write-Failure "started (pid $processId) but never became healthy"
    Write-Info "see $(Join-Path $LogDir "$($Service.Name).log")"
    return $false
}

function Invoke-Quiet {
    <# Runs a native command with its output discarded and its exit code returned. #>
    param([string] $Command, [string[]] $Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        $global:LASTEXITCODE = 0
        & $Command @Arguments 2>&1 | Out-Null
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Stop-ProcessTree {
    <#
    Stops a process and its children.

    `taskkill /T` walks the tree from the given PID, which only works while the
    parent is still alive - a recorded launcher whose parent shell has already gone
    is exactly the case this script hits, and taskkill then fails with "could not be
    terminated". So the children are resolved from the process table and stopped
    individually, deepest first, and only the forced path uses `Stop-Process -Force`.
    #>
    param([int] $ProcessId, [int] $GraceSeconds = 5)

    $root = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $root) { return }

    # `taskkill /T` when the tree is still rooted at a live parent; this is the
    # polite request.
    if (Invoke-Quiet -Command 'taskkill' -Arguments @('/PID', "$ProcessId", '/T') -eq 0) {
        $deadline = (Get-Date).AddSeconds($GraceSeconds)
        while ((Get-Date) -lt $deadline) {
            if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return }
            Start-Sleep -Milliseconds 250
        }
    }

    # Either the tree was already orphaned, or it ignored the polite request.
    # Enumerate the descendants ourselves and stop them deepest-first so the Flask
    # debug reloader child cannot outlive its launcher and keep the port.
    $descendants = Get-DescendantProcessIds -ProcessId $ProcessId
    foreach ($childId in $descendants) {
        $child = Get-Process -Id $childId -ErrorAction SilentlyContinue
        if ($child) { $child.CloseMainWindow() | Out-Null }
    }

    Start-Sleep -Milliseconds 500
    foreach ($childId in $descendants) {
        Stop-Process -Id $childId -Force -ErrorAction SilentlyContinue
    }

    $root = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($root) { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue }
}

function Get-DescendantProcessIds {
    <# Every PID beneath the given one, deepest first, so a tree is stopped leaf-up. #>
    param([int] $ProcessId)

    $children = @{}
    foreach ($process in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
        if ($null -eq $process.ParentProcessId) { continue }
        if (-not $children.ContainsKey($process.ParentProcessId)) {
            $children[$process.ParentProcessId] = New-Object System.Collections.ArrayList
        }
        [void] $children[$process.ParentProcessId].Add($process.ProcessId)
    }

    $ordered = New-Object System.Collections.ArrayList
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($ProcessId)
    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        if (-not $children.ContainsKey($current)) { continue }
        foreach ($childId in $children[$current]) {
            [void] $ordered.Add($childId)
            $queue.Enqueue($childId)
        }
    }

    return @($ordered)
}

function Stop-Service {
    param([hashtable] $Service)

    Write-Head "$($Service.Name)  http://$($Service.Host):$($Service.Port)"

    $recorded = Get-RecordedPid -Name $Service.Name
    $ours = @(Get-LiveProjectProcess -Pattern (Get-ServiceProcessPattern -Service $Service))

    if ($ours.Count -eq 0) {
        Write-Info 'not running'
        Remove-PidFile -Name $Service.Name
        return
    }

    # Stop the recorded launcher first: it is the ancestor of the reloader child, so
    # killing it takes the whole tree and releases the port cleanly.
    if ($recorded -and (Get-Process -Id $recorded -ErrorAction SilentlyContinue)) {
        Stop-ProcessTree -ProcessId $recorded
        Write-Ok "stopped launcher pid $recorded"
    }

    # Then anything of ours still alive, found by command line. This is what reaches
    # the reloader child that actually holds the port, which the TCP table does not
    # reliably name.
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline) {
        $ours = @(Get-LiveProjectProcess -Pattern (Get-ServiceProcessPattern -Service $Service))
        if ($ours.Count -eq 0) { break }
        foreach ($process in $ours) {
            Stop-ProcessTree -ProcessId $process.Pid
        }
        Start-Sleep -Milliseconds 250
    }

    $ours = @(Get-LiveProjectProcess -Pattern (Get-ServiceProcessPattern -Service $Service))
    if ($ours.Count -gt 0) {
        foreach ($process in $ours) {
            Write-Warn "pid $($process.Pid) ($($process.ProcessName)) survived - forcing"
            Stop-Process -Id $process.Pid -Force -ErrorAction SilentlyContinue
        }
    }

    if (@(Get-LiveProjectProcess -Pattern (Get-ServiceProcessPattern -Service $Service)).Count -gt 0) {
        Write-Failure "could not stop every process on port $($Service.Port)"
    } else {
        Write-Ok 'stopped'
    }

    Remove-PidFile -Name $Service.Name
}

function Show-Service {
    param([hashtable] $Service)

    # Liveness is the health check, not the process table: Windows keeps naming the
    # dead parent PID for a socket the reloader child inherited, so a PID check
    # would call a working server "stopped".
    $healthy = Test-Healthy -Service $Service
    $ours = @(Get-LiveProjectProcess -Pattern (Get-ServiceProcessPattern -Service $Service))
    $recorded = Get-RecordedPid -Name $Service.Name

    if ($healthy) {
        $label = 'healthy'
        $colour = 'Green'
    } elseif ($ours.Count -gt 0) {
        $label = 'unhealthy'
        $colour = 'Yellow'
    } else {
        $label = 'stopped'
        $colour = 'DarkGray'
    }

    $pidText = if ($recorded) { "pid $recorded" } elseif ($ours.Count) { "pids $((@($ours).Pid) -join ',')" } else { '' }
    $extras = if ($ours.Count -gt 2) { "  [$($ours.Count) processes]" } else { '' }

    Write-Host ("  {0} {1,-10} {2}{3}  {4}" -f `
        $Service.Name.PadRight(4), $label, $pidText, $extras, "http://$($Service.Host):$($Service.Port)") `
        -ForegroundColor $colour
}

# ----------------------------------------------------------------------------
# Entry point
# ----------------------------------------------------------------------------

$verb, $target = $Action.Split(':')
$verb = $verb.ToLower()
$target = if ($target) { $target.ToLower() } else { 'all' }

if ($verb -notin @('start', 'stop', 'restart', 'status')) {
    throw "Unknown action '$Action'. Use start|stop|restart|status, optionally suffixed with :api or :web."
}

$selected = if ($target -eq 'all') { @('api', 'web') } else { @($target) }
foreach ($name in $selected) {
    if (-not $Services.ContainsKey($name)) { throw "Unknown service '$name'. Use api or web." }
}

if ($verb -ne 'status' -and -not (Test-Path -LiteralPath $StateDir)) {
    New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
}
if ($verb -eq 'start' -and -not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$failures = @()

switch ($verb) {
    'start'   { $failures = @($selected | Where-Object { -not (Start-Service -Service $Services[$_]) }) }
    'stop'    { $selected | ForEach-Object { Stop-Service -Service $Services[$_] } }
    'restart' {
        $selected | ForEach-Object { Stop-Service -Service $Services[$_] }
        $failures = @($selected | Where-Object { -not (Start-Service -Service $Services[$_]) })
    }
    'status'  {
        Write-Head 'dev servers'
        $selected | ForEach-Object { Show-Service -Service $Services[$_] }
    }
}

if ($verb -ne 'status') {
    Write-Head 'status'
    $selected | ForEach-Object { Show-Service -Service $Services[$_] }
}

if ($failures) {
    throw "Failed to start: $($failures -join ', '). See the logs in $LogDir."
}
