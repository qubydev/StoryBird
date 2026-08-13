import React, { useState, useRef, useEffect } from 'react';
import { useStoryBoard } from '../../../context/StoryBoardContext';
import { Button } from '@/components/ui/button';
import { FaMagic, FaSpinner, FaPenFancy, FaImages, FaStop, FaUsers, FaRedo } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { refreshSessionKey } from '../../../lib/storyboard-utils';
import { collectSentences, requestCharacters, requestSceneGrouping, generatePromptsAndImages } from '../../../lib/scene-generation';
import { useProjectSettings } from '../../../hooks/useProjectSettings';

const GeneratorControls = () => {
    const { state, dispatch } = useStoryBoard();
    const { settings, flowAccounts } = useProjectSettings();
    // Bulk generation runs for minutes while the reducer keeps updating, so the
    // shared pipeline reads state through a ref instead of a stale closure.
    const stateRef = useRef(state);
    useEffect(() => { stateRef.current = state; }, [state]);
    const [isGeneratingScenes, setIsGeneratingScenes] = useState(false);
    const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
    const [isGeneratingAllImages, setIsGeneratingAllImages] = useState(false);
    const [isDetectingChars, setIsDetectingChars] = useState(false);
    const [failedImageCount, setFailedImageCount] = useState(0);

    const promptAbortControllerRef = useRef(null);
    const imageAbortControllerRef = useRef(null);

    const backendUrl = import.meta.env.VITE_BACKEND_URL;

    const handleDetectCharacters = async () => {
        setIsDetectingChars(true);
        const toastId = toast.loading("Detecting characters from script...");

        try {
            const allSentences = collectSentences(state.items);
            if (allSentences.length === 0) throw new Error("No sentences found to detect characters from.");

            const detected = await requestCharacters({
                backendUrl,
                title: state.title,
                sentences: allSentences,
                settings
            });

            if (detected.length === 0) {
                toast.success("No characters detected.", { id: toastId });
                return;
            }

            const newCharacters = detected.map(c => {
                return {
                    id: `char_${Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000)}`,
                    name: c.name || 'Unknown Character',
                    description: c.description || '',
                    image: null,
                    mediaId: null
                };
            });

            dispatch({ type: 'SET_CHARACTERS', payload: [...(state.characters || []), ...newCharacters] });
            toast.success(`Detected ${newCharacters.length} characters!`, { id: toastId });

        } catch (err) {
            console.error(err);
            toast.error(err.message || "Failed to detect characters", { id: toastId });
        } finally {
            setIsDetectingChars(false);
        }
    };

    const handleGenerateScenes = async () => {
        setIsGeneratingScenes(true);
        const toastId = toast.loading("Analyzing script...");

        try {
            const allSentences = collectSentences(state.items);
            if (allSentences.length === 0) throw new Error("No sentences found");

            const sceneIndices = await requestSceneGrouping({
                backendUrl,
                title: state.title,
                sentences: allSentences,
                settings
            });

            dispatch({ type: 'APPLY_AUTO_GROUPING', payload: sceneIndices });
            toast.success("Scenes Generated", { id: toastId });

        } catch (e) {
            console.error(e);
            toast.error(e.message, { id: toastId });
        } finally {
            setIsGeneratingScenes(false);
        }
    };

    const handleGenerateImagePrompts = async () => {
        if (isGeneratingPrompts) {
            promptAbortControllerRef.current?.abort();
            return;
        }

        setIsGeneratingPrompts(true);
        const toastId = toast.loading("Generating image prompts...");

        promptAbortControllerRef.current = new AbortController();

        try {
            const result = await generatePromptsAndImages({
                backendUrl,
                getState: () => stateRef.current,
                dispatch,
                settings,
                signal: promptAbortControllerRef.current.signal,
                onNotice: message => toast.error(message)
            });

            if (promptAbortControllerRef.current?.signal.aborted) {
                toast.success(`Stopped. Prompts: ${result.promptsGenerated}, Images: ${result.imagesGenerated}`, { id: toastId });
            } else {
                toast.success(`Done! Prompts: ${result.promptsGenerated}, Images: ${result.imagesGenerated}, Image failures: ${result.imageFailures}, Skipped: ${result.scenesSkipped}`, { id: toastId });
            }
            setFailedImageCount(result.imageFailures);
        } catch (e) {
            console.error(e);
            toast.error(e.message || "Prompt generation failed", { id: toastId });
        } finally {
            setIsGeneratingPrompts(false);
            promptAbortControllerRef.current = null;
        }
    };

    const handleGenerateAllImages = async (retryFailedOnly = false) => {
        if (isGeneratingAllImages) {
            if (imageAbortControllerRef.current) {
                imageAbortControllerRef.current.abort();
            }
            return;
        }

        if (flowAccounts.length === 0) {
            toast.error('Add Flow accounts in Settings, on the dashboard or for this storyboard.');
            return;
        }
        setIsGeneratingAllImages(true);
        const toastId = toast.loading("Starting bulk image generation...");

        imageAbortControllerRef.current = new AbortController();
        const signal = imageAbortControllerRef.current.signal;

        const scenesToProcess = [];
        const allStateCharacters = state.characters || [];

        try {
            let skippedHasImage = 0;
            let skippedNoPrompt = 0;

            for (let i = 0; i < state.items.length; i++) {
                const item = state.items[i];
                if (item.type !== 'scene') continue;

                if (item.image || (retryFailedOnly && !item.imageGenError)) {
                    skippedHasImage++;
                    continue;
                }

                if (!item.prompt || !item.prompt.trim()) {
                    skippedNoPrompt++;
                    continue;
                }

                scenesToProcess.push({ ...item, displayIndex: i + 1 });
            }

            if (scenesToProcess.length === 0) {
                toast.success(`Done! Skipped ${skippedHasImage} (has image), ${skippedNoPrompt} (no prompt).`, { id: toastId });
                setIsGeneratingAllImages(false);
                return;
            }

            scenesToProcess.forEach(scene => {
                dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'imageGenStatus', value: 'queued' } });
            });
            let generatedCount = 0;
            let failureCount = 0;
            // Give each account its own Flow project. This makes one job per
            // account safe to run in parallel without reusing a project panel.
            const maxConcurrentFlowJobs = Math.min(flowAccounts.length, 10);
            let flowProjectUrl = state.flowProjectUrl || null;
            for (let batchStart = 0; batchStart < scenesToProcess.length && !signal.aborted; batchStart += 10) {
                const batch = scenesToProcess.slice(batchStart, batchStart + 10);
                toast.loading(`Generating batch ${Math.floor(batchStart / 10) + 1} of ${Math.ceil(scenesToProcess.length / 10)} (${batch.length} scenes)...`, { id: toastId });
                let nextScene = 0;
                const worker = async (workerIndex) => {
                    while (!signal.aborted) {
                        const sceneIndex = nextScene++;
                        const scene = batch[sceneIndex];
                        if (!scene) return;
                        // A worker owns one account for the entire batch, so
                        // the same account never receives two simultaneous
                        // Flow requests.
                        const account = flowAccounts[workerIndex % flowAccounts.length];
                    try {
                        if (scene.prompt.includes('[CHX]')) {
                            throw new Error(`Prompt contains unlinked character [CHX]`);
                        }

                        const promptTags = scene.prompt.match(/\[CH(?:\d+)\]/g) || [];
                        for (const tag of promptTags) {
                            const charId = scene.characterMap?.[tag];
                            const character = allStateCharacters.find(c => c.id === charId);
                            if (character && !character.mediaId) {
                                throw new Error(`Linked character "${character.name || tag}" is missing an uploaded image.`);
                            }
                        }

                        dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'imageGenStatus', value: 'generating' } });

                        const subjectIds = promptTags.map(tag => {
                            const charId = scene.characterMap?.[tag];
                            const character = allStateCharacters.find(c => c.id === charId);
                            return character ? character.mediaId : null;
                        }).filter(Boolean);

                        let endpoint = `${backendUrl}/api/generate-image`;
                        let reqBody = {
                            prompt: scene.prompt,
                            session_token: account.cookies,
                            flow_project_url: flowAccounts.length > 1 ? null : flowProjectUrl,
                            model: settings.imageModel || null,
                        };

                        if (subjectIds.length > 0) {
                            endpoint = `${backendUrl}/api/generate-image-chars`;
                            // Now correctly sending name, description, and mediaId
                            reqBody.characters = subjectIds.map(id => {
                                const c = allStateCharacters.find(ch => ch.mediaId === id);
                                return {
                                    name: c ? (c.name || 'Unknown Character') : 'Unknown Character',
                                    description: c ? (c.description || 'Character') : 'Character',
                                    mediaId: id,
                                    image: c ? c.image : null
                                };
                            });
                        }

                        const res = await fetch(endpoint, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(reqBody),
                            signal
                        });

                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            if (err.refresh) refreshSessionKey();
                            throw new Error(err.message || "Failed to generate image");
                        }

                        const data = await res.json();
                        if (flowAccounts.length === 1 && data.flow_project_url && data.flow_project_url !== flowProjectUrl) {
                            flowProjectUrl = data.flow_project_url;
                            dispatch({ type: 'SET_FLOW_PROJECT', payload: flowProjectUrl });
                        }
                        let returnedImage = null;
                        if (data?.imagePanels?.[0]?.generatedImages?.[0]?.encodedImage) {
                            const rawBase64 = data.imagePanels[0].generatedImages[0].encodedImage;
                            returnedImage = rawBase64.startsWith('data:') ? rawBase64 : `data:image/jpeg;base64,${rawBase64}`;
                        }

                        if (returnedImage) {
                            dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, updates: { image: returnedImage, imageGenError: null } } });
                            generatedCount++;
                        } else {
                            throw new Error("No image data returned from server");
                        }

                    } catch (err) {
                        if (err.name !== 'AbortError') {
                            console.error(`Failed to generate image for scene ${scene.id}:`, err);
                            failureCount++;
                            dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'imageGenError', value: err.message || 'Image generation failed' } });
                        }
                    } finally {
                        dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'imageGenStatus', value: null } });
                    }
                    }
                };
                await Promise.all(Array.from({ length: Math.min(maxConcurrentFlowJobs, batch.length) }, (_, index) => worker(index)));
            }

            setFailedImageCount(failureCount);
            if (signal.aborted) {
                toast.success(`Stopped. Generated: ${generatedCount}`, { id: toastId });
            } else {
                toast.success(`Done! Generated: ${generatedCount} | Failed: ${failureCount} | Skipped: ${skippedHasImage + skippedNoPrompt}`, { id: toastId });
            }

        } catch (e) {
            console.error(e);
            toast.error(e.message || "Bulk generation failed", { id: toastId });
        } finally {
            scenesToProcess.forEach(scene => {
                dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'imageGenStatus', value: null } });
            });
            setIsGeneratingAllImages(false);
            imageAbortControllerRef.current = null;
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-2 mr-2">

            <Button variant="outline" size="sm" onClick={handleDetectCharacters} disabled={isDetectingChars} className="h-9 text-sm px-3 text-slate-700 hover:text-emerald-600 hover:bg-emerald-50">
                {isDetectingChars ? <FaSpinner className="mr-2 animate-spin" /> : <FaUsers className="mr-2" />}
                Detect Characters
            </Button>

            <Button variant="outline" size="sm" onClick={handleGenerateScenes} disabled={isGeneratingScenes} className="h-9 text-sm px-3 text-slate-700 hover:text-purple-600 hover:bg-purple-50">
                {isGeneratingScenes ? <FaSpinner className="mr-2 animate-spin" /> : <FaMagic className="mr-2" />}
                Generate Scenes
            </Button>

            {!isGeneratingPrompts ? (
                <Button variant="outline" size="sm" onClick={handleGenerateImagePrompts} className="h-9 text-sm px-3 text-slate-700 hover:text-pink-600 hover:bg-pink-50">
                    <FaPenFancy className="mr-2" /> Generate Prompts
                </Button>
            ) : (
                <Button variant="destructive" size="sm" onClick={handleGenerateImagePrompts} className="h-9 text-sm px-3 shadow-md border border-red-700 transition-all">
                    <FaStop className="mr-2 animate-pulse" /> Stop Generating
                </Button>
            )}

            {!isGeneratingAllImages ?
                (
                    <>
                        <Button variant="outline" size="sm" onClick={handleGenerateAllImages} className="h-9 text-sm px-3 text-slate-700 hover:text-blue-600 hover:bg-blue-50">
                            <FaImages className="mr-2" /> Generate Missing Images
                        </Button>
                        {failedImageCount > 0 && (
                            <Button variant="outline" size="sm" onClick={() => handleGenerateAllImages(true)} className="h-9 text-sm px-3 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200">
                                <FaRedo className="mr-2" /> Retry Failed ({failedImageCount})
                            </Button>
                        )}
                    </>
                ) : (
                    <Button variant="destructive" size="sm" onClick={handleGenerateAllImages} className="h-9 text-sm px-3 shadow-md border border-red-700 transition-all">
                        <FaStop className="mr-2 animate-pulse" /> Stop Generating
                    </Button>
                )}
        </div>
    );
};

export default GeneratorControls;
