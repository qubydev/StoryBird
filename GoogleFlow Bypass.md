# Pikgen AI — Workflow & Architecture

> Desktop AI image generation app (Electron + React + Tailwind) that automates
> [Google Flow](https://labs.google/fx/tools/flow) via **patchright** (a stealth
> Playwright fork) to generate images from text prompts.

---

## 1. Architecture Overview

```
  ┌──────────────┐     ┌──────────────────────┐     ┌──────────────────┐
  │  Renderer     │     │    Main Process       │     │   Google Flow     │
  │  (React SPA)  │◄───►│  (Electron Node.js)   │◄───►│  (Browser via     │
  │               │     │                       │     │   patchright)     │
  └──────────────┘     └──────────────────────┘     └──────────────────┘
        │                       │                          │
  ┌─────┴──────┐        ┌──────┴───────┐           ┌──────┴──────┐
  │  Context    │        │  IPC Handlers │           │  Settings   │
  │  Isolation  │        │  Services     │           │  Menu Tabs  │
  │  Preload    │        │  Generator    │           │  Create Btn │
  │  Bridge     │        │  Connector    │           │  Generation │
  └────────────┘        └──────────────┘           └─────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron 34 |
| Renderer | React 18 + Vite + Tailwind CSS |
| Main Process | Node.js (ESM) |
| Data Store | SQLite via sql.js |
| Browser Automation | patchright 1.61 (Playwright fork) |
| Image Generation | Google Flow (labs.google/fx/tools/flow) |

### Directory Layout

```
electron/
├── main/
│   ├── index.js                 # Electron entry — creates BrowserWindow
│   ├── ipc.js                   # IPC handler registration
│   ├── db.js                    # SQLite init, DATA_ROOT paths
│   ├── settings.js              # App settings persistence
│   ├── data/
│   │   └── models.js            # Static model catalog
│   ├── engine/
│   │   ├── generator.js         # GenerationEngine wrapper
│   │   └── connector/
│   │       ├── index.js          # Barrel exports
│   │       ├── googleFlowConnector.js  # Sign-in / auth
│   │       ├── flowAutomator.js         # Browser automation (Flow interaction)
│   │       └── cookieStore.js          # Cookie persistence
│   └── services/
│       ├── projectService.js     # CRUD projects
│       ├── promptService.js      # CRUD prompts + CSV import
│       ├── resultService.js      # CRUD generated images
│       ├── referenceService.js   # CRUD reference images
│       └── ingredientService.js  # Prompt ingredient library
├── preload/
│   └── index.js                 # contextBridge API exposure
├── renderer/
│   ├── index.html               # HTML shell (Material Symbols font)
│   └── src/
│       ├── main.jsx             # React mount
│       ├── App.jsx              # Root component, state, orchestration
│       ├── index.css            # Tailwind + custom styles
│       ├── lib/
│       │   └── api.js           # Preload bridge wrapper
│       └── components/
│           ├── Composer.jsx     # Prompt input + settings chips + Create
│           ├── ResultStream.jsx # Generated images gallery
│           ├── Inspector.jsx    # Image detail panel
│           ├── HistoryView.jsx  # Past results
│           ├── SettingsView.jsx # Preferences
│           └── Rail.jsx         # Left sidebar navigation
shared/
└── ipc.js                       # IPC channel name constants
```

---

## 2. UI Component Flow

### 2.1 App Shell — `App.jsx`

The root component manages all application state:

```
State                           Default
─────────────────────────────────────────
view                            'create'
models                          [] (fetched from main)
selectedModel                   'nano-banana-2'
aspect                          '16:9'
count                           2
prompt                          ''
generating                      false
progress                        null
results                         []
selectedResult                  null
referencePaths                  []
project                         null (auto-created default)
account                         { connected: false }
error                           ''
```

**On mount** (`useEffect`):
1. Fetch models list from main process
2. Fetch connector status (is Google signed in?)
3. Auto-create or load the default project
4. Load existing generated results
5. Subscribe to generation progress events

### 2.2 Views

The app has three views controlled by `view` state:

| View | Component | Description |
|------|-----------|-------------|
| `create` | Composer + ResultStream | Prompt input, settings, generate button, results gallery |
| `history` | HistoryView | Scrollable list of all past results |
| `settings` | SettingsView | Preferences (Chrome profile path, connector URL) |

### 2.3 Left Sidebar — `Rail.jsx`

Navigation rail with icons:
- **Create** (auto_awesome) → switches to `create` view
- **History** (history) → switches to `history` view
- Account status indicator (connected/disconnected dot)
- Settings gear → switches to `settings` view

Uses **Material Symbols Outlined** icons (`<span class="material-symbols-outlined">`).

### 2.4 Composer — `Composer.jsx`

The main input area, divided into sections:

#### Prompt Input
- `contentEditable` div with `role="textbox"`
- Uses Slate.js-compatible `data-placeholder` for placeholder text
- On focus, collapses cursor to position 0 (start of prompt)
- After generation completes, clears and refocuses

#### Settings Chips (bottom bar)
Mirrors Google Flow's bottom bar chip layout:

| Chip | Controls | Options |
|------|----------|---------|
| Model | `<select>` dropdown | Nano Banana Pro, Nano Banana 2, Nano Banana 2 Lite |
| Aspect | `<select>` dropdown | 16:9, 4:3, 1:1, 3:4, 9:16 |
| Count | `<select>` dropdown | 1, 2, 3, 4 |
| Agent | Label (visual only) | — |
| +Add Media | Opens file picker | PNG, JPG, WebP, GIF |

#### Create Button
- Disabled when prompt is empty or generation in progress
- Shows spinner + "Generating…" during generation
- Shows progress message below

#### Reference Images
- Uploaded images appear as thumbnail grid
- Each has an × button to remove
- Uses `file:///` URI with `onError` fallback to 10% opacity

### 2.5 Result Stream — `ResultStream.jsx`

After generation, results appear in a responsive grid:
- 16:9 aspect ratio cards
- Grid columns: 1 (mobile) → 2 (sm) → 3 (md) → 4 (lg)
- Each card shows image + prompt text below
- Clicking opens the Inspector panel

### 2.6 Inspector — `Inspector.jsx`

Right-side detail panel for a selected image:
- Full-size image display
- Prompt text
- "Reuse Prompt" button → copies prompt back to composer
- "Delete" button
- Close (×) button

---

## 3. Data Flow: User Click → Image Generation

```
User clicks "Create"
        │
        ▼
  App.jsx — handleGenerate()
        │
        ├── Validates: prompt not empty, account connected
        ├── Sets generating=true
        │
        ▼
  api.generate.now({ projectId, prompt, model, aspect, count, references })
        │
        ▼
  Preload Bridge (preload/index.js)
        │
        ├── ipcRenderer.invoke('generate:now', payload)
        │
        ▼
  Main Process (ipc.js)
        │
        ├── engine.generate(payload, emitProgress)
        │
        ▼
  GenerationEngine.generate() (generator.js)
        │
        ├── Maps payload fields (promptText, projectId, model, aspect, count, references)
        │
        ▼
  connector/executeScript('generate-image', params) (flowAutomator.js)
        │
        ├── launchFlow() — opens Chrome with persistent profile
        ├── navigateToComposer() — navigates to Flow project
        ├── Type prompt via keyboard.insertText (Slate.js compatible)
        ├── Open settings menu (model chip at y=646)
        │   ├── Select Image tab (not Video)
        │   ├── Select aspect ratio tab
        │   ├── Select count tab (1x/x2/x3/x4)
        │   ├── Select model if different from current
        │   └── Close menu via Escape
        ├── Upload reference images (if any)
        │   ├── Click +Add Media button
        │   ├── Click "Upload media"
        │   ├── setInputFiles on file input
        │   └── Click "Add to Prompt"
        ├── Attach network response listener
        ├── Click Create button (arrow_forward)
        │
        ▼
  Google Flow generates images
        │
        ▼
  Polling loop (every 5s, 300s timeout)
        │
        ├── DOM snapshot → detect new img[src] URLs
        ├── Network listener → capture flow-content.google/image/* URLs
        ├── Progress emit: "Generating… 2/4 images detected (15s)"
        ├── Break when all N images detected
        │
        ▼
  downloadImage() — save images to disk
        │
        ├── Try page.context().request.get(url) → direct signed URLs (200)
        ├── Fallback: page.evaluate(() => fetch(url)) → 307 redirects via page auth
        │
        ▼
  resultService.create() — persist to SQLite
        │
        ▼
  refreshResults() — fetch updated results from DB
        │
        ▼
  ResultStream renders new images
        │
        ▼
  Done ✓
```

---

## 4. Google Flow Integration (Critical Path)

### 4.1 Sign-in — `googleFlowConnector.js`

Uses **patchright** (not vanilla Playwright) because Google sign-in detects Playwright's CDP automation traces.

**Strategy**: Launch persistent Chrome profile with patchright → user signs in manually → cookies are saved to `cookieStore.json` → subsequent launches reuse the session.

**Profile location**: `%APPDATA%\nanostudio\NanoStudio\Chrome Signin Profile`

**Auth cookies** saved: SAPISID, HSID, SSID, APISID, SID, \_\_Secure-*

### 4.2 Browser Automation — `flowAutomator.js`

All interaction with Google Flow happens in this file. Key challenges solved:

#### Slate.js Text Input
Flow's prompt editor uses Slate.js, which doesn't respond to `page.type()` or `page.keyboard.type()`. **Fix**: `page.keyboard.insertText(text)` sends native `InputEvent(inputType: 'insertText')` which Slate recognizes.

#### The Settings Chip Selector
There are **6 buttons** with `aria-haspopup="menu"` on the page. The settings chip is the one in the bottom bar (y ≈ 646). The first match by DOM order is a sidebar "more_vert" button (y ≈ 22).

**Fixed selector**:
```js
page.getByRole('button', { name: /Nano Banana/ })
  .and(page.locator('[aria-haspopup="menu"]'))
```
Uses **accessible name** matching (not raw textContent), which is more reliable when the button has icon spans inside.

#### Menu Structure

When the settings chip is clicked, a `[role="menu"]` opens with 11 `[role="tab"]` buttons organized in 3 groups:

| Index | Tab Text | Group | Purpose |
|-------|----------|-------|---------|
| 0 | `imageImage` | Image/Video | Toggle Image mode |
| 1 | `play_circleVideo` | Image/Video | Toggle Video mode |
| 2 | `crop_16_916:9` | Aspect | 16:9 |
| 3 | `crop_landscape4:3` | Aspect | 4:3 |
| 4 | `crop_square1:1` | Aspect | 1:1 |
| 5 | `crop_portrait3:4` | Aspect | 3:4 |
| 6 | `crop_9_169:16` | Aspect | 9:16 |
| 7 | `1x` | Count | 1 image |
| 8 | `x2` | Count | 2 images |
| 9 | `x3` | Count | 3 images |
| 10 | `x4` | Count | 4 images |

Additionally, there's a model dropdown button inside the menu with `arrow_drop_down` text.

#### Tab Click Reliability

React/Radix UI tabs do NOT respond to native DOM `.click()` via `page.evaluate(() => el.click())`. **Fix**: Use Playwright's `locator.nth(i).click()` which dispatches a proper mousedown→mouseup→click event sequence.

#### Tab State Detection
Tabs use `data-state` attribute: `active` = selected, `inactive` = not selected. Also `aria-selected`="true" for the active tab.

#### Chip Text Verification
After closing the menu, the chip text updates to reflect the current settings. Example:
```
"🍌 Nano Banana 2crop_16_9x4"
  ↑ model              ↑ aspect  ↑ count
```

The count portion is always the last `xN` in the chip text. This allows post-selection verification.

#### Model Dropdown
Inside the menu, the model dropdown is a `button` with text containing `arrow_drop_down`. Clicking it reveals a list of `[role="menuitem"]` elements.

Available models (from live scan):
- 🍌 Nano Banana Pro
- 🍌 Nano Banana 2
- 🍌 Nano Banana 2 Lite

### 4.3 Image Download — `downloadImage()`

Generated images appear in two URL formats:

| Format | Direct? | Download Method |
|--------|---------|----------------|
| `flow-content.google/image/{uuid}?Expires=...&Signature=...` | Yes (signed URL) | `request.get()` works directly |
| `media.getMediaUrlRedirect?name={uuid}` | No (307 redirect) | Must use `fetch()` in page context (has auth cookies) |

**Two-strategy approach**:
1. Try `page.context().request.get(url, { maxRedirects: 5 })` — works for direct signed URLs
2. Fallback: `page.evaluate(() => fetch(url).then(r => r.blob()))` — runs in page JS context with full auth, follows 307 redirects correctly

### 4.4 Reference Image Upload

Flow's "+ Add Media" button opens a creation panel. The upload flow:
1. Click `button[aria-haspopup="dialog"]` with text containing "add"
2. Click "Upload media" button
3. Find `input[type="file"]` with `accept="image/*"`
4. `setInputFiles(references)` to upload
5. Click "Add to Prompt" button to confirm attachment

**Error handling**: If Flow returns "does not support image input", the user gets a clear message: *"Reference images not supported by the selected model. Remove reference images or switch to an image model."*

### 4.5 Generation Polling & Count Precision

After clicking Create, a polling loop runs every 5 seconds (300s timeout):

```js
const expectedCount = Math.min(Math.max(parseInt(count) || 2, 1), 4)
```

The loop collects URLs from two sources:
1. **Network listener** — captures `flow-content.google/image/{uuid}?Signature=...` responses with `content-type: image/*`
2. **DOM snapshots** — detects new `img[src]` elements with generated image URL patterns

**The loop only exits when `allImageUrls.size >= expectedCount`**. This ensures precise count matching (not breaking on the first image detected).

---

## 5. Settings & Preferences

Settings persist to `settings.json` in `DATA_ROOT`:

```json
{
  "chromeProfileDir": "",
  "chromeExecutable": "",
  "connectUrl": "https://labs.google/fx/tools/flow",
  "connector": {
    "activeConnector": "google-flow",
    "cookiePolicy": "always",
    "headlessAutomations": true
  }
}
```

- **chromeExecutable**: Custom Chrome path (defaults to system Chrome)
- **connectUrl**: Flow URL (auto-migrated from stale URLs)
- **headlessAutomations**: Whether generation runs headless (default: true)

---

## 6. Models Catalog — `models.js`

Static model definitions consulted by the renderer and passed to Flow:

```js
[
  { id: 'nano-banana-pro',    name: 'Nano Banana Pro',    modality: 'image', maxCount: 4 },
  { id: 'nano-banana-2',      name: 'Nano Banana 2',      modality: 'image', maxCount: 4 },
  { id: 'nano-banana-2-lite', name: 'Nano Banana 2 Lite', modality: 'image', maxCount: 4 },
]
```

Each model defines:
- `aspects` — supported aspect ratios
- `maxCount` — maximum image count
- `defaultAspect` / `defaultCount` — defaults when switching models

Models were discovered by live-scraping Flow's model dropdown menu.

---

## 7. Services

### projectService
- Auto-creates a default "Workspace" project on first launch
- CRUD for projects in SQLite

### resultService
- Stores generated results: filename, path, source URL, prompt text
- Methods: `list(projectId)`, `create({...})`, `remove(id)`, `get(id)`, `ensureDir(projectId)`, `newFilename(prompt, ext)`

### referenceService
- Stores reference images linked to projects
- Dialog-based file picker → copies images to project folder

### ingredientService
- 28 default prompt ingredients (styles, lighting, moods, camera angles, backgrounds, quality)
- Used for prompt construction

---

## 8. Known Quirks & Workarounds

### Flow's Bottom Bar Button
There are multiple `aria-haspopup="menu"` buttons on the page. The settings chip is identifiable by:
- Position: bottom-right area (y ≈ 646, x ≈ 741)
- Text content contains "Nano Banana"
- It's the LAST such button in DOM order

### Tab Text Contains Icons
Tab textContent combines icon font text + label text, e.g.:
- `imageImage` = `<i class="google-symbols">image</i>Image`
- `crop_16_916:9` = icon "crop_16_9" + label "16:9"
- `play_circleVideo` = icon "play_circle" + "Video"

Use `text.includes()` or `===` against the full combined string for matching.

### Empty Prompt Button State
The Create button's `aria-disabled` attribute is "true" when the prompt is empty. The flowAutomator checks this before clicking to avoid clicking a disabled button.

### Generation Duration
Flow takes approximately:
- 15-20s for first image to appear
- 20-30s for all N images to be visible
- 180s timeout was extended to 300s for safety

### Session Expiry
If the Google session expires mid-generation, Flow redirects to `accounts.google.com`. The polling loop detects this and returns an error.

---

## 9. Development

### Commands

```bash
npm run dev       # Start Electron in development mode (hot reload)
npm run build     # Build for production (outputs to out/)
npm run preview   # Preview production build
```

The app needs a Google account signed into Flow (`labs.google/fx/tools/flow`). Sign-in is handled via the app's Connect button which opens Chrome with the persistent profile.

### IPC Channels (shared/ipc.js)

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `generate:now` | Renderer → Main | Start generation |
| `generate:progress` | Main → Renderer | Generation status updates |
| `models:list` | Renderer → Main | Fetch model catalog |
| `connector:status` | Renderer → Main | Check Google sign-in state |
| `connector:connect` | Renderer → Main | Launch sign-in flow |
| `connector:disconnect` | Renderer → Main | Clear session |
| `project:*` | Both | Project CRUD |
| `result:*` | Both | Generated result CRUD |
| `reference:*` | Both | Reference image CRUD |
| `settings:*` | Both | App settings |
| `prompt:*` | Both | Prompt management |

---

## 10. Error Messages

| Message | Cause | Resolution |
|---------|-------|------------|
| "Session expired during generation" | Google auth cookies expired | Reconnect via Connect button |
| "Create button is disabled" | Prompt is empty | Enter a prompt |
| "Reference images not supported..." | Video model selected with references | Remove references or switch to image model |
| "Generation completed but no images were captured" | Image URLs didn't match expected patterns | Check network listener; may need URL pattern update |
| "Prompt is required" | Empty prompt submitted | Enter text before generating |
