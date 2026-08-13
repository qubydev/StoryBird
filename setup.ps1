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

# Probe for installed modules WITHOUT importing them and without writing to
# stderr. Redirecting a native command's stderr (2>$null) makes PowerShell 5.1
# raise a terminating NativeCommandError while ErrorActionPreference is 'Stop',
# which aborted setup on what is only meant to be a question.
function Test-PythonModule ($interpreter, [string[]]$modules) {
    $list = ($modules | ForEach-Object { "'$_'" }) -join ','
    $code = "import importlib.util as u; print('yes' if all(u.find_spec(m) for m in [$list]) else 'no')"
    $answer = & $interpreter -c $code
    return ("$answer".Trim() -eq 'yes')
}

# Tools we install ourselves live here, so nothing needs administrator rights
# and nothing is scattered across the machine.
$script:toolsDir = Join-Path $root '.tools'

function Add-ToolPath ($directory) {
    if (-not $directory -or -not (Test-Path $directory)) { return }
    if ($env:Path -split ';' -notcontains $directory) { $env:Path = "$directory;$env:Path" }
    # Persist for future shells, without touching the machine-wide PATH.
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (($userPath -split ';') -notcontains $directory) {
        [Environment]::SetEnvironmentVariable('Path', "$directory;$userPath", 'User')
    }
}

function Get-RemoteFile ($url, $destination) {
    # PowerShell 5.1 defaults to TLS 1.0, which these hosts refuse.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $progressPreferenceOld = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'   # a visible progress bar makes downloads far slower
    try {
        Invoke-WebRequest -Uri $url -OutFile $destination -UseBasicParsing
        return $true
    } catch {
        Write-Info "Download failed: $($_.Exception.Message)"
        return $false
    } finally {
        $ProgressPreference = $progressPreferenceOld
    }
}

function Invoke-Winget ($id, $extraArgs) {
    if (-not (Test-Command 'winget')) { return $false }
    Write-Info "Trying winget: $id"
    # winget writes to stderr routinely and returns non-zero for conditions like
    # "already installed", so its exit code is not trustworthy. Verification
    # after the fact is what decides success.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $arguments = @('install', '--id', $id, '--exact', '--silent',
                       '--accept-package-agreements', '--accept-source-agreements')
        if ($extraArgs) { $arguments += $extraArgs }
        & winget @arguments | Out-Null
    } catch {
        Write-Info "winget could not install $id : $($_.Exception.Message)"
    } finally {
        $ErrorActionPreference = $previous
    }
    Update-PathFromRegistry
    return $true
}

# Freshly installed tools are often not on PATH yet in this process, so look in
# the standard install locations before declaring failure.
function Find-InstalledBinary ($fileName, [string[]]$searchRoots) {
    foreach ($searchRoot in $searchRoots) {
        if (-not $searchRoot -or -not (Test-Path $searchRoot)) { continue }
        $found = Get-ChildItem -Path $searchRoot -Filter $fileName -Recurse -ErrorAction SilentlyContinue |
                 Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

Write-Host @'

  +-------------------------------------------+
  |   A N I M   B O A R D   -   S E T U P     |
  |   script in, finished video out           |
  +-------------------------------------------+
'@ -ForegroundColor Magenta

# -------------------- 1. Python ---------------------------------------------------------------
Write-Step 'Python 3.10+'

function Find-Python {
    foreach ($candidate in @('python', 'python3', 'py')) {
        if (-not (Test-Command $candidate)) { continue }
        try { $raw = & $candidate --version } catch { continue }
        if ("$raw" -match '(\d+)\.(\d+)\.(\d+)') {
            if ([int]$Matches[1] -eq 3 -and [int]$Matches[2] -ge 10) { return $candidate }
        }
    }
    # The Windows Store stub answers `python` but installs nothing, so also look
    # where real installs land.
    $probe = Find-InstalledBinary 'python.exe' @(
        "$env:LOCALAPPDATA\Programs\Python",
        "$env:ProgramFiles\Python313", "$env:ProgramFiles\Python312",
        "$env:ProgramFiles\Python311", "$env:ProgramFiles\Python310"
    )
    if ($probe) {
        try { $raw = & $probe --version } catch { return $null }
        if ("$raw" -match '3\.(\d+)' -and [int]$Matches[1] -ge 10) {
            Add-ToolPath (Split-Path $probe -Parent)
            Add-ToolPath (Join-Path (Split-Path $probe -Parent) 'Scripts')
            return $probe
        }
    }
    return $null
}

$python = Find-Python
if ($python) {
    Write-Ok "Found $(& $python --version)"
} else {
    Write-Info 'Python 3.10+ not found. Installing it now...'
    Invoke-Winget 'Python.Python.3.12' | Out-Null
    $python = Find-Python

    if (-not $python) {
        # No winget, or winget failed. Use the official installer in per-user
        # mode, which needs no administrator rights.
        $installer = Join-Path $env:TEMP 'python-3.12.8-amd64.exe'
        Write-Info 'Downloading the official Python installer (~25 MB)...'
        if (Get-RemoteFile 'https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe' $installer) {
            Write-Info 'Installing Python for the current user (no admin needed)...'
            Start-Process -FilePath $installer -Wait -ArgumentList @(
                '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_pip=1', 'Include_test=0'
            )
            Remove-Item $installer -Force -ErrorAction SilentlyContinue
            Update-PathFromRegistry
            $python = Find-Python
        }
    }

    if (-not $python) {
        Write-Fail 'Could not install Python automatically. Install Python 3.12 from https://python.org (tick "Add python.exe to PATH") and re-run this script.'
        exit 1
    }
    Write-Ok "Installed $(& $python --version)"
}

# torch publishes no wheels beyond 3.13 yet; alignment would silently fall back.
$versionText = "$(& $python --version)"
if ($versionText -match '3\.(\d+)' -and [int]$Matches[1] -ge 14) {
    Write-Warn "Python $versionText may have no PyTorch wheels. If alignment fails to install, use Python 3.12."
}

# -------------------- 2. Node.js --------------------------------------------------------------
Write-Step 'Node.js 18+'

function Find-Node {
    if (Test-Command 'node') {
        try {
            $version = (& node --version) -replace 'v', ''
            if ([int]($version -split '\.')[0] -ge 18) { return 'node' }
        } catch { }
    }
    $probe = Find-InstalledBinary 'node.exe' @(
        (Join-Path $script:toolsDir 'node'),
        "$env:ProgramFiles\nodejs",
        "$env:LOCALAPPDATA\Programs\nodejs"
    )
    if ($probe) {
        Add-ToolPath (Split-Path $probe -Parent)
        try {
            $version = (& $probe --version) -replace 'v', ''
            if ([int]($version -split '\.')[0] -ge 18) { return 'node' }
        } catch { }
    }
    return $null
}

if (Find-Node) {
    Write-Ok "Found Node $((& node --version) -replace 'v','')"
} else {
    Write-Info 'Node.js 18+ not found. Installing it now...'
    Invoke-Winget 'OpenJS.NodeJS.LTS' | Out-Null

    if (-not (Find-Node)) {
        # Portable zip: no installer, no administrator rights, and it cannot
        # collide with anything already on the machine.
        Write-Info 'Downloading the portable Node.js build (~30 MB)...'
        $nodeVersion = 'v22.12.0'
        $nodeArchive = Join-Path $env:TEMP "node-$nodeVersion-win-x64.zip"
        $nodeUrl = "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-win-x64.zip"
        if (Get-RemoteFile $nodeUrl $nodeArchive) {
            New-Item -ItemType Directory -Force $script:toolsDir | Out-Null
            Write-Info 'Extracting Node.js...'
            Expand-Archive -Path $nodeArchive -DestinationPath $script:toolsDir -Force
            Remove-Item $nodeArchive -Force -ErrorAction SilentlyContinue
            $extracted = Join-Path $script:toolsDir "node-$nodeVersion-win-x64"
            $nodeTarget = Join-Path $script:toolsDir 'node'
            if (Test-Path $nodeTarget) { Remove-Item $nodeTarget -Recurse -Force }
            if (Test-Path $extracted) { Rename-Item $extracted $nodeTarget }
            Add-ToolPath $nodeTarget
        }
    }

    if (Find-Node) {
        Write-Ok "Installed Node $((& node --version) -replace 'v','')"
    } else {
        Write-Fail 'Could not install Node.js automatically. Install the LTS build from https://nodejs.org and re-run this script.'
        exit 1
    }
}

if (-not (Test-Command 'npm')) {
    Write-Fail 'node is available but npm is not. Reinstall Node.js from https://nodejs.org and re-run.'
    exit 1
}

# -------------------- 3. ffmpeg ---------------------------------------------------------------
Write-Step 'ffmpeg'

function Find-Ffmpeg {
    if (Test-Command 'ffmpeg') { return 'ffmpeg' }
    $probe = Find-InstalledBinary 'ffmpeg.exe' @(
        (Join-Path $script:toolsDir 'ffmpeg'),
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages",
        "$env:ProgramFiles\ffmpeg", 'C:\ffmpeg'
    )
    if ($probe) { Add-ToolPath (Split-Path $probe -Parent); return 'ffmpeg' }
    return $null
}

if (Find-Ffmpeg) {
    Write-Ok "Found $((& ffmpeg -version | Select-Object -First 1))"
} else {
    Write-Info 'ffmpeg not found. Installing it now...'
    Invoke-Winget 'Gyan.FFmpeg' | Out-Null

    if (-not (Find-Ffmpeg)) {
        Write-Info 'Downloading a static ffmpeg build (~80 MB)...'
        $ffmpegArchive = Join-Path $env:TEMP 'ffmpeg-release-essentials.zip'
        if (Get-RemoteFile 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' $ffmpegArchive) {
            New-Item -ItemType Directory -Force $script:toolsDir | Out-Null
            Write-Info 'Extracting ffmpeg...'
            $staging = Join-Path $script:toolsDir '_ffmpeg_staging'
            if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
            Expand-Archive -Path $ffmpegArchive -DestinationPath $staging -Force
            Remove-Item $ffmpegArchive -Force -ErrorAction SilentlyContinue

            # The archive nests everything under a versioned folder; flatten it
            # so the path stays stable across releases.
            $inner = Get-ChildItem $staging -Directory | Select-Object -First 1
            $ffmpegTarget = Join-Path $script:toolsDir 'ffmpeg'
            if (Test-Path $ffmpegTarget) { Remove-Item $ffmpegTarget -Recurse -Force }
            if ($inner) { Move-Item $inner.FullName $ffmpegTarget }
            Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
            Add-ToolPath (Join-Path $ffmpegTarget 'bin')
        }
    }

    if (Find-Ffmpeg) {
        Write-Ok "Installed $((& ffmpeg -version | Select-Object -First 1))"
    } else {
        Write-Warn 'ffmpeg could not be installed. Video export and script alignment will fail until it is on PATH. Get it from https://ffmpeg.org/download.html'
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
$torchInstalled = Test-PythonModule $venvPython @('torch', 'torchaudio')
if ($torchInstalled) {
    Write-Ok "torch $(& $venvPython -c 'import torch; print(torch.__version__)') already installed"
} else {
    Write-Info 'Installing CPU builds of torch and torchaudio (~250 MB)...'
    & $venvPython -m pip install --quiet torch torchaudio --index-url https://download.pytorch.org/whl/cpu
    $torchInstalled = Test-PythonModule $venvPython @('torch', 'torchaudio')
    if ($torchInstalled) { Write-Ok 'torch and torchaudio installed' }
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
& $venvPython -c "import app, routes"
if ($LASTEXITCODE -ne 0) { Write-Fail 'The backend failed to import. Check the error above.'; exit 1 }
Write-Ok 'Backend imports cleanly'

if (Test-PythonModule $venvPython @('torch', 'torchaudio')) { Write-Ok 'Forced alignment available (real sentence timings)' }
else { Write-Warn 'Forced alignment unavailable - sentence timings will be estimated' }

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
