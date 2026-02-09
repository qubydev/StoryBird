import React, { useState, useEffect } from 'react';
import { useStoryBoard } from '../../context/StoryBoardContext';
import { generateId } from '../../lib/storyboard-utils';
import WordDialog from './WordDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FaPlus, FaCheck, FaTrash } from 'react-icons/fa';

const Sentence = ({ sentence, sceneId = null, isNested = false, index = -1, onSelectionChange }) => {
    const { state, dispatch } = useStoryBoard();
    const [isEditing, setIsEditing] = useState(false);

    const isSelected = state.selection.includes(sentence.id);
    const isEmpty = sentence.words.length === 0;

    useEffect(() => {
        if (isEmpty) setIsEditing(true);
    }, [isEmpty]);

    const getNextTimeSlot = () => {
        let maxEnd = 0;
        const traverse = (items) => {
            items.forEach(i => {
                if (i.type === 'sentence') i.words.forEach(w => maxEnd = Math.max(maxEnd, w.end));
                if (i.type === 'scene') traverse(i.sentences.map(s => ({ ...s, type: 'sentence' })));
            });
        };
        traverse(state.items);

        if (sentence.words.length > 0) {
            return {
                start: parseFloat((sentence.words[sentence.words.length - 1].end + 0.1).toFixed(2)),
                end: parseFloat((sentence.words[sentence.words.length - 1].end + 1.1).toFixed(2))
            };
        }
        return { start: parseFloat((maxEnd + 0.2).toFixed(2)), end: parseFloat((maxEnd + 1.2).toFixed(2)) };
    };

    const handleCreateWord = (data) => {
        const newWord = { ...data, id: generateId() };
        dispatch({ type: 'ADD_WORD', payload: { sentenceId: sentence.id, word: newWord } });
    };

    const handleEditWord = (id, data) => {
        dispatch({ type: 'UPDATE_WORD', payload: { id, updates: data } });
    };

    const handleDeleteWord = (id) => {
        dispatch({ type: 'DELETE_WORD', payload: id });
    };

    const handleDeleteSentence = () => {
        if (isNested && sceneId) {
            dispatch({ type: 'DELETE_SENTENCE_FROM_SCENE', payload: { sceneId, sentenceId: sentence.id } });
        } else {
            dispatch({ type: 'DELETE_ITEM', payload: sentence.id });
        }
    };

    // Custom Handler to capture Shift Key
    const handleCheckboxClick = (e) => {
        // Prevent default checkbox behavior from firing twice if needed, 
        // but here we just intercept the click to get modifier keys
        if (onSelectionChange && !isNested) {
            onSelectionChange(sentence.id, index, e.nativeEvent.shiftKey);
        }
    };

    const handleDialogChange = (isOpen) => {
        if (!isOpen && sentence.words.length === 0) handleDeleteSentence();
    };

    const baseClasses = "flex items-start gap-3 p-2 transition-colors group relative";
    const topLevelClasses = "bg-white border border-slate-200 shadow-sm rounded my-2";
    const nestedClasses = "hover:bg-slate-50 border-b border-transparent hover:border-slate-100 last:border-0";
    const selectedClasses = "bg-blue-50 border-blue-200 shadow-none";

    return (
        <div className={`
        ${baseClasses}
        ${!isNested ? topLevelClasses : nestedClasses}
        ${isSelected ? selectedClasses : ''}
    `}>

            {!isNested && !isEditing && (
                <div className="pt-3">
                    {/* We wrap the Checkbox in a span to capture the Click event with modifiers */}
                    <span onClickCapture={handleCheckboxClick}>
                        <Checkbox
                            checked={isSelected}
                            // We disable the default onCheckedChange to rely on our custom click handler for Shift support
                            onCheckedChange={() => { }}
                            className="cursor-pointer"
                        />
                    </span>
                </div>
            )}

            <div className="flex-grow">
                {!isEditing ? (
                    <div className="flex items-center gap-2">
                        <p
                            onClick={() => setIsEditing(true)}
                            className="flex-1 cursor-pointer text-slate-700 p-2 rounded leading-relaxed min-h-[40px] border border-transparent hover:border-slate-200"
                        >
                            {sentence.words.map(w => w.text).join(' ')}
                        </p>

                        <Button
                            variant="ghost" size="icon"
                            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500"
                            onClick={handleDeleteSentence}
                        >
                            <FaTrash size={14} />
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-3 rounded-md border border-slate-200 shadow-inner">
                        {sentence.words.map(word => (
                            <WordDialog
                                key={word.id}
                                mode="edit"
                                wordData={word}
                                onSave={(data) => handleEditWord(word.id, data)}
                                onDelete={() => handleDeleteWord(word.id)}
                            >
                                <button className="px-2 py-1 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors border border-slate-200 bg-white">
                                    {word.text}
                                </button>
                            </WordDialog>
                        ))}

                        <WordDialog
                            mode="create"
                            wordData={{ text: '', ...getNextTimeSlot() }}
                            onSave={handleCreateWord}
                            forceOpen={isEmpty}
                            onOpenChange={isEmpty ? handleDialogChange : undefined}
                        >
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200">
                                <FaPlus size={10} />
                            </Button>
                        </WordDialog>

                        <div className="ml-auto flex items-center gap-1">
                            <Button
                                size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                                onClick={handleDeleteSentence}
                            >
                                <FaTrash size={12} />
                            </Button>
                            <Button
                                size="sm" variant="outline" className="h-7 text-xs bg-white"
                                onClick={() => setIsEditing(false)}
                            >
                                <FaCheck className="mr-1" /> Done
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Sentence;