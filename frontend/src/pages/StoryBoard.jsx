import React, { useRef, useState } from 'react';
import { StoryBoardProvider, useStoryBoard } from '../context/StoryBoardContext';
import TopBar from '../components/storyboard/TopBar';
import Scene from '../components/storyboard/Scene';
import Sentence from '../components/storyboard/Sentence';
import CharactersSection from '../components/storyboard/CharactersSection';
import StudioSidebar from '../components/storyboard/StudioSidebar';
import { Button } from '@/components/ui/button';
import { FaPlus, FaThLarge, FaList, FaMagic, FaFileImport, FaArrowRight } from 'react-icons/fa';
import { useParams } from 'react-router-dom';

const StoryBoardInner = () => {
    const { state, dispatch } = useStoryBoard();
    const lastSelectedIdRef = useRef(null);
    const [viewMode, setViewMode] = useState('list');

    const scenes = state.items.filter(item => item.type === 'scene');

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

    return (
        <div className="studio-app min-h-screen relative">
            <StudioSidebar />
            <div className="studio-main-shell">
                <TopBar />
                <main id="storyboard" className={`${viewMode === 'gallery' ? 'max-w-[1540px]' : 'max-w-6xl'} mx-auto px-6 py-8 space-y-5 transition-[max-width] duration-200`}>

                <div id="characters"><CharactersSection /></div>

                <div className="studio-board-heading">
                    <div>
                        <p className="studio-eyebrow">Creative workspace</p>
                        <h1>Storyboard</h1>
                    </div>
                    <div className="studio-view-switcher" aria-label="Storyboard view">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={`h-8 px-3 text-xs ${viewMode === 'list' ? 'studio-view-active' : 'text-slate-500'}`}
                            onClick={() => setViewMode('list')}
                            title="Vertical editor view"
                        >
                            <FaList className="mr-1.5" /> Editor
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={`h-8 px-3 text-xs ${viewMode === 'gallery' ? 'studio-view-active' : 'text-slate-500'}`}
                            onClick={() => setViewMode('gallery')}
                            title="Gallery view"
                        >
                            <FaThLarge className="mr-1.5" /> Gallery
                        </Button>
                    </div>
                </div>

                {state.items.length === 0 ? (
                    <section className="studio-empty-state">
                        <div className="studio-empty-orb"><FaMagic /></div>
                        <p className="studio-eyebrow">Your canvas is ready</p>
                        <h2>Turn your idea into a visual story.</h2>
                        <p className="studio-empty-copy">Build your storyboard scene by scene, or bring in an existing script and let the studio do the first pass.</p>
                        <div className="flex flex-wrap justify-center gap-3">
                            <Button
                                size="lg"
                                onClick={() => dispatch({ type: 'ADD_ITEM', payload: { type: 'scene' } })}
                                className="studio-primary-action"
                            >
                                <FaPlus className="mr-2" /> Create first scene
                            </Button>
                            <Button
                                size="lg"
                                variant="outline"
                                onClick={() => dispatch({ type: 'ADD_ITEM', payload: { type: 'sentence' } })}
                                className="studio-secondary-action"
                            >
                                <FaArrowRight className="mr-2" /> Start with a sentence
                            </Button>
                        </div>
                        <div className="studio-empty-tip"><FaFileImport /> Import an SRT transcript from the project menu to start with your script.</div>
                    </section>
                ) : viewMode === 'gallery' ? (
                    scenes.length ? (
                        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {scenes.map((scene, sceneIndex) => <Scene key={scene.id} scene={scene} index={sceneIndex} gallery />)}
                        </div>
                    ) : (
                        <p className="py-8 text-center text-sm text-muted-foreground">Group sentences into scenes to see them in the gallery.</p>
                    )
                ) : (
                    state.items.map((item, index) => {
                        if (item.type === 'scene') {
                            return <div id={`scene-${item.id}`} key={item.id}><Scene scene={item} index={index} /></div>;
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

                {state.items.length > 0 && (
                    <div className="flex justify-center py-8">
                        <div className="studio-add-bar">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-sm text-slate-500 hover:text-blue-600"
                                onClick={() => dispatch({ type: 'ADD_ITEM', payload: { type: 'scene' } })}
                            >
                                <FaPlus className="mr-1" /> Scene
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-sm text-slate-500 hover:text-blue-600"
                                onClick={() => dispatch({ type: 'ADD_ITEM', payload: { type: 'sentence' } })}
                            >
                                <FaPlus className="mr-1" /> Sentence
                            </Button>
                        </div>
                    </div>
                )}
                </main>
            </div>
        </div>
    );
};

const StoryBoard = () => {
    const { projectId } = useParams();
    return (
    <StoryBoardProvider projectId={projectId}>
        <StoryBoardInner />
    </StoryBoardProvider>
    );
};

export default StoryBoard;
