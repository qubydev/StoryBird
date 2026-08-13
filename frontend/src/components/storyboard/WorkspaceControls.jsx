import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FaSlidersH, FaTimes, FaFolderOpen, FaMagic, FaCloud } from 'react-icons/fa';
import FileMenu from './topbar/FileMenu';
import GeneratorControls from './topbar/GeneratorControls';
import { GlobalSettings } from './topbar/GlobalSettings';
import SuperMenu from './topbar/SuperMenu';

const WorkspaceControls = () => {
    const [open, setOpen] = useState(true);

    if (!open) {
        return (
            <Button
                size="icon"
                onClick={() => setOpen(true)}
                className="fixed right-0 top-1/2 z-40 h-12 w-10 -translate-y-1/2 rounded-l-xl rounded-r-none bg-slate-900 shadow-xl hover:bg-slate-800"
                title="Open workspace controls"
            >
                <FaSlidersH />
            </Button>
        );
    }

    return (
        <aside
            className="workspace-dock fixed inset-y-0 right-0 z-40 w-[min(350px,calc(100vw-2rem))] overflow-hidden border-l border-slate-200 bg-white shadow-2xl"
        >
            <div className="flex items-center justify-between bg-slate-900 px-4 py-4 text-white">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">
                    Studio tools
                </div>
                <Button size="icon" variant="ghost" onClick={() => setOpen(false)} className="h-7 w-7 text-slate-300 hover:bg-white/10 hover:text-white" title="Minimize controls"><FaTimes /></Button>
            </div>
            <div className="flex h-[calc(100vh-56px)] flex-col gap-5 overflow-y-auto p-4">
                <section>
                    <p className="dock-label"><FaFolderOpen /> Project</p>
                    <div className="dock-project mt-2">
                    <FileMenu />
                    </div>
                </section>
                <section>
                    <p className="dock-label"><FaCloud /> AI &amp; Flow</p>
                    <div className="dock-settings mt-2">
                    <GlobalSettings />
                    </div>
                </section>
                <section>
                    <p className="dock-label"><FaMagic /> Generate</p>
                    <div className="dock-generate mt-2">
                    <GeneratorControls />
                    </div>
                </section>
                <div className="flex justify-end border-t border-slate-100 pt-3">
                    <SuperMenu />
                </div>
            </div>
        </aside>
    );
};

export default WorkspaceControls;
