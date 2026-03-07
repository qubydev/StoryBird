export const generateId = () => {
    return Math.random().toString(36).substring(2, 9);
};

export const getInitialData = () => ({
    title: "Untitled",
    items: [],
    selection: [],
    lastSaved: null
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

export const getStorageItem = (key) => {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : { text: '', enabled: true };
    } catch (e) {
        return { text: '', enabled: true };
    }
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

export const refreshSessionKey = () => {
    localStorage.removeItem('sb_global_session_key');
    window.dispatchEvent(new Event('session_key_changed'));
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

export const parseSRTTimestamp = (srtString) => {
    if (typeof srtString === 'number') return srtString;
    const match = String(srtString).trim().match(/^(\d{2,}):(\d{2}):(\d{2})(?:,|.)(\d{3})$/);
    if (!match) return parseFloat(srtString) || 0;
    const [_, h, m, s, ms] = match;
    return (parseInt(h, 10) * 3600) + (parseInt(m, 10) * 60) + parseInt(s, 10) + (parseInt(ms, 10) / 1000);
};