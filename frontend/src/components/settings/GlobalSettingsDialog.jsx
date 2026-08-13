// Dashboard-level defaults. Saved once, inherited by every storyboard.
import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FaCog, FaExternalLinkAlt } from 'react-icons/fa';
import toast from 'react-hot-toast';
import SettingsPanel from './SettingsPanel';
import { loadGlobalSettings, saveGlobalSettings, validateFlowCookies } from '../../lib/settings';

const GlobalSettingsDialog = () => {
    const [open, setOpen] = useState(false);
    const [values, setValues] = useState(loadGlobalSettings);

    // Reload on open so the form never shows a stale copy after edits made
    // from inside a storyboard or another tab.
    useEffect(() => {
        if (open) setValues(loadGlobalSettings());
    }, [open]);

    const change = (key, value) => setValues(current => ({ ...current, [key]: value }));

    const openFlowProfile = async () => {
        try {
            const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
            const response = await fetch(`${backendUrl}/api/open-flow-profile`, { method: 'POST' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || 'Could not open the Google Flow sign-in window');
            toast.success(data.message || 'Google Flow sign-in window opened');
        } catch (error) {
            toast.error(error.message || 'Could not open the Google Flow sign-in window');
        }
    };

    const save = () => {
        const cookies = values.flowCookies?.trim();
        if (cookies) {
            try {
                validateFlowCookies(cookies);
            } catch (error) {
                toast.error(error.message);
                return;
            }
        }
        saveGlobalSettings(values);
        toast.success('Default settings saved for every storyboard');
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="h-11 px-5">
                    <FaCog className="mr-2" /> Settings
                </Button>
            </DialogTrigger>
            <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] flex-col gap-4 overflow-hidden sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><FaCog /> Default settings</DialogTitle>
                </DialogHeader>

                <p className="shrink-0 text-sm text-muted-foreground">
                    These apply to every storyboard. Any storyboard can override them for itself without changing what is set here.
                </p>

                <div className="min-h-0 overflow-y-auto pr-1">
                    <SettingsPanel scope="global" values={values} onChange={change} />
                </div>

                <DialogFooter className="shrink-0 sm:justify-between">
                    <Button variant="outline" onClick={openFlowProfile} className="text-blue-600 hover:bg-blue-50">
                        <FaExternalLinkAlt className="mr-2" /> Open Flow sign-in
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button onClick={save} className="bg-pink-500 hover:bg-pink-600">Save defaults</Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default GlobalSettingsDialog;
