import React, { useState } from 'react';
import { useStoryBoard } from '../../context/StoryBoardContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogFooter } from '@/components/ui/dialog';
import { FaUserPlus, FaTrash, FaUpload, FaUserCircle, FaEdit, FaSpinner } from 'react-icons/fa';
import { fileToBase64, getStorageItem, refreshSessionKey } from '../../lib/storyboard-utils';
import toast from 'react-hot-toast';

const CharacterCard = ({ character, index, dispatch }) => {
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isUploadingEdit, setIsUploadingEdit] = useState(false);
    const [isUploadingDirect, setIsUploadingDirect] = useState(false);

    const [editState, setEditState] = useState({
        name: '',
        description: '',
        image: null,
        mediaId: null
    });

    const handleOpenEdit = () => {
        setEditState({
            name: character.name || '',
            description: character.description || '',
            image: character.image || null,
            mediaId: character.mediaId || null
        });
        setIsEditOpen(true);
    };

    const handleCancel = () => {
        setIsEditOpen(false);
    };

    const handleSave = () => {
        dispatch({
            type: 'UPDATE_CHARACTER',
            payload: { id: character.id, updates: { ...editState } }
        });
        setIsEditOpen(false);
        toast.success("Character updated");
    };

    const performUpload = async (file) => {
        const sessionData = getStorageItem('sb_global_session_key');
        if (!sessionData || !sessionData.text) {
            throw new Error("Session Key is missing. Please add it in Global Settings.");
        }

        const base64 = await fileToBase64(file);
        const backendUrl = import.meta.env.VITE_BACKEND_URL;

        const res = await fetch(`${backendUrl}/api/upload-character-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rawBytes: base64,
                session_token: sessionData.text
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            if (err.refresh) refreshSessionKey();
            throw new Error(err.error || err.message || "Upload failed");
        }

        const data = await res.json();
        if (!data.uploadMediaGenerationId) {
            throw new Error("Missing uploadMediaGenerationId in response");
        }

        return { base64, mediaId: data.uploadMediaGenerationId };
    };

    const handleDirectUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsUploadingDirect(true);
        const toastId = toast.loading("Uploading character image...");

        try {
            const result = await performUpload(file);
            if (result) {
                dispatch({
                    type: 'UPDATE_CHARACTER',
                    payload: {
                        id: character.id,
                        updates: { image: result.base64, mediaId: result.mediaId }
                    }
                });
                toast.success("Image uploaded successfully!", { id: toastId });
            }
        } catch (err) {
            console.error(err);
            toast.error(err.message || "Error uploading image", { id: toastId });
        } finally {
            setIsUploadingDirect(false);
            e.target.value = null;
        }
    };

    const handleEditDialogUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsUploadingEdit(true);
        const toastId = toast.loading("Uploading character image...");

        try {
            const result = await performUpload(file);
            if (result) {
                setEditState(prev => ({
                    ...prev,
                    image: result.base64,
                    mediaId: result.mediaId
                }));
                toast.success("Image uploaded successfully!", { id: toastId });
            }
        } catch (err) {
            console.error(err);
            toast.error(err.message || "Error uploading image", { id: toastId });
        } finally {
            setIsUploadingEdit(false);
            e.target.value = null;
        }
    };

    return (
        <>
            <div className="flex bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow h-32">
                <div className="w-32 h-full bg-slate-100 relative flex items-center justify-center border-r border-slate-100 overflow-hidden group flex-shrink-0">
                    <div className="absolute top-1.5 left-1.5 bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full z-20 shadow-sm pointer-events-none">
                        {index + 1}
                    </div>

                    {character.image ? (
                        <img src={character.image} alt="Character" className="w-full h-full object-cover" />
                    ) : (
                        <FaUserCircle className="text-slate-300 text-5xl" />
                    )}

                    <div className={`absolute inset-0 bg-black/40 transition-opacity flex flex-col items-center justify-center text-white backdrop-blur-[1px] z-10 ${isUploadingDirect ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        {isUploadingDirect ? (
                            <FaSpinner className="animate-spin text-3xl drop-shadow-md" />
                        ) : (
                            <label className="cursor-pointer bg-white/90 p-3 rounded-full hover:bg-white text-slate-700 shadow-sm transition-transform hover:scale-110" title="Upload Image directly">
                                <FaUpload size={16} />
                                <input type="file" hidden onChange={handleDirectUpload} accept="image/*" />
                            </label>
                        )}
                    </div>
                </div>

                <div className="p-3 flex flex-col flex-1 min-w-0 justify-between bg-white">
                    <div className="space-y-1">
                        <div className="flex justify-between items-start gap-2">
                            <h4 className="font-bold text-sm text-slate-800 truncate" title={character.name || 'Unnamed Character'}>
                                {character.name || 'Unnamed Character'}
                            </h4>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-2" title={character.description || 'No description'}>
                            {character.description || 'No description'}
                        </p>
                    </div>

                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-50">
                        <div className="truncate pr-2">
                            {character.mediaId ? (
                                <span className="text-[10px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded-full border border-emerald-100 font-mono" title={`Media ID: ${character.mediaId}`}>
                                    MID: {character.mediaId.substring(0, 8)}...
                                </span>
                            ) : (
                                <span className="text-[10px] text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-100 italic">
                                    No Media ID
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                                onClick={handleOpenEdit}
                                disabled={isUploadingDirect}
                                className="p-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Edit Character"
                            >
                                <FaEdit size={14} />
                            </button>
                            <button
                                onClick={() => dispatch({ type: 'DELETE_CHARACTER', payload: character.id })}
                                disabled={isUploadingDirect}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Delete Character"
                            >
                                <FaTrash size={14} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="sm:max-w-[450px]">
                    <DialogHeader>
                        <DialogTitle>Edit Character #{index + 1}</DialogTitle>
                    </DialogHeader>

                    <div className="py-4 flex flex-col gap-5">
                        <div className="flex flex-col items-center gap-3">
                            <div className="relative w-48 h-48 rounded-xl overflow-hidden border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center group transition-colors">
                                {editState.image ? (
                                    <img src={editState.image} className="w-full h-full object-cover" />
                                ) : (
                                    <FaUserCircle className="text-slate-300 text-6xl" />
                                )}

                                <label className={`absolute inset-0 bg-black/40 transition-opacity flex flex-col items-center justify-center text-white cursor-pointer backdrop-blur-[1px] ${isUploadingEdit ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                    {isUploadingEdit ? (
                                        <FaSpinner className="animate-spin text-3xl" />
                                    ) : (
                                        <>
                                            <FaUpload size={24} className="mb-2" />
                                            <span className="text-sm font-medium">Upload</span>
                                            <input type="file" hidden onChange={handleEditDialogUpload} accept="image/*" disabled={isUploadingEdit} />
                                        </>
                                    )}
                                </label>
                            </div>
                            {editState.mediaId && (
                                <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full border border-emerald-100 font-mono">
                                    ID: {editState.mediaId.substring(0, 10)}...
                                </span>
                            )}
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 mb-1 block">Character Name</label>
                                <Input
                                    value={editState.name}
                                    onChange={e => setEditState(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="e.g. Victor Lustig"
                                    className="focus-visible:ring-1 bg-slate-50"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 mb-1 block">Role Description</label>
                                <Textarea
                                    value={editState.description}
                                    onChange={e => setEditState(prev => ({ ...prev, description: e.target.value }))}
                                    placeholder="e.g. Main character, the con artist"
                                    className="focus-visible:ring-1 bg-slate-50 resize-none h-24"
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="flex gap-2 sm:justify-end">
                        <Button variant="outline" onClick={handleCancel} disabled={isUploadingEdit}>Cancel</Button>
                        <Button onClick={handleSave} disabled={isUploadingEdit} className="bg-primary hover:bg-primary/90 text-primary-foreground">Save Changes</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

const CharactersSection = () => {
    const { state, dispatch } = useStoryBoard();
    const characters = state.characters || [];

    const handleAdd = () => dispatch({ type: 'ADD_CHARACTER' });

    return (
        <div className="mb-6 space-y-4 animate-in slide-in-from-top-4 fade-in duration-300">
            <div className="flex items-center justify-between px-1 border-b border-slate-200 pb-2">
                <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2">
                    Characters
                    <span className="bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">{characters.length}</span>
                </h3>
                <Button variant="ghost" size="sm" onClick={handleAdd} className="h-7 text-xs text-primary hover:bg-primary/10 border border-primary/20">
                    <FaUserPlus className="mr-2" /> Add Character
                </Button>
            </div>

            {characters.length === 0 ? (
                <div className="text-center py-8 rounded-xl text-muted-foreground text-sm">
                    Use "Detect Characters" or add them manually.
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {characters.map((char, index) => (
                        <CharacterCard
                            key={char.id}
                            index={index}
                            character={char}
                            dispatch={dispatch}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default CharactersSection;