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
ffmpeg --version
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
```

This is a Vite app.

---

## Run the Project

Open two terminals.

### Terminal 1 – Backend

```bash
uvicorn app:app --reload
```

(Runs using Uvicorn)

### Terminal 2 – Frontend

```bash
cd frontend
npm run dev
```
