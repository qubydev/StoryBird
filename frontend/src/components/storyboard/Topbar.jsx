import React from 'react';
import { useStoryBoard } from '../../context/StoryBoardContext';
import { Input } from '@/components/ui/input';
import FileMenu from './topbar/FileMenu';
import StatsDisplay from './topbar/StatsDisplay';
import GeneratorControls from './topbar/GeneratorControls';
import { GlobalSettings } from './topbar/GlobalSettings';

const TopBar = () => {
    const { state, dispatch } = useStoryBoard();

    return (
        <header className="sticky top-0 z-50 w-full bg-white border-b border-slate-200 shadow-sm">
            <div className="flex flex-col gap-3 px-6 py-3">

                {/* ROW 1: Title & File Menu */}
                <div className="flex flex-wrap items-center justify-between gap-y-3">
                    <div className="flex items-center gap-4">
                        <img src="/logo.svg" alt="Logo" className="h-9 w-9" />
                        <Input
                            value={state.title}
                            onChange={(e) => dispatch({ type: 'UPDATE_TITLE', payload: e.target.value })}
                            className="font-bold text-lg border-transparent focus:border-slate-300 hover:border-slate-200 w-full sm:w-80 px-2 h-10"
                            placeholder="Untitled Storyboard"
                        />
                    </div>
                    <FileMenu />
                </div>

                {/* ROW 2: Stats/Selection & Generators/Settings */}
                <div className="flex flex-wrap items-center justify-between gap-y-3 pt-1">
                    <StatsDisplay />

                    <div className="flex flex-wrap items-center gap-2">
                        <GeneratorControls />
                        <div className="hidden sm:block h-5 w-[1px] bg-slate-200 mx-1"></div>
                        <GlobalSettings />
                    </div>
                </div>
            </div>
        </header>
    );
};

export default TopBar;