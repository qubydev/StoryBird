#!/usr/bin/env bash
# One-shot setup for Anim Board on macOS or Linux.
#
# Installs and configures everything the app needs: Python, Node.js, ffmpeg,
# the virtual environment, the Chromium build that drives Google Flow, the
# frontend packages, and the .env file.
#
# Safe to re-run: every step skips what is already present.
#
#   ./setup.sh                 normal setup
#   ./setup.sh --prefetch      also download the 1.2 GB alignment model now
#   ./setup.sh --recreate      rebuild the virtual environment
#   ./setup.sh --no-browsers   skip the Chromium download

set -euo pipefail
cd "$(dirname "$0")"

PREFETCH_MODEL=0
SKIP_BROWSERS=0
RECREATE=0
NON_INTERACTIVE=0

for arg in "$@"; do
    case "$arg" in
        --prefetch)        PREFETCH_MODEL=1 ;;
        --no-browsers)     SKIP_BROWSERS=1 ;;
        --recreate)        RECREATE=1 ;;
        --non-interactive) NON_INTERACTIVE=1 ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; GRAY='\033[0;90m'; RESET='\033[0m'
WARNINGS=()

step() { printf "\n${CYAN}=== %s ===${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}[ok]${RESET}   %s\n" "$1"; }
info() { printf "  ${GRAY}[..]${RESET}   %s\n" "$1"; }
warn() { printf "  ${YELLOW}[warn]${RESET} %s\n" "$1"; WARNINGS+=("$1"); }
fail() { printf "  ${RED}[fail]${RESET} %s\n" "$1"; }

have() { command -v "$1" >/dev/null 2>&1; }

# Anything we install ourselves lands here, so no step needs sudo and nothing
# is scattered across the machine. run.sh puts it on PATH too.
TOOLS_DIR="$PWD/.tools"
export PATH="$TOOLS_DIR/node/bin:$TOOLS_DIR/ffmpeg:$PATH"

case "$(uname -s)" in
    Darwin) OS=mac ;;
    Linux)  OS=linux ;;
    *)      OS=other ;;
esac
ARCH=$(uname -m)
case "$ARCH" in
    x86_64|amd64) NODE_ARCH=x64 ;;
    arm64|aarch64) NODE_ARCH=arm64 ;;
    *) NODE_ARCH='' ;;
esac

fetch() {
    local url="$1" out="$2"
    if have curl; then curl -fsSL "$url" -o "$out"
    elif have wget; then wget -q "$url" -O "$out"
    else return 1; fi
}

# Portable Node: no package manager, no sudo, cannot collide with anything.
install_node_portable() {
    [ -n "$NODE_ARCH" ] || return 1
    [ "$OS" = "other" ] && return 1
    local version='v22.12.0'
    local platform="$OS"
    [ "$OS" = "mac" ] && platform=darwin
    local name="node-$version-$platform-$NODE_ARCH"
    local url="https://nodejs.org/dist/$version/$name.tar.xz"
    info "Downloading the portable Node.js build (~30 MB)..."
    mkdir -p "$TOOLS_DIR"
    fetch "$url" "/tmp/$name.tar.xz" || return 1
    tar -xJf "/tmp/$name.tar.xz" -C "$TOOLS_DIR" || return 1
    rm -f "/tmp/$name.tar.xz"
    rm -rf "$TOOLS_DIR/node"
    mv "$TOOLS_DIR/$name" "$TOOLS_DIR/node"
    export PATH="$TOOLS_DIR/node/bin:$PATH"
    have node
}

# Static ffmpeg build, same reasoning.
install_ffmpeg_portable() {
    mkdir -p "$TOOLS_DIR/ffmpeg"
    if [ "$OS" = "linux" ] && [ "$NODE_ARCH" = "x64" ]; then
        info "Downloading a static ffmpeg build (~30 MB)..."
        fetch 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz' /tmp/ffmpeg.tar.xz || return 1
        tar -xJf /tmp/ffmpeg.tar.xz -C /tmp || return 1
        local extracted
        extracted=$(find /tmp -maxdepth 1 -type d -name 'ffmpeg-*-static' | head -1)
        [ -n "$extracted" ] || return 1
        cp "$extracted/ffmpeg" "$extracted/ffprobe" "$TOOLS_DIR/ffmpeg/"
        rm -rf "$extracted" /tmp/ffmpeg.tar.xz
    elif [ "$OS" = "mac" ]; then
        info "Downloading ffmpeg and ffprobe..."
        fetch 'https://evermeet.cx/ffmpeg/getrelease/zip' /tmp/ffmpeg.zip || return 1
        unzip -oq /tmp/ffmpeg.zip -d "$TOOLS_DIR/ffmpeg" || return 1
        fetch 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip' /tmp/ffprobe.zip \
            && unzip -oq /tmp/ffprobe.zip -d "$TOOLS_DIR/ffmpeg" || true
        rm -f /tmp/ffmpeg.zip /tmp/ffprobe.zip
    else
        return 1
    fi
    chmod +x "$TOOLS_DIR/ffmpeg/"* 2>/dev/null || true
    export PATH="$TOOLS_DIR/ffmpeg:$PATH"
    have ffmpeg
}

# Pick the package manager once so each install reads the same.
if have brew;    then PKG='brew install'
elif have apt-get; then PKG='sudo apt-get install -y'
elif have dnf;   then PKG='sudo dnf install -y'
elif have pacman; then PKG='sudo pacman -S --noconfirm'
else PKG=''
fi

install_pkg() {
    local package="$1" label="$2"
    if [ -z "$PKG" ]; then
        warn "$label is missing and no supported package manager was found. Install $label manually, then re-run."
        return 1
    fi
    info "Installing $label…"
    if have apt-get; then sudo apt-get update -qq || true; fi
    $PKG "$package" || { warn "Could not install $label automatically."; return 1; }
    return 0
}

printf "${CYAN}\n  Anim Board setup — script to finished video\n${RESET}"

# ─── 1. Python ───────────────────────────────────────────────────────────────
step "Python 3.10+"
PYTHON=''
for candidate in python3.12 python3.11 python3.10 python3 python; do
    have "$candidate" || continue
    version=$("$candidate" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null) || continue
    major=${version%%.*}; minor=${version##*.}
    if [ "$major" -eq 3 ] && [ "$minor" -ge 10 ]; then
        PYTHON="$candidate"; ok "Found Python $version"; break
    fi
done

if [ -z "$PYTHON" ]; then
    install_pkg python3 "Python 3" || true
    have python3 && PYTHON=python3
fi
[ -n "$PYTHON" ] || { fail "Python 3.10+ is required. Install it and re-run."; exit 1; }

# venv is a separate package on Debian/Ubuntu.
if ! "$PYTHON" -c 'import venv' 2>/dev/null; then
    install_pkg python3-venv "python3-venv" || true
fi

# ─── 2. Node.js ──────────────────────────────────────────────────────────────
step "Node.js 18+"
if have node; then
    node_major=$(node --version | sed 's/v//' | cut -d. -f1)
    if [ "$node_major" -ge 18 ]; then ok "Found Node $(node --version)"
    else warn "Node $(node --version) is old; the frontend needs 18+."; fi
else
    info "Node.js 18+ not found. Installing it now..."
    install_pkg nodejs "Node.js" || true
    if ! have node; then install_node_portable || true; fi
    if have node; then
        ok "Installed Node $(node --version)"
    else
        fail "Could not install Node.js automatically. Install the LTS build from https://nodejs.org and re-run."
        exit 1
    fi
fi
have npm || { fail "npm is required. Install it alongside Node.js."; exit 1; }

# ─── 3. ffmpeg ───────────────────────────────────────────────────────────────
step "ffmpeg"
if have ffmpeg; then
    ok "$(ffmpeg -version 2>&1 | head -1)"
else
    info "ffmpeg not found. Installing it now..."
    install_pkg ffmpeg "ffmpeg" || true
    if ! have ffmpeg; then install_ffmpeg_portable || true; fi
    if have ffmpeg; then ok "ffmpeg installed"
    else warn "ffmpeg could not be installed. Video export and script alignment will fail until it is on PATH."; fi
fi

# ─── 4. Virtual environment ──────────────────────────────────────────────────
step "Python virtual environment"
VENV_PYTHON="venv/bin/python"

if [ "$RECREATE" -eq 1 ] && [ -d venv ]; then
    info "Removing the existing venv (--recreate)…"
    rm -rf venv
fi

if [ -x "$VENV_PYTHON" ]; then
    ok "venv already exists"
else
    info "Creating venv…"
    "$PYTHON" -m venv venv
    ok "venv created"
fi

info "Upgrading pip…"
"$VENV_PYTHON" -m pip install --quiet --upgrade pip setuptools wheel

# ─── 5. Python packages ──────────────────────────────────────────────────────
step "Python packages"
TORCH_OK=0
if "$VENV_PYTHON" -c 'import torch, torchaudio' 2>/dev/null; then
    ok "torch $("$VENV_PYTHON" -c 'import torch; print(torch.__version__)') already installed"
    TORCH_OK=1
else
    # CPU wheels explicitly: plain pip would fetch multi-gigabyte CUDA builds
    # that this app never uses. macOS wheels are CPU-only already.
    info "Installing CPU builds of torch and torchaudio (~250 MB)…"
    if [ "$(uname -s)" = "Darwin" ]; then
        "$VENV_PYTHON" -m pip install --quiet torch torchaudio
    else
        "$VENV_PYTHON" -m pip install --quiet torch torchaudio --index-url https://download.pytorch.org/whl/cpu
    fi
    if "$VENV_PYTHON" -c 'import torch, torchaudio' 2>/dev/null; then
        ok "torch and torchaudio installed"; TORCH_OK=1
    else
        warn "torch could not be installed. The app still runs; sentence timings fall back to an estimate."
    fi
fi

info "Installing the remaining requirements…"
"$VENV_PYTHON" -m pip install --quiet -r requirements.txt
ok "Python packages installed"

# ─── 6. Chromium ─────────────────────────────────────────────────────────────
step "Chromium (drives Google Flow)"
if [ "$SKIP_BROWSERS" -eq 1 ]; then
    warn "Skipped (--no-browsers). Run 'venv/bin/patchright install chromium' before generating images."
else
    info "Installing Chromium (~150 MB, skipped if cached)…"
    if "$VENV_PYTHON" -m patchright install chromium; then ok "Chromium ready"
    else warn "Chromium install failed. Run 'venv/bin/patchright install chromium' later; image generation needs it."; fi
fi

# ─── 7. Configuration ────────────────────────────────────────────────────────
step "Configuration (.env)"
if [ -f .env ]; then
    ok ".env already exists — leaving it untouched"
else
    cp .env.example .env
    ok "Created .env from .env.example"

    if [ "$NON_INTERACTIVE" -eq 0 ] && [ -t 0 ]; then
        printf "\n  ${YELLOW}Paste your API keys now, or press Enter to skip and edit .env later.${RESET}\n"
        set_key() {
            local key="$1" label="$2" value
            printf "\n  ${GRAY}%s${RESET}\n" "$label"
            read -r -p "  $key: " value
            if [ -n "$value" ]; then
                # macOS sed needs an argument to -i; GNU sed must not have one.
                if [ "$(uname -s)" = "Darwin" ]; then sed -i '' "s|^$key=.*|$key=$value|" .env
                else sed -i "s|^$key=.*|$key=$value|" .env; fi
            fi
        }
        set_key FAMESPEAK_API_KEY  "FameSpeak API key (voiceover)      https://famespeak.online"
        set_key OPENROUTER_API_KEY "OpenRouter API key (prompts)       https://openrouter.ai/keys"
        set_key GROQ_API_KEY       "Groq API key (optional fallback)   https://console.groq.com/keys"
        ok "Saved .env"
    fi
fi

grep -qE '^FAMESPEAK_API_KEY=.+' .env || warn "FAMESPEAK_API_KEY is empty — voiceover generation will fail until you set it in .env"
if ! grep -qE '^(OPENROUTER_API_KEY|GROQ_API_KEY)=.+' .env; then
    warn "No LLM key set — scene grouping and image prompts will fail until OPENROUTER_API_KEY or GROQ_API_KEY is set in .env"
fi

# ─── 8. Frontend ─────────────────────────────────────────────────────────────
step "Frontend packages"
[ -f frontend/.env ] || { echo 'VITE_BACKEND_URL=http://127.0.0.1:8000' > frontend/.env; ok "Created frontend/.env"; }

if [ -d frontend/node_modules ]; then
    ok "node_modules already present"
else
    info "Running npm install (a few minutes on first run)…"
    (cd frontend && npm install --no-fund --no-audit)
    ok "Frontend packages installed"
fi

# ─── 9. Alignment model ──────────────────────────────────────────────────────
step "Forced-alignment model"
if [ "$TORCH_OK" -eq 0 ]; then
    warn "Skipped: torch is not installed."
elif [ "$PREFETCH_MODEL" -eq 1 ]; then
    info "Downloading the MMS_FA checkpoint (~1.2 GB, one time)…"
    "$VENV_PYTHON" -c "import torchaudio; torchaudio.pipelines.MMS_FA.get_model(with_star=False); print('ready')" \
        && ok "Alignment model cached" \
        || warn "Model download failed; it will retry during the first voiceover."
else
    info "Not downloaded. The 1.2 GB checkpoint is fetched during the first voiceover."
    info "Re-run with --prefetch to get it now instead."
fi

# ─── 10. Verify ──────────────────────────────────────────────────────────────
step "Verifying the install"
"$VENV_PYTHON" -c "import app, routes; print('backend imports ok')" || { fail "The backend failed to import."; exit 1; }
ok "Backend imports cleanly"
"$VENV_PYTHON" -c "from utils.align import is_available; print('alignment available:', is_available())"

# ─── Done ────────────────────────────────────────────────────────────────────
echo
if [ ${#WARNINGS[@]} -gt 0 ]; then
    printf "${YELLOW}  Setup finished with %d warning(s):${RESET}\n" "${#WARNINGS[@]}"
    for warning in "${WARNINGS[@]}"; do printf "${YELLOW}    - %s${RESET}\n" "$warning"; done
else
    printf "${GREEN}  Setup complete. Everything is ready.${RESET}\n"
fi

printf "${CYAN}
  Start the app:      ./run.sh
  Then open:          http://localhost:5173

  Before your first video, open Settings on the dashboard and paste your
  Google Flow cookies — image generation needs a signed-in Flow account.
${RESET}\n"
