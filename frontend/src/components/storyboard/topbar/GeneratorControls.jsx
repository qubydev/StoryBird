import React, { useState } from 'react';
import { useStoryBoard } from '../../../context/StoryBoardContext';
import { Button } from '@/components/ui/button';
import { FaMagic, FaImage, FaSpinner, FaPenFancy } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { getStorageItem } from '../../../lib/storyboard-utils';

const GeneratorControls = () => {
    const { state, dispatch } = useStoryBoard();
    const [isGeneratingScenes, setIsGeneratingScenes] = useState(false);
    const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
    const backendUrl = import.meta.env.VITE_BACKEND_URL;

    // --- 1. GENERATE SCENES (Group Sentences) ---
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
                let duration = 0;
                if (s.words.length > 0) duration = s.words[s.words.length - 1].end - s.words[0].start;
                return {
                    text: s.words.map(w => w.text).join(' '),
                    duration: parseFloat(duration.toFixed(2))
                };
            });

            const res = await fetch(`${backendUrl}/api/generate-scenes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || errData.message || `Error ${res.status}`);
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

    // --- 2. GENERATE IMAGE PROMPTS (Bulk) ---
    const handleGenerateImagePrompts = async () => {
        // --- VALIDATION START ---
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
        // --- VALIDATION END ---

        setIsGeneratingPrompts(true);
        const toastId = toast.loading("Starting prompt generation...");

        try {
            const sessionData = getStorageItem('sb_global_session_key');

            const characterContext = charData.enabled ? charData.text : null;
            const styleContext = styleData.enabled ? styleData.text : null;

            let previousContext = null;
            let scenesProcessed = 0;
            let scenesSkipped = 0;
            let sceneIndex = 0;

            for (const item of state.items) {
                if (item.type !== 'scene') continue;
                sceneIndex++;

                if (item.prompt && item.prompt.trim().length > 0) {
                    previousContext = item.prompt;
                    scenesSkipped++;
                    toast(`Skipping Scene ${sceneIndex} (Prompt exists)`, {
                        icon: '⏭️',
                        duration: 2000,
                        position: 'bottom-right',
                        style: { fontSize: '12px' }
                    });
                    continue;
                }

                const sceneText = item.sentences.flatMap(s => s.words.map(w => w.text)).join(' ').trim();
                if (!sceneText) continue;

                // toast.loading(`Generating prompt for Scene ${sceneIndex}...`, { id: toastId });

                const res = await fetch(`${backendUrl}/api/generate-image-prompt`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        scene_sentences: sceneText,
                        previous_scene_context: previousContext,
                        character_description: characterContext,
                        style: styleContext
                    })
                });

                if (!res.ok) {
                    console.error(`Failed to generate prompt for scene ${item.id}`);
                    continue;
                }

                const data = await res.json();
                const generatedPrompt = data.prompt;

                if (generatedPrompt) {
                    dispatch({
                        type: 'UPDATE_SCENE_META',
                        payload: { id: item.id, field: 'prompt', value: generatedPrompt }
                    });
                    previousContext = generatedPrompt;
                    scenesProcessed++;
                }

                await new Promise(resolve => setTimeout(resolve, 300));
            }

            toast.dismiss(toastId);
            if (scenesProcessed > 0 || scenesSkipped > 0) {
                toast.success(`Done! Generated: ${scenesProcessed}, Skipped: ${scenesSkipped}`);
            } else {
                toast.error("No scenes found to process");
            }

        } catch (e) {
            console.error(e);
            toast.error(e.message || "Prompt generation failed", { id: toastId });
        } finally {
            setIsGeneratingPrompts(false);
        }
    };

    return (
        <div className="flex items-center gap-2 mr-2">
            <Button variant="outline" size="sm" onClick={handleGenerateScenes} disabled={isGeneratingScenes} className="h-9 text-sm px-3 text-slate-700 hover:text-purple-600 hover:bg-purple-50">
                {isGeneratingScenes ? <FaSpinner className="mr-2 animate-spin" /> : <FaMagic className="mr-2" />}
                Generate Scenes
            </Button>
            <Button variant="outline" size="sm" onClick={handleGenerateImagePrompts} disabled={isGeneratingPrompts} className="h-9 text-sm px-3 text-slate-700 hover:text-pink-600 hover:bg-pink-50">
                {isGeneratingPrompts ? <FaSpinner className="mr-2 animate-spin" /> : <FaPenFancy className="mr-2" />}
                Generate Image Prompts
            </Button>
        </div>
    );
};

export default GeneratorControls;