// Auto-pilot: script + voice in, exported video out.
//
// The run is a state machine rather than one long async function because it
// deliberately halts at `references` to wait for the user to upload a reference
// image per detected character. The current step is persisted through the
// reducer, so closing the tab mid-run leaves a resumable board instead of a
// half-built one.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStoryBoard } from '../context/StoryBoardContext';
import {
    generateId, splitScriptIntoSentences, estimateTimings, buildSRT, fileToBase64
} from '../lib/storyboard-utils';
import { useProjectSettings } from './useProjectSettings';
import { collectSentences, requestCharacters, requestSceneGrouping, generatePromptsAndImages } from '../lib/scene-generation';
import { generateMissingCharacterImages, registerCharacterImage } from '../lib/character-images';
import { exportProjectVideo } from '../lib/video-export';

export const AUTO_PILOT_STEPS = [
    { key: 'voiceover', label: 'Generating voiceover' },
    { key: 'timing', label: 'Aligning script to audio' },
    { key: 'characters', label: 'Detecting characters' },
    { key: 'references', label: 'Waiting for character images' },
    { key: 'scenes', label: 'Grouping scenes' },
    { key: 'visuals', label: 'Writing prompts, generating images' },
    { key: 'export', label: 'Exporting video' },
];

const backendUrl = import.meta.env.VITE_BACKEND_URL || '';

const getAudioDuration = (url) => new Promise((resolve) => {
    const audio = new Audio(url);
    audio.onloadedmetadata = () => resolve(audio.duration);
    // A missing duration must not strand the run; the aligner supplies the real
    // timings anyway and the estimate is only a fallback.
    audio.onerror = () => resolve(0);
});

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
});

export const useAutoPilot = () => {
    const { state, dispatch } = useStoryBoard();
    const { settings, flowAccounts } = useProjectSettings();
    const stateRef = useRef(state);
    useEffect(() => { stateRef.current = state; }, [state]);
    // The run outlives renders, so settings are read through a ref too.
    const settingsRef = useRef(settings);
    useEffect(() => { settingsRef.current = settings; }, [settings]);

    const abortRef = useRef(null);
    const [run, setRun] = useState({
        status: 'idle', step: null, message: '', stats: null, videoUrl: null, error: null,
        // Wall-clock for the whole run, including the character-image pause.
        startedAt: null, elapsedMs: null, stepTimes: {},
        // null until the user picks how characters get their reference images.
        characterMode: null, characterProgress: null, characterBusy: false,
        waitingFor: null, expiredAccount: null, cookieReturnTo: null,
    });
    const stepStartedRef = useRef(null);
    // Callbacks read the latest run state without being rebuilt on every tick.
    const runRef = useRef(run);
    useEffect(() => { runRef.current = run; }, [run]);

    const patch = useCallback((updates) => setRun(current => ({ ...current, ...updates })), []);

    // Reducer dispatches are applied on the next render, so a step that feeds
    // the following one waits for the board to actually reflect it.
    const waitForState = useCallback(async (predicate, timeoutMs = 5000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (predicate(stateRef.current)) return true;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return false;
    }, []);

    const persistedStepRef = useRef(null);
    const setStep = useCallback((step, message = '') => {
        patch({ status: 'running', step, message, error: null });
        // Persist only on a real step change: every write marks the project
        // dirty, and the autosave rewrites the whole board (images included).
        if (persistedStepRef.current !== step) {
            const previous = persistedStepRef.current;
            const now = Date.now();
            if (previous && stepStartedRef.current) {
                const spent = now - stepStartedRef.current;
                setRun(current => ({ ...current, stepTimes: { ...current.stepTimes, [previous]: (current.stepTimes[previous] || 0) + spent } }));
            }
            stepStartedRef.current = now;
            persistedStepRef.current = step;
            dispatch({ type: 'SET_AUTOPILOT', payload: { step, updatedAt: new Date().toISOString() } });
        }
    }, [dispatch, patch]);

    const cancel = useCallback(() => {
        abortRef.current?.abort();
        patch({ status: 'cancelled', message: 'Run stopped.' });
        dispatch({ type: 'SET_AUTOPILOT', payload: null });
    }, [dispatch, patch]);

    // ── Steps ───────────────────────────────────────────────────────────────

    const runVoiceover = useCallback(async ({ sentences, voice, rate, signal }) => {
        setStep('voiceover', 'Sending the script to FameSpeak');

        const response = await fetch(`${backendUrl}/api/tts/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: sentences.map(sentence => sentence.text).join('\n\n'),
                voice: voice?.trim() || undefined,
                rate: Number(rate) || 1,
                sentences: sentences.map(sentence => ({ id: sentence.id, text: sentence.text })),
            }),
            signal,
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || error.message || 'Voiceover generation failed.');
        }

        const job = await response.json();
        let status;
        do {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            await new Promise(resolve => setTimeout(resolve, 1000));
            const statusResponse = await fetch(`${backendUrl}/api/tts/jobs/${job.id}`, { signal });
            status = await statusResponse.json();
            if (!statusResponse.ok || status.status === 'failed') {
                throw new Error(status.detail || status.message || 'Voiceover generation failed.');
            }
            // The backend switches to alignment at 96%, which is a distinct
            // phase worth naming in the UI.
            setStep(status.progress >= 96 ? 'timing' : 'voiceover', `${status.message || 'Working'} (${status.progress || 0}%)`);
        } while (status.status !== 'completed');

        const audioResponse = await fetch(`${backendUrl}/api/tts/jobs/${job.id}/audio`, { signal });
        if (!audioResponse.ok) throw new Error('Voiceover finished but the audio could not be downloaded.');

        const blob = await audioResponse.blob();
        const objectUrl = URL.createObjectURL(blob);
        const duration = await getAudioDuration(objectUrl);
        URL.revokeObjectURL(objectUrl);

        const aligned = Array.isArray(status.timings) && status.timings.length === sentences.length;
        const timings = aligned ? status.timings : estimateTimings(sentences, duration || 1);
        if (!aligned) {
            console.warn('Falling back to estimated timings:', status.alignment_error || 'aligner returned no timings');
        }

        const extension = blob.type === 'audio/wav' ? 'wav' : 'mp3';
        dispatch({
            type: 'APPLY_VOICEOVER',
            payload: {
                timings,
                srt: status.srt || buildSRT(timings),
                voiceover: {
                    dataUrl: await blobToDataUrl(blob),
                    mimeType: blob.type || 'audio/mpeg',
                    filename: `voiceover.${extension}`,
                    duration,
                },
            },
        });

        return { aligned, alignmentError: status.alignment_error || null };
    }, [dispatch, setStep]);

    const runCharacters = useCallback(async ({ sentences, signal }) => {
        setStep('characters', 'Looking for recurring characters');

        const detected = await requestCharacters({
            backendUrl,
            title: stateRef.current.title,
            sentences,
            settings: settingsRef.current,
            signal,
        });

        if (detected.length === 0) return [];

        const characters = detected.map(character => ({
            id: `char_${generateId()}_${Math.random().toString(36).substring(2, 6)}`,
            name: character.name || 'Unknown Character',
            description: character.description || '',
            image: null,
            mediaId: null,
        }));
        dispatch({ type: 'SET_CHARACTERS', payload: [...(stateRef.current.characters || []), ...characters] });
        return characters;
    }, [dispatch, setStep]);

    const runScenesToExport = useCallback(async ({ signal }) => {
        // Regrouping an already-grouped board would rebuild every item from the
        // sentences, discarding the prompts and images a resumed run is trying
        // to keep. Group only when there are no scenes yet.
        const alreadyGrouped = stateRef.current.items.some(item => item.type === 'scene');

        if (alreadyGrouped) {
            setStep('scenes', 'Scenes already grouped — keeping the existing shots');
        } else {
            setStep('scenes', 'Grouping sentences into shots');

            const sentences = collectSentences(stateRef.current.items);
            if (sentences.length === 0) throw new Error('There are no sentences to group.');

            const groups = await requestSceneGrouping({
                backendUrl,
                title: stateRef.current.title,
                sentences,
                settings: settingsRef.current,
                signal,
            });
            dispatch({ type: 'APPLY_AUTO_GROUPING', payload: groups });
            await waitForState(current => current.items.some(item => item.type === 'scene'));
        }

        setStep('visuals', 'Writing prompts and generating images');
        const result = await generatePromptsAndImages({
            backendUrl,
            getState: () => stateRef.current,
            dispatch,
            settings: settingsRef.current,
            signal,
            onNotice: message => patch({ message }),
            onProgress: stats => patch({
                stats,
                message: `Prompts ${stats.promptsGenerated}/${stats.totalScenes} · images ${stats.imagesGenerated}/${stats.totalScenes}`
                    + (stats.imageConcurrency > 1 ? ` · ${stats.imageConcurrency} images at a time` : ''),
            }),
        });
        patch({ stats: result });

        if (signal.aborted) return null;

        if (result.expiredAccount) {
            // Nothing is lost: finished prompts and images stay on the board and
            // continuing picks up exactly the scenes still missing an image.
            patch({
                status: 'waiting',
                waitingFor: 'cookies',
                expiredAccount: result.expiredAccount,
                cookieReturnTo: 'scenes',
                message: `The Google Flow session for ${result.expiredAccount} expired after ${result.imagesGenerated} image${result.imagesGenerated === 1 ? '' : 's'}.`,
            });
            return null;
        }

        // Count images actually on the board rather than images produced by
        // this pass: on a resumed run the prompts and some images already
        // exist, so this pass can legitimately generate none.
        const countImages = (current) => current.items.filter(item => item.type === 'scene' && item.image).length;
        await waitForState(current => countImages(current) >= result.imagesGenerated);
        if (countImages(stateRef.current) === 0) {
            throw new Error('No scene images are available, so there is nothing to export. Check your Google Flow accounts and retry.');
        }

        setStep('export', 'Rendering the video');
        const videoUrl = await exportProjectVideo({
            state: stateRef.current,
            backendUrl,
            signal,
            onProgress: message => patch({ message }),
        });

        dispatch({ type: 'SET_AUTOPILOT', payload: null });
        // The last step never transitions, so close out its timing here.
        const finishedAt = Date.now();
        const lastStep = persistedStepRef.current;
        const lastStepSpent = stepStartedRef.current ? finishedAt - stepStartedRef.current : 0;
        persistedStepRef.current = null;
        stepStartedRef.current = null;
        setRun(current => ({
            ...current,
            status: 'done',
            step: null,
            videoUrl,
            stepTimes: lastStep
                ? { ...current.stepTimes, [lastStep]: (current.stepTimes[lastStep] || 0) + lastStepSpent }
                : current.stepTimes,
            elapsedMs: current.startedAt ? finishedAt - current.startedAt : null,
            message: result.imageFailures > 0
                ? `Video ready, but ${result.imageFailures} scene${result.imageFailures === 1 ? '' : 's'} rendered without an image.`
                : 'Video ready.',
        }));
        return videoUrl;
    }, [dispatch, patch, setStep, waitForState]);

    // ── Character reference images ──────────────────────────────────────────

    const applyCharacterImage = useCallback((characterId, result) => {
        dispatch({ type: 'UPDATE_CHARACTER', payload: { id: characterId, updates: { image: result.image, mediaId: result.mediaId } } });
    }, [dispatch]);

    /** Let the app draw a reference portrait for every character that lacks one. */
    const generateCharacterImages = useCallback(async () => {
        const controller = new AbortController();
        abortRef.current = controller;
        patch({ characterMode: 'generating', characterBusy: true, characterProgress: { generated: 0, failed: 0, total: 0 }, error: null });

        try {
            const result = await generateMissingCharacterImages({
                backendUrl,
                characters: stateRef.current.characters || [],
                settings: settingsRef.current,
                signal: controller.signal,
                onResult: applyCharacterImage,
                onProgress: progress => patch({ characterProgress: progress }),
            });
            if (result.expiredAccount) {
                patch({
                    characterProgress: result,
                    waitingFor: 'cookies',
                    expiredAccount: result.expiredAccount,
                    // Come back to the character step, not the scene stage: the
                    // user was mid-way through giving characters their images.
                    cookieReturnTo: 'characters',
                    message: `The Google Flow session for ${result.expiredAccount} expired while drawing characters.`,
                });
                return;
            }
            patch({
                characterProgress: { ...result, generated: result.generated, failed: result.failed },
                message: result.failed
                    ? `${result.generated} character image${result.generated === 1 ? '' : 's'} generated, ${result.failed} failed. Retry or upload those yourself.`
                    : `${result.generated} character image${result.generated === 1 ? '' : 's'} generated.`,
            });
        } catch (error) {
            if (error.name !== 'AbortError') patch({ error: error.message || 'Character image generation failed.' });
        } finally {
            // Explicit rather than inferred from the remaining count: a run that
            // ends with failures still has characters missing images, and must
            // not leave the panel stuck in a busy state.
            patch({ characterBusy: false });
            abortRef.current = null;
        }
    }, [applyCharacterImage, patch]);

    /** Attach an image the user picked for one character. */
    const uploadCharacterImage = useCallback(async (characterId, file) => {
        patch({ characterMode: 'manual', characterBusy: false, error: null });
        try {
            const base64 = await fileToBase64(file);
            const result = await registerCharacterImage({ backendUrl, base64, settings: settingsRef.current });
            applyCharacterImage(characterId, result);
            return true;
        } catch (error) {
            patch({ error: error.message || 'Could not upload that image.' });
            return false;
        }
    }, [applyCharacterImage, patch]);

    const setCharacterMode = useCallback((mode) => patch({ characterMode: mode, error: null }), [patch]);

    // ── Entry points ────────────────────────────────────────────────────────

    const guard = useCallback(async (work) => {
        abortRef.current = new AbortController();
        try {
            await work(abortRef.current.signal);
        } catch (error) {
            if (error.name === 'AbortError') {
                setRun(current => ({ ...current, status: 'cancelled', message: 'Run stopped.', elapsedMs: current.startedAt ? Date.now() - current.startedAt : null }));
                return;
            }
            console.error('Auto-pilot failed:', error);
            setRun(current => ({ ...current, status: 'failed', error: error.message || 'The run failed.', elapsedMs: current.startedAt ? Date.now() - current.startedAt : null }));
        } finally {
            abortRef.current = null;
        }
    }, [patch]);

    const start = useCallback(({ script, voice, rate }) => guard(async (signal) => {
        if (flowAccounts.length === 0) {
            throw new Error('Add Flow accounts in Settings before starting a run.');
        }

        const texts = splitScriptIntoSentences(script);
        if (texts.length === 0) throw new Error('The script is empty.');

        const sentences = texts.map(text => ({ id: generateId(), text }));
        dispatch({ type: 'IMPORT_SCRIPT', payload: sentences });
        // Reset the clock here, not in guard(), so continuing past the
        // character pause keeps measuring the same run.
        persistedStepRef.current = null;
        stepStartedRef.current = Date.now();
        patch({ status: 'running', videoUrl: null, error: null, stats: null, startedAt: Date.now(), elapsedMs: null, stepTimes: {}, characterMode: null, characterProgress: null, characterBusy: false, waitingFor: null, expiredAccount: null, cookieReturnTo: null });

        await runVoiceover({ sentences, voice, rate, signal });

        const characters = await runCharacters({ sentences, signal });
        if (characters.length > 0) {
            // Halt: prompts cannot reference a character until its image has
            // been uploaded and given a Flow mediaId.
            setStep('references', `Choose how the ${characters.length} detected character${characters.length === 1 ? '' : 's'} get reference images.`);
            patch({ status: 'waiting', waitingFor: 'characters' });
            return;
        }

        await runScenesToExport({ signal });
    }), [dispatch, guard, patch, runCharacters, runVoiceover, runScenesToExport, setStep]);

    /** Continue past the character pause, with or without reference images. */
    const continueRun = useCallback(() => guard(async (signal) => {
        setRun(current => ({ ...current, startedAt: current.startedAt || Date.now(), waitingFor: null, expiredAccount: null }));
        if (!stepStartedRef.current) stepStartedRef.current = Date.now();
        await runScenesToExport({ signal });
    }), [guard, runScenesToExport]);

    /** Called after the user pastes fresh Flow cookies. */
    const continueAfterCookies = useCallback(() => {
        const target = runRef.current.cookieReturnTo;
        patch({ waitingFor: target === 'characters' ? 'characters' : null, expiredAccount: null, cookieReturnTo: null, error: null });
        if (target === 'characters') return;
        return continueRun();
    }, [continueRun, patch]);

    /**
     * Resume a run interrupted by a reload or a crash. What is missing on the
     * board decides where to restart, not the recorded step: the board is the
     * source of truth, and a step recorded just before a failed dispatch would
     * otherwise skip work that never actually happened.
     */
    const resume = useCallback(({ step, voice, rate } = {}) => {
        const board = stateRef.current;

        // No audio means the voiceover never completed. Everything downstream is
        // timed against it, so it has to be redone — but from the script already
        // on the board, not from scratch.
        if (!board.voiceover?.dataUrl) {
            const sentences = collectSentences(board.items)
                .filter(sentence => sentence.text?.trim())
                .map(sentence => ({ id: sentence.id, text: sentence.text.trim() }));

            if (sentences.length === 0) {
                patch({ status: 'failed', error: 'Nothing to resume: this storyboard has no script.' });
                return;
            }

            return guard(async (signal) => {
                patch({ status: 'running', startedAt: Date.now(), elapsedMs: null, stepTimes: {}, error: null });
                persistedStepRef.current = null;
                stepStartedRef.current = Date.now();

                await runVoiceover({ sentences, voice, rate, signal });

                const characters = (stateRef.current.characters || []);
                if (characters.length > 0) {
                    setStep('references', 'Choose how the characters get reference images.');
                    patch({ status: 'waiting', waitingFor: 'characters' });
                    return;
                }
                await runScenesToExport({ signal });
            });
        }

        if (step === 'references' || (stateRef.current.characters || []).some(character => !character.mediaId)) {
            patch({ status: 'waiting', waitingFor: 'characters', step: 'references', message: 'Finish the character images, then continue.' });
            return;
        }

        return continueRun();
    }, [continueRun, guard, patch, runScenesToExport, runVoiceover, setStep]);

    const reset = useCallback(() => {
        persistedStepRef.current = null;
        stepStartedRef.current = null;
        patch({ status: 'idle', step: null, message: '', stats: null, videoUrl: null, error: null, startedAt: null, elapsedMs: null, stepTimes: {}, characterMode: null, characterProgress: null, characterBusy: false, waitingFor: null, expiredAccount: null, cookieReturnTo: null });
        dispatch({ type: 'SET_AUTOPILOT', payload: null });
    }, [dispatch, patch]);

    const charactersMissingImages = (state.characters || []).filter(character => !character.mediaId);

    return {
        ...run,
        start,
        continueRun,
        generateCharacterImages,
        continueAfterCookies,
        uploadCharacterImage,
        setCharacterMode,
        resume,
        cancel,
        reset,
        isRunning: run.status === 'running',
        isWaiting: run.status === 'waiting',
        charactersMissingImages,
        interruptedStep: run.status === 'idle' ? state.autoPilot?.step || null : null,
    };
};
