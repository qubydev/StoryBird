// Resolved settings for the open storyboard: dashboard defaults with this
// storyboard's overrides applied on top.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStoryBoard } from '../context/StoryBoardContext';
import { loadGlobalSettings, resolveSettings, hasOverride, effectiveFlowAccounts } from '../lib/settings';

/** Dashboard defaults, kept in sync when they are edited elsewhere in the app. */
export const useGlobalSettings = () => {
    const [globals, setGlobals] = useState(loadGlobalSettings);

    useEffect(() => {
        const refresh = () => setGlobals(loadGlobalSettings());
        window.addEventListener('global_settings_changed', refresh);
        // Another tab editing the defaults should be reflected here too.
        window.addEventListener('storage', refresh);
        return () => {
            window.removeEventListener('global_settings_changed', refresh);
            window.removeEventListener('storage', refresh);
        };
    }, []);

    return [globals, () => setGlobals(loadGlobalSettings())];
};

export const useProjectSettings = () => {
    const { state, dispatch } = useStoryBoard();
    const [globals] = useGlobalSettings();
    const overrides = state.settings || {};

    const settings = useMemo(() => resolveSettings(globals, overrides), [globals, overrides]);
    const flowAccounts = useMemo(() => effectiveFlowAccounts(settings), [settings]);

    const setOverride = useCallback((key, value) => {
        dispatch({ type: 'SET_SETTING_OVERRIDE', payload: { key, value } });
    }, [dispatch]);

    const clearOverride = useCallback((key) => {
        dispatch({ type: 'CLEAR_SETTING_OVERRIDE', payload: key });
    }, [dispatch]);

    const clearAllOverrides = useCallback(() => {
        dispatch({ type: 'CLEAR_ALL_SETTING_OVERRIDES' });
    }, [dispatch]);

    return {
        settings,
        globals,
        overrides,
        flowAccounts,
        isOverridden: (key) => hasOverride(overrides, key),
        overrideCount: Object.keys(overrides).length,
        setOverride,
        clearOverride,
        clearAllOverrides,
    };
};
