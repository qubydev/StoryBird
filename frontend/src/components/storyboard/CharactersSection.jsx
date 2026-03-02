import React, { useState } from 'react';
import { useStoryBoard } from '../../context/StoryBoardContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogFooter } from '@/components/ui/dialog';
import { FaUserPlus, FaTrash, FaUpload, FaUserCircle, FaEdit, FaSpinner } from 'react-icons/fa';
import { fileToBase64, getStorageItem } from '../../lib/storyboard-utils';
import toast from 'react-hot-toast';

const CharacterCard = ({ character, dispatch }) => {
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [editState, setEditState] = useState({ description: '', image: null, mediaId: null });

    const handleOpenEdit = () => {
        setEditState({
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

    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const sessionData = getStorageItem('sb_global_session_key');
        if (!sessionData || !sessionData.text) {
            return toast.error("Session Key is missing. Please add it in Global Settings.");
        }

        setIsUploading(true);
        const toastId = toast.loading("Uploading character image...");

        try {
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
                throw new Error(err.error || err.message || "Upload failed");
            }

            const data = await res.json();

            if (!data.uploadMediaGenerationId) {
                throw new Error("Missing uploadMediaGenerationId in response");
            }

            setEditState(prev => ({
                ...prev,
                image: base64,
                mediaId: data.uploadMediaGenerationId
            }));

            toast.success("Image uploaded successfully!", { id: toastId });
        } catch (err) {
            console.error(err);
            toast.error(err.message || "Error uploading image", { id: toastId });
        } finally {
            setIsUploading(false);
            e.target.value = null; // reset input
        }
    };

    return (
        <>
            <div className="flex flex-col bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow">

                <div className="aspect-square bg-slate-100 relative flex items-center justify-center border-b border-slate-100 overflow-hidden">
                    {character.image ? (
                        <img src={character.image} alt="Character" className="w-full h-full object-cover" />
                    ) : (
                        <FaUserCircle className="text-slate-300 text-6xl" />
                    )}
                </div>

                {/* Bottom Bar: Replaced Name with Description */}
                <div className="p-3 flex items-center justify-between gap-2 bg-white">
                    <span className="font-medium text-xs text-slate-600 truncate flex-1">
                        {character.description || 'No description'}
                    </span>

                    <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                            onClick={handleOpenEdit}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="Edit Character"
                        >
                            <FaEdit size={14} />
                        </button>
                        <button
                            onClick={() => dispatch({ type: 'DELETE_CHARACTER', payload: character.id })}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                            title="Delete Character"
                        >
                            <FaTrash size={14} />
                        </button>
                    </div>
                </div>
            </div>

            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>Edit Character</DialogTitle>
                    </DialogHeader>

                    <div className="py-4 flex flex-col gap-5">
                        <div className="flex flex-col items-center gap-3">
                            <div className="relative w-32 h-32 rounded-xl overflow-hidden border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center group transition-colors">
                                {editState.image ? (
                                    <img src={editState.image} className="w-full h-full object-cover" />
                                ) : (
                                    <FaUserCircle className="text-slate-300 text-5xl" />
                                )}

                                <label className={`absolute inset-0 bg-black/40 transition-opacity flex flex-col items-center justify-center text-white cursor-pointer backdrop-blur-[1px] ${isUploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                    {isUploading ? (
                                        <FaSpinner className="animate-spin text-2xl" />
                                    ) : (
                                        <>
                                            <FaUpload size={18} className="mb-1" />
                                            <span className="text-xs font-medium">Upload</span>
                                            <input type="file" hidden onChange={handleImageUpload} accept="image/*" disabled={isUploading} />
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

                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-bold text-slate-500 mb-1 block">Role Description</label>
                                <Input
                                    value={editState.description}
                                    onChange={e => setEditState(prev => ({ ...prev, description: e.target.value }))}
                                    placeholder="e.g. Main character, the con artist"
                                    className="focus-visible:ring-1 bg-slate-50"
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="flex gap-2 sm:justify-end">
                        <Button variant="outline" onClick={handleCancel} disabled={isUploading}>Cancel</Button>
                        <Button onClick={handleSave} disabled={isUploading} className="bg-blue-600 hover:bg-blue-700 text-white">Save Changes</Button>
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

    if (characters.length === 0 && state.items.length === 0) return null;

    return (
        <div className="mb-6 space-y-4 animate-in slide-in-from-top-4 fade-in duration-300">
            <div className="flex items-center justify-between px-1 border-b border-slate-200 pb-2">
                <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2">
                    Cast & Characters
                    <span className="bg-slate-200 text-slate-600 text-[10px] px-1.5 py-0.5 rounded-full">{characters.length}</span>
                </h3>
                <Button variant="ghost" size="sm" onClick={handleAdd} className="h-7 text-xs text-blue-600 hover:bg-blue-50 border border-blue-100">
                    <FaUserPlus className="mr-2" /> Add Character
                </Button>
            </div>

            {characters.length === 0 ? (
                <div className="text-center py-8 bg-white rounded-xl border border-dashed border-slate-300 text-slate-400 text-sm">
                    No characters added yet. Use "Detect Characters" or add them manually.
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {characters.map(char => (
                        <CharacterCard
                            key={char.id}
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