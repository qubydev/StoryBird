// Storyboard-scoped settings. Every value starts as the dashboard default;
// editing one here overrides it for this storyboard only and leaves the
// defaults, and every other storyboard, untouched.
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FaSlidersH, FaExternalLinkAlt, FaUndo } from 'react-icons/fa';
import toast from 'react-hot-toast';
import SettingsPanel from '../../settings/SettingsPanel';
import { useProjectSettings } from '../../../hooks/useProjectSettings';
import { validateFlowCookies } from '../../../lib/settings';

export const GlobalSettings = () => {
    const [open, setOpen] = useState(false);
    const { settings, isOverridden, overrideCount, setOverride, clearOverride, clearAllOverrides } = useProjectSettings();

    const change = (key, value) => {
        if (key === 'flowCookies' && value.trim()) {
            try {
                validateFlowCookies(value);
            } catch {
                // Let the user keep typing; the value is validated on save.
            }
        }
        setOverride(key, value);
    };

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

    const resetAll = () => {
        clearAllOverrides();
        toast.success('This storyboard follows the default settings again');
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 px-3 text-sm">
                    <FaSlidersH className="mr-2" /> Settings
                    {overrideCount > 0 && (
                        <span className="ml-2 rounded-full bg-violet-100 px-1.5 text-[11px] font-medium text-violet-700">{overrideCount}</span>
                    )}
                </Button>
            </DialogTrigger>

            <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] flex-col gap-4 overflow-hidden sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><FaSlidersH /> Storyboard settings</DialogTitle>
                </DialogHeader>

                <p className="shrink-0 text-sm text-muted-foreground">
                    {overrideCount === 0
                        ? 'This storyboard uses the default settings from the dashboard. Change anything below to override it here only.'
                        : `${overrideCount} setting${overrideCount === 1 ? '' : 's'} overridden for this storyboard. The dashboard defaults are unchanged.`}
                </p>

                <div className="min-h-0 overflow-y-auto pr-1">
                    <SettingsPanel
                        scope="project"
                        values={settings}
                        onChange={change}
                        isOverridden={isOverridden}
                        onReset={clearOverride}
                    />
                </div>

                <DialogFooter className="shrink-0 sm:justify-between">
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={openFlowProfile} className="text-blue-600 hover:bg-blue-50">
                            <FaExternalLinkAlt className="mr-2" /> Open Flow sign-in
                        </Button>
                        {overrideCount > 0 && (
                            <Button variant="outline" onClick={resetAll} className="text-slate-600">
                                <FaUndo className="mr-2" /> Reset all to global
                            </Button>
                        )}
                    </div>
                    <Button onClick={() => setOpen(false)}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default GlobalSettings;
