import React, { useState, useEffect } from 'react';
import { useStoryBoard } from '../../context/StoryBoardContext';
import { getSceneDuration, fileToBase64, getStorageItem, refreshSessionKey } from '../../lib/storyboard-utils';
import Sentence from './Sentence';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from '@/components/ui/dialog';
import { FaImage, FaMagic, FaTrash, FaUpload, FaDownload, FaPlus, FaCopy, FaPen, FaUnlink, FaEraser, FaExpand } from 'react-icons/fa';
import toast from 'react-hot-toast';

const Scene = ({ scene, index }) => {
    const { state, dispatch } = useStoryBoard();
    const [isGeneratingImg, setIsGeneratingImg] = useState(false);
    const [isGeneratingTxt, setIsGeneratingTxt] = useState(false);

    const [lastGeneratedPrompt, setLastGeneratedPrompt] = useState(scene.image ? scene.prompt : null);
    const { start, end } = getSceneDuration(scene.sentences);

    useEffect(() => {
        if (!scene.image) {
            setLastGeneratedPrompt(null);
        }
    }, [scene.image]);

    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const base64String = await fileToBase64(file);
                dispatch({
                    type: 'UPDATE_SCENE_META',
                    payload: { id: scene.id, field: 'image', value: base64String }
                });
                setLastGeneratedPrompt(scene.prompt);
                toast.success("Uploaded");
            } catch (err) {
                toast.error("Error uploading image");
            }
        }
    };

    const handleDownloadImage = () => {
        if (!scene.image) return;
        const link = document.createElement('a');
        link.href = scene.image;
        link.download = `scene-${index + 1}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleDeleteImage = () => {
        dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'image', value: null } });
        setLastGeneratedPrompt(null);
    };

    const handleCleanScene = () => {
        dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'image', value: null } });
        dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'prompt', value: "" } });
        setLastGeneratedPrompt(null);
        toast.success("Scene cleaned");
    };

    const handleGenerateImage = async () => {
        if (!scene.prompt) return toast.error("Enter a prompt first");

        const sessionData = getStorageItem('sb_global_session_key');
        if (!sessionData.text) {
            return toast.error("Session Key is missing. Please add it first.");
        }

        setIsGeneratingImg(true);
        const toastId = toast.loading("Generating image...");

        try {
            const backendUrl = import.meta.env.VITE_BACKEND_URL;
            const res = await fetch(`${backendUrl}/api/generate-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: scene.prompt,
                    session_token: sessionData.text,
                })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                if (err.refresh) {
                    refreshSessionKey();
                }
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
                setLastGeneratedPrompt(scene.prompt);
                toast.success("Image Generated", { id: toastId });
            } else {
                throw new Error("No valid image data found in the response");
            }

        } catch (e) {
            console.error(e);
            toast.error(e.message, { id: toastId });
        } finally {
            setIsGeneratingImg(false);
        }
    };

    const handleGeneratePrompt = async () => {
        const charData = getStorageItem('sb_global_character');
        const styleData = getStorageItem('sb_global_style');

        if (charData.enabled && (!charData.text || !charData.text.trim())) {
            return toast.error("Character is enabled but empty. Please disable it or add a description.");
        }
        if (styleData.enabled && (!styleData.text || !styleData.text.trim())) {
            return toast.error("Style is enabled but empty. Please disable it or add a description.");
        }

        setIsGeneratingTxt(true);
        const toastId = toast.loading("Generating prompt...");

        try {
            const sceneText = scene.sentences.map(s => s.text).join(' ').trim();
            if (!sceneText) throw new Error("Scene has no text");

            let previousContext = null;
            const allScenes = state.items.filter(i => i.type === 'scene');
            const currentSceneIndex = allScenes.findIndex(s => s.id === scene.id);

            if (currentSceneIndex > 0) {
                previousContext = allScenes[currentSceneIndex - 1].prompt || null;
            }

            const backendUrl = import.meta.env.VITE_BACKEND_URL;

            const res = await fetch(`${backendUrl}/api/generate-image-prompt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scene_sentences: sceneText,
                    previous_scene_context: previousContext,
                    character_description: charData.enabled ? charData.text : null,
                    style: styleData.enabled ? styleData.text : null
                })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || "Failed to generate");
            }

            const data = await res.json();
            if (data.prompt) {
                dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'prompt', value: data.prompt } });
                toast.success("Prompt Generated", { id: toastId });
            } else {
                throw new Error("No prompt returned");
            }

        } catch (e) {
            console.error(e);
            toast.error(e.message, { id: toastId });
        } finally {
            setIsGeneratingTxt(false);
        }
    };

    const handleCopyScript = () => {
        const text = scene.sentences.map(s => s.text).join('\n');
        if (!text.trim()) { toast.error("No text"); return; }
        navigator.clipboard.writeText(text);
        toast.success("Scene text copied");
    };

    const handleUngroup = () => {
        dispatch({ type: 'UNGROUP_SCENE', payload: scene.id });
    };

    const isImageGenDisabled = isGeneratingImg || (!!scene.image && scene.prompt === lastGeneratedPrompt);

    return (
        <Card className="overflow-hidden border-slate-200 shadow-sm transition-shadow">
            <div className="flex border-b px-3 py-1 items-center justify-between h-9">
                <div className="flex items-center gap-2">
                    <Badge>Scene {index + 1}</Badge>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1 rounded border border-slate-200">
                        {start.toFixed(2)}s - {end.toFixed(2)}s
                    </span>
                </div>
                <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={handleUngroup} className="h-6 w-6 text-slate-400 hover:text-blue-600 hover:bg-blue-50" title="Ungroup Scene">
                        <FaUnlink size={10} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => dispatch({ type: 'DELETE_ITEM', payload: scene.id })} className="h-6 w-6 text-slate-400 hover:text-red-500 hover:bg-red-50" title="Delete Scene">
                        <FaTrash size={10} />
                    </Button>
                </div>
            </div>

            <CardContent className="p-0">
                <div className="flex flex-col md:flex-row border-b border-slate-100 bg-slate-50/30 p-4">
                    <div className="w-full md:w-1/3 pr-4 border-b md:border-b-0 md:border-r border-slate-100">
                        <div className="aspect-video bg-slate-100 rounded border border-slate-200 overflow-hidden relative group flex items-center justify-center">
                            {scene.image ? (
                                <img src={scene.image} alt="Scene" className="w-full h-full object-cover" />
                            ) : (
                                <div className="text-slate-300 flex flex-col items-center">
                                    <FaImage size={20} className="mb-1" />
                                    <span className="text-[10px]">No Image</span>
                                </div>
                            )}

                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                <label className="cursor-pointer bg-white p-2 rounded-full hover:bg-slate-100 text-slate-700 shadow-sm transition-transform hover:scale-110" title="Upload">
                                    <FaUpload size={16} />
                                    <input type="file" hidden onChange={handleImageUpload} accept="image/*" />
                                </label>

                                {scene.image && (
                                    <>
                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <button className="bg-white p-2 rounded-full hover:bg-slate-100 text-slate-700 shadow-sm transition-transform hover:scale-110" title="Expand">
                                                    <FaExpand size={16} />
                                                </button>
                                            </DialogTrigger>
                                            <DialogContent className="max-w-4xl w-auto p-1 bg-white/95 border-none shadow-2xl">
                                                <DialogTitle className="sr-only">Scene {index + 1} Image</DialogTitle>
                                                <div className="flex justify-center items-center pt-9">
                                                    <img src={scene.image} alt={`Scene ${index + 1}`} className="max-h-[80vh] w-auto rounded shadow-sm" />
                                                </div>
                                            </DialogContent>
                                        </Dialog>

                                        <button onClick={handleDownloadImage} className="bg-white p-2 rounded-full hover:bg-slate-100 text-slate-700 shadow-sm transition-transform hover:scale-110" title="Download">
                                            <FaDownload size={16} />
                                        </button>

                                        <button onClick={handleDeleteImage} className="bg-white p-2 rounded-full hover:bg-red-50 text-red-500 shadow-sm transition-transform hover:scale-110" title="Delete">
                                            <FaTrash size={16} />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="w-full md:w-2/3 pl-0 md:pl-4 pt-4 md:pt-0 flex flex-col gap-2">
                        <Textarea
                            placeholder="Describe scene..."
                            className="text-xs resize-none bg-white h-24 focus-visible:ring-1"
                            value={scene.prompt}
                            onChange={(e) => dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, field: 'prompt', value: e.target.value } })}
                        />
                        <div className="flex flex-wrap gap-2">
                            <Button size="sm" className={`h-7 text-xs text-white ${isImageGenDisabled ? 'bg-slate-400' : 'bg-purple-600 hover:bg-purple-700'}`} onClick={handleGenerateImage} disabled={isImageGenDisabled} title={isImageGenDisabled ? "Change prompt to regenerate" : "Generate Image"}>
                                {isGeneratingImg ? "..." : <><FaMagic className="mr-1" /> Gen Image</>}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs text-slate-600" onClick={handleGeneratePrompt} disabled={isGeneratingTxt}>
                                {isGeneratingTxt ? "..." : <><FaPen className="mr-1" /> Gen Prompt</>}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 border-red-100" onClick={handleCleanScene} title="Clear Prompt & Image">
                                <FaEraser className="mr-1" /> Clean
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400 ml-auto" onClick={handleCopyScript} title="Copy text">
                                <FaCopy />
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-white">
                    <div className="space-y-0">
                        {scene.sentences.map(sent => (
                            <Sentence key={sent.id} sentence={sent} sceneId={scene.id} isNested={true} />
                        ))}
                    </div>
                    <div className="mt-2 flex justify-center">
                        <Button variant="ghost" size="sm" className="h-6 text-xs text-slate-400 hover:text-blue-600 hover:bg-blue-50" onClick={() => dispatch({ type: 'ADD_SENTENCE', payload: scene.id })}>
                            <FaPlus className="mr-1" /> Add Sentence
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default Scene;