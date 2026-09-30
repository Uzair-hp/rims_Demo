# Ruchita Interiors - one-step run script.
#
# Verifies the project is set up (dependencies, Python venv, .env files and the
# database), performs first-time setup only for whatever is missing, then starts
# the API and web app together with `npm run dev`.
#
# Usage:
#   .\run.ps1            start the dev servers (foreground)
#   .\run.ps1 -Detached  start them in the background (npm run dev:start)
#   .\run.ps1 -Stop      stop background servers (npm run dev:stop)
#   .\run.ps1 -Status    report background server health

[CmdletBinding()]
param(
    [switch]$Detached,
    [switch]$Stop,
    [switch]$Status
)

$ErrorActionPreference = 'Stop'

# Always run from the repo root (the folder this script lives in).
Set-Location -Path $PSScriptRoot

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

# --- Short-circuit control commands (no setup needed) ---------------------
if ($Stop)   { Write-Step 'Stopping background dev servers'; npm run dev:stop;   exit $LASTEXITCODE }
if ($Status) { Write-Step 'Dev server status';               npm run dev:status; exit $LASTEXITCODE }

# --- Prerequisite checks --------------------------------------------------
Write-Step 'Checking prerequisites'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is not installed or not on PATH. Install Node >= 20.19 and retry.'
}
Write-Ok "node $(node --version)"

# Locate a Python interpreter: prefer the project venv, then python/python3.
$venvPython = Join-Path $PSScriptRoot 'backend\venv\Scripts\python.exe'
$pythonCmd = $null
if (Test-Path $venvPython) {
    $pythonCmd = $venvPython
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonCmd = 'python'
} elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
    $pythonCmd = 'python3'
} else {
    throw 'Python is not installed or not on PATH. Install Python 3 and retry.'
}

# --- One-time setup (only for what is missing) ----------------------------

# 1. Root + frontend node modules.
if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules')) -or
    -not (Test-Path (Join-Path $PSScriptRoot 'frontend\node_modules'))) {
    Write-Step 'Installing npm dependencies (first-time setup)'
    npm install
} else {
    Write-Ok 'npm dependencies present'
}

# 2. Python virtual environment.
if (-not (Test-Path $venvPython)) {
    Write-Step 'Creating Python virtual environment (first-time setup)'
    & $pythonCmd -m venv backend/venv
    $venvPython = Join-Path $PSScriptRoot 'backend\venv\Scripts\python.exe'
    Write-Step 'Installing backend dependencies'
    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
} else {
    Write-Ok 'Python venv present'
}

# 3. Environment files (copied from templates; secrets still need editing).
foreach ($pair in @(
    @{ Env = 'backend\.env';  Example = 'backend\.env.example' },
    @{ Env = 'frontend\.env'; Example = 'frontend\.env.example' }
)) {
    if (-not (Test-Path $pair.Env)) {
        if (Test-Path $pair.Example) {
            Copy-Item $pair.Example $pair.Env
            Write-Warn "Created $($pair.Env) from template - open it and set the secrets/credentials before signing in."
        } else {
            Write-Warn "Missing $($pair.Env) and no template found."
        }
    } else {
        Write-Ok "$($pair.Env) present"
    }
}

# 4. Database: create schema + seed on first run.
$dbFile = Join-Path $PSScriptRoot 'backend\instance\ruchita_interiors.db'
if (-not (Test-Path $dbFile)) {
    Write-Step 'Initialising the database (first-time setup)'
    Push-Location backend
    try {
        & $venvPython -m flask --app "app:create_app" db upgrade
        Write-Step 'Seeding the admin account and default settings'
        & $venvPython -m flask --app "app:create_app" seed-admin
        & $venvPython -m flask --app "app:create_app" seed-defaults
    } finally {
        Pop-Location
    }
} else {
    Write-Ok 'Database present'
}

# --- Start the servers ----------------------------------------------------
Write-Host ''
Write-Host 'Web app:      http://localhost:5173' -ForegroundColor White
Write-Host 'API:          http://127.0.0.1:5000' -ForegroundColor White
Write-Host 'Health check: http://127.0.0.1:5000/api/v1/health' -ForegroundColor White
Write-Host ''

if ($Detached) {
    Write-Step 'Starting API and web app (detached)'
    npm run dev:start
    Write-Host 'Servers started in the background. Use  .\run.ps1 -Status  or  .\run.ps1 -Stop.' -ForegroundColor Green
} else {
    Write-Step 'Starting API and web app (press Ctrl+C to stop)'
    npm run dev
}
