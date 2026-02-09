import React, { useState, useEffect } from 'react';
import { useStoryBoard } from '../../context/StoryBoardContext';
import { hasOverlap } from '../../lib/storyboard-utils';
import { FaTrash } from 'react-icons/fa';
import toast from 'react-hot-toast';

const Word = ({ word, sceneId }) => {
    const { state, dispatch } = useStoryBoard();

    // Local state for smooth typing of floats
    const [localData, setLocalData] = useState(word);

    useEffect(() => setLocalData(word), [word]);

    const commitChange = (field, value) => {
        const numValue = parseFloat(value);

        if (field === 'start' || field === 'end') {
            if (isNaN(numValue)) return; // Reject invalid

            const newStart = field === 'start' ? numValue : localData.start;
            const newEnd = field === 'end' ? numValue : localData.end;

            // VALIDATION
            if (newStart >= newEnd) {
                toast.error("Start time must be less than End time");
                setLocalData(word); // Revert
                return;
            }

            if (hasOverlap(state.scenes, newStart, newEnd, word.id)) {
                toast.error("Time overlap detected with another word!");
                setLocalData(word); // Revert
                return;
            }

            dispatch({ type: 'UPDATE_WORD', payload: { id: word.id, updates: { [field]: numValue } } });
        } else {
            // Text update
            dispatch({ type: 'UPDATE_WORD', payload: { id: word.id, updates: { text: value } } });
        }
    };

    return (
        <div className="group relative inline-flex flex-col bg-slate-50 border border-slate-200 rounded-md p-2 mx-1 transition-all hover:shadow-md hover:border-blue-300">
            <button
                onClick={() => dispatch({ type: 'DELETE_WORD', payload: word.id })}
                className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
                <FaTrash size={8} />
            </button>

            {/* Word Text */}
            <input
                className="bg-transparent text-center font-semibold text-slate-800 outline-none w-20 text-sm mb-1 focus:text-blue-600"
                value={localData.text}
                onChange={(e) => setLocalData({ ...localData, text: e.target.value })}
                onBlur={(e) => commitChange('text', e.target.value)}
            />

            {/* Timestamps */}
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
                <input
                    type="number" step="0.1"
                    className="w-10 bg-white border rounded px-1 text-center outline-none focus:border-blue-400"
                    value={localData.start}
                    onChange={(e) => setLocalData({ ...localData, start: e.target.value })}
                    onBlur={(e) => commitChange('start', e.target.value)}
                />
                <span>-</span>
                <input
                    type="number" step="0.1"
                    className="w-10 bg-white border rounded px-1 text-center outline-none focus:border-blue-400"
                    value={localData.end}
                    onChange={(e) => setLocalData({ ...localData, end: e.target.value })}
                    onBlur={(e) => commitChange('end', e.target.value)}
                />
            </div>
        </div>
    );
};

export default Word;