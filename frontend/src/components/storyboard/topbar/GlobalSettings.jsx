import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { FaKey, FaInfoCircle } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { getStorageItem } from '../../../lib/storyboard-utils';

const setStorageItem = (key, text) => {
    localStorage.setItem(key, JSON.stringify({ text }));
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

const GlobalInputButton = ({ title, storageKey, icon: Icon, processInput, onUpdate }) => {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");
    const [isSaved, setIsSaved] = useState(false);

    useEffect(() => {
        const data = getStorageItem(storageKey);
        setText(data.text || "");
        setIsSaved(!!data.text);
    }, [open, storageKey]);

    const handleSave = () => {
        let finalValue = text.trim();

        if (processInput && finalValue) {
            try {
                finalValue = processInput(finalValue);
            } catch (e) {
                toast.error(e.message || "Invalid input");
                return;
            }
        }

        if (finalValue) {
            setStorageItem(storageKey, finalValue);
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

export const GlobalSettings = () => {
    const [config, setConfig] = useState({
        instructions: { hasText: false },
        session: { hasText: false }
    });

    const refreshConfig = () => {
        const instData = getStorageItem('sb_global_instructions');
        const sessionData = getStorageItem('sb_global_session_key');

        setConfig({
            instructions: { hasText: !!instData.text },
            session: { hasText: !!sessionData.text }
        });
    };

    useEffect(() => {
        refreshConfig();
        window.addEventListener('session_key_changed', refreshConfig);
        return () => window.removeEventListener('session_key_changed', refreshConfig);
    }, []);

    return (
        <div className="flex items-center gap-2">
            <GlobalInputButton title="Instructions" storageKey="sb_global_instructions" icon={FaInfoCircle} onUpdate={refreshConfig} />
            <GlobalInputButton key={`session-${config.session.hasText}`} title="Session Key" storageKey="sb_global_session_key" icon={FaKey} processInput={parseSessionCookies} onUpdate={refreshConfig} />
        </div>
    );
};