<#
.SYNOPSIS
    Start Anim Board: the FastAPI backend and the Vite frontend together.

.EXAMPLE
    .\run.ps1

.EXAMPLE
    # Serve the production build instead of the dev server.
    .\run.ps1 -Production
#>
[CmdletBinding()]
param(
    # Build the frontend and preview it rather than running the dev server.
    [switch]$Production,
    # Backend port (must match frontend/.env).
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# setup.ps1 may have installed Node or ffmpeg into .tools; make them visible
# here too, otherwise a machine that got them that way cannot start the app.
$toolsDir = Join-Path $root '.tools'
foreach ($toolPath in @((Join-Path $toolsDir 'node'), (Join-Path $toolsDir 'ffmpeg\bin'))) {
    if ((Test-Path $toolPath) -and ($env:Path -split ';' -notcontains $toolPath)) {
        $env:Path = "$toolPath;$env:Path"
    }
}

$venvPython = Join-Path $root 'venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    Write-Host 'The virtual environment is missing. Run .\setup.ps1 first.' -ForegroundColor Red
    exit 1
}
if (-not (Test-Path 'frontend\node_modules')) {
    Write-Host 'Frontend packages are missing. Run .\setup.ps1 first.' -ForegroundColor Red
    exit 1
}

# A stale server on the port would make the new one exit immediately, and the
# failure is easy to miss when it scrolls past in another window.
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    Write-Host "Port $Port is already in use by PID $($busy[0].OwningProcess)." -ForegroundColor Yellow
    Write-Host 'The backend may already be running. Stop it, or pass -Port to use another port.' -ForegroundColor Yellow
    exit 1
}

Write-Host "Starting backend on http://127.0.0.1:$Port ..." -ForegroundColor Cyan
$backend = Start-Process -FilePath $venvPython `
    -ArgumentList '-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', "$Port" `
    -PassThru -NoNewWindow

try {
    Write-Host 'Starting frontend...' -ForegroundColor Cyan
    Set-Location 'frontend'
    if ($Production) {
        npm run build
        npm run preview
    } else {
        npm run dev
    }
} finally {
    Set-Location $root
    if ($backend -and -not $backend.HasExited) {
        Write-Host "`nStopping backend..." -ForegroundColor Cyan
        Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
    }
}
