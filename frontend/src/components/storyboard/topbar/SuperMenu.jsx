import React, { useState, useRef, useEffect } from 'react';
import { useStoryBoard } from '../../../context/StoryBoardContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { FaEllipsisV, FaImage, FaAlignLeft } from 'react-icons/fa';
import toast from 'react-hot-toast';

const SuperMenu = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [showImageConfirm, setShowImageConfirm] = useState(false);
    const [showPromptConfirm, setShowPromptConfirm] = useState(false);

    const { dispatch } = useStoryBoard();
    const menuRef = useRef(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const confirmCleanImages = () => {
        dispatch({ type: 'CLEAN_ALL_IMAGES' });
        toast.success("All images cleared");
        setShowImageConfirm(false);
    };

    const confirmCleanPrompts = () => {
        dispatch({ type: 'CLEAN_ALL_PROMPTS' });
        toast.success("All prompts cleared");
        setShowPromptConfirm(false);
    };

    return (
        <div className="relative" ref={menuRef}>
            <Button
                variant="ghost"
                size="icon"
                className={`h-9 w-9 text-slate-500 hover:text-slate-700 transition-colors ${isOpen ? 'bg-slate-100 text-slate-900' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                title="Super Powers"
            >
                <FaEllipsisV />
            </Button>

            {/* Custom Dropdown Menu */}
            {isOpen && (
                <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-slate-200 z-50 py-1 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 mb-1">
                        Super Powers
                    </div>

                    <button
                        onClick={() => { setIsOpen(false); setShowImageConfirm(true); }}
                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center transition-colors"
                    >
                        <FaImage className="mr-2 opacity-70" /> Clean All Images
                    </button>

                    <button
                        onClick={() => { setIsOpen(false); setShowPromptConfirm(true); }}
                        className="w-full text-left px-4 py-2 text-sm text-amber-600 hover:bg-amber-50 flex items-center transition-colors"
                    >
                        <FaAlignLeft className="mr-2 opacity-70" /> Clean All Prompts
                    </button>
                </div>
            )}

            {/* Image Deletion Confirmation Dialog */}
            <Dialog open={showImageConfirm} onOpenChange={setShowImageConfirm}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Clear All Images?</DialogTitle>
                        <DialogDescription>
                            This will permanently delete all generated and uploaded images from every scene. This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowImageConfirm(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={confirmCleanImages}>Yes, Clear Images</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Prompt Deletion Confirmation Dialog */}
            <Dialog open={showPromptConfirm} onOpenChange={setShowPromptConfirm}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Clear All Prompts?</DialogTitle>
                        <DialogDescription>
                            This will erase the image generation prompts from every scene. Your text script and images will remain intact.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowPromptConfirm(false)}>Cancel</Button>
                        <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={confirmCleanPrompts}>Yes, Clear Prompts</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default SuperMenu;