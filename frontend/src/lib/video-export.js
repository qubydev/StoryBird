// In-app video export. The /render page uploads a project file by hand; the
// auto-pilot instead builds the same payload straight from board state so a run
// can finish without the user round-tripping a JSON through their downloads.
import { buildExportProject, dataUrlToFile } from './storyboard-utils';

const safeFilename = (title) => (title || 'storyboard')
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '') || 'storyboard';

/** Read an /api/export-video SSE stream, reporting progress until it resolves to a video URL. */
export const streamExportEvents = async (response, onProgress) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (!line.trim().startsWith('data:')) continue;
            const rawJson = line.replace('data:', '').trim();
            if (!rawJson) continue;

            let event;
            try {
                event = JSON.parse(rawJson);
            } catch {
                // Keep-alives and split frames are expected; skip anything
                // that is not a complete JSON event.
                continue;
            }

            if (event.error) throw new Error(event.error);
            if (event.status === 'processing') onProgress(event.message || 'Processing...');
            if (event.status === 'done') return event.video_url;
        }
    }

    throw new Error('The export stream ended before the video was ready.');
};

export const exportProjectVideo = async ({ state, backendUrl, signal, onProgress = () => {} }) => {
    const scenes = (state.items || []).filter(item => item.type === 'scene');
    if (scenes.length === 0) throw new Error('There are no scenes to export.');

    const project = buildExportProject(state);
    const formData = new FormData();
    formData.append('file', new File([JSON.stringify(project)], `${safeFilename(state.title)}.json`, { type: 'application/json' }));

    if (state.voiceover?.dataUrl) {
        formData.append('audio', dataUrlToFile(
            state.voiceover.dataUrl,
            state.voiceover.filename || 'storyboard-voiceover.mp3',
            state.voiceover.mimeType
        ));
    }

    const response = await fetch(`${backendUrl}/api/export-video`, { method: 'POST', body: formData, signal });
    if (!response.ok) throw new Error('Could not reach the export service.');

    const videoUrl = await streamExportEvents(response, onProgress);
    return `${backendUrl}${videoUrl}`;
};
