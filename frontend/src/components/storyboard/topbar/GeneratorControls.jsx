import React, { useState, useRef } from 'react';
import { useStoryBoard } from '../../../context/StoryBoardContext';
import { Button } from '@/components/ui/button';
import { FaMagic, FaSpinner, FaPenFancy, FaImages, FaStop, FaUsers } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { getStorageItem, refreshSessionKey } from '../../../lib/storyboard-utils';

const GeneratorControls = () => {
    const { state, dispatch } = useStoryBoard();
    const [isGeneratingScenes, setIsGeneratingScenes] = useState(false);
    const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
    const [isGeneratingAllImages, setIsGeneratingAllImages] = useState(false);
    const [isDetectingChars, setIsDetectingChars] = useState(false);

    const promptAbortControllerRef = useRef(null);
    const imageAbortControllerRef = useRef(null);

    const backendUrl = import.meta.env.VITE_BACKEND_URL;

    const handleDetectCharacters = async () => {
        setIsDetectingChars(true);
        const toastId = toast.loading("Detecting characters from script...");

        try {
            const allSentences = [];
            state.items.forEach(item => {
                if (item.type === 'sentence') allSentences.push(item);
                else if (item.type === 'scene') allSentences.push(...item.sentences);
            });

            if (allSentences.length === 0) throw new Error("No sentences found to detect characters from.");

            const payload = allSentences.map(s => ({ text: s.text || '' }));

            const res = await fetch(`${backendUrl}/api/detect-characters`, {
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
            const detected = data.characters || [];

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
            const allSentences = [];
            state.items.forEach(item => {
                if (item.type === 'sentence') allSentences.push(item);
                else if (item.type === 'scene') allSentences.push(...item.sentences);
            });
            if (allSentences.length === 0) throw new Error("No sentences found");

            const payload = allSentences.map(s => {
                return {
                    text: s.text || ''
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

    const handleGenerateImagePrompts = async () => {
        if (isGeneratingPrompts) {
            if (promptAbortControllerRef.current) {
                promptAbortControllerRef.current.abort();
            }
            return;
        }

        const instData = getStorageItem('sb_global_instructions');

        const activeCharacters = (state.characters || []).filter(c => c.mediaId);
        // Prompt generation only needs name and description
        const charactersPayload = activeCharacters.length > 0 ? activeCharacters.map(c => ({
            name: c.name || 'Unknown Character',
            description: c.description || 'character'
        })) : null;

        setIsGeneratingPrompts(true);
        const toastId = toast.loading("Generating image prompts...");

        promptAbortControllerRef.current = new AbortController();
        const signal = promptAbortControllerRef.current.signal;

        const scenesToProcess = state.items.filter(item => item.type === 'scene');
        try {
            let scenesProcessed = 0;
            let scenesSkipped = 0;
            let previousScenesList = [];

            for (let i = 0; i < scenesToProcess.length; i++) {
                if (signal.aborted) break;
                const item = scenesToProcess[i];
                const sceneText = item.sentences.map(s => s.text).join(' ').trim();

                if (item.prompt && item.prompt.trim().length > 0) {
                    scenesSkipped++;
                    if (sceneText) {
                        previousScenesList.push({ scene_lines: sceneText, prompt: item.prompt });
                        if (previousScenesList.length > 10) previousScenesList.shift();
                    }
                    continue;
                }

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
                            title: state.title || 'Untitled',
                            scene_lines: sceneText,
                            instructions: instData.text ? instData.text : null,
                            previous_scenes: previousScenesList.length > 0 ? previousScenesList : null,
                            characters: charactersPayload
                        }),
                        signal
                    });

                    if (!res.ok) {
                        console.error(`Failed to generate prompt for scene ${item.id}`);
                        continue;
                    }

                    const data = await res.json();
                    if (data.prompt) {
                        const newMap = { ...(item.characterMap || {}) };
                        const matches = data.prompt.match(/\[CH(?:\d+|X)\]/g) || [];

                        matches.forEach(tag => {
                            if (tag !== '[CHX]') {
                                const num = parseInt(tag.replace(/\D/g, ''), 10) - 1;
                                if (activeCharacters[num]) {
                                    newMap[tag] = activeCharacters[num].id;
                                }
                            }
                        });

                        dispatch({
                            type: 'UPDATE_SCENE_META',
                            payload: {
                                id: item.id,
                                updates: {
                                    prompt: data.prompt,
                                    subjectMediaIds: data.subject_media_ids || [],
                                    characterMap: newMap
                                }
                            }
                        });
                        scenesProcessed++;

                        previousScenesList.push({ scene_lines: sceneText, prompt: data.prompt });
                        if (previousScenesList.length > 10) previousScenesList.shift();
                    }
                } catch (e) {
                    if (e.name !== 'AbortError') {
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
        const allStateCharacters = state.characters || [];

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
                            session_token: sessionData.text,
                        };

                        if (subjectIds.length > 0) {
                            endpoint = `${backendUrl}/api/generate-image-chars`;
                            // Now correctly sending name, description, and mediaId
                            reqBody.characters = subjectIds.map(id => {
                                const c = allStateCharacters.find(ch => ch.mediaId === id);
                                return {
                                    name: c ? (c.name || 'Unknown Character') : 'Unknown Character',
                                    description: c ? (c.description || 'Character') : 'Character',
                                    mediaId: id
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
                            throw new Error(err.error || "Failed to generate image");
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
                        if (err.name !== 'AbortError') {
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