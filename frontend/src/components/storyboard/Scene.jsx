import React, { useState, useEffect } from 'react';
import { useStoryBoard } from '../../context/StoryBoardContext';
import { getSceneDuration, fileToBase64, getStorageItem, refreshSessionKey, formatSRTTimestamp } from '../../lib/storyboard-utils';
import Sentence from './Sentence';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogHeader } from '@/components/ui/dialog';
import { FaImage, FaMagic, FaTrash, FaUpload, FaDownload, FaPlus, FaCopy, FaPen, FaUnlink, FaEraser, FaExpand, FaSpinner, FaCheck, FaEdit } from 'react-icons/fa';
import toast from 'react-hot-toast';

const Scene = ({ scene, index }) => {
    const { state, dispatch } = useStoryBoard();
    const [isGeneratingImg, setIsGeneratingImg] = useState(false);
    const [isGeneratingTxt, setIsGeneratingTxt] = useState(false);

    const [isEditingPrompt, setIsEditingPrompt] = useState(false);
    const [localPrompt, setLocalPrompt] = useState(scene.prompt || "");
    const [linkDialog, setLinkDialog] = useState(null);

    const [lastGeneratedPrompt, setLastGeneratedPrompt] = useState(scene.image ? scene.prompt : null);
    const { start, end } = getSceneDuration(scene.sentences);

    const isGlobalGenerating = scene.imageGenStatus === 'generating';
    const isGlobalQueued = scene.imageGenStatus === 'queued';
    const isBusy = isGeneratingImg || isGlobalGenerating || isGlobalQueued;
    const isPromptBusy = isGeneratingTxt || scene.promptGenStatus === 'generating';

    useEffect(() => {
        if (!scene.image) {
            setLastGeneratedPrompt(null);
        }
    }, [scene.image]);

    useEffect(() => {
        if (!isEditingPrompt) {
            setLocalPrompt(scene.prompt || "");
        }
    }, [scene.prompt, isEditingPrompt]);

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
        dispatch({ type: 'UPDATE_SCENE_META', payload: { id: scene.id, updates: { image: null, prompt: "", subjectMediaIds: [], characterMap: {} } } });
        setLastGeneratedPrompt(null);
        toast.success("Scene cleaned");
    };

    const handleSavePrompt = () => {
        const newMap = { ...(scene.characterMap || {}) };
        let finalPrompt = localPrompt;
        const matches = localPrompt.match(/\[CH(?:\d+|X)\]/g) || [];

        matches.forEach(tag => {
            if (tag !== '[CHX]') {
                if (!newMap[tag]) {
                    const num = parseInt(tag.replace(/\D/g, ''), 10) - 1;
                    if (!isNaN(num) && state.characters && state.characters[num]) {
                        newMap[tag] = state.characters[num].id;
                    } else {
                        finalPrompt = finalPrompt.split(tag).join('[CHX]');
                    }
                } else {
                    const charExists = state.characters?.some(c => c.id === newMap[tag]);
                    if (!charExists) {
                        finalPrompt = finalPrompt.split(tag).join('[CHX]');
                        delete newMap[tag];
                    }
                }
            }
        });

        dispatch({
            type: 'UPDATE_SCENE_META',
            payload: { id: scene.id, updates: { prompt: finalPrompt, characterMap: newMap } }
        });
        setLocalPrompt(finalPrompt);
        setIsEditingPrompt(false);
    };

    const handleGenerateImage = async () => {
        if (!scene.prompt) return toast.error("Enter a prompt first");

        if (scene.prompt.includes('[CHX]')) {
            return toast.error("Error: Prompt contains unlinked character [CHX]");
        }

        const allStateCharacters = state.characters || [];
        const promptTags = scene.prompt.match(/\[CH(?:\d+)\]/g) || [];
        for (const tag of promptTags) {
            const charId = scene.characterMap?.[tag];
            const character = allStateCharacters.find(c => c.id === charId);
            if (character && !character.mediaId) {
                return toast.error(`Error: Linked character "${character.name || tag}" is missing an uploaded image.`);
            }
        }

        const sessionData = getStorageItem('sb_global_session_key');
        if (!sessionData.text) {
            return toast.error("Session Key is missing. Please add it first.");
        }

        setIsGeneratingImg(true);
        const toastId = toast.loading("Generating image...");
        try {
            const backendUrl = import.meta.env.VITE_BACKEND_URL;

            const matches = scene.prompt.match(/\[CH(?:\d+|X)\]/g) || [];
            const subjectIds = matches.map(tag => {
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
                body: JSON.stringify(reqBody)
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                if (err.refresh) {
                    refreshSessionKey();
                }
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
        const instData = getStorageItem('sb_global_instructions');

        const sceneIndex = state.items.findIndex(i => i.id === scene.id);
        const previousScenes = state.items.slice(0, sceneIndex).filter(i => i.type === 'scene');
        const last10Scenes = previousScenes.slice(-10);

        const previousScenesPayload = last10Scenes.reduce((acc, s) => {
            if (s.prompt && s.prompt.trim()) {
                acc.push({
                    scene_lines: s.sentences.map(sent => sent.text).join(' ').trim(),
                    prompt: s.prompt
                });
            }
            return acc;
        }, []);

        const activeCharacters = (state.characters || []).filter(c => c.mediaId);
        const charactersPayload = activeCharacters.length > 0 ? activeCharacters.map(c => ({
            name: c.name || 'Unknown Character',
            description: c.description || 'character'
        })) : null;

        setIsGeneratingTxt(true);
        const toastId = toast.loading("Generating prompt...");
        try {
            const sceneText = scene.sentences.map(s => s.text).join(' ').trim();
            if (!sceneText) throw new Error("Scene has no text");

            if (!state.title.trim() || state.title.trim() === 'Untitled') {
                return toast.error("Please provide a title for your storyboard to get the best results.", { id: toastId });
            }

            const backendUrl = import.meta.env.VITE_BACKEND_URL;
            const res = await fetch(`${backendUrl}/api/generate-image-prompt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: state.title || 'Untitled',
                    scene_lines: sceneText,
                    instructions: instData.text ? instData.text : null,
                    previous_scenes: previousScenesPayload.length > 0 ? previousScenesPayload : null,
                    characters: charactersPayload
                })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || "Failed to generate");
            }

            const data = await res.json();
            if (data.prompt) {

                const newMap = { ...(scene.characterMap || {}) };
                let finalPrompt = data.prompt;
                const matches = data.prompt.match(/\[CH(?:\d+|X)\]/g) || [];

                matches.forEach(tag => {
                    if (tag !== '[CHX]') {
                        const num = parseInt(tag.replace(/\D/g, ''), 10) - 1;
                        if (activeCharacters[num]) {
                            newMap[tag] = activeCharacters[num].id;
                        } else {
                            finalPrompt = finalPrompt.split(tag).join('[CHX]');
                        }
                    }
                });

                dispatch({
                    type: 'UPDATE_SCENE_META',
                    payload: {
                        id: scene.id,
                        updates: {
                            prompt: finalPrompt,
                            subjectMediaIds: data.subject_media_ids || [],
                            characterMap: newMap
                        }
                    }
                });
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

    const handleUpdateLink = (tag, charId) => {
        let newPrompt = scene.prompt || "";
        const newMap = { ...(scene.characterMap || {}) };
        let newTag = tag;

        if (charId === null) {
            newTag = '[CHX]';
            delete newMap[tag];
        } else {
            const charIndex = state.characters?.findIndex(c => c.id === charId);
            if (charIndex !== -1) {
                newTag = `[CH${charIndex + 1}]`;
                newMap[newTag] = charId;

                if (newTag !== tag) {
                    delete newMap[tag];
                }
            }
        }

        if (newTag !== tag) {
            newPrompt = newPrompt.split(tag).join(newTag);
        }

        dispatch({
            type: 'UPDATE_SCENE_META',
            payload: {
                id: scene.id,
                updates: {
                    prompt: newPrompt,
                    characterMap: newMap
                }
            }
        });

        setLocalPrompt(newPrompt);
        setLinkDialog(null);
    };

    const renderPromptWithLinks = () => {
        if (!scene.prompt) return <span className="text-slate-400 italic">No prompt generated...</span>;

        const parts = scene.prompt.split(/(\[CH(?:\d+|X)\])/g);

        return parts.map((part, i) => {
            const match = part.match(/\[CH(?:\d+|X)\]/);
            if (match) {
                const tag = match[0];
                const mappedId = scene.characterMap?.[tag];
                const character = state.characters?.find(c => c.id === mappedId);

                if (!character) {
                    return (
                        <span
                            key={i}
                            onClick={() => setLinkDialog({ tag })}
                            className="text-red-500 font-bold bg-red-50 px-1 rounded border border-red-200 cursor-pointer hover:bg-red-100 transition-colors"
                        >
                            [UNLINKED]
                        </span>
                    );
                }

                return (
                    <span
                        key={i}
                        onClick={() => setLinkDialog({ tag })}
                        className="text-blue-600 font-bold bg-blue-50 px-1 rounded border border-blue-200 cursor-pointer hover:bg-blue-100 transition-colors"
                        title={`Link: ${character.name}`}
                    >
                        {character.name || tag}
                    </span>
                );
            }
            return <span key={i}>{part}</span>;
        });
    };

    const isImageGenDisabled = isBusy || (!!scene.image && scene.prompt === lastGeneratedPrompt);

    return (
        <Card className="overflow-hidden border-slate-200 shadow-sm transition-shadow relative">

            <Dialog open={!!linkDialog} onOpenChange={(open) => !open && setLinkDialog(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Link Character for {linkDialog?.tag}</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-2 py-4">
                        {state.characters?.map(char => {
                            const isCurrentlySelected = scene.characterMap?.[linkDialog?.tag] === char.id;

                            return (
                                <Button
                                    key={char.id}
                                    variant={isCurrentlySelected ? "default" : "outline"}
                                    className={`justify-start h-auto py-2 ${isCurrentlySelected ? 'bg-blue-50 border-blue-200 hover:bg-blue-100' : ''}`}
                                    onClick={() => handleUpdateLink(linkDialog.tag, char.id)}
                                >
                                    <div className="flex items-center gap-3">
                                        {char.image ? (
                                            <img src={char.image} alt="char" className="w-8 h-8 rounded-full object-cover" />
                                        ) : (
                                            <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                                                <FaImage size={12} />
                                            </div>
                                        )}
                                        <div className="flex flex-col items-start text-left">
                                            <span className={`font-bold text-sm ${isCurrentlySelected ? 'text-blue-800' : 'text-slate-800'}`}>
                                                {char.name || 'Unnamed'}
                                            </span>
                                            <span className={`text-xs truncate max-w-[250px] ${isCurrentlySelected ? 'text-blue-600' : 'text-slate-500'}`}>
                                                {char.description}
                                            </span>
                                        </div>
                                    </div>
                                </Button>
                            );
                        })}
                        {(!state.characters || state.characters.length === 0) && (
                            <p className="text-sm text-slate-500 text-center py-4">No characters available.</p>
                        )}
                        <Button variant="destructive" className="mt-4 border border-red-200" onClick={() => handleUpdateLink(linkDialog?.tag, null)}>
                            Unlink Character
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <div className="flex border-b px-3 py-1 items-center justify-between h-9">
                <div className="flex items-center gap-2">
                    <Badge>Scene {index + 1}</Badge>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1 rounded border border-slate-200">
                        {formatSRTTimestamp(start)} --&gt; {formatSRTTimestamp(end)}
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

                            {isBusy && (
                                <div className="absolute inset-0 bg-white/80 backdrop-blur-[2px] flex flex-col items-center justify-center z-20">
                                    <FaSpinner className="animate-spin text-purple-600 mb-2" size={24} />
                                    <span className="text-xs font-bold text-slate-700 tracking-wide uppercase">
                                        {isGlobalQueued ? "Queued" : "Generating"}
                                    </span>
                                </div>
                            )}

                            {scene.image ? (
                                <img src={scene.image} alt="Scene" className="w-full h-full object-cover" />
                            ) : (
                                <div className="text-slate-300 flex flex-col items-center">
                                    <FaImage size={20} className="mb-1" />
                                    <span className="text-[10px]">No Image</span>
                                </div>
                            )}

                            {!isBusy && (
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
                            )}
                        </div>
                    </div>

                    <div className="w-full md:w-2/3 pl-0 md:pl-4 pt-4 md:pt-0 flex flex-col gap-2 relative">
                        {isEditingPrompt ? (
                            <div className="relative">
                                <Textarea
                                    value={localPrompt}
                                    onChange={(e) => setLocalPrompt(e.target.value)}
                                    className="text-xs resize-none bg-white h-24 focus-visible:ring-1 pr-10"
                                    placeholder="Enter image prompt here... Use [CH1], [CH2] etc. to link characters."
                                    autoFocus
                                />
                                <div className="absolute bottom-2 right-2 flex gap-1">
                                    <Button size="icon" className="h-6 w-6 bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSavePrompt}>
                                        <FaCheck size={10} />
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="relative h-24 bg-white border border-slate-200 rounded-md p-3 text-xs overflow-y-auto whitespace-pre-wrap">
                                {renderPromptWithLinks()}
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                            <Button size="sm" className={`h-7 text-xs text-white ${isImageGenDisabled ? 'bg-slate-400' : 'bg-purple-600 hover:bg-purple-700'}`} onClick={handleGenerateImage} disabled={isImageGenDisabled} title={isImageGenDisabled ? "Change prompt to regenerate" : "Generate Image"}>
                                {isBusy ? "..." : <><FaMagic className="mr-1" /> Gen Image</>}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs text-slate-600" onClick={handleGeneratePrompt} disabled={isPromptBusy}>
                                {isPromptBusy ? "..." : <><FaPen className="mr-1" /> Gen Prompt</>}
                            </Button>

                            {!isEditingPrompt && (
                                <Button size="sm" variant="outline" className="h-7 text-xs text-slate-600" onClick={() => setIsEditingPrompt(true)}>
                                    <FaEdit className="mr-1" /> Edit
                                </Button>
                            )}

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