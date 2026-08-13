import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaDownload, FaMusic, FaSpinner, FaCheckCircle } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useStoryBoard } from '../../../context/StoryBoardContext';
import { estimateTimings, buildSRT } from '../../../lib/storyboard-utils';

const collectSentences = (items) => items.flatMap(item => item.type === 'scene' ? (item.sentences || []) : [item]).filter(item => item.text?.trim());
const getDuration = (url) => new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.onloadedmetadata = () => resolve(audio.duration);
    audio.onerror = reject;
});
const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
});

const TTSControls = () => {
    const { state, dispatch } = useStoryBoard();
    const [open, setOpen] = useState(false);
    const [voice, setVoice] = useState('');
    const [rate, setRate] = useState('1');
    const [isGenerating, setIsGenerating] = useState(false);
    const [audioUrl, setAudioUrl] = useState(null);
    const [voices, setVoices] = useState([]);
    const [voicesLoading, setVoicesLoading] = useState(false);
    const [progress, setProgress] = useState({ value: 0, message: '' });
    const voicesRequested = useRef(false);

    const voiceGroups = useMemo(() => {
        const groups = new Map();
        voices.forEach(item => {
            const language = item.language || 'Other';
            if (!groups.has(language)) groups.set(language, []);
            groups.get(language).push(item);
        });
        return [...groups.entries()];
    }, [voices]);

    const sentences = useMemo(() => collectSentences(state.items || []), [state.items]);
    const script = useMemo(() => sentences.map(sentence => sentence.text.trim()).join('\n\n'), [sentences]);

    useEffect(() => () => {
        if (audioUrl) URL.revokeObjectURL(audioUrl);
    }, [audioUrl]);

    useEffect(() => {
        if (!open || voicesRequested.current) return;
        voicesRequested.current = true;
        const loadVoices = async () => {
            setVoicesLoading(true);
            try {
                const response = await fetch(`${import.meta.env.VITE_BACKEND_URL || ''}/api/tts/voices`);
                const data = await response.json();
                if (!response.ok) throw new Error(data.detail || data.message);
                setVoices(data.voices || []);
            } catch (error) {
                voicesRequested.current = false;
                toast.error(error.message || 'Could not load FameSpeak voices.', { id: 'famespeak-voices' });
            } finally { setVoicesLoading(false); }
        };
        loadVoices();
    }, [open]);

    const handleGenerate = async () => {
        if (!script) {
            toast.error('Add script text before generating a voiceover.');
            return;
        }
        setIsGenerating(true);
        const toastId = toast.loading('Generating voiceover with FameSpeak...');
        try {
            const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
            const response = await fetch(`${backendUrl}/api/tts/jobs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: script,
                    voice: voice.trim() || undefined,
                    rate: Number(rate),
                    // Ask the backend to force-align the result so the SRT
                    // reflects real speech instead of an estimate.
                    sentences: sentences.map(sentence => ({ id: sentence.id, text: sentence.text.trim() })),
                }),
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.detail || error.message || 'Voiceover generation failed.');
            }
            const job = await response.json();
            let status;
            do {
                await new Promise(resolve => setTimeout(resolve, 1000));
                const statusResponse = await fetch(`${backendUrl}/api/tts/jobs/${job.id}`);
                status = await statusResponse.json();
                if (!statusResponse.ok || status.status === 'failed') throw new Error(status.detail || status.message || 'Voiceover generation failed.');
                setProgress({ value: status.progress || 0, message: status.message || 'Generating voiceover' });
            } while (status.status !== 'completed');

            const audioResponse = await fetch(`${backendUrl}/api/tts/jobs/${job.id}/audio`);
            if (!audioResponse.ok) throw new Error('Voiceover completed but the audio could not be downloaded.');
            const blob = await audioResponse.blob();
            const nextAudioUrl = URL.createObjectURL(blob);
            const duration = await getDuration(nextAudioUrl);
            // Forced alignment is preferred; the character-count estimate is
            // only used when the backend could not align the audio.
            const aligned = Array.isArray(status.timings) && status.timings.length === sentences.length;
            const timings = aligned ? status.timings : estimateTimings(sentences, duration);
            const srt = status.srt || buildSRT(timings);
            const extension = blob.type === 'audio/wav' ? 'wav' : 'mp3';
            dispatch({ type: 'APPLY_VOICEOVER', payload: {
                timings, srt,
                voiceover: { dataUrl: await blobToDataUrl(blob), mimeType: blob.type || 'audio/mpeg', filename: `${(state.title || 'storyboard').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'storyboard'}-voiceover.${extension}`, duration },
            }});
            setAudioUrl(current => {
                if (current) URL.revokeObjectURL(current);
                return nextAudioUrl;
            });
            toast.success(aligned
                ? 'Voiceover added and every sentence timed against the audio.'
                : 'Voiceover added. Timings are estimated — alignment was unavailable.', { id: toastId });
        } catch (error) {
            toast.error(error.message || 'Voiceover generation failed.', { id: toastId });
        } finally {
            setIsGenerating(false);
            setProgress({ value: 0, message: '' });
        }
    };

    const download = () => {
        if (!audioUrl) return;
        const link = document.createElement('a');
        link.href = audioUrl;
        link.download = `${(state.title || 'storyboard').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'storyboard'}-voiceover.mp3`;
        link.click();
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 px-3 text-sm text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700" title="Generate a FameSpeak voiceover from the storyboard script">
                    <FaMusic className="mr-2" /> Generate Voiceover
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Generate voiceover</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <p className="text-sm text-muted-foreground">FameSpeak will narrate all non-empty storyboard sentences in order.</p>
                    <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">{script ? `${script.length.toLocaleString()} characters ready` : 'No script text available yet'}</p>
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium" htmlFor="famespeak-voice">Voice actor</label>
                        <select id="famespeak-voice" value={voice} onChange={event => setVoice(event.target.value)} disabled={isGenerating || voicesLoading} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                            <option value="">{voicesLoading ? 'Loading FameSpeak voices…' : 'FameSpeak default voice'}</option>
                            {voiceGroups.map(([language, items]) => (
                                <optgroup key={language} label={`${language} (${items.length})`}>
                                    {items.map(item => <option key={item.id} value={item.id}>{item.name}{item.gender ? ` — ${item.gender}` : ''}{item.tier === 'premium' ? ' ★ premium' : ''}</option>)}
                                </optgroup>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium" htmlFor="famespeak-rate">Speaking speed</label>
                        <select id="famespeak-rate" value={rate} onChange={event => setRate(event.target.value)} disabled={isGenerating} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                            <option value="0.8">Slow (0.8×)</option>
                            <option value="1">Normal (1×)</option>
                            <option value="1.15">Fast (1.15×)</option>
                            <option value="1.3">Faster (1.3×)</option>
                        </select>
                    </div>
                    {isGenerating && <div className="rounded-lg border border-violet-100 bg-violet-50 p-3">
                        <div className="mb-2 flex items-center justify-between text-xs font-medium text-violet-800"><span>{progress.message || 'Preparing generation'}</span><span>{progress.value}%</span></div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-violet-100"><div className="h-full rounded-full bg-violet-600 transition-all duration-500" style={{ width: `${progress.value}%` }} /></div>
                    </div>}
                    {audioUrl && <><audio controls src={audioUrl} className="w-full" /><p className="flex items-center gap-2 text-xs text-emerald-700"><FaCheckCircle /> Timed SRT is applied and this audio will be used in video export.</p></>}
                </div>
                <DialogFooter>
                    {audioUrl && <Button variant="outline" onClick={download} disabled={isGenerating}><FaDownload className="mr-2" /> Download</Button>}
                    <Button onClick={handleGenerate} disabled={isGenerating || !script}>
                        {isGenerating ? <><FaSpinner className="mr-2 animate-spin" /> Generating...</> : <><FaMusic className="mr-2" /> Generate</>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default TTSControls;
