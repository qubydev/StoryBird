<#
.SYNOPSIS
    One-shot setup for Anim Board on a fresh Windows machine.

.DESCRIPTION
    Installs and configures everything the app needs: Python, Node.js, ffmpeg,
    the Python virtual environment, the Chromium build used to drive Google
    Flow, the frontend packages, and the .env file.

    Safe to re-run. Every step detects what is already present and skips it,
    so this doubles as a repair script.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File setup.ps1

.EXAMPLE
    # Also pre-download the 1.2 GB alignment model instead of fetching it
    # during the first voiceover.
    powershell -ExecutionPolicy Bypass -File setup.ps1 -PrefetchModel
#>
[CmdletBinding()]
param(
    # Download the forced-alignment checkpoint now rather than on first use.
    [switch]$PrefetchModel,
    # Skip the Chromium download (Google Flow image generation will not work).
    [switch]$SkipBrowsers,
    # Delete and rebuild the virtual environment.
    [switch]$Recreate,
    # Never prompt; leave .env keys blank to fill in by hand.
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$script:warnings = @()

function Write-Step  ($text) { Write-Host "`n=== $text " -ForegroundColor Cyan -NoNewline; Write-Host ("=" * [Math]::Max(0, 60 - $text.Length)) -ForegroundColor Cyan }
function Write-Ok    ($text) { Write-Host "  [ok]   $text" -ForegroundColor Green }
function Write-Info  ($text) { Write-Host "  [..]   $text" -ForegroundColor Gray }
function Write-Warn  ($text) { Write-Host "  [warn] $text" -ForegroundColor Yellow; $script:warnings += $text }
function Write-Fail  ($text) { Write-Host "  [fail] $text" -ForegroundColor Red }

# A winget install writes PATH to the registry, but the running shell keeps its
# old copy. Without this refresh, a freshly installed tool looks missing.
function Update-PathFromRegistry {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = ($machine, $user | Where-Object { $_ }) -join ';'
}

function Test-Command ($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Install-WithWinget ($id, $label) {
    if (-not (Test-Command 'winget')) {
        Write-Warn "$label is missing and winget is unavailable. Install $label manually, then re-run this script."
        return $false
    }
    Write-Info "Installing $label via winget (this can take a few minutes)..."
    winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    Update-PathFromRegistry
    return $true
}

Write-Host @'

  +-------------------------------------------+
  |   A N I M   B O A R D   -   S E T U P     |
  |   script in, finished video out           |
  +-------------------------------------------+
'@ -ForegroundColor Magenta

# -------------------- 1. Python ---------------------------------------------------------------
Write-Step 'Python 3.10+'
$python = $null
foreach ($candidate in @('python', 'python3', 'py')) {
    if (-not (Test-Command $candidate)) { continue }
    try { $raw = & $candidate --version 2>&1 } catch { continue }
    if ("$raw" -match '(\d+)\.(\d+)\.(\d+)') {
        $major = [int]$Matches[1]; $minor = [int]$Matches[2]
        if ($major -eq 3 -and $minor -ge 10) { $python = $candidate; Write-Ok "Found $raw"; break }
        Write-Info "$candidate is $raw - needs 3.10 or newer"
    }
}

if (-not $python) {
    if (Install-WithWinget 'Python.Python.3.12' 'Python 3.12') {
        foreach ($candidate in @('python', 'py')) {
            if (Test-Command $candidate) { $python = $candidate; break }
        }
    }
    if (-not $python) {
        Write-Fail 'Python 3.10+ is required. Install it from https://python.org and re-run.'
        exit 1
    }
    Write-Ok "Installed $(& $python --version 2>&1)"
}

# torch has no wheels beyond 3.13 yet; alignment would silently fall back.
$versionText = "$(& $python --version 2>&1)"
if ($versionText -match '3\.(\d+)' -and [int]$Matches[1] -ge 14) {
    Write-Warn "Python $versionText may have no PyTorch wheels. If alignment fails to install, use Python 3.12."
}

# -------------------- 2. Node.js --------------------------------------------------------------
Write-Step 'Node.js 18+'
if (Test-Command 'node') {
    $nodeVersion = (& node --version) -replace 'v', ''
    if ([int]($nodeVersion -split '\.')[0] -ge 18) { Write-Ok "Found Node $nodeVersion" }
    else { Write-Warn "Node $nodeVersion is old; the frontend needs 18+." }
} else {
    if (-not (Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS')) {
        Write-Fail 'Node.js is required for the frontend. Install it from https://nodejs.org and re-run.'
        exit 1
    }
    Write-Ok "Installed Node $((& node --version) -replace 'v','')"
}

# -------------------- 3. ffmpeg ---------------------------------------------------------------
Write-Step 'ffmpeg'
if (Test-Command 'ffmpeg') {
    Write-Ok "Found $(((& ffmpeg -version 2>&1) | Select-Object -First 1))"
} else {
    Install-WithWinget 'Gyan.FFmpeg' 'ffmpeg' | Out-Null
    if (Test-Command 'ffmpeg') {
        Write-Ok 'ffmpeg installed'
    } else {
        # Not fatal at setup time, but video export and alignment both need it.
        Write-Warn 'ffmpeg is not on PATH. Video export and script alignment will fail until it is. Install from https://ffmpeg.org/download.html, then reopen your terminal.'
    }
}

# -------------------- 4. Virtual environment --------------------------------------------------
Write-Step 'Python virtual environment'
$venvPython = Join-Path $root 'venv\Scripts\python.exe'

if ($Recreate -and (Test-Path 'venv')) {
    Write-Info 'Removing the existing venv (-Recreate)...'
    Remove-Item 'venv' -Recurse -Force
}

if (Test-Path $venvPython) {
    Write-Ok 'venv already exists'
} else {
    Write-Info 'Creating venv...'
    & $python -m venv venv
    if (-not (Test-Path $venvPython)) { Write-Fail 'Could not create the virtual environment.'; exit 1 }
    Write-Ok 'venv created'
}

Write-Info 'Upgrading pip...'
& $venvPython -m pip install --quiet --upgrade pip setuptools wheel

# -------------------- 5. Python packages ------------------------------------------------------
Write-Step 'Python packages'

# CPU wheels must be installed first and explicitly. requirements.txt lists
# torch/torchaudio plainly, and plain pip would pull multi-gigabyte CUDA builds
# this app never uses.
$torchInstalled = $false
& $venvPython -c "import torch, torchaudio" 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Ok "torch $(& $venvPython -c 'import torch; print(torch.__version__)') already installed"
    $torchInstalled = $true
} else {
    Write-Info 'Installing CPU builds of torch and torchaudio (~250 MB)...'
    & $venvPython -m pip install --quiet torch torchaudio --index-url https://download.pytorch.org/whl/cpu
    & $venvPython -c "import torch, torchaudio" 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Ok 'torch and torchaudio installed'; $torchInstalled = $true }
    else { Write-Warn 'torch could not be installed. The app still runs; sentence timings fall back to an estimate.' }
}

Write-Info 'Installing the remaining requirements...'
& $venvPython -m pip install --quiet -r requirements.txt
if ($LASTEXITCODE -ne 0) { Write-Fail 'pip install -r requirements.txt failed.'; exit 1 }
Write-Ok 'Python packages installed'

# -------------------- 6. Chromium for Google Flow ---------------------------------------------
Write-Step 'Chromium (drives Google Flow)'
if ($SkipBrowsers) {
    Write-Warn 'Skipped (-SkipBrowsers). Image generation will not work until you run: venv\Scripts\patchright install chromium'
} else {
    $browserCache = Join-Path $env:USERPROFILE 'AppData\Local\ms-playwright'
    $haveChromium = (Test-Path $browserCache) -and (Get-ChildItem $browserCache -Filter 'chromium-*' -ErrorAction SilentlyContinue)
    if ($haveChromium) {
        Write-Ok 'Chromium already downloaded'
    } else {
        Write-Info 'Downloading Chromium (~150 MB)...'
        & $venvPython -m patchright install chromium
        if ($LASTEXITCODE -eq 0) { Write-Ok 'Chromium installed' }
        else { Write-Warn 'Chromium download failed. Run "venv\Scripts\patchright install chromium" later; image generation needs it.' }
    }
}

# -------------------- 7. Environment file -----------------------------------------------------
Write-Step 'Configuration (.env)'
if (Test-Path '.env') {
    Write-Ok '.env already exists - leaving it untouched'
} else {
    Copy-Item '.env.example' '.env'
    Write-Ok 'Created .env from .env.example'

    if (-not $NonInteractive) {
        Write-Host ''
        Write-Host '  Paste your API keys now, or press Enter to skip and edit .env later.' -ForegroundColor Yellow

        $prompts = @(
            @{ Key = 'FAMESPEAK_API_KEY'; Label = 'FameSpeak API key (voiceover)      https://famespeak.online' },
            @{ Key = 'OPENROUTER_API_KEY'; Label = 'OpenRouter API key (prompts)       https://openrouter.ai/keys' },
            @{ Key = 'GROQ_API_KEY';       Label = 'Groq API key (optional fallback)   https://console.groq.com/keys' }
        )

        $envText = Get-Content '.env' -Raw
        foreach ($prompt in $prompts) {
            Write-Host ''
            Write-Host "  $($prompt.Label)" -ForegroundColor Gray
            $value = Read-Host "  $($prompt.Key)"
            if ($value -and $value.Trim()) {
                $envText = $envText -replace "(?m)^$($prompt.Key)=.*$", "$($prompt.Key)=$($value.Trim())"
            }
        }
        Set-Content '.env' $envText -Encoding utf8 -NoNewline
        Write-Ok 'Saved .env'
    }
}

# The app accepts several spellings: FAMESPEAK_API_KEY or FAMESPEAK_API,
# OPENROUTER_API_KEY or OPENROUTER_API, and GROQ_API_KEY or GROQ_API_KEY_<n>
# (numbered keys are rotated on rate limits). Accept them all, or a valid
# config gets warned about for no reason.
$envContent = Get-Content '.env' -Raw
if ($envContent -notmatch '(?m)^FAMESPEAK_API(_KEY)?=\S') {
    Write-Warn 'No FameSpeak key set - voiceover generation will fail until FAMESPEAK_API_KEY is set in .env'
}
if ($envContent -notmatch '(?m)^(OPENROUTER_API(_KEY)?|GROQ_API_KEY(_\d+)?)=\S') {
    Write-Warn 'No LLM key set - scene grouping and image prompts will fail until OPENROUTER_API_KEY or GROQ_API_KEY is set in .env'
}

# -------------------- 8. Frontend -------------------------------------------------------------
Write-Step 'Frontend packages'
Push-Location 'frontend'
try {
    if (-not (Test-Path 'frontend\.env') -and -not (Test-Path '.env')) {
        Set-Content '.env' 'VITE_BACKEND_URL=http://127.0.0.1:8000' -Encoding utf8
        Write-Ok 'Created frontend/.env'
    }

    if (Test-Path 'node_modules') {
        Write-Ok 'node_modules already present'
    } else {
        Write-Info 'Running npm install (a few minutes on first run)...'
        npm install --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) { Write-Fail 'npm install failed.'; exit 1 }
        Write-Ok 'Frontend packages installed'
    }
} finally {
    Pop-Location
}

# -------------------- 9. Alignment model (optional) -------------------------------------------
Write-Step 'Forced-alignment model'
if (-not $torchInstalled) {
    Write-Warn 'Skipped: torch is not installed.'
} elseif ($PrefetchModel) {
    Write-Info 'Downloading the MMS_FA checkpoint (~1.2 GB, one time)...'
    & $venvPython -c "import torchaudio; torchaudio.pipelines.MMS_FA.get_model(with_star=False); print('ready')"
    if ($LASTEXITCODE -eq 0) { Write-Ok 'Alignment model cached' }
    else { Write-Warn 'Model download failed; it will retry during the first voiceover.' }
} else {
    Write-Info 'Not downloaded. The 1.2 GB checkpoint is fetched during the first voiceover.'
    Write-Info 'Re-run with -PrefetchModel to get it now instead.'
}

# -------------------- 10. Verify --------------------------------------------------------------
Write-Step 'Verifying the install'
& $venvPython -c "import app; import routes; print('backend imports ok')"
if ($LASTEXITCODE -ne 0) { Write-Fail 'The backend failed to import. Check the error above.'; exit 1 }
Write-Ok 'Backend imports cleanly'

& $venvPython -c "from utils.align import is_available; print('alignment available:', is_available())"

if (Test-Command 'ffmpeg') { Write-Ok 'ffmpeg reachable' } else { Write-Warn 'ffmpeg still not on PATH - reopen your terminal after installing it' }

# -------------------- Done --------------------------------------------------------------------
Write-Host ''
if ($script:warnings.Count -gt 0) {
    Write-Host "  Setup finished with $($script:warnings.Count) warning(s):" -ForegroundColor Yellow
    foreach ($warning in $script:warnings) { Write-Host "    - $warning" -ForegroundColor Yellow }
} else {
    Write-Host '  Setup complete. Everything is ready.' -ForegroundColor Green
}

Write-Host @'

  Start the app:      .\run.ps1
  Then open:          http://localhost:5173

  Before your first video, open Settings on the dashboard and paste your
  Google Flow cookies - image generation needs a signed-in Flow account.

'@ -ForegroundColor Cyan
