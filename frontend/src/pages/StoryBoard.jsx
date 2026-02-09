import React, { useRef } from 'react';
import { StoryBoardProvider, useStoryBoard } from '../context/StoryBoardContext';
import TopBar from '../components/storyboard/TopBar'; // Import the new TopBar
import Scene from '../components/storyboard/Scene';
import Sentence from '../components/storyboard/Sentence';
import { Button } from '@/components/ui/button';
import { FaPlus } from 'react-icons/fa';
import toast from 'react-hot-toast';

// --- MAIN COMPONENT ---
const StoryBoardInner = () => {
    const { state, dispatch } = useStoryBoard();
    const lastSelectedIdRef = useRef(null);

    // --- SELECTION LOGIC ---
    const handleSelection = (id, index, isShift) => {
        if (isShift && lastSelectedIdRef.current) {
            const lastIndex = state.items.findIndex(i => i.id === lastSelectedIdRef.current);
            if (lastIndex !== -1 && index !== -1) {
                const start = Math.min(lastIndex, index);
                const end = Math.max(lastIndex, index);
                const idsToSelect = [];
                for (let i = start; i <= end; i++) {
                    idsToSelect.push(state.items[i].id);
                }
                dispatch({ type: 'ADD_SELECTION', payload: idsToSelect });
            }
        } else {
            dispatch({ type: 'TOGGLE_SELECTION', payload: id });
            lastSelectedIdRef.current = id;
        }
    };

    const handleGroup = () => {
        dispatch({ type: 'GROUP_SELECTED' });
        toast.success("Created Scene from selection");
        lastSelectedIdRef.current = null;
    };

    const handleCancelSelection = () => {
        dispatch({ type: 'CLEAR_SELECTION' });
        lastSelectedIdRef.current = null;
    };

    const handleDeleteSelection = () => {
        dispatch({ type: 'DELETE_SELECTED' });
        toast.success("Items deleted");
        lastSelectedIdRef.current = null;
    };

    return (
        <div className="min-h-screen bg-slate-100 pb-20">

            {/* Refactored TopBar */}
            <TopBar
                handleGroup={handleGroup}
                handleDeleteSelection={handleDeleteSelection}
                handleCancelSelection={handleCancelSelection}
            />

            {/* CANVAS */}
            <main className="max-w-4xl mx-auto mt-8 px-4 space-y-4">
                {state.items.length === 0 ? (
                    <div className="text-center py-10 text-slate-400 flex flex-col items-center gap-3">
                        <p className="text-sm">Start by adding items.</p>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={() => dispatch({ type: 'ADD_ITEM', payload: { type: 'scene' } })} className="bg-blue-600 hover:bg-blue-700 text-white">
                                <FaPlus className="mr-2" /> Add Scene
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => dispatch({ type: 'ADD_ITEM', payload: { type: 'sentence' } })}>
                                <FaPlus className="mr-2" /> Add Sentence
                            </Button>
                        </div>
                    </div>
                ) : (
                    state.items.map((item, index) => {
                        if (item.type === 'scene') {
                            return <Scene key={item.id} scene={item} index={index} />;
                        } else {
                            return (
                                <Sentence
                                    key={item.id}
                                    sentence={item}
                                    isNested={false}
                                    index={index}
                                    onSelectionChange={handleSelection}
                                />
                            );
                        }
                    })
                )}

                {/* BOTTOM ACTIONS */}
                {state.items.length > 0 && (
                    <div className="flex justify-center py-6 gap-4">
                        <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow border border-slate-200 hover:shadow-md transition-shadow">
                            <Button variant="ghost" size="sm" className="h-6 text-sm text-slate-500 hover:text-blue-600"
                                onClick={() => dispatch({ type: 'ADD_ITEM', payload: { type: 'scene' } })}>
                                <FaPlus className="mr-1" /> Scene
                            </Button>
                            <div className="h-4 w-[1px] bg-slate-200"></div>
                            <Button variant="ghost" size="sm" className="h-6 text-sm text-slate-500 hover:text-blue-600"
                                onClick={() => dispatch({ type: 'ADD_ITEM', payload: { type: 'sentence' } })}>
                                <FaPlus className="mr-1" /> Sentence
                            </Button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

const StoryBoard = () => (
    <StoryBoardProvider>
        <StoryBoardInner />
    </StoryBoardProvider>
);

export default StoryBoard;