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
import { useSettings } from '@/context/SettingsContext';
import { MdCancel } from 'react-icons/md';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

const Scene = ({ scene, index }) => {
    const { state, dispatch } = useStoryBoard();
    const { sessionKey, setSessionKey, instructions } = useSettings();

    const [isGeneratingImg, setIsGeneratingImg] = useState(false);
    const [isGeneratingTxt, setIsGeneratingTxt] = useState(false);
    const [isEditingPrompt, setIsEditingPrompt] = useState(false);

    const [localPrompt, setLocalPrompt] = useState(scene.prompt || "");
    const [linkDialog, setLinkDialog] = useState(null);

    const { start, end } = getSceneDuration(scene.sentences);

    const isGlobalGenerating = scene.imageGenStatus === 'generating';
    const isBusy = isGeneratingImg || isGlobalGenerating;
    const isPromptBusy = isGeneratingTxt || scene.promptGenStatus === 'generating';

    // When user is editing the prompt,
    // we better not let it be overwritten by external changes
    useEffect(() => {
        if (!isEditingPrompt) {
            setLocalPrompt(scene.prompt);
        }
    }, [scene.prompt, isEditingPrompt]);

    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const base64String = await fileToBase64(file);
                dispatch({
                    type: 'UPDATE_SCENE_META_V2',
                    payload: { id: scene.id, updates: { image: base64String } }
                });
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
        dispatch({ type: 'UPDATE_SCENE_META_V2', payload: { id: scene.id, updates: { image: null } } });
    };

    const handleCleanPrompt = () => {
        if (isEditingPrompt) {
            return toast.error("Can not clean prompt while editing.");
        }
        dispatch({ type: 'UPDATE_SCENE_META_V2', payload: { id: scene.id, updates: { prompt: "", subjectMediaIds: [], characterMap: {} } } });
        toast.success("Prompt cleaned");
    };

    const handleSavePrompt = () => {
        const newCharacterMap = {};
        let localPromptCopy = localPrompt;

        // [CHd+]
        const matches = localPromptCopy.match(/\[CH\d+\]/g) || [];
        matches.forEach(tag => {
            const chNum = parseInt(tag.replace(/\D/g, ''), 10);
            if (state.characters && state.characters[chNum - 1]) {
                newCharacterMap[tag] = state.characters[chNum - 1].id;
            } else {
                localPromptCopy = localPromptCopy.split(tag).join('[CHX]');
            }
        });

        // [CHX]
        const xMatches = localPromptCopy.match(/\[CHX\]/g) || [];
        xMatches.forEach(tag => {
            newCharacterMap[tag] = null;
        });

        dispatch({
            type: 'UPDATE_SCENE_META_V2',
            payload: { id: scene.id, updates: { prompt: localPromptCopy, characterMap: newCharacterMap } }
        });
        setLocalPrompt(localPromptCopy);
        setIsEditingPrompt(false);
    };

    const handleCancelPrompt = () => {
        setLocalPrompt(scene.prompt);
        setIsEditingPrompt(false);
    }

    const handleGenerateImage = async () => {
        if (!scene.prompt.trim()) return toast.error("Enter a prompt first");

        // Verify charactersMap
        if (scene.characterMap) {
            for (const [tag, charId] of Object.entries(scene.characterMap)) {
                if (charId === null) {
                    return toast.error(`Prompt contains unlinked character ${tag}.`);
                }

                // Make sure charId is valid
                const idx = state.characters.findIndex(c => c.id === charId);
                const character = state.characters[idx];

                if (!character) {
                    return toast.error(`Prompt contains invalid character link ${tag}.`);
                }

                if (!character.name?.trim()) {
                    return toast.error(`Please set a name to character ${idx + 1}`)
                }
                if (!character.description?.trim()) {
                    return toast.error(`Please set a description to character ${idx + 1}`)
                }
                if (!character.mediaId) {
                    return toast.error(`Linked character ${idx + 1} is missing an media upload ID.`);
                }
            }
        }

        if (!sessionKey) {
            return toast.error("Session Key is missing. Please add it first.");
        }
        setIsGeneratingImg(true);
        const toastId = toast.loading("Generating image...");

        try {
            let endpoint = `${BACKEND_URL}/api/generate-image`;
            let payload = {
                prompt: scene.prompt,
                session_token: sessionKey,
            };


            if (scene.characterMap && Object.keys(scene.characterMap).length > 0) {
                endpoint = `${BACKEND_URL}/api/generate-image-chars`;
                payload.characters = Object.entries(scene.characterMap).map(([tag, charId]) => {
                    const character = state.characters.find(c => c.id === charId);
                    return {
                        name: character.name,
                        description: character.description,
                        mediaId: character.mediaId
                    };
                });
            }

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                if (err.refresh) {
                    setSessionKey("");
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
                dispatch({
                    type: 'UPDATE_SCENE_META_V2',
                    payload: {
                        id: scene.id,
                        updates: {
                            image: returnedImage
                        }
                    }
                });
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
        const sceneText = scene.sentences.map(s => s.text).join(' ').trim();
        if (!sceneText) return toast.error("Scene has no text");

        if (!state.title.trim() || state.title.trim() === 'Untitled') {
            return toast.error("Please provide a title for your storyboard to get the best results.");
        }

        // Validate characters
        state.characters.forEach((ch, idx) => {
            if (!ch.name.trim()) {
                return toast.error(`Please set a name for character "${idx + 1}"`);
            }
            if (!ch.description.trim()) {
                return toast.error(`Please set a description for character ${idx + 1}`);
            }
        });

        const sceneIndex = state.items.findIndex(i => i.id === scene.id);
        const previousScenes = state.items.slice(0, sceneIndex).filter(i => i.type === 'scene');
        const last10Scenes = previousScenes.slice(-10);
        const lastScene = sceneIndex > 0 ? state.items[sceneIndex - 1] : null;

        if (lastScene && !lastScene.prompt.trim()) {
            return toast.error("Previous scene's prompt must be generated first.");
        }

        const previousScenesPayload = last10Scenes.map(s => ({
            scene_lines: (s.sentences.map(sent => sent.text).join(' ').trim()) || "",
            prompt: s.prompt.trim() || "No prompt provided"
        }))

        const charactersPayload = state.characters.map(c => ({
            name: c.name,
            description: c.description
        }));

        setIsGeneratingTxt(true);
        const toastId = toast.loading("Generating prompt...");

        try {
            const res = await fetch(`${BACKEND_URL}/api/generate-image-prompt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: state.title,
                    scene_lines: sceneText,
                    instructions: instructions.trim() || null,
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
                const newCharacterMap = {};
                let promptCopy = data.prompt;

                // [CHd+]
                const matches = promptCopy.match(/\[CH\d+\]/g) || [];
                matches.forEach(tag => {
                    const chNum = parseInt(tag.replace(/\D/g, ''), 10);
                    if (state.characters && state.characters[chNum - 1]) {
                        newCharacterMap[tag] = state.characters[chNum - 1].id;
                    } else {
                        promptCopy = promptCopy.split(tag).join('[CHX]');
                    }
                });

                // [CHX]
                const xMatches = promptCopy.match(/\[CHX\]/g) || [];
                xMatches.forEach(tag => {
                    newCharacterMap[tag] = null;
                });

                dispatch({
                    type: 'UPDATE_SCENE_META_V2',
                    payload: { id: scene.id, updates: { prompt: promptCopy, characterMap: newCharacterMap } }
                });
            } else {
                throw new Error("No prompt returned");
            }

            toast.success("Prompt generated", { id: toastId });

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
        toast.success("Scene lines copied");
    };

    const handleUngroup = () => {
        dispatch({ type: 'UNGROUP_SCENE', payload: scene.id });
    };

    const handleUpdateLink = (tag, charId) => {
        let newtag = '';
        if (charId === null) {
            newtag = '[CHX]';
        } else {
            const idx = state.characters?.findIndex(c => c.id === charId);
            if (idx == -1) {
                return toast.error("Character not found");
            }
            const newTag = `[CH${idx + 1}]`;
            newtag = newTag;
        }

        let promptCopy = scene.prompt || "";
        const newCharacterMap = {};

        const match = promptCopy.match(new RegExp(`\\${tag}(?!\\d)`, 'g'));
        if (!match) {
            return toast.error("Tag not found in prompt");
        }

        promptCopy = promptCopy.replace(new RegExp(`\\${tag}(?!\\d)`), newtag);

        // [CHd+]
        const matches = promptCopy.match(/\[CH\d+\]/g) || [];
        matches.forEach(t => {
            const chNum = parseInt(t.replace(/\D/g, ''), 10);
            if (state.characters && state.characters[chNum - 1]) {
                newCharacterMap[t] = state.characters[chNum - 1].id;
            } else {
                promptCopy = promptCopy.split(t).join('[CHX]');
            }
        });

        // [CHX]
        const xMatches = promptCopy.match(/\[CHX\]/g) || [];
        xMatches.forEach(t => {
            newCharacterMap[t] = null;
        });

        dispatch({
            type: 'UPDATE_SCENE_META_V2',
            payload: { id: scene.id, updates: { prompt: promptCopy, characterMap: newCharacterMap } }
        });
        setLocalPrompt(promptCopy);
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
                                        Generating
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
                            <Textarea
                                value={localPrompt}
                                onChange={(e) => setLocalPrompt(e.target.value)}
                                className="text-xs resize-none bg-white h-24 focus-visible:ring-1 pr-10"
                                placeholder="Enter image prompt here... Use [CH1], [CH2] etc. to link characters."
                                autoFocus
                            />
                        ) : (
                            <div className="relative h-24 bg-white border border-slate-200 rounded-md p-3 text-xs overflow-y-auto whitespace-pre-wrap">
                                {renderPromptWithLinks()}
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                            <Button size="sm" className={`h-7 text-xs text-white ${isBusy ? 'bg-slate-400' : 'bg-purple-600 hover:bg-purple-700'}`} onClick={handleGenerateImage} disabled={isBusy} title={isBusy ? "Change prompt to regenerate" : "Generate Image"}>
                                {isBusy ? "..." : <><FaMagic className="mr-1" /> Gen Image</>}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs text-slate-600" onClick={handleGeneratePrompt} disabled={isPromptBusy}>
                                {isPromptBusy ? "..." : <><FaPen className="mr-1" /> Gen Prompt</>}
                            </Button>

                            {isEditingPrompt ? (
                                <>
                                    <Button size="sm" variant="outline" className="h-7 text-xs text-slate-600" onClick={handleSavePrompt}>
                                        <FaCheck className="mr-1" /> Save
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-7 text-xs text-slate-600" onClick={handleCancelPrompt}>
                                        <MdCancel className="mr-1" /> Cancel
                                    </Button>
                                </>
                            ) : (
                                <Button size="sm" variant="outline" className="h-7 text-xs text-slate-600" onClick={() => setIsEditingPrompt(true)}>
                                    <FaEdit className="mr-1" /> Edit
                                </Button>
                            )}

                            <Button size="sm" variant="outline" className="ml-auto h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 border-red-100" onClick={handleCleanPrompt} title="Clear Prompt & Image">
                                <FaEraser className="mr-1" /> Clean
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-white">
                    <div className='flex items-center justify-end'>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400" onClick={handleCopyScript}>
                            <FaCopy />
                        </Button>
                    </div>
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