import React, { useState, useRef } from 'react';
import { useStoryBoard } from '../../../context/StoryBoardContext';
import { Button } from '@/components/ui/button';
import { FaMagic, FaSpinner, FaPenFancy, FaImages, FaStop } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { getStorageItem, refreshSessionKey } from '../../../lib/storyboard-utils';

const GeneratorControls = () => {
    const { state, dispatch } = useStoryBoard();
    const [isGeneratingScenes, setIsGeneratingScenes] = useState(false);

    // Tracking states
    const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
    const [isGeneratingAllImages, setIsGeneratingAllImages] = useState(false);

    // Abort controllers for stopping processes
    const promptAbortControllerRef = useRef(null);
    const imageAbortControllerRef = useRef(null);

    const backendUrl = import.meta.env.VITE_BACKEND_URL;

    // --- 1. GENERATE SCENES ---
    const handleGenerateScenes = async () => {
        setIsGeneratingScenes(true);
        const toastId = toast.loading("Analyzing script...");

        try {
            const allSentences = [];
            state.items.forEach(item => {
                if (item.type === 'sentence') allSentences.push(item);
                else if (item.type === 'scene') allSentences.push(...item.sentences);
            });

            if (allSentences.length === 0) throw new Error("No sentences found");

            const payload = allSentences.map(s => {
                return {
                    text: s.text || '',
                    duration: parseFloat((s.end - s.start).toFixed(2)) || 0
                };
            });

            const res = await fetch(`${backendUrl}/api/generate-scenes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: state.title || 'Untitled',
                    lines: payload
                })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || `Error ${res.status}`);
            }

            const data = await res.json();
            const sceneIndices = data.scenes;

            if (!sceneIndices) throw new Error("Invalid response");

            dispatch({ type: 'APPLY_AUTO_GROUPING', payload: sceneIndices });
            toast.success("Scenes Generated", { id: toastId });

        } catch (e) {
            console.error(e);
            toast.error(e.message, { id: toastId });
        } finally {
            setIsGeneratingScenes(false);
        }
    };

    // --- 2. GENERATE PROMPTS (WITH STOP ABILITY) ---
    const handleGenerateImagePrompts = async () => {
        // If already running, abort the process
        if (isGeneratingPrompts) {
            if (promptAbortControllerRef.current) {
                promptAbortControllerRef.current.abort();
            }
            return;
        }

        const charData = getStorageItem('sb_global_character');
        const styleData = getStorageItem('sb_global_style');

        if (charData.enabled && (!charData.text || !charData.text.trim())) {
            toast.error("Character is enabled but empty. Please disable it or add a description.");
            return;
        }
        if (styleData.enabled && (!styleData.text || !styleData.text.trim())) {
            toast.error("Style is enabled but empty. Please disable it or add a description.");
            return;
        }

        setIsGeneratingPrompts(true);
        const toastId = toast.loading("Generating image prompts...");

        promptAbortControllerRef.current = new AbortController();
        const signal = promptAbortControllerRef.current.signal;

        const scenesToProcess = state.items.filter(item => item.type === 'scene');

        try {
            let scenesProcessed = 0;
            let scenesSkipped = 0;

            for (let i = 0; i < scenesToProcess.length; i++) {
                if (signal.aborted) break;

                const item = scenesToProcess[i];

                if (item.prompt && item.prompt.trim().length > 0) {
                    scenesSkipped++;
                    continue;
                }

                const sceneText = item.sentences.map(s => s.text).join(' ').trim();
                if (!sceneText) {
                    scenesSkipped++;
                    continue;
                }

                try {
                    dispatch({ type: 'UPDATE_SCENE_META', payload: { id: item.id, field: 'promptGenStatus', value: 'generating' } });

                    const res = await fetch(`${backendUrl}/api/generate-image-prompt`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            scene_lines: sceneText,
                            character_description: charData.enabled ? charData.text : null,
                            animation_style: styleData.enabled ? styleData.text : null
                        }),
                        signal // Pass the abort signal
                    });

                    if (!res.ok) {
                        console.error(`Failed to generate prompt for scene ${item.id}`);
                        continue;
                    }

                    const data = await res.json();
                    if (data.prompt) {
                        dispatch({
                            type: 'UPDATE_SCENE_META',
                            payload: { id: item.id, field: 'prompt', value: data.prompt }
                        });
                        scenesProcessed++;
                    }
                } catch (e) {
                    if (e.name === 'AbortError') {
                        // Silently ignore aborts
                    } else {
                        console.error(e);
                    }
                } finally {
                    dispatch({ type: 'UPDATE_SCENE_META', payload: { id: item.id, field: 'promptGenStatus', value: null } });
                }

                if (signal.aborted) break;
                await new Promise(resolve => setTimeout(resolve, 300));
            }

            if (signal.aborted) {
                toast.success(`Stopped. Generated: ${scenesProcessed}`, { id: toastId });
            } else {
                toast.success(`Done! Generated: ${scenesProcessed}, Skipped: ${scenesSkipped}`, { id: toastId });
            }

        } catch (e) {
            console.error(e);
            toast.error(e.message || "Prompt generation failed", { id: toastId });
        } finally {
            scenesToProcess.forEach(scene => {
                dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'promptGenStatus', value: null } });
            });
            setIsGeneratingPrompts(false);
            promptAbortControllerRef.current = null;
        }
    };

    // --- 3. GENERATE ALL IMAGES (QUEUE SYSTEM) ---
    const handleGenerateAllImages = async () => {
        if (isGeneratingAllImages) {
            if (imageAbortControllerRef.current) {
                imageAbortControllerRef.current.abort();
            }
            return;
        }

        const sessionData = getStorageItem('sb_global_session_key');
        if (!sessionData.text) {
            return toast.error("Session Key is missing. Please add it in Global Settings.");
        }

        setIsGeneratingAllImages(true);
        const toastId = toast.loading("Starting bulk image generation...");

        imageAbortControllerRef.current = new AbortController();
        const signal = imageAbortControllerRef.current.signal;

        const scenesToProcess = [];

        try {
            let skippedHasImage = 0;
            let skippedNoPrompt = 0;

            for (let i = 0; i < state.items.length; i++) {
                const item = state.items[i];
                if (item.type !== 'scene') continue;

                if (item.image) {
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
            let hasError = false;
            const activePromises = new Set();

            for (let i = 0; i < scenesToProcess.length; i++) {
                if (signal.aborted || hasError) break;

                while (activePromises.size >= 4) {
                    await Promise.race(activePromises);
                }

                if (signal.aborted || hasError) break;

                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                if (signal.aborted || hasError) break;

                const scene = scenesToProcess[i];
                toast.loading(`Processing ${generatedCount + activePromises.size + 1} of ${scenesToProcess.length}...`, { id: toastId });

                const promise = (async () => {
                    try {
                        dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'imageGenStatus', value: 'generating' } });

                        const res = await fetch(`${backendUrl}/api/generate-image`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                prompt: scene.prompt,
                                session_token: sessionData.text,
                            }),
                            signal
                        });

                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            if (err.refresh) refreshSessionKey();
                            throw new Error(err.message || "Failed to generate image");
                        }

                        const data = await res.json();
                        let returnedImage = null;
                        if (data?.imagePanels?.[0]?.generatedImages?.[0]?.encodedImage) {
                            const rawBase64 = data.imagePanels[0].generatedImages[0].encodedImage;
                            returnedImage = rawBase64.startsWith('data:') ? rawBase64 : `data:image/jpeg;base64,${rawBase64}`;
                        }

                        if (returnedImage) {
                            dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'image', value: returnedImage } });
                            generatedCount++;
                        } else {
                            throw new Error("No image data returned from server");
                        }

                    } catch (err) {
                        if (err.name === 'AbortError') {
                            // Ignored
                        } else {
                            console.error(`Failed to generate image for scene ${scene.id}:`, err);
                            hasError = true;
                            toast.error(`Error on Scene ${scene.displayIndex}: ${err.message}`);

                            if (imageAbortControllerRef.current) {
                                imageAbortControllerRef.current.abort();
                            }
                        }
                    } finally {
                        dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'imageGenStatus', value: null } });
                    }
                })();

                activePromises.add(promise);
                promise.finally(() => activePromises.delete(promise));
            }

            await Promise.all(activePromises);

            if (signal.aborted && !hasError) {
                toast.success(`Stopped. Generated: ${generatedCount}`, { id: toastId });
            } else if (hasError) {
                toast.error(`Queue halted due to error. Generated: ${generatedCount}`, { id: toastId });
            } else {
                toast.success(`Done! Generated: ${generatedCount} | Skipped: ${skippedHasImage + skippedNoPrompt}`, { id: toastId });
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

            {!isGeneratingAllImages ? (
                <Button variant="outline" size="sm" onClick={handleGenerateAllImages} className="h-9 text-sm px-3 text-slate-700 hover:text-blue-600 hover:bg-blue-50">
                    <FaImages className="mr-2" /> Generate Images
                </Button>
            ) : (
                <Button variant="destructive" size="sm" onClick={handleGenerateAllImages} className="h-9 text-sm px-3 shadow-md border border-red-700 transition-all">
                    <FaStop className="mr-2 animate-pulse" /> Stop Generating
                </Button>
            )}
        </div>
    );
};

export default GeneratorControls;