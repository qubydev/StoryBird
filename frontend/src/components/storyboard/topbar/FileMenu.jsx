import React from 'react';
import { useStoryBoard } from '../../../context/StoryBoardContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { FaDownload, FaUpload, FaEraser, FaSpinner } from 'react-icons/fa';
import { parseTranscriptToState } from '../../../lib/storyboard-utils';
import toast from 'react-hot-toast';

const FileMenu = () => {
    const { state, dispatch } = useStoryBoard();

    const handleExport = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
        const node = document.createElement('a');
        node.setAttribute("href", dataStr);
        node.setAttribute("download", `${state.title.replace(/\s+/g, '_') || 'storyboard'}.json`);
        document.body.appendChild(node);
        node.click();
        node.remove();
        toast.success("Project exported");
    };

    const handleProjectImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target.result);
                if (json.items && Array.isArray(json.items)) {
                    dispatch({ type: 'SET_STATE', payload: json });
                    toast.success("Storyboard loaded");
                } else {
                    throw new Error("File is not a Storyboard project");
                }
            } catch (err) {
                toast.error(err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = null; 
    };

    const handleTranscriptImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target.result);
                if (Array.isArray(json) && json.length > 0 && (json[0].type === 'segment' || json[0].words)) {
                    const convertedState = parseTranscriptToState(json);
                    dispatch({ type: 'SET_STATE', payload: convertedState });
                    toast.success("Transcript imported");
                } else {
                    throw new Error("File is not a JSON Transcript");
                }
            } catch (err) {
                toast.error(err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = null; 
    };

    const handleClearConfirm = () => { 
        dispatch({ type: 'CLEAR_BOARD' });
        toast.success("Cleared");
    };

    return (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className={`text-xs mr-2 font-medium flex items-center gap-1.5 ${state.isDirty ? 'text-amber-600' : 'text-green-600'}`}>
                {state.isDirty ? <><FaSpinner className="animate-spin" /> Saving...</> : "Saved"}
            </span>
            
            <Button variant="ghost" size="sm" onClick={handleExport} className="h-9 text-sm px-2 sm:px-3">
                <FaDownload className="mr-2" /> Export
            </Button>

            <Button variant="ghost" size="sm" asChild className="h-9 text-sm px-2 sm:px-3">
                <label className="cursor-pointer">
                    <FaUpload className="mr-2" /> Import
                    <input type="file" hidden onChange={handleProjectImport} accept=".json" />
                </label>
            </Button>

            <Button variant="ghost" size="sm" asChild className="h-9 text-sm px-2 sm:px-3 text-slate-600 hover:text-purple-600 hover:bg-purple-50">
                <label className="cursor-pointer" title="Import JSON Transcript">
                    {/* Changed Icon to FaUpload as requested */}
                    <FaUpload className="mr-2" /> Transcript
                    <input type="file" hidden onChange={handleTranscriptImport} accept=".json" />
                </label>
            </Button>

            <div className="hidden sm:block h-5 w-[1px] bg-slate-200 mx-1"></div>

            <Dialog>
                <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-9 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 px-2 sm:px-3">
                        <FaEraser className="mr-2" /> Clear
                    </Button>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Clear Storyboard?</DialogTitle>
                        <DialogDescription>
                            This action cannot be undone. This will permanently delete all scenes and sentences.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                        <DialogClose asChild><Button variant="destructive" onClick={handleClearConfirm}>Yes, Clear All</Button></DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default FileMenu;