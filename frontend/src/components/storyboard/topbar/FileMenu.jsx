import React from 'react';
import { useStoryBoard } from '../../../context/StoryBoardContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FaDownload, FaUpload, FaEraser, FaSpinner, FaProjectDiagram, FaFileAlt, FaBrain } from 'react-icons/fa';
import { parseTranscript, parseSRTTimestamp, buildExportProject } from '../../../lib/storyboard-utils';
import toast from 'react-hot-toast';

const FileMenu = () => {
    const { state, dispatch } = useStoryBoard();

    const projectInputRef = React.useRef(null);
    const transcriptInputRef = React.useRef(null);
    const smartTranscriptInputRef = React.useRef(null);

    const handleExport = () => {
        const exportState = buildExportProject(state);

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportState, null, 2));
        const node = document.createElement('a');
        node.setAttribute("href", dataStr);
        node.setAttribute("download", `${state.title.replace(/\s+/g, '_') || 'storyboard'}.json`);
        document.body.appendChild(node);
        node.click();
        node.remove();
        toast.success("Project exported");
    };

    const handleStoryboardImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();

        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target.result);

                if (json.items && Array.isArray(json.items)) {
                    const normalizedItems = json.items.map(item => {
                        if (item.type === 'scene') {
                            return {
                                ...item,
                                sentences: item.sentences.map(s => ({
                                    ...s,
                                    start: parseSRTTimestamp(s.start),
                                    end: parseSRTTimestamp(s.end)
                                }))
                            };
                        } else if (item.type === 'sentence') {
                            return {
                                ...item,
                                start: parseSRTTimestamp(item.start),
                                end: parseSRTTimestamp(item.end)
                            };
                        }

                        return item;
                    });

                    json.items = normalizedItems;

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
    };

    const handleTranscriptImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.srt')) {
            toast.error("Only SRT files are supported");
            return;
        }

        const reader = new FileReader();

        reader.onload = (event) => {
            try {
                const parsedSentences = parseTranscript(event.target.result, file.name);

                if (parsedSentences.length > 0) {
                    dispatch({ type: 'IMPORT_TRANSCRIPT', payload: parsedSentences });
                    toast.success(`Imported ${parsedSentences.length} sentences`);
                } else {
                    throw new Error("No readable sentences found in file");
                }
            } catch (err) {
                toast.error(err.message);
            }
        };

        reader.readAsText(file);
    };

    const handleSmartTranscriptImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.srt')) {
            toast.error("Only SRT files are supported");
            return;
        }

        const reader = new FileReader();

        reader.onload = async (event) => {
            const loadingToast = toast.loading("Analyzing transcript with AI...");

            try {
                const srtData = event.target.result;

                const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/smart-transcript`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        transcript: srtData
                    })
                });

                if (!response.ok) {
                    throw new Error("Failed to process transcript");
                }

                const data = await response.json();

                if (!data.sentences || !Array.isArray(data.sentences)) {
                    throw new Error("Invalid response from server");
                }

                const parsedSentences = data.sentences.map(s => ({
                    ...s,
                    start: parseSRTTimestamp(s.start),
                    end: parseSRTTimestamp(s.end)
                }));

                dispatch({ type: 'IMPORT_TRANSCRIPT', payload: parsedSentences });

                toast.success(`Imported ${parsedSentences.length} sentences`, { id: loadingToast });
            } catch (err) {
                toast.error(err.message, { id: loadingToast });
            }
        };

        reader.readAsText(file);
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

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-9 text-sm px-2 sm:px-3">
                        <FaUpload className="mr-2" /> Import
                    </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => projectInputRef.current.click()}>
                        <FaProjectDiagram className="mr-2 text-purple-500" />
                        Storyboard
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => transcriptInputRef.current.click()}>
                        <FaFileAlt className="mr-2 text-blue-500" />
                        Transcript
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => smartTranscriptInputRef.current.click()}>
                        <FaBrain className="mr-2 text-emerald-500" />
                        Smart Transcript
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <input
                ref={projectInputRef}
                type="file"
                hidden
                accept=".json"
                onChange={handleStoryboardImport}
                onClick={(e) => (e.target.value = null)}
            />

            <input
                ref={transcriptInputRef}
                type="file"
                hidden
                accept=".srt"
                onChange={handleTranscriptImport}
                onClick={(e) => (e.target.value = null)}
            />

            <input
                ref={smartTranscriptInputRef}
                type="file"
                hidden
                accept=".srt"
                onChange={handleSmartTranscriptImport}
                onClick={(e) => (e.target.value = null)}
            />

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
                        <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                        </DialogClose>

                        <DialogClose asChild>
                            <Button variant="destructive" onClick={handleClearConfirm}>
                                Yes, Clear All
                            </Button>
                        </DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default FileMenu;