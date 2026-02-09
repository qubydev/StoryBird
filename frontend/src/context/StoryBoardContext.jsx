import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { getInitialData, generateId, loadFromStorage, saveToStorage, duplicateSceneData } from '../lib/storyboard-utils';
import toast from 'react-hot-toast';

const StoryBoardContext = createContext();

const reducer = (state, action) => {
    switch (action.type) {
        case 'SET_STATE':
            return { ...action.payload, isDirty: true, selection: [] };

        case 'CLEAR_BOARD':
            return { ...getInitialData(), isDirty: true };

        case 'UPDATE_TITLE':
            return { ...state, title: action.payload, isDirty: true };

        case 'TOGGLE_SELECTION': {
            const id = action.payload;
            const isSelected = state.selection.includes(id);
            return {
                ...state,
                selection: isSelected
                    ? state.selection.filter(sid => sid !== id)
                    : [...state.selection, id]
            };
        }

        case 'SET_SELECTION': {
            return { ...state, selection: action.payload };
        }

        case 'ADD_SELECTION': {
            const newIds = action.payload.filter(id => !state.selection.includes(id));
            return { ...state, selection: [...state.selection, ...newIds] };
        }

        case 'CLEAR_SELECTION':
            return { ...state, selection: [] };

        case 'DELETE_SELECTED': {
            if (state.selection.length === 0) return state;
            return {
                ...state,
                items: state.items.filter(i => !state.selection.includes(i.id)),
                selection: [],
                isDirty: true
            };
        }

        // --- GROUPING & AUTO-GEN ---
        case 'GROUP_SELECTED': {
            const selectedItems = state.items.filter(i => state.selection.includes(i.id));

            if (selectedItems.some(i => i.type !== 'sentence')) {
                toast.error("Can only group Sentences");
                return state;
            }
            if (selectedItems.length === 0) return state;

            const newScene = {
                type: 'scene',
                id: generateId(),
                image: null,
                prompt: "",
                sentences: selectedItems.map(s => ({ ...s, words: s.words }))
            };

            let inserted = false;
            const finalItems = state.items.reduce((acc, item) => {
                if (state.selection.includes(item.id)) {
                    if (!inserted) {
                        acc.push(newScene);
                        inserted = true;
                    }
                } else {
                    acc.push(item);
                }
                return acc;
            }, []);

            return { ...state, items: finalItems, selection: [], isDirty: true };
        }

        case 'APPLY_AUTO_GROUPING': {
            // payload: [[0, 1, 2], [3, 4], ...] (List of indices)
            const groups = action.payload;

            // 1. Flatten all current items to a single list of sentences
            const allSentences = [];
            state.items.forEach(item => {
                if (item.type === 'sentence') allSentences.push(item);
                else if (item.type === 'scene') allSentences.push(...item.sentences);
            });

            if (allSentences.length === 0) return state;

            // 2. Reconstruct Items based on groups
            const newItems = groups.map(groupIndices => {
                // Get sentences for this group
                const groupSentences = groupIndices.map(idx => allSentences[idx]).filter(Boolean);

                if (groupSentences.length === 0) return null;

                // Create a new Scene for this group
                return {
                    type: 'scene',
                    id: generateId(),
                    image: null,
                    prompt: "",
                    // Ensure deep copy of sentence structure
                    sentences: groupSentences.map(s => ({
                        id: s.id,
                        words: s.words
                    }))
                };
            }).filter(Boolean);

            return {
                ...state,
                items: newItems,
                selection: [],
                isDirty: true
            };
        }

        case 'UNGROUP_SCENE': {
            const sceneId = action.payload;
            const sceneIndex = state.items.findIndex(i => i.id === sceneId);
            if (sceneIndex === -1) return state;

            const scene = state.items[sceneIndex];
            const releasedSentences = scene.sentences.map(s => ({ ...s, type: 'sentence' }));

            const newItems = [...state.items];
            newItems.splice(sceneIndex, 1, ...releasedSentences);

            return { ...state, items: newItems, isDirty: true };
        }

        // --- CRUD ---
        case 'ADD_ITEM':
            const newItem = action.payload.type === 'scene'
                ? { type: 'scene', id: generateId(), sentences: [], image: null, prompt: "" }
                : { type: 'sentence', id: generateId(), words: [] };

            return {
                ...state,
                items: [...state.items, newItem],
                isDirty: true
            };

        case 'DELETE_ITEM':
            return {
                ...state,
                items: state.items.filter(i => i.id !== action.payload),
                isDirty: true
            };

        case 'DUPLICATE_SCENE': {
            const index = state.items.findIndex(i => i.id === action.payload);
            const copy = duplicateSceneData(state.items[index]);
            const newItems = [...state.items];
            newItems.splice(index + 1, 0, copy);
            return { ...state, items: newItems, isDirty: true };
        }

        case 'UPDATE_SCENE_META':
            return {
                ...state,
                items: state.items.map(i =>
                    i.id === action.payload.id ? { ...i, [action.payload.field]: action.payload.value } : i
                ),
                isDirty: true
            };

        case 'ADD_SENTENCE':
            return {
                ...state,
                items: state.items.map(item => {
                    if (item.id === action.payload && item.type === 'scene') {
                        return {
                            ...item,
                            sentences: [...item.sentences, { id: generateId(), words: [] }]
                        };
                    }
                    return item;
                }),
                isDirty: true
            };

        case 'DELETE_SENTENCE_FROM_SCENE':
            return {
                ...state,
                items: state.items.map(item => {
                    if (item.id === action.payload.sceneId && item.type === 'scene') {
                        return {
                            ...item,
                            sentences: item.sentences.filter(s => s.id !== action.payload.sentenceId)
                        };
                    }
                    return item;
                }),
                isDirty: true
            };

        case 'ADD_WORD':
        case 'UPDATE_WORD':
        case 'DELETE_WORD': {
            const mapSentence = (sent) => {
                if (sent.id !== action.payload.sentenceId && action.type === 'ADD_WORD') return sent;

                let newWords = sent.words;
                if (action.type === 'ADD_WORD') {
                    newWords = [...sent.words, action.payload.word];
                } else if (action.type === 'DELETE_WORD') {
                    newWords = sent.words.filter(w => w.id !== action.payload);
                } else if (action.type === 'UPDATE_WORD') {
                    newWords = sent.words.map(w => w.id === action.payload.id ? { ...w, ...action.payload.updates } : w);
                }
                return { ...sent, words: newWords };
            };

            const mapItem = (item) => {
                if (item.type === 'sentence') {
                    if (action.type === 'ADD_WORD' && item.id === action.payload.sentenceId) return mapSentence(item);
                    if (action.type !== 'ADD_WORD') return mapSentence(item);
                    return item;
                }
                if (item.type === 'scene') {
                    const updatedSentences = item.sentences.map(mapSentence);
                    if (action.type === 'DELETE_WORD') {
                        return { ...item, sentences: updatedSentences.filter(s => s.words.length > 0) };
                    }
                    return { ...item, sentences: updatedSentences };
                }
                return item;
            };

            let newItems = state.items.map(mapItem);
            if (action.type === 'DELETE_WORD') {
                newItems = newItems.filter(item => {
                    if (item.type === 'sentence' && item.words.length === 0) return false;
                    return true;
                });
            }

            return { ...state, items: newItems, isDirty: true };
        }

        case 'MARK_SAVED':
            return { ...state, lastSaved: new Date().toISOString(), isDirty: false };

        default:
            return state;
    }
};

export const StoryBoardProvider = ({ children }) => {
    const [state, dispatch] = useReducer(reducer, null, loadFromStorage);

    useEffect(() => {
        if (!state.isDirty) return;
        const handler = setTimeout(() => {
            saveToStorage(state);
            dispatch({ type: 'MARK_SAVED' });
        }, 300);
        return () => clearTimeout(handler);
    }, [state]);

    return (
        <StoryBoardContext.Provider value={{ state, dispatch }}>
            {children}
        </StoryBoardContext.Provider>
    );
};

export const useStoryBoard = () => useContext(StoryBoardContext);