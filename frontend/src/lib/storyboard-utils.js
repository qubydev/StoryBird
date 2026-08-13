export const generateId = () => {
    return Math.random().toString(36).substring(2, 9);
};

export const getInitialData = () => ({
    title: "Untitled",
    items: [],
    selection: [],
    flowProjectUrl: null,
    lastSaved: null,
    autoPilot: null,
    // Per-storyboard overrides of the dashboard defaults. Empty means this
    // storyboard follows the global settings entirely.
    settings: {}
});

// --- Stats & Calculations ---

export const getSceneDuration = (sentences) => {
    if (!sentences || sentences.length === 0) return { start: 0, end: 0 };

    let minStart = Infinity;
    let maxEnd = -Infinity;

    sentences.forEach(s => {
        const start = parseFloat(s.start) || 0;
        const end = parseFloat(s.end) || 0;

        if (start < minStart) minStart = start;
        if (end > maxEnd) maxEnd = end;
    });

    return {
        start: minStart === Infinity ? 0 : minStart,
        end: maxEnd === -Infinity ? 0 : maxEnd
    };
};

export const getMaxEndTime = (items) => {
    let maxEnd = 0;
    const traverse = (itemList) => {
        if (!itemList) return;
        itemList.forEach(item => {
            if (item.type === 'scene') traverse(item.sentences);
            else if (item.type === 'sentence' || !item.type) {
                const end = parseFloat(item.end) || 0;
                if (end > maxEnd) maxEnd = end;
            }
        });
    };
    traverse(items);
    return maxEnd;
};

export const calculateStats = (items) => {
    let sceneCount = 0;
    let sentenceCount = 0;
    let wordCount = 0;
    let maxEnd = 0;

    const traverse = (itemList) => {
        if (!itemList) return;
        itemList.forEach(item => {
            if (item.type === 'scene') {
                sceneCount++;
                traverse(item.sentences);
            } else if (item.type === 'sentence' || !item.type) {
                sentenceCount++;

                const text = item.text || "";
                const words = text.trim().split(/\s+/).filter(w => w.length > 0);
                wordCount += words.length;

                const end = parseFloat(item.end) || 0;
                if (end > maxEnd) {
                    maxEnd = end;
                }
            }
        });
    };

    if (items && Array.isArray(items)) {
        traverse(items);
    }

    return { sceneCount, sentenceCount, wordCount, duration: maxEnd };
};

export const formatDuration = (seconds) => {
    if (!seconds || isNaN(seconds)) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

/** Human-readable run duration, e.g. "2m 5s". Empty for an unknown duration. */
export const formatElapsed = (milliseconds) => {
    if (milliseconds === null || milliseconds === undefined || isNaN(milliseconds)) return '';
    const total = Math.round(milliseconds / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
};

export const isSelectionConsecutive = (items, selection) => {
    if (!selection || selection.length <= 1) return true;

    const indices = [];
    items.forEach((item, index) => {
        if (selection.includes(item.id)) {
            indices.push(index);
        }
    });

    for (let i = 1; i < indices.length; i++) {
        if (indices[i] !== indices[i - 1] + 1) {
            return false;
        }
    }
    return true;
};

// --- File & Storage Utilities ---

export const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
};

// Settings now live in lib/settings.js, which resolves dashboard defaults
// against per-storyboard overrides. Only the expiry signal remains here.
export const refreshSessionKey = () => {
    window.dispatchEvent(new Event('session_key_changed'));
};

// IndexedDB Setup for large project files
const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('StoryBirdDB', 1);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('projects')) {
                db.createObjectStore('projects');
            }
        };

        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
};

export const saveToStorage = async (state) => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('projects', 'readwrite');
            const store = transaction.objectStore('projects');

            const request = store.put(state, 'storybird_project');

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error("Failed to save to IndexedDB", e);
        return false;
    }
};

export const loadFromStorage = async () => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('projects', 'readonly');
            const store = transaction.objectStore('projects');
            const request = store.get('storybird_project');

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error("Failed to load from IndexedDB", e);
        return null;
    }
};

export const duplicateSceneData = (scene) => {
    return {
        ...scene,
        id: generateId(),
        sentences: scene.sentences.map(s => ({
            ...s,
            id: generateId()
        }))
    };
};

export const hasOverlap = (items, start, end, ignoreId) => {
    let overlap = null;
    const traverse = (itemList) => {
        if (!itemList) return;
        for (const item of itemList) {
            if (item.type === 'scene') {
                traverse(item.sentences);
            } else if (item.type === 'sentence' || !item.type) {
                if (item.id === ignoreId) continue;

                const itemStart = parseFloat(item.start) || 0;
                const itemEnd = parseFloat(item.end) || 0;

                if (start < itemEnd && end > itemStart) {
                    overlap = item;
                    return;
                }
            }
        }
    };

    if (items && Array.isArray(items)) {
        traverse(items);
    }
    return overlap;
};

// --- Transcript Parsing Utilities ---

const timeToSeconds = (timeStr) => {
    const parts = timeStr.replace(',', '.').split(':');
    if (parts.length === 3) {
        return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    }
    if (parts.length === 2) {
        return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(timeStr) || 0;
};

export const parseTranscript = (content, filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    const sentences = [];

    if (ext === 'srt' || ext === 'vtt') {
        const blocks = content.replace(/\r\n/g, '\n').split('\n\n');
        blocks.forEach(block => {
            const lines = block.split('\n').filter(line => line.trim() !== '');
            if (lines.length >= 2) {
                const timeLineIdx = lines.findIndex(line => line.includes('-->'));
                if (timeLineIdx !== -1) {
                    const timeLine = lines[timeLineIdx];
                    const textLines = lines.slice(timeLineIdx + 1).join(' ');

                    const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());

                    sentences.push({
                        text: textLines.trim(),
                        start: parseFloat(timeToSeconds(startStr).toFixed(2)),
                        end: parseFloat(timeToSeconds(endStr).toFixed(2))
                    });
                }
            }
        });
    } else {
        throw new Error("Unsupported file format. Please use .srt or .vtt");
    }

    return sentences;
};

export const formatSRTTimestamp = (seconds) => {
    if (isNaN(seconds)) return "00:00:00,000";
    const date = new Date(seconds * 1000);
    const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss},${ms}`;
};

// Words that end in a period without ending a sentence. Single letters are
// handled separately so initials ("J. R. Tolkien") stay in one piece.
const ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'inc', 'ltd',
    'co', 'corp', 'dept', 'est', 'fig', 'al', 'approx', 'min', 'max', 'no', 'vol',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'
]);

const endsWithAbbreviation = (chunk) => {
    const match = chunk.match(/([A-Za-z.]+)\.$/);
    if (!match) return false;
    const word = match[1].toLowerCase().replace(/\./g, '');
    return word.length === 1 || ABBREVIATIONS.has(word);
};

// Split a pasted script into narration sentences. Line breaks are treated as
// hard boundaries because scripts are usually written a beat per line, and the
// scanner is manual rather than a lookbehind regex for browser compatibility.
export const splitScriptIntoSentences = (script) => {
    const sentences = [];

    String(script || '').replace(/\r\n/g, '\n').split(/\n+/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let start = 0;
        for (let i = 0; i < trimmed.length; i++) {
            if (!'.!?…'.includes(trimmed[i])) continue;

            let end = i + 1;
            while (end < trimmed.length && `"'”’)]`.includes(trimmed[end])) end++;
            // A terminator not followed by a space is inside a token: decimals
            // like "3.5" and acronyms like "U.S.A" must not split.
            if (end < trimmed.length && !/\s/.test(trimmed[end])) continue;

            // A new sentence starts with a capital, digit or quote. A lowercase
            // word after the terminator means it was an abbreviation the list
            // above does not cover ("...at 9 a.m. the tower opened").
            const nextCharacter = trimmed.slice(end).trimStart()[0];
            if (nextCharacter && /[a-z]/.test(nextCharacter)) continue;

            const candidate = trimmed.slice(start, end).trim();
            if (endsWithAbbreviation(candidate)) continue;
            if (candidate) sentences.push(candidate);
            start = end;
            i = end - 1;
        }

        const tail = trimmed.slice(start).trim();
        if (tail) sentences.push(tail);
    });

    return sentences;
};

// Fallback used when forced alignment is unavailable: spread the real audio
// duration across sentences by character count. Cheap, but the error compounds,
// so it is only a safety net behind the aligner.
export const estimateTimings = (sentences, duration) => {
    const totalWeight = sentences.reduce((sum, sentence) => sum + Math.max(sentence.text.trim().length, 1), 0);
    let cursor = 0;

    return sentences.map((sentence, index) => {
        const remaining = duration - cursor;
        const length = index === sentences.length - 1
            ? remaining
            : duration * (Math.max(sentence.text.trim().length, 1) / totalWeight);
        const timing = {
            id: sentence.id,
            text: sentence.text.trim(),
            start: Number(cursor.toFixed(3)),
            end: Number((cursor + length).toFixed(3))
        };
        cursor += length;
        return timing;
    });
};

export const buildSRT = (timings) => timings
    .map((timing, index) => `${index + 1}\n${formatSRTTimestamp(timing.start)} --> ${formatSRTTimestamp(timing.end)}\n${timing.text}`)
    .join('\n\n');

// The exporter parses timestamps as SRT strings, so numeric seconds have to be
// formatted before a project is sent to /api/export-video or written to disk.
export const buildExportProject = (state) => ({
    ...state,
    items: state.items.map(item => {
        if (item.type === 'scene') {
            return {
                ...item,
                sentences: item.sentences.map(sentence => ({
                    ...sentence,
                    start: formatSRTTimestamp(sentence.start),
                    end: formatSRTTimestamp(sentence.end)
                }))
            };
        }
        if (item.type === 'sentence') {
            return { ...item, start: formatSRTTimestamp(item.start), end: formatSRTTimestamp(item.end) };
        }
        return item;
    })
});

export const dataUrlToFile = (dataUrl, filename, mimeType) => {
    const [header, encoded] = dataUrl.split(',');
    const type = mimeType || header.match(/data:(.*?);/)?.[1] || 'audio/mpeg';
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], filename, { type });
};

export const parseSRTTimestamp = (srtString) => {
    if (typeof srtString === 'number') return srtString;
    const match = String(srtString).trim().match(/^(\d{2,}):(\d{2}):(\d{2})(?:,|.)(\d{3})$/);
    if (!match) return parseFloat(srtString) || 0;
    const [_, h, m, s, ms] = match;
    return (parseInt(h, 10) * 3600) + (parseInt(m, 10) * 60) + parseInt(s, 10) + (parseInt(ms, 10) / 1000);
};

// --- Multi-project storage ---
// Project data lives in IndexedDB (rather than localStorage) because generated
// images can make a storyboard too large for localStorage.
const PROJECT_INDEX_KEY = 'storybird_project_index';

export const createProjectId = () => `project_${Date.now()}_${generateId()}`;

const getProjectIndex = () => {
    try {
        const projects = JSON.parse(localStorage.getItem(PROJECT_INDEX_KEY) || '[]');
        return Array.isArray(projects) ? projects : [];
    } catch {
        return [];
    }
};

const setProjectIndex = (projects) => {
    localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(projects));
};

export const listProjects = () => getProjectIndex().sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
);

export const createProject = (title = 'Untitled Storyboard') => {
    const id = createProjectId();
    const now = new Date().toISOString();
    const project = { id, title: title.trim() || 'Untitled Storyboard', createdAt: now, updatedAt: now };
    setProjectIndex([project, ...getProjectIndex()]);
    return project;
};

export const saveProject = async (projectId, state) => {
    const savedAt = new Date().toISOString();
    const projectState = { ...state, lastSaved: savedAt };
    const projects = getProjectIndex();
    const existing = projects.find(project => project.id === projectId);
    const project = {
        id: projectId,
        title: state.title?.trim() || 'Untitled Storyboard',
        createdAt: existing?.createdAt || savedAt,
        updatedAt: savedAt,
    };
    setProjectIndex([project, ...projects.filter(item => item.id !== projectId)]);

    try {
        const db = await initDB();
        await new Promise((resolve, reject) => {
            const request = db.transaction('projects', 'readwrite')
                .objectStore('projects')
                .put(projectState, `storybird_project:${projectId}`);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
        return true;
    } catch (e) {
        console.error('Failed to save project to IndexedDB', e);
        return false;
    }
};

export const loadProject = async (projectId) => {
    try {
        const db = await initDB();
        return await new Promise((resolve, reject) => {
            const request = db.transaction('projects', 'readonly')
                .objectStore('projects')
                .get(`storybird_project:${projectId}`);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error('Failed to load project from IndexedDB', e);
        return null;
    }
};

export const deleteProject = async (projectId) => {
    setProjectIndex(getProjectIndex().filter(project => project.id !== projectId));
    try {
        const db = await initDB();
        await new Promise((resolve, reject) => {
            const request = db.transaction('projects', 'readwrite')
                .objectStore('projects')
                .delete(`storybird_project:${projectId}`);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
        return true;
    } catch (e) {
        console.error('Failed to delete project from IndexedDB', e);
        return false;
    }
};

// Preserve the single storyboard used by older versions when upgrading to the
// dashboard. It is copied only once, and only if there are no projects yet.
export const migrateLegacyProject = async () => {
    if (getProjectIndex().length > 0) return null;
    const legacy = await loadFromStorage();
    if (!legacy || (!legacy.items?.length && !legacy.characters?.length && legacy.title === 'Untitled')) return null;
    const project = createProject(legacy.title || 'Imported storyboard');
    await saveProject(project.id, legacy);
    return project;
};
