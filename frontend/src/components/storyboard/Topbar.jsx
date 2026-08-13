import React from 'react';
import { useStoryBoard } from '../../context/StoryBoardContext';
import { Input } from '@/components/ui/input';
import TTSControls from './topbar/TTSControls';
import AutoCreateControls from './topbar/AutoCreateControls';
import SuperMenu from './topbar/SuperMenu';
import { FaCheckCircle } from 'react-icons/fa';

const TopBar = () => {
    const { state, dispatch } = useStoryBoard();

    return (
        <header className="studio-header">
            <div className="studio-header-main">
                <div className="studio-brand-group">
                    <div className="studio-project-name">
                        <p>Storyboard project</p>
                        <Input
                            value={state.title}
                            onChange={(e) => dispatch({ type: 'UPDATE_TITLE', payload: e.target.value })}
                            className="w-full border-0 bg-transparent px-0 text-base font-semibold shadow-none focus-visible:ring-0"
                            placeholder="Untitled"
                        />
                    </div>
                </div>
                <div className="studio-header-actions">
                    <AutoCreateControls />
                    <TTSControls />
                    <span className="studio-saved-status"><FaCheckCircle /> {state.isDirty ? 'Saving changes' : 'All changes saved'}</span>
                    <SuperMenu />
                </div>
            </div>
        </header>
    );
};

export default TopBar;
