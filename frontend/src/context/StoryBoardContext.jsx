import React, { createContext, useContext, useReducer, useEffect, useState } from 'react';
import { getInitialData, generateId, loadFromStorage, saveToStorage, duplicateSceneData, getMaxEndTime } from '../lib/storyboard-utils';
import toast from 'react-hot-toast';

const StoryBoardContext = createContext();

const cleanPayloadItems = (payloadItems) => {
    if (!payloadItems || !Array.isArray(payloadItems)) return [];
    return payloadItems.map(item => {
        if (item.type === 'scene') {
            const { imageGenStatus, promptGenStatus, ...rest } = item;
            return rest;
        }
        return item;
    });
};

const reducer = (state, action) => {
    const currentSelection = state.selection || [];

    switch (action.type) {
        case 'INIT_STATE':
            return {
                ...getInitialData(),
                ...action.payload,
                items: cleanPayloadItems(action.payload?.items),
                characters: action.payload?.characters || [],
                isDirty: false,
                selection: action.payload?.selection || []
            };

        case 'SET_STATE':
            return {
                ...getInitialData(),
                ...action.payload,
                items: cleanPayloadItems(action.payload?.items),
                characters: action.payload?.characters || [],
                isDirty: true,
                selection: []
            };

        case 'CLEAR_BOARD':
            return { ...getInitialData(), characters: [], isDirty: true };

        // --- CHARACTER ACTIONS ---
        case 'SET_CHARACTERS':
            return { ...state, characters: action.payload, isDirty: true };

        case 'ADD_CHARACTER': {
            const rawId = String(generateId());
            const shortId = rawId.length > 6 ? rawId.substring(rawId.length - 6) : rawId;

            const newChar = {
                id: `char_${shortId}`,
                description: '',
                image: null,
                mediaId: null
            };

            return {
                ...state,
                characters: [...(state.characters || []), newChar],
                isDirty: true
            };
        }

        case 'UPDATE_CHARACTER':
            return {
                ...state,
                characters: (state.characters || []).map(c =>
                    c.id === action.payload.id ? { ...c, ...action.payload.updates } : c
                ),
                isDirty: true
            };

        case 'DELETE_CHARACTER':
            return {
                ...state,
                characters: (state.characters || []).filter(c => c.id !== action.payload),
                isDirty: true
            };
        // -------------------------

        case 'CLEAN_ALL_IMAGES':
            return {
                ...state,
                items: state.items.map(item =>
                    item.type === 'scene' ? { ...item, image: null, imageGenStatus: null } : item
                ),
                isDirty: true
            };

        case 'CLEAN_ALL_PROMPTS':
            return {
                ...state,
                items: state.items.map(item =>
                    item.type === 'scene' ? { ...item, prompt: "", promptGenStatus: null } : item
                ),
                isDirty: true
            };

        case 'UPDATE_TITLE':
            return { ...state, title: action.payload, isDirty: true };

        case 'TOGGLE_SELECTION': {
            const id = action.payload;
            const isSelected = currentSelection.includes(id);

            return {
                ...state,
                selection: isSelected
                    ? currentSelection.filter(sid => sid !== id)
                    : [...currentSelection, id]
            };
        }

        case 'SET_SELECTION': {
            return { ...state, selection: action.payload || [] };
        }

        case 'ADD_SELECTION': {
            const newIds = (action.payload || []).filter(id => !currentSelection.includes(id));
            return { ...state, selection: [...currentSelection, ...newIds] };
        }

        case 'CLEAR_SELECTION':
            return { ...state, selection: [] };

        case 'DELETE_SELECTED': {
            if (currentSelection.length === 0) return state;
            return {
                ...state,
                items: state.items.filter(i => !currentSelection.includes(i.id)),
                selection: [],
                isDirty: true
            };
        }

        case 'GROUP_SELECTED': {
            const selectedIndices = [];
            state.items.forEach((item, index) => {
                if (currentSelection.includes(item.id)) selectedIndices.push(index);
            });

            if (selectedIndices.length === 0) return state;

            for (let i = 1; i < selectedIndices.length; i++) {
                if (selectedIndices[i] !== selectedIndices[i - 1] + 1) return state;
            }

            const selectedItems = selectedIndices.map(idx => state.items[idx]);
            if (selectedItems.some(i => i.type !== 'sentence')) return state;

            const newScene = {
                type: 'scene',
                id: generateId(),
                image: null,
                prompt: "",
                sentences: selectedItems.map(s => ({ ...s }))
            };

            const newItems = [...state.items];
            newItems.splice(selectedIndices[0], selectedIndices.length, newScene);

            return { ...state, items: newItems, selection: [], isDirty: true };
        }

        case 'MERGE_SELECTED': {
            const selectedIndices = [];
            state.items.forEach((item, index) => {
                if (currentSelection.includes(item.id)) selectedIndices.push(index);
            });

            if (selectedIndices.length <= 1) return state;

            for (let i = 1; i < selectedIndices.length; i++) {
                if (selectedIndices[i] !== selectedIndices[i - 1] + 1) return state;
            }

            const selectedItems = selectedIndices.map(idx => state.items[idx]);
            if (selectedItems.some(i => i.type !== 'sentence')) return state;

            const mergedText = selectedItems.map(i => i.text).filter(Boolean).join(' ');
            const mergedStart = Math.min(...selectedItems.map(i => i.start));
            const mergedEnd = Math.max(...selectedItems.map(i => i.end));

            const mergedSentence = {
                type: 'sentence',
                id: generateId(),
                text: mergedText,
                start: mergedStart,
                end: mergedEnd
            };

            const newItems = [...state.items];
            newItems.splice(selectedIndices[0], selectedIndices.length, mergedSentence);

            return { ...state, items: newItems, selection: [], isDirty: true };
        }

        case 'APPLY_AUTO_GROUPING': {
            const groups = action.payload;
            const allSentences = [];

            state.items.forEach(item => {
                if (item.type === 'sentence') allSentences.push(item);
                else if (item.type === 'scene') allSentences.push(...item.sentences);
            });

            if (allSentences.length === 0) return state;

            const newItems = groups.map(groupIndices => {
                const groupSentences = groupIndices.map(idx => allSentences[idx]).filter(Boolean);
                if (groupSentences.length === 0) return null;

                return {
                    type: 'scene',
                    id: generateId(),
                    image: null,
                    prompt: "",
                    sentences: groupSentences.map(s => ({ ...s }))
                };
            }).filter(Boolean);

            return { ...state, items: newItems, selection: [], isDirty: true };
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

        case 'ADD_ITEM': {
            const maxEnd = getMaxEndTime(state.items);
            const startStr = parseFloat((maxEnd > 0 ? maxEnd + 0.1 : 0).toFixed(2));
            const endStr = parseFloat((startStr + 1.0).toFixed(2));

            const newItem = action.payload.type === 'scene'
                ? { type: 'scene', id: generateId(), sentences: [], image: null, prompt: "" }
                : { type: 'sentence', id: generateId(), text: "", start: startStr, end: endStr };

            return { ...state, items: [...state.items, newItem], isDirty: true };
        }

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

        case 'ADD_SENTENCE': {
            const maxEnd = getMaxEndTime(state.items);
            const startStr = parseFloat((maxEnd > 0 ? maxEnd + 0.1 : 0).toFixed(2));
            const endStr = parseFloat((startStr + 1.0).toFixed(2));

            return {
                ...state,
                items: state.items.map(item => {
                    if (item.id === action.payload && item.type === 'scene') {
                        return {
                            ...item,
                            sentences: [...item.sentences, { id: generateId(), text: "", start: startStr, end: endStr }]
                        };
                    }
                    return item;
                }),
                isDirty: true
            };
        }

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

        case 'UPDATE_SENTENCE': {
            const updateItem = (item) => {
                if (item.type === 'sentence' && item.id === action.payload.id) {
                    return { ...item, ...action.payload.updates };
                }
                if (item.type === 'scene') {
                    return {
                        ...item,
                        sentences: item.sentences.map(s =>
                            s.id === action.payload.id ? { ...s, ...action.payload.updates } : s
                        )
                    };
                }
                return item;
            };

            return { ...state, items: state.items.map(updateItem), isDirty: true };
        }

        case 'IMPORT_TRANSCRIPT': {
            const newItems = action.payload.map(s => ({
                type: 'sentence',
                id: generateId(),
                text: s.text,
                start: s.start,
                end: s.end
            }));

            return { ...state, items: newItems, selection: [], isDirty: true };
        }

        case 'MARK_SAVED':
            return { ...state, lastSaved: new Date().toISOString(), isDirty: false };

        default:
            return state;
    }
};

export const StoryBoardProvider = ({ children }) => {
    const [state, dispatch] = useReducer(reducer, getInitialData());
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        const hydrate = async () => {
            const savedData = await loadFromStorage();
            if (savedData) {
                dispatch({ type: 'INIT_STATE', payload: savedData });
            }
            setIsLoaded(true);
        };
        hydrate();
    }, []);

    useEffect(() => {
        if (!state.isDirty) return;

        const handler = setTimeout(async () => {
            await saveToStorage(state);
            dispatch({ type: 'MARK_SAVED' });
        }, 500);

        return () => clearTimeout(handler);
    }, [state]);

    if (!isLoaded) {
        return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading Storyboard...</div>;
    }

    return (
        <StoryBoardContext.Provider value={{ state, dispatch }}>
            {children}
        </StoryBoardContext.Provider>
    );
};

export const useStoryBoard = () => useContext(StoryBoardContext);