// Scene, prompt and image generation shared by the manual topbar buttons and
// the auto-pilot. Both paths must behave identically, so the logic lives here
// rather than inside a component.
import { refreshSessionKey } from './storyboard-utils';
import { effectiveFlowAccounts, DEFAULT_SETTINGS } from './settings';

export const collectSentences = (items) => {
    const sentences = [];
    (items || []).forEach(item => {
        if (item.type === 'sentence') sentences.push(item);
        else if (item.type === 'scene') sentences.push(...(item.sentences || []));
    });
    return sentences;
};

const postJson = async (url, body, signal) => {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || error.detail || `Error ${response.status}`);
    }
    return response.json();
};

export const requestCharacters = async ({ backendUrl, title, sentences, settings, signal }) => {
    const data = await postJson(`${backendUrl}/api/detect-characters`, {
        title: title || 'Untitled',
        lines: sentences.map(sentence => ({ text: sentence.text || '' })),
        provider: settings?.llmProvider || DEFAULT_SETTINGS.llmProvider
    }, signal);
    return data.characters || [];
};

export const requestSceneGrouping = async ({ backendUrl, title, sentences, settings, signal }) => {
    const data = await postJson(`${backendUrl}/api/generate-scenes`, {
        title: title || 'Untitled',
        lines: sentences.map(sentence => ({ text: sentence.text || '' })),
        provider: settings?.llmProvider || DEFAULT_SETTINGS.llmProvider
    }, signal);
    if (!data.scenes) throw new Error('Invalid response from scene generation');
    return data.scenes;
};

// Every image generation drives its own headless browser, so concurrency is
// bounded by Flow accounts: one worker owns one account for the whole run and
// an account never has two Flow sessions open at once. The ceiling protects
// memory, since each worker costs a Chromium instance.
export const MAX_CONCURRENT_IMAGES = 10;
// Flow fails intermittently (slow panels, transient 5xx), so a scene gets a few
// attempts before it is called a failure. An expired session is exempt: it is
// retried by the user supplying new cookies, never by us.
export const MAX_IMAGE_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1500;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generate a prompt for every scene that lacks one, starting each scene's image
 * as soon as its prompt lands. Prompts run three at a time; images run one per
 * configured Flow account.
 *
 * With a single account the images stay serialized, which is what lets the
 * first one bind the storyboard to a Flow project that the rest reuse. Add more
 * accounts in Global Settings and the run gets proportionally faster.
 *
 * `getState` is a function rather than a snapshot: this runs for minutes while
 * the reducer keeps changing, and a captured state would go stale.
 */
export const generatePromptsAndImages = async ({ backendUrl, getState, dispatch, settings, signal, onNotice = () => {}, onProgress = () => {} }) => {
    const state = getState();
    const resolved = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    const activeCharacters = (state.characters || []).filter(character => character.mediaId);
    const charactersPayload = activeCharacters.length > 0
        ? activeCharacters.map(character => ({
            name: character.name || 'Unknown Character',
            description: character.description || 'character'
        }))
        : null;

    const scenesToProcess = state.items.filter(item => item.type === 'scene');
    const flowAccounts = effectiveFlowAccounts(resolved);
    let flowProjectUrl = state.flowProjectUrl || null;

    let promptsGenerated = 0;
    let scenesSkipped = 0;
    let imagesGenerated = 0;
    let imageFailures = 0;
    const promptJobs = [];
    const imageBacklog = [];

    // Prompt workers push here; image workers drain it. A scene starts its
    // image as soon as its own prompt is ready, without waiting for the rest.
    const imageJobs = [];
    let promptsFinished = false;
    // Set to the account name whose Google session expired, which halts the
    // image stage so the user can paste fresh cookies and resume.
    let expiredAccount = null;
    // Idle workers park on these resolvers so a new prompt starts its image
    // immediately instead of waiting for the next poll.
    const waitingWorkers = [];
    const wakeWorkers = () => waitingWorkers.splice(0).forEach(resolve => resolve());

    const queueImage = (scene, prompt, characterMap) => {
        imageJobs.push({ scene, prompt, characterMap });
        dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'imageGenStatus', value: 'queued' } });
        wakeWorkers();
    };

    const renderImage = async ({ scene, prompt, characterMap }, account) => {
            if (signal.aborted) return;
            if (prompt.includes('[CHX]')) {
                imageFailures++;
                onNotice(`Scene ${scene.displayIndex} has an unlinked character.`);
                return;
            }

            const tags = prompt.match(/\[CH\d+\]/g) || [];
            const linkedCharacters = tags
                .map(tag => (getState().characters || []).find(character => character.id === characterMap?.[tag]))
                .filter(Boolean);
            if (linkedCharacters.some(character => !character.mediaId)) {
                imageFailures++;
                onNotice(`Scene ${scene.displayIndex} has a character without an uploaded image.`);
                return;
            }

            dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'imageGenStatus', value: 'generating' } });
            let lastError = null;

            try {
                for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt++) {
                    if (signal.aborted || expiredAccount) return;
                    try {
                        const endpoint = linkedCharacters.length ? `${backendUrl}/api/generate-image-chars` : `${backendUrl}/api/generate-image`;
                        const body = {
                            prompt,
                            session_token: account.cookies,
                            flow_project_url: flowAccounts.length > 1 ? null : flowProjectUrl,
                            model: resolved.imageModel || null,
                        };
                        if (linkedCharacters.length) {
                            body.characters = linkedCharacters.map(character => ({
                                name: character.name || 'Unknown Character',
                                description: character.description || 'Character',
                                mediaId: character.mediaId,
                                image: character.image || null,
                            }));
                        }
                        const response = await fetch(endpoint, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
                        });
                        if (!response.ok) {
                            const error = await response.json().catch(() => ({}));
                            const failure = new Error(error.message || 'Failed to generate image');
                            // The backend flags an expired Google session with
                            // `refresh`. Retrying that is pointless: it needs new
                            // cookies from the user.
                            failure.refresh = Boolean(error.refresh);
                            throw failure;
                        }
                        const data = await response.json();
                        if (flowAccounts.length === 1 && data.flow_project_url && data.flow_project_url !== flowProjectUrl) {
                            flowProjectUrl = data.flow_project_url;
                            dispatch({ type: 'SET_FLOW_PROJECT', payload: flowProjectUrl });
                        }
                        const encodedImage = data?.imagePanels?.[0]?.generatedImages?.[0]?.encodedImage;
                        if (!encodedImage) throw new Error('No image data returned from server');
                        const image = encodedImage.startsWith('data:') ? encodedImage : `data:image/jpeg;base64,${encodedImage}`;
                        dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, updates: { image, imageGenError: null } } });
                        imagesGenerated++;
                        onProgress({ promptsGenerated, imagesGenerated, imageFailures, totalScenes: plannedImages });
                        return;
                    } catch (error) {
                        if (error.name === 'AbortError') return;
                        lastError = error;

                        if (error.refresh) {
                            // Stop the whole image stage: every worker would hit
                            // the same wall, and burning through the queue would
                            // mark every remaining scene as failed.
                            expiredAccount = account.name || 'this Flow account';
                            refreshSessionKey();
                            wakeWorkers();
                            dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'imageGenError', value: 'Flow session expired' } });
                            return;
                        }

                        if (attempt < MAX_IMAGE_ATTEMPTS) {
                            onNotice(`Scene ${scene.displayIndex} failed (${error.message}). Retrying ${attempt}/${MAX_IMAGE_ATTEMPTS - 1}…`);
                            await delay(RETRY_BASE_DELAY_MS * attempt);
                        }
                    }
                }

                imageFailures++;
                console.error(`Failed to generate image for scene ${scene.id} after ${MAX_IMAGE_ATTEMPTS} attempts:`, lastError);
                dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'imageGenError', value: lastError?.message || 'Image generation failed' } });
                onProgress({ promptsGenerated, imagesGenerated, imageFailures, totalScenes: plannedImages });
            } finally {
                dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'imageGenStatus', value: null } });
            }
    };

    // Each worker keeps one account for the whole run, so a given Flow session
    // is never asked for two images at the same time.
    const imageWorker = async (workerIndex) => {
        const account = flowAccounts[workerIndex] || { cookies: resolved.flowCookies };
        while (!signal.aborted && !expiredAccount) {
            const job = imageJobs.shift();
            if (!job) {
                if (promptsFinished) return;
                // The timeout is a backstop against a missed wake-up, not the
                // normal path.
                await Promise.race([new Promise(resolve => waitingWorkers.push(resolve)), delay(250)]);
                continue;
            }
            await renderImage(job, account);
        }
    };

    scenesToProcess.forEach((item, index) => {
        const sceneText = item.sentences.map(sentence => sentence.text).join(' ').trim();
        if (!sceneText) {
            scenesSkipped++;
            return;
        }
        // A scene that already has its prompt skips straight to the image queue
        // when the image is missing. Without this, a resumed or retried run
        // would skip the scene entirely and never fill the gap.
        if (item.prompt?.trim()) {
            if (item.image) {
                scenesSkipped++;
            } else {
                imageBacklog.push({ ...item, displayIndex: index + 1 });
            }
            return;
        }
        // Give the model a compact view of the last scenes so it preserves
        // continuity while keeping each shot visually distinct.
        const previousScenes = scenesToProcess
            .slice(Math.max(0, index - 3), index)
            .map(previous => ({
                scene_lines: previous.sentences.map(sentence => sentence.text).join(' ').trim(),
                prompt: previous.prompt?.trim() || 'Prompt not generated yet; use the scene lines to avoid repeating this shot.'
            }));
        promptJobs.push({ ...item, displayIndex: index + 1, sceneText, previousScenes });
    });

    let nextJobIndex = 0;
    const promptWorker = async () => {
        while (!signal.aborted) {
            const item = promptJobs[nextJobIndex++];
            if (!item) return;
            try {
                dispatch({ type: 'UPDATE_SCENE_META', payload: { id: item.id, field: 'promptGenStatus', value: 'generating' } });
                const response = await fetch(`${backendUrl}/api/generate-image-prompt`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: getState().title || 'Untitled',
                        scene_lines: item.sceneText,
                        instructions: resolved.instructions?.trim() ? resolved.instructions : null,
                        previous_scenes: item.previousScenes.length ? item.previousScenes : null,
                        characters: charactersPayload,
                        provider: resolved.llmProvider
                    }),
                    signal
                });

                if (!response.ok) {
                    console.error(`Failed to generate prompt for scene ${item.id}`);
                    continue;
                }

                const data = await response.json();
                if (data.prompt) {
                    const characterMap = { ...(item.characterMap || {}) };
                    const matches = data.prompt.match(/\[CH(?:\d+|X)\]/g) || [];

                    matches.forEach(tag => {
                        if (tag !== '[CHX]') {
                            const index = parseInt(tag.replace(/\D/g, ''), 10) - 1;
                            if (activeCharacters[index]) characterMap[tag] = activeCharacters[index].id;
                        }
                    });

                    dispatch({
                        type: 'UPDATE_SCENE_META',
                        payload: {
                            id: item.id,
                            updates: {
                                prompt: data.prompt,
                                subjectMediaIds: data.subject_media_ids || [],
                                characterMap
                            }
                        }
                    });
                    promptsGenerated++;
                    onProgress({ promptsGenerated, imagesGenerated, imageFailures, totalScenes: plannedImages });
                    queueImage(item, data.prompt, characterMap);
                }
            } catch (error) {
                if (error.name !== 'AbortError') console.error(error);
            } finally {
                dispatch({ type: 'UPDATE_SCENE_META', payload: { id: item.id, field: 'promptGenStatus', value: null } });
            }
        }
    };

    // Seed the queue with scenes whose prompts already exist so image workers
    // have work before the first new prompt arrives.
    imageBacklog.forEach(scene => queueImage(scene, scene.prompt, scene.characterMap));

    const plannedImages = promptJobs.length + imageBacklog.length;
    const imageConcurrency = Math.max(1, Math.min(flowAccounts.length || 1, MAX_CONCURRENT_IMAGES, plannedImages || 1));
    onProgress({ promptsGenerated, imagesGenerated, imageFailures, totalScenes: plannedImages, imageConcurrency });

    try {
        // Image workers start immediately and idle until the first prompt is
        // ready, so generation begins before every prompt has been written.
        const images = Promise.all(Array.from({ length: imageConcurrency }, (_, index) => imageWorker(index)));
        try {
            await Promise.all(Array.from({ length: Math.min(3, promptJobs.length) }, promptWorker));
        } finally {
            // Set even when prompts throw, otherwise the workers idle forever.
            promptsFinished = true;
            wakeWorkers();
        }
        await images;
    } finally {
        // Includes queued-but-unrendered scenes when a run is stopped early.
        scenesToProcess.forEach(scene => {
            dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, updates: { promptGenStatus: null, imageGenStatus: null } } });
        });
    }

    return {
        promptsGenerated, imagesGenerated, imageFailures, scenesSkipped,
        totalScenes: plannedImages, imageConcurrency,
        // Non-null means the run stopped early and needs fresh Flow cookies.
        expiredAccount,
        pendingImages: imageJobs.length,
    };
};
