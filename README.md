# Anim Board

Turn a script into a narrated, storyboarded video.

## Quick start

One command sets up everything: Python, Node.js, ffmpeg, the virtual
environment, the Chromium build that drives Google Flow, the frontend packages
and your `.env`. It is safe to re-run at any time.

**Windows**

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
.\run.ps1
```

**macOS / Linux**

```bash
./setup.sh
./run.sh
```

Then open <http://localhost:5173>.

Useful flags: `-PrefetchModel` / `--prefetch` downloads the 1.2 GB alignment
model up front instead of during your first voiceover; `-Recreate` /
`--recreate` rebuilds the virtual environment.

### What you still need to supply

| What | Where | Needed for |
|---|---|---|
| FameSpeak API key | `.env` (setup prompts for it) | Voiceover |
| OpenRouter **or** Groq key | `.env` (setup prompts for it) | Scene grouping, image prompts |
| Google Flow cookies | Settings, in the app | Image generation |

Flow cookies are pasted in the app rather than `.env`: open **Settings** on the
dashboard for the default, or inside a storyboard to override it there only.
Add more than one Flow account and images generate in parallel, one job per
account.

## Manual setup

The steps below are what `setup.ps1` / `setup.sh` automate. You only need them
if you would rather do it by hand.


## Backend

### 1. Create Virtual Environment

```bash
python -m venv venv
````

Activate it:

**Windows**

```bash
venv\Scripts\activate
```

**macOS / Linux**

```bash
source venv/bin/activate
```

---

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

---

### 3. Install FFmpeg

Install FFmpeg and verify:

```bash
ffmpeg -version
```

---

### 4. Configure Environment

Rename:

```
.env.example
```

to:

```
.env
```

Then update the required values.

---

## Frontend

```bash
cd frontend
npm install
npm run build
```

---

## Run the Project

Open two terminals.

### Terminal 1 – Backend

```bash
python app.py
```

(Runs using Uvicorn)

### Terminal 2 – Frontend

```bash
cd frontend
npm run preview
```

---

## Optional: use the local ChatGPT wrapper for prompts

Run `chatgpt-Api` separately on a different port (for example `8001`), then
add these values to Anim Board's `.env`:

```env
PROMPT_PROVIDER=chatgpt_wrapper
CHATGPT_WRAPPER_URL=http://127.0.0.1:8001
CHATGPT_WRAPPER_TIMEOUT_SECONDS=120
```

The wrapper is used only by the backend for scene grouping, character detection,
and image-prompt generation. It must be logged in and running before using
those features. Set `PROMPT_PROVIDER=groq` to use the original provider again.
