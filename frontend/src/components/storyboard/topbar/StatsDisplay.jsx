import React, { useMemo } from 'react';
import { useStoryBoard } from '../../../context/StoryBoardContext';
import { Button } from '@/components/ui/button';
import { FaObjectGroup, FaTrash, FaTimes, FaLayerGroup, FaFont, FaClock } from 'react-icons/fa';
import { calculateStats, formatDuration } from '../../../lib/storyboard-utils';
import toast from 'react-hot-toast';

const StatsDisplay = () => {
    const { state, dispatch } = useStoryBoard();
    const stats = useMemo(() => calculateStats(state.items), [state.items]);

    const handleGroup = () => {
        dispatch({ type: 'GROUP_SELECTED' });
        toast.success("Created Scene");
    };

    const handleDeleteSelection = () => {
        dispatch({ type: 'DELETE_SELECTED' });
        toast.success("Items deleted");
    };

    const handleCancelSelection = () => {
        dispatch({ type: 'CLEAR_SELECTION' });
    };

    // Safely fallback to empty array
    const selection = state.selection || [];

    if (selection.length > 0) {
        return (
            <div className="flex flex-wrap items-center gap-2 animate-in slide-in-from-top-2 fade-in duration-200">
                <Button size="sm" onClick={handleGroup} className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
                    <FaObjectGroup className="mr-2" /> Group ({selection.length})
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
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 font-medium animate-in slide-in-from-top-2 fade-in duration-200">
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded border border-slate-200">
                <FaLayerGroup className="text-slate-400" />
                <span>{stats.sceneCount} Scenes</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded border border-slate-200">
                <FaFont className="text-slate-400" />
                <span>{stats.wordCount} Words</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded border border-slate-200 text-blue-700 font-mono">
                <FaClock className="text-blue-400" />
                <span>{formatDuration(stats.duration)}</span>
            </div>
        </div>
    );
};

export default StatsDisplay;