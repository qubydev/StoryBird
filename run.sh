#!/usr/bin/env bash
# Start Anim Board: the FastAPI backend and the Vite frontend together.
#
#   ./run.sh                normal (dev server)
#   ./run.sh --production   build the frontend and preview it
#   PORT=8001 ./run.sh      use another backend port

set -euo pipefail
cd "$(dirname "$0")"

# setup.sh may have installed Node or ffmpeg into .tools; make them visible
# here too, otherwise a machine that got them that way cannot start the app.
TOOLS_DIR="$PWD/.tools"
export PATH="$TOOLS_DIR/node/bin:$TOOLS_DIR/ffmpeg:$PATH"

PORT="${PORT:-8000}"
PRODUCTION=0
[ "${1:-}" = "--production" ] && PRODUCTION=1

if [ ! -x venv/bin/python ]; then
    echo "The virtual environment is missing. Run ./setup.sh first." >&2
    exit 1
fi
if [ ! -d frontend/node_modules ]; then
    echo "Frontend packages are missing. Run ./setup.sh first." >&2
    exit 1
fi

echo "Starting backend on http://127.0.0.1:$PORT …"
venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port "$PORT" &
BACKEND_PID=$!

# Stop the backend however this script exits, including Ctrl-C.
cleanup() {
    if kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo; echo "Stopping backend…"
        kill "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

echo "Starting frontend…"
cd frontend
if [ "$PRODUCTION" -eq 1 ]; then
    npm run build
    npm run preview
else
    npm run dev
fi
