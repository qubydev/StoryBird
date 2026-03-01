import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { FaPalette, FaKey, FaUser, FaCog } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { getStorageItem } from '../../../lib/storyboard-utils';

// --- HELPERS ---
const setStorageItem = (key, text, enabled) => {
    localStorage.setItem(key, JSON.stringify({ text, enabled }));
};

const parseSessionCookies = (input) => {
    try {
        const cookies = JSON.parse(input);
        if (!Array.isArray(cookies)) throw new Error("Input is not a JSON array");
        const target = cookies.find(c => c.name === "__Secure-next-auth.session-token");
        if (target && target.value) return target.value;
        throw new Error("Session token not found");
    } catch (e) {
        if (input.startsWith("eyJ")) return input;
        throw new Error("Invalid Cookie JSON");
    }
};

// --- SUB-COMPONENTS ---
const MainSettingsDialog = ({ onUpdate, config }) => {
    const [open, setOpen] = useState(false);
    const [toggles, setToggles] = useState({ character: true, style: true });

    useEffect(() => {
        if (open) {
            setToggles({ character: config.character.enabled, style: config.style.enabled });
        }
    }, [open, config]);

    const handleToggle = (key, currentVal) => {
        const newVal = !currentVal;
        setToggles(prev => ({ ...prev, [key]: newVal }));
        const storageKey = key === 'character' ? 'sb_global_character' : 'sb_global_style';
        const currentData = getStorageItem(storageKey);
        setStorageItem(storageKey, currentData.text, newVal);
        onUpdate();
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-slate-500 hover:text-slate-700">
                    <FaCog className="animate-in spin-in-90 duration-300" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[350px]">
                <DialogHeader>
                    <DialogTitle>Global Settings</DialogTitle>
                    <DialogDescription>Enable or disable global contexts.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="flex flex-col gap-1">
                            <span className="font-medium text-sm flex items-center gap-2"><FaUser className="text-slate-400" /> Character</span>
                            <span className="text-[10px] text-slate-500">Include details in generation</span>
                        </div>
                        <Switch checked={toggles.character} onCheckedChange={() => handleToggle('character', toggles.character)} />
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex flex-col gap-1">
                            <span className="font-medium text-sm flex items-center gap-2"><FaPalette className="text-slate-400" /> Style</span>
                            <span className="text-[10px] text-slate-500">Include style in generation</span>
                        </div>
                        <Switch checked={toggles.style} onCheckedChange={() => handleToggle('style', toggles.style)} />
                    </div>
                </div>
                <DialogFooter><Button onClick={() => setOpen(false)}>Done</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const GlobalInputButton = ({ title, storageKey, icon: Icon, processInput, isDisabled, onUpdate }) => {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");
    const [isSaved, setIsSaved] = useState(false);

    useEffect(() => {
        const data = getStorageItem(storageKey);
        setText(data.text || "");
        setIsSaved(!!data.text);
    }, [open, isDisabled, storageKey]);

    const handleSave = () => {
        let finalValue = text.trim();
        if (processInput && finalValue) {
            try { finalValue = processInput(finalValue); }
            catch (e) { toast.error(e.message || "Invalid input"); return; }
        }
        const currentData = getStorageItem(storageKey);

        if (finalValue) {
            setStorageItem(storageKey, finalValue, currentData.enabled);
            setIsSaved(true);
            setText(finalValue);
            toast.success(`${title} saved`);
            setOpen(false);
        } else {
            localStorage.removeItem(storageKey);
            setIsSaved(false);
            setText("");
            toast.success(`${title} cleared`);
            setOpen(false);
        }
        onUpdate();
    };

    let btnClass = "h-9 text-sm px-3 border transition-colors ";
    btnClass += isSaved ? "text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200" : "text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200";

    if (isDisabled) {
        return (
            <Button variant="outline" size="sm" disabled className="h-9 text-sm px-3 border border-slate-200 text-slate-300 opacity-50 cursor-not-allowed">
                <Icon className="mr-2" /> {title}
            </Button>
        );
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className={btnClass}><Icon className="mr-2" /> {title}</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader><DialogTitle className="flex items-center gap-2"><Icon /> {title}</DialogTitle></DialogHeader>
                <div className="py-4">
                    <Textarea value={text} onChange={(e) => setText(e.target.value)} className="h-[300px] break-all font-mono text-xs" placeholder={`Enter ${title}...`} />
                </div>
                <DialogFooter><Button onClick={handleSave}>{text ? "Save Changes" : "Save"}</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// --- EXPORTED COMPONENT ---
export const GlobalSettings = () => {
    const [config, setConfig] = useState({
        character: { enabled: true, hasText: false },
        style: { enabled: true, hasText: false },
        session: { enabled: true, hasText: false }
    });

    const refreshConfig = () => {
        const charData = getStorageItem('sb_global_character');
        const styleData = getStorageItem('sb_global_style');
        const sessionData = getStorageItem('sb_global_session_key');

        setConfig({
            character: { enabled: charData.enabled, hasText: !!charData.text },
            style: { enabled: styleData.enabled, hasText: !!styleData.text },
            session: { enabled: true, hasText: !!sessionData.text }
        });
    };

    useEffect(() => {
        refreshConfig();

        window.addEventListener('session_key_changed', refreshConfig);
        return () => window.removeEventListener('session_key_changed', refreshConfig);
    }, []);

    return (
        <div className="flex items-center gap-2">
            <GlobalInputButton title="Character" storageKey="sb_global_character" icon={FaUser} isDisabled={!config.character.enabled} onUpdate={refreshConfig} />
            <GlobalInputButton title="Style" storageKey="sb_global_style" icon={FaPalette} isDisabled={!config.style.enabled} onUpdate={refreshConfig} />
            <GlobalInputButton key={`session-${config.session.hasText}`} title="Session Key" storageKey="sb_global_session_key" icon={FaKey} processInput={parseSessionCookies} isDisabled={false} onUpdate={refreshConfig} />
            <MainSettingsDialog onUpdate={refreshConfig} config={config} />
        </div>
    );
};