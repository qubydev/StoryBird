import React, { useState, useEffect } from 'react';
import { useStoryBoard } from '../../context/StoryBoardContext';
import { hasOverlap } from '../../lib/storyboard-utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { FaCheck, FaTrash, FaPen } from 'react-icons/fa';
import toast from 'react-hot-toast';

const Sentence = ({ sentence, sceneId = null, isNested = false, index = -1, onSelectionChange }) => {
    const { state, dispatch } = useStoryBoard();
    const [isEditing, setIsEditing] = useState(false);

    const [localData, setLocalData] = useState({
        text: sentence.text || '',
        start: sentence.start || 0,
        end: sentence.end || 0
    });

    const isSelected = (state.selection || []).includes(sentence.id);
    const isEmpty = !sentence.text || sentence.text.trim() === '';

    useEffect(() => {
        setLocalData({ text: sentence.text || '', start: sentence.start || 0, end: sentence.end || 0 });
        if (isEmpty && !isEditing) setIsEditing(true);
    }, [sentence, isEmpty]);

    const handleSave = () => {
        const newStart = parseFloat(localData.start) || 0;
        const newEnd = parseFloat(localData.end) || 0;

        // 1. Validate proper order
        if (newStart >= newEnd) {
            return toast.error("Start time must be before end time");
        }

        // 2. Validate Overlap
        const conflict = hasOverlap(state.items, newStart, newEnd, sentence.id);
        if (conflict) {
            return toast.error(`Time overlaps with another sentence: "${conflict.text.substring(0, 15)}..." (${conflict.start}s - ${conflict.end}s)`);
        }

        const updates = {
            text: localData.text.trim(),
            start: newStart,
            end: newEnd
        };

        dispatch({ type: 'UPDATE_SENTENCE', payload: { id: sentence.id, updates } });
        setIsEditing(false);
    };

    const handleDelete = () => {
        if (isNested && sceneId) {
            dispatch({ type: 'DELETE_SENTENCE_FROM_SCENE', payload: { sceneId, sentenceId: sentence.id } });
        } else {
            dispatch({ type: 'DELETE_ITEM', payload: sentence.id });
        }
    };

    const handleCheckboxClick = (e) => {
        if (onSelectionChange && !isNested) {
            onSelectionChange(sentence.id, index, e.nativeEvent.shiftKey);
        }
    };

    const baseClasses = "flex items-start gap-3 p-3 transition-colors group relative";
    const topLevelClasses = "bg-white border border-slate-200 shadow-sm rounded my-2";
    const nestedClasses = "hover:bg-slate-50 border-b border-transparent hover:border-slate-100 last:border-0";
    const selectedClasses = "bg-blue-50 border-blue-200 shadow-none";

    return (
        <div className={`${baseClasses} ${!isNested ? topLevelClasses : nestedClasses} ${isSelected ? selectedClasses : ''}`}>
            {!isNested && !isEditing && (
                <div className="pt-1">
                    <span onClickCapture={handleCheckboxClick}>
                        <Checkbox checked={isSelected} onCheckedChange={() => { }} className="cursor-pointer" />
                    </span>
                </div>
            )}

            <div className="flex-grow w-full">
                {!isEditing ? (
                    <div className="flex items-start gap-2">
                        <div
                            onClick={() => setIsEditing(true)}
                            className="flex-1 cursor-pointer text-slate-700 p-1 rounded min-h-[24px] border border-transparent hover:border-slate-200"
                        >
                            <span className="leading-relaxed">{sentence.text || <span className="text-slate-400 italic">Empty sentence...</span>}</span>
                            <span className="ml-2 text-[10px] font-mono text-slate-400 bg-slate-100 px-1 rounded border border-slate-200">
                                {sentence.start}s - {sentence.end}s
                            </span>
                        </div>

                        <div className="flex opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-blue-500" onClick={() => setIsEditing(true)}>
                                <FaPen size={12} />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500" onClick={handleDelete}>
                                <FaTrash size={12} />
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3 bg-slate-50 p-3 rounded-md border border-slate-200 shadow-inner">
                        <Textarea
                            value={localData.text}
                            onChange={(e) => setLocalData({ ...localData, text: e.target.value })}
                            className="text-sm resize-none h-20"
                            placeholder="Enter sentence text..."
                            autoFocus
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm text-slate-600 font-medium">
                                <label>Start:</label>
                                <Input
                                    type="number" step="0.1" className="w-20 h-8 text-xs"
                                    value={localData.start}
                                    onChange={(e) => setLocalData({ ...localData, start: e.target.value })}
                                />
                                <label className="ml-2">End:</label>
                                <Input
                                    type="number" step="0.1" className="w-20 h-8 text-xs"
                                    value={localData.end}
                                    onChange={(e) => setLocalData({ ...localData, end: e.target.value })}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <Button size="sm" variant="ghost" className="h-8 text-xs text-red-500 hover:bg-red-50" onClick={handleDelete}>
                                    <FaTrash className="mr-1" /> Delete
                                </Button>
                                <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700" onClick={handleSave}>
                                    <FaCheck className="mr-1" /> Save
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Sentence;