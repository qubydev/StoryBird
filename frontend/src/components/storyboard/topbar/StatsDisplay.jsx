import React, { useMemo } from 'react';
import { useStoryBoard } from '../../../context/StoryBoardContext';
import { Button } from '@/components/ui/button';
import { FaObjectGroup, FaTrash, FaTimes, FaLayerGroup, FaFont, FaClock, FaCompressAlt, FaAlignLeft } from 'react-icons/fa';
import { calculateStats, formatDuration, isSelectionConsecutive } from '../../../lib/storyboard-utils';
import toast from 'react-hot-toast';

const StatsDisplay = () => {
    const { state, dispatch } = useStoryBoard();
    const stats = useMemo(() => calculateStats(state.items), [state.items]);
    const selection = state.selection || [];

    const handleGroup = () => {
        const selectedItems = state.items.filter(i => selection.includes(i.id));

        if (selectedItems.some(i => i.type !== 'sentence')) {
            return toast.error("Can only group standalone sentences.");
        }

        if (!isSelectionConsecutive(state.items, selection)) {
            return toast.error("Please select consecutive sentences to group.");
        }

        dispatch({ type: 'GROUP_SELECTED' });
        toast.success("Created Scene");
    };

    const handleMerge = () => {
        const selectedItems = state.items.filter(i => selection.includes(i.id));

        if (selectedItems.some(i => i.type !== 'sentence')) {
            return toast.error("Can only merge standalone sentences.");
        }

        if (selectedItems.length < 2) {
            return toast.error("Select at least 2 sentences to merge.");
        }

        if (!isSelectionConsecutive(state.items, selection)) {
            return toast.error("Please select consecutive sentences to merge.");
        }

        dispatch({ type: 'MERGE_SELECTED' });
        toast.success("Sentences merged");
    };

    const handleDeleteSelection = () => {
        dispatch({ type: 'DELETE_SELECTED' });
        toast.success("Items deleted");
    };

    const handleCancelSelection = () => {
        dispatch({ type: 'CLEAR_SELECTION' });
    };

    if (selection.length > 0) {
        return (
            <div className="flex flex-wrap items-center gap-2 animate-in slide-in-from-top-2 fade-in duration-200">
                <Button size="sm" onClick={handleGroup} className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
                    <FaObjectGroup className="mr-2" /> Group ({selection.length})
                </Button>

                <Button size="sm" onClick={handleMerge} className="h-8 text-xs bg-purple-600 hover:bg-purple-700 text-white shadow-sm">
                    <FaCompressAlt className="mr-2" /> Merge ({selection.length})
                </Button>

                <Button size="sm" variant="outline" onClick={handleDeleteSelection} className="h-8 text-xs text-red-600 hover:bg-red-50 border-red-200">
                    <FaTrash className="mr-2" /> Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={handleCancelSelection} className="h-8 text-xs text-slate-500">
                    <FaTimes className="mr-2" /> Cancel
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 font-medium animate-in slide-in-from-top-2 fade-in duration-200">
            <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded border border-slate-200">
                <FaLayerGroup className="text-slate-400 text-xs" />
                <span>{stats.sceneCount} Scenes</span>
            </div>

            <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded border border-slate-200">
                <FaAlignLeft className="text-slate-400 text-xs" />
                <span>{stats.sentenceCount} Sentences</span>
            </div>

            <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded border border-slate-200">
                <FaFont className="text-slate-400 text-xs" />
                <span>{stats.wordCount} Words</span>
            </div>

            <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded border border-slate-200 text-blue-700 font-mono">
                <FaClock className="text-blue-400 text-xs" />
                <span>{formatDuration(stats.duration)}</span>
            </div>
        </div>
    );
};

export default StatsDisplay;