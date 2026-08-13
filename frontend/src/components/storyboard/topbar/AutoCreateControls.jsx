import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaBolt, FaSpinner, FaStop, FaCheckCircle, FaExclamationTriangle, FaUserCircle, FaArrowRight, FaDownload, FaClock, FaMagic, FaUpload, FaKey, FaRedo } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useStoryBoard } from '../../../context/StoryBoardContext';
import { useAutoPilot, AUTO_PILOT_STEPS } from '../../../hooks/useAutoPilot';
import { splitScriptIntoSentences, formatElapsed } from '../../../lib/storyboard-utils';
import { useProjectSettings } from '../../../hooks/useProjectSettings';
import { MAX_CONCURRENT_IMAGES } from '../../../lib/scene-generation';

const StepList = ({ activeStep, stepTimes = {} }) => {
    const activeIndex = AUTO_PILOT_STEPS.findIndex(step => step.key === activeStep);

    return (
        <ol className="space-y-1.5">
            {AUTO_PILOT_STEPS.map((step, index) => {
                const isDone = activeIndex > index;
                const isActive = activeIndex === index;
                return (
                    <li key={step.key} className={`flex items-center gap-2.5 text-sm ${isActive ? 'font-medium text-slate-900' : isDone ? 'text-emerald-600' : 'text-slate-400'}`}>
                        <span className="flex size-5 shrink-0 items-center justify-center">
                            {isDone ? <FaCheckCircle className="size-3.5" />
                                : isActive ? <FaSpinner className="size-3.5 animate-spin text-violet-600" />
                                : <span className="size-1.5 rounded-full bg-slate-300" />}
                        </span>
                        <span className="flex-1">{step.label}</span>
                        {stepTimes[step.key] > 0 && (
                            <span className="text-[11px] tabular-nums text-slate-400">{formatElapsed(stepTimes[step.key])}</span>
                        )}
                    </li>
                );
            })}
        </ol>
    );
};

const CharacterRow = ({ character, onUpload, uploading }) => {
    const inputRef = useRef(null);

    return (
        <li className="flex items-center gap-3 rounded-md border border-amber-100 bg-white px-3 py-2">
            {character.image
                ? <img src={character.image} alt="" className="size-9 shrink-0 rounded-md object-cover" />
                : <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-400"><FaUserCircle /></span>}

            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{character.name}</p>
                <p className={`truncate text-xs ${character.mediaId ? 'text-emerald-600' : 'text-amber-700'}`}>
                    {character.mediaId ? 'Reference image ready' : character.description || 'Needs a reference image'}
                </p>
            </div>

            {character.mediaId
                ? <FaCheckCircle className="shrink-0 text-emerald-600" />
                : uploading === character.id
                    ? <FaSpinner className="shrink-0 animate-spin text-amber-600" />
                    : (
                        <>
                            <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={() => inputRef.current?.click()}>
                                <FaUpload className="mr-1.5" /> Upload
                            </Button>
                            <input
                                ref={inputRef}
                                type="file"
                                accept="image/*"
                                hidden
                                onClick={event => { event.target.value = null; }}
                                onChange={event => {
                                    const file = event.target.files?.[0];
                                    if (file) onUpload(character.id, file);
                                }}
                            />
                        </>
                    )}
        </li>
    );
};

/**
 * The pause after character detection. The run cannot continue until each
 * character either has a Flow media id or is knowingly left without one, so
 * this is a decision point rather than a progress line.
 */
const CharacterStep = ({ characters, missingCount, mode, busy, progress, onChooseMode, onGenerate, onUpload, onContinue }) => {
    const [uploading, setUploading] = useState(null);
    const ready = characters.length - missingCount;

    const handleUpload = async (characterId, file) => {
        setUploading(characterId);
        await onUpload(characterId, file);
        setUploading(null);
    };

    const generating = busy;

    return (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div>
                <p className="text-sm font-medium text-amber-900">Character reference images</p>
                <p className="mt-1 text-xs text-amber-800">
                    {characters.length} character{characters.length === 1 ? '' : 's'} found · {ready} of {characters.length} ready.
                    A reference image keeps a character looking the same in every scene.
                </p>
            </div>

            {!mode ? (
                <div className="grid gap-2 sm:grid-cols-2">
                    <button
                        type="button"
                        onClick={onGenerate}
                        className="rounded-lg border border-amber-300 bg-white p-3 text-left transition hover:border-amber-500 hover:bg-amber-50"
                    >
                        <span className="flex items-center gap-2 text-sm font-medium text-slate-800"><FaMagic className="text-amber-600" /> Generate for me</span>
                        <span className="mt-1 block text-xs text-slate-500">The app draws a portrait for each character from its description.</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => onChooseMode('manual')}
                        className="rounded-lg border border-amber-300 bg-white p-3 text-left transition hover:border-amber-500 hover:bg-amber-50"
                    >
                        <span className="flex items-center gap-2 text-sm font-medium text-slate-800"><FaUpload className="text-amber-600" /> Upload my own</span>
                        <span className="mt-1 block text-xs text-slate-500">Pick an image per character from your computer.</span>
                    </button>
                </div>
            ) : (
                <ul className="space-y-2">
                    {characters.map(character => (
                        <CharacterRow key={character.id} character={character} onUpload={handleUpload} uploading={generating ? character.id : uploading} />
                    ))}
                </ul>
            )}

            {generating && (
                <p className="flex items-center gap-2 text-xs text-amber-800">
                    <FaSpinner className="animate-spin" />
                    Generating portraits{progress?.total ? ` — ${progress.generated + progress.failed}/${progress.total}` : ''}…
                </p>
            )}

            {mode && (
                <div className="flex flex-wrap items-center gap-2 border-t border-amber-200 pt-3">
                    <Button size="sm" onClick={onContinue} disabled={generating} className="bg-amber-600 hover:bg-amber-700">
                        <FaArrowRight className="mr-2" />
                        {missingCount > 0 ? `Continue without ${missingCount} image${missingCount === 1 ? '' : 's'}` : 'Continue'}
                    </Button>
                    {missingCount > 0 && mode === 'manual' && (
                        <Button size="sm" variant="outline" onClick={onGenerate} disabled={generating}>
                            <FaMagic className="mr-2" /> Generate the rest for me
                        </Button>
                    )}
                    {missingCount > 0 && mode === 'generating' && !generating && (
                        <Button size="sm" variant="outline" onClick={onGenerate}>
                            <FaMagic className="mr-2" /> Retry the {missingCount} that failed
                        </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => onChooseMode(null)} disabled={generating} className="text-slate-600">
                        Back
                    </Button>
                </div>
            )}
        </div>
    );
};

/**
 * Shown when Google Flow rejects a session mid-run. The run is paused rather
 * than failed: everything generated so far is on the board, and continuing
 * regenerates only the scenes still missing an image.
 */
const CookieStep = ({ accountName, imagesDone, imagesLeft, onContinue }) => (
    <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-red-900">
            <FaKey /> Google Flow session expired
        </p>
        <p className="text-xs text-red-800">
            Flow signed out <strong>{accountName}</strong>, so image generation is paused.
            Nothing is lost — {imagesDone} image{imagesDone === 1 ? '' : 's'} {imagesDone === 1 ? 'is' : 'are'} already on the storyboard.
        </p>
        <ol className="list-decimal space-y-1 pl-4 text-xs text-red-800">
            <li>Open <strong>Settings</strong> in the sidebar (or the dashboard for the default).</li>
            <li>Re-export your Google cookies from a browser where Flow opens, and paste them into that account.</li>
            <li>Come back here and continue.</li>
        </ol>
        <Button size="sm" onClick={onContinue} className="bg-red-600 hover:bg-red-700">
            <FaRedo className="mr-2" /> I have updated the cookies — continue
            {imagesLeft > 0 ? ` (${imagesLeft} left)` : ''}
        </Button>
    </div>
);

const AutoCreateControls = () => {
    const { state } = useStoryBoard();
    const { flowAccounts } = useProjectSettings();
    const autoPilot = useAutoPilot();
    const [open, setOpen] = useState(false);
    const [script, setScript] = useState('');
    const [voice, setVoice] = useState('');
    const [rate, setRate] = useState('1');
    const [voices, setVoices] = useState([]);
    const [voicesLoading, setVoicesLoading] = useState(false);
    const [alignmentAvailable, setAlignmentAvailable] = useState(true);
    const voicesRequested = useRef(false);

    const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
    const sentenceCount = useMemo(() => splitScriptIntoSentences(script).length, [script]);
    const imageConcurrency = useMemo(
        () => Math.max(1, Math.min(flowAccounts.length || 1, MAX_CONCURRENT_IMAGES)),
        [flowAccounts]
    );
    const { status, step, message, videoUrl, error, isRunning, isWaiting, charactersMissingImages, stats, interruptedStep, startedAt, elapsedMs, stepTimes, characterMode, characterProgress, characterBusy, waitingFor, expiredAccount } = autoPilot;
    const busy = isRunning || isWaiting;

    // Ticks only while a run is in flight; the final total is stamped by the hook.
    const [liveElapsed, setLiveElapsed] = useState(0);
    useEffect(() => {
        if (!busy || !startedAt) return;
        setLiveElapsed(Date.now() - startedAt);
        const timer = setInterval(() => setLiveElapsed(Date.now() - startedAt), 1000);
        return () => clearInterval(timer);
    }, [busy, startedAt]);

    const voiceGroups = useMemo(() => {
        const groups = new Map();
        voices.forEach(item => {
            const language = item.language || 'Other';
            if (!groups.has(language)) groups.set(language, []);
            groups.get(language).push(item);
        });
        return [...groups.entries()];
    }, [voices]);

    useEffect(() => {
        if (!open || voicesRequested.current) return;
        voicesRequested.current = true;

        const load = async () => {
            setVoicesLoading(true);
            try {
                const [voiceResponse, alignmentResponse] = await Promise.all([
                    fetch(`${backendUrl}/api/tts/voices`),
                    fetch(`${backendUrl}/api/tts/alignment`),
                ]);
                const voiceData = await voiceResponse.json();
                if (!voiceResponse.ok) throw new Error(voiceData.detail || voiceData.message);
                setVoices(voiceData.voices || []);
                if (alignmentResponse.ok) setAlignmentAvailable((await alignmentResponse.json()).available !== false);
            } catch (loadError) {
                voicesRequested.current = false;
                toast.error(loadError.message || 'Could not load FameSpeak voices.', { id: 'autopilot-voices' });
            } finally {
                setVoicesLoading(false);
            }
        };
        load();
    }, [open, backendUrl]);

    // Keep the dialog open for the whole run so progress stays visible.
    useEffect(() => {
        if (busy) setOpen(true);
    }, [busy]);

    const handleStart = () => {
        if (state.items.length > 0 && !window.confirm('Auto-create replaces everything currently on this storyboard. Continue?')) return;
        autoPilot.start({ script, voice, rate });
    };

    return (
        <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
            <DialogTrigger asChild>
                <Button size="sm" className="h-9 bg-violet-600 px-3 text-sm text-white hover:bg-violet-700" title="Turn a script into a finished video">
                    {busy ? <FaSpinner className="mr-2 animate-spin" /> : <FaBolt className="mr-2" />} Auto-create
                </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Auto-create video</DialogTitle>
                </DialogHeader>

                <div className="max-h-[65vh] space-y-4 overflow-y-auto py-2">
                    {status === 'idle' && (
                        <>
                            <p className="text-sm text-muted-foreground">
                                Paste your script and pick a voice. The studio narrates it, times every sentence against the audio,
                                builds the scenes, generates the images and exports the finished video.
                            </p>

                            {interruptedStep && (
                                <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                                    <p className="text-xs text-amber-800">A previous run stopped at “{AUTO_PILOT_STEPS.find(s => s.key === interruptedStep)?.label || interruptedStep}”.</p>
                                    <Button size="sm" variant="outline" onClick={() => autoPilot.resume({ step: interruptedStep, voice, rate })}>Resume</Button>
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <label className="text-sm font-medium" htmlFor="autopilot-script">Script</label>
                                <textarea
                                    id="autopilot-script"
                                    value={script}
                                    onChange={event => setScript(event.target.value)}
                                    rows={8}
                                    placeholder={'Paris, 1925.\nThe city is still recovering from the Great War...'}
                                    className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                                />
                                <p className="text-xs text-slate-500">
                                    {sentenceCount} sentence{sentenceCount === 1 ? '' : 's'} detected · one line per beat works best
                                    {' · '}
                                    {imageConcurrency > 1
                                        ? `${imageConcurrency} images at a time`
                                        : 'images one at a time — add Flow accounts to go faster'}
                                </p>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium" htmlFor="autopilot-voice">Voice actor</label>
                                    <select id="autopilot-voice" value={voice} onChange={event => setVoice(event.target.value)} disabled={voicesLoading} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                                        <option value="">{voicesLoading ? 'Loading voices…' : 'FameSpeak default voice'}</option>
                                        {voiceGroups.map(([language, items]) => (
                                            <optgroup key={language} label={`${language} (${items.length})`}>
                                                {items.map(item => <option key={item.id} value={item.id}>{item.name}{item.gender ? ` — ${item.gender}` : ''}{item.tier === 'premium' ? ' ★ premium' : ''}</option>)}
                                            </optgroup>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium" htmlFor="autopilot-rate">Speaking speed</label>
                                    <select id="autopilot-rate" value={rate} onChange={event => setRate(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                                        <option value="0.8">Slow (0.8×)</option>
                                        <option value="1">Normal (1×)</option>
                                        <option value="1.15">Fast (1.15×)</option>
                                        <option value="1.3">Faster (1.3×)</option>
                                    </select>
                                </div>
                            </div>

                            {!alignmentAvailable && (
                                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                    Local alignment is unavailable, so sentence timings will be estimated from the audio length and may drift.
                                    Install it with <code>pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu</code>.
                                </p>
                            )}
                        </>
                    )}

                    {status !== 'idle' && (
                        <div className="space-y-4">
                            <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-4">
                                <div className="mb-3 flex items-center justify-between border-b border-violet-100 pb-2">
                                    <span className="text-xs font-medium text-violet-900">
                                        {status === 'done' ? 'Finished in' : status === 'failed' ? 'Stopped after' : status === 'cancelled' ? 'Stopped after' : 'Elapsed'}
                                    </span>
                                    <span className="flex items-center gap-1.5 font-mono text-sm tabular-nums text-violet-900">
                                        <FaClock className="size-3 text-violet-400" />
                                        {formatElapsed(busy ? liveElapsed : elapsedMs) || '0s'}
                                    </span>
                                </div>
                                <StepList activeStep={step} stepTimes={stepTimes} />
                                {message && <p className="mt-3 border-t border-violet-100 pt-3 text-xs text-slate-600">{message}</p>}
                            </div>

                            {isWaiting && waitingFor === 'cookies' && (
                                <CookieStep
                                    accountName={expiredAccount}
                                    imagesDone={stats?.imagesGenerated || 0}
                                    imagesLeft={Math.max((stats?.totalScenes || 0) - (stats?.imagesGenerated || 0), 0)}
                                    onContinue={autoPilot.continueAfterCookies}
                                />
                            )}

                            {isWaiting && waitingFor !== 'cookies' && (
                                <CharacterStep
                                    characters={state.characters || []}
                                    missingCount={charactersMissingImages.length}
                                    mode={characterMode}
                                    busy={characterBusy}
                                    progress={characterProgress}
                                    onChooseMode={autoPilot.setCharacterMode}
                                    onGenerate={autoPilot.generateCharacterImages}
                                    onUpload={autoPilot.uploadCharacterImage}
                                    onContinue={autoPilot.continueRun}
                                />
                            )}

                            {stats && (
                                <div className="grid grid-cols-3 gap-2 text-center">
                                    {[['Scenes', stats.totalScenes], ['Prompts', stats.promptsGenerated], ['Images', stats.imagesGenerated]].map(([label, value]) => (
                                        <div key={label} className="rounded-lg border border-slate-200 bg-white p-2">
                                            <p className="text-lg font-semibold text-slate-800">{value ?? 0}</p>
                                            <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {error && (
                                <p className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                                    <FaExclamationTriangle className="mt-0.5 shrink-0" /> {error}
                                </p>
                            )}

                            {videoUrl && (
                                <div className="space-y-2">
                                    <video src={videoUrl} controls className="w-full rounded-lg border bg-black" />
                                    <a href={videoUrl} download className="inline-flex items-center gap-2 text-sm font-medium text-violet-700 hover:underline">
                                        <FaDownload /> Download MP4
                                    </a>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    {busy && <Button variant="destructive" onClick={autoPilot.cancel}><FaStop className="mr-2" /> Stop</Button>}
                    {(status === 'done' || status === 'failed' || status === 'cancelled') && (
                        <Button variant="outline" onClick={autoPilot.reset}>Start another</Button>
                    )}
                    {status === 'idle' && (
                        <Button onClick={handleStart} disabled={sentenceCount === 0} className="bg-violet-600 hover:bg-violet-700">
                            <FaBolt className="mr-2" /> Create video
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default AutoCreateControls;
