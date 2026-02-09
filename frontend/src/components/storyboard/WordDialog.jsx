import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { hasOverlap } from '../../lib/storyboard-utils';
import { useStoryBoard } from '../../context/StoryBoardContext';
import { FaExclamationCircle } from 'react-icons/fa';

const WordDialog = ({
    children,
    mode = 'edit',
    wordData,
    onSave,
    onDelete,
    forceOpen = false,
    onOpenChange
}) => {
    const { state } = useStoryBoard();
    const [open, setOpen] = useState(forceOpen);
    const [formData, setFormData] = useState({ text: '', start: 0, end: 0 });
    const [error, setError] = useState(null);

    useEffect(() => {
        setOpen(forceOpen);
    }, [forceOpen]);

    useEffect(() => {
        if (open && wordData) {
            setFormData(wordData);
        }
        if (onOpenChange) onOpenChange(open);
    }, [open, wordData]);

    // Real-time Validation
    useEffect(() => {
        if (!open) return;

        const text = formData.text ? formData.text.toString().trim() : '';
        const start = parseFloat(formData.start);
        const end = parseFloat(formData.end);

        // 1. Basic Format Validation
        if (text.length === 0) {
            setError("Text cannot be empty");
            return;
        }
        if (/\s/.test(text)) {
            setError("Single words only (no spaces)");
            return;
        }
        if (isNaN(start) || isNaN(end)) {
            setError("Invalid timestamps");
            return;
        }
        if (start >= end) {
            setError("Start time must be before End time");
            return;
        }

        // 2. Overlap Validation
        const ignoreId = mode === 'edit' ? wordData.id : null;
        const conflict = hasOverlap(state.items, start, end, ignoreId);

        if (conflict) {
            // Smart Error Messaging
            const conflictStart = parseFloat(conflict.start).toFixed(2);
            const conflictEnd = parseFloat(conflict.end).toFixed(2);

            let position = "existing";
            if (conflict.start < start) position = "previous"; // Conflict starts before us
            if (conflict.start > start) position = "next";     // Conflict starts after us

            setError(`Overlaps with ${position} word "${conflict.text}" (${conflictStart}s - ${conflictEnd}s)`);
            return;
        }

        // Valid
        setError(null);
    }, [formData, open, state.items, mode, wordData]);

    const handleSave = () => {
        if (error) return;

        onSave({
            ...formData,
            text: formData.text.trim(),
            start: parseFloat(formData.start),
            end: parseFloat(formData.end)
        });
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {children}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>{mode === 'create' ? 'Add New Word' : 'Edit Word'}</DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="text" className="text-right">Text</Label>
                        <Input
                            id="text"
                            value={formData.text}
                            onChange={(e) => setFormData({ ...formData, text: e.target.value })}
                            className="col-span-3"
                            placeholder="Word"
                            autoFocus
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="start" className="text-right">Start (s)</Label>
                        <Input
                            id="start"
                            type="number" step="0.1"
                            value={formData.start}
                            onChange={(e) => setFormData({ ...formData, start: e.target.value })}
                            className="col-span-3"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="end" className="text-right">End (s)</Label>
                        <Input
                            id="end"
                            type="number" step="0.1"
                            value={formData.end}
                            onChange={(e) => setFormData({ ...formData, end: e.target.value })}
                            className="col-span-3"
                        />
                    </div>
                </div>

                {/* Error Display */}
                {error && (
                    <div className="flex items-start gap-2 text-red-500 text-xs px-4 mb-2 justify-end font-medium text-right">
                        <FaExclamationCircle className="mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                <DialogFooter className="flex justify-between sm:justify-between">
                    {mode === 'edit' && onDelete ? (
                        <Button variant="destructive" onClick={onDelete}>Delete Word</Button>
                    ) : <div></div>}

                    <Button onClick={handleSave} disabled={!!error}>
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default WordDialog;