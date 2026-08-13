// Character reference images. A character is only usable in a scene prompt once
// it has a Flow mediaId, which is issued when an image is registered — whether
// the user uploaded it or the app generated it.
import { effectiveFlowAccounts, DEFAULT_SETTINGS } from './settings';

// Flow fails intermittently, so a portrait is retried before being called a
// failure. An expired session stops the batch instead: only new cookies fix it.
const MAX_CHARACTER_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1500;

/** Register an image with Flow and return the mediaId a scene prompt needs. */
export const registerCharacterImage = async ({ backendUrl, base64, settings, signal }) => {
    const resolved = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    const accounts = effectiveFlowAccounts(resolved);

    const response = await fetch(`${backendUrl}/api/upload-character-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            rawBytes: base64,
            session_token: accounts[0]?.cookies || resolved.flowCookies,
        }),
        signal,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || error.message || 'Could not register the character image.');
    }

    const data = await response.json();
    if (!data.uploadMediaGenerationId) throw new Error('Flow did not return a media id for the image.');
    return { image: base64, mediaId: data.uploadMediaGenerationId };
};

/**
 * Build a reference-portrait prompt. The pose is deliberately plain: this image
 * is a likeness Flow reuses across scenes, not a shot from the story, so a
 * neutral pose and background keep the character recognisable everywhere.
 */
export const characterPortraitPrompt = (character, instructions) => {
    const description = character.description?.trim() || 'a character in this story';
    const style = instructions?.trim() ? ` Art style: ${instructions.trim()}` : '';
    return `Character reference portrait of ${character.name || 'an unnamed character'}. ${description}. `
        + `Single subject, head and shoulders visible, facing the camera, neutral expression, plain uncluttered background, `
        + `even lighting, clear and consistent character design suitable for reuse across many scenes.${style}`;
};

/** Generate a portrait for one character and register it, returning image + mediaId. */
export const generateCharacterImage = async ({ backendUrl, character, settings, account, signal }) => {
    const resolved = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    const accounts = effectiveFlowAccounts(resolved);
    const cookies = account?.cookies || accounts[0]?.cookies || resolved.flowCookies;

    const response = await fetch(`${backendUrl}/api/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt: characterPortraitPrompt(character, resolved.instructions),
            session_token: cookies,
            model: resolved.imageModel || null,
            // Portraits go in their own Flow project so they never collide with
            // the scene panels this storyboard is filling.
            flow_project_url: null,
            aspect_ratio: 'IMAGE_ASPECT_RATIO_SQUARE',
        }),
        signal,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const failure = new Error(error.message || `Could not generate an image for ${character.name}.`);
        // Same contract as scene images: an expired session is not retryable.
        failure.refresh = Boolean(error.refresh);
        throw failure;
    }

    const data = await response.json();
    const encoded = data?.imagePanels?.[0]?.generatedImages?.[0]?.encodedImage;
    if (!encoded) throw new Error(`Flow returned no image for ${character.name}.`);
    const base64 = encoded.startsWith('data:') ? encoded : `data:image/jpeg;base64,${encoded}`;

    return registerCharacterImage({ backendUrl, base64, settings, signal });
};

/**
 * Generate portraits for every character still missing one, one job per Flow
 * account so an account never runs two Flow sessions at once.
 */
export const generateMissingCharacterImages = async ({ backendUrl, characters, settings, signal, onResult = () => {}, onProgress = () => {} }) => {
    const pending = characters.filter(character => !character.mediaId);
    if (pending.length === 0) return { generated: 0, failed: 0 };

    const accounts = effectiveFlowAccounts({ ...DEFAULT_SETTINGS, ...(settings || {}) });
    const concurrency = Math.max(1, Math.min(accounts.length || 1, pending.length));

    let next = 0;
    let generated = 0;
    let failed = 0;
    let expiredAccount = null;

    const worker = async (workerIndex) => {
        const account = accounts[workerIndex];
        while (!signal?.aborted && !expiredAccount) {
            const character = pending[next++];
            if (!character) return;

            for (let attempt = 1; attempt <= MAX_CHARACTER_ATTEMPTS; attempt++) {
                if (signal?.aborted || expiredAccount) return;
                try {
                    const result = await generateCharacterImage({ backendUrl, character, settings, account, signal });
                    onResult(character.id, result);
                    generated++;
                    break;
                } catch (error) {
                    if (error.name === 'AbortError') return;
                    if (error.refresh) {
                        expiredAccount = account?.name || 'this Flow account';
                        return;
                    }
                    if (attempt === MAX_CHARACTER_ATTEMPTS) {
                        console.error(`Character image failed for ${character.name}:`, error);
                        failed++;
                    } else {
                        await new Promise(resolve => setTimeout(resolve, RETRY_BASE_DELAY_MS * attempt));
                    }
                }
            }
            onProgress({ generated, failed, total: pending.length });
        }
    };

    await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index)));
    return { generated, failed, total: pending.length, expiredAccount };
};
