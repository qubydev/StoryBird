# Setup

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
