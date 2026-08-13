// Two-level settings: defaults live on the dashboard and apply to every
// storyboard; a storyboard may override any of them for itself alone.
//
// Globals stay in localStorage under the original keys and formats so existing
// configuration keeps working. Overrides live inside the project document, so
// they travel with the storyboard and never leak back into the defaults.

export const LLM_PROVIDER_STORAGE_KEY = 'sb_llm_provider';
export const FLOW_ACCOUNTS_STORAGE_KEY = 'sb_flow_accounts';
export const INSTRUCTIONS_STORAGE_KEY = 'sb_global_instructions';
export const SESSION_KEY_STORAGE_KEY = 'sb_global_session_key';
export const IMAGE_MODEL_STORAGE_KEY = 'sb_image_model';

export const SETTINGS = [
    { key: 'llmProvider', label: 'LLM provider', storageKey: LLM_PROVIDER_STORAGE_KEY },
    { key: 'imageModel', label: 'Image model', storageKey: IMAGE_MODEL_STORAGE_KEY },
    { key: 'instructions', label: 'Prompt instructions', storageKey: INSTRUCTIONS_STORAGE_KEY },
    { key: 'flowAccounts', label: 'Flow accounts', storageKey: FLOW_ACCOUNTS_STORAGE_KEY },
    { key: 'flowCookies', label: 'Flow cookies', storageKey: SESSION_KEY_STORAGE_KEY },
];

// Matched by label against Flow's own model menu, because Flow owns that list
// and renames entries without notice. An empty value keeps whatever model Flow
// currently has selected, which is always a safe choice.
export const IMAGE_MODEL_OPTIONS = [
    { value: '', label: "Flow's current model (default)" },
    { value: 'Nano Banana', label: 'Nano Banana' },
    { value: 'Imagen 4', label: 'Imagen 4' },
    { value: 'Imagen 3', label: 'Imagen 3' },
];

export const DEFAULT_SETTINGS = {
    llmProvider: 'openrouter',
    imageModel: '',
    instructions: '',
    flowAccounts: [],
    flowCookies: '',
};

// Values were historically wrapped as {"text": "..."}; a bare string is also
// accepted so hand-edited or older entries still load.
const readWrapped = (key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return '';
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'text' in parsed) return parsed.text || '';
        if (typeof parsed === 'string') return parsed;
        return raw;
    } catch {
        return raw;
    }
};

const writeWrapped = (key, value) => {
    if (value) localStorage.setItem(key, JSON.stringify({ text: value }));
    else localStorage.removeItem(key);
};

export const parseFlowAccounts = (raw) => {
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
        if (!Array.isArray(parsed)) return [];
        // The earliest format stored one raw cookie array rather than a list of
        // named accounts.
        const isCookieArray = parsed.some(item => item?.name && Object.prototype.hasOwnProperty.call(item, 'value'));
        if (isCookieArray) return [{ name: 'Flow account 1', cookies: JSON.stringify(parsed) }];
        return parsed
            .map(account => ({
                name: String(account?.name || ''),
                cookies: typeof account?.cookies === 'string' ? account.cookies : JSON.stringify(account?.cookies || []),
            }))
            .filter(account => account.cookies && account.cookies !== '[]');
    } catch {
        return [];
    }
};

export const loadGlobalSettings = () => {
    const provider = localStorage.getItem(LLM_PROVIDER_STORAGE_KEY);
    return {
        llmProvider: provider === 'groq' || provider === 'openrouter' ? provider : DEFAULT_SETTINGS.llmProvider,
        imageModel: readWrapped(IMAGE_MODEL_STORAGE_KEY),
        instructions: readWrapped(INSTRUCTIONS_STORAGE_KEY),
        flowAccounts: parseFlowAccounts(readWrapped(FLOW_ACCOUNTS_STORAGE_KEY)),
        flowCookies: readWrapped(SESSION_KEY_STORAGE_KEY),
    };
};

export const saveGlobalSettings = (settings) => {
    if ('llmProvider' in settings) localStorage.setItem(LLM_PROVIDER_STORAGE_KEY, settings.llmProvider);
    if ('imageModel' in settings) writeWrapped(IMAGE_MODEL_STORAGE_KEY, (settings.imageModel || '').trim());
    if ('instructions' in settings) writeWrapped(INSTRUCTIONS_STORAGE_KEY, settings.instructions.trim());
    if ('flowCookies' in settings) writeWrapped(SESSION_KEY_STORAGE_KEY, settings.flowCookies.trim());
    if ('flowAccounts' in settings) {
        const accounts = (settings.flowAccounts || []).filter(account => account.cookies?.trim());
        writeWrapped(FLOW_ACCOUNTS_STORAGE_KEY, accounts.length ? JSON.stringify(accounts) : '');
    }
    window.dispatchEvent(new Event('global_settings_changed'));
};

/** Merge a storyboard's overrides over the dashboard defaults. */
export const resolveSettings = (globals, overrides) => {
    const resolved = { ...DEFAULT_SETTINGS, ...globals };
    Object.entries(overrides || {}).forEach(([key, value]) => {
        // Only keys the storyboard explicitly set count as overrides; anything
        // else must keep following the global default as it changes.
        if (value !== undefined && value !== null) resolved[key] = value;
    });
    return resolved;
};

export const hasOverride = (overrides, key) => {
    const value = overrides?.[key];
    return value !== undefined && value !== null;
};

/**
 * Flow accounts to actually drive image generation with. A single legacy
 * cookie blob still counts as one account so older setups keep working.
 */
export const effectiveFlowAccounts = (settings) => {
    const accounts = (settings?.flowAccounts || []).filter(account => typeof account.cookies === 'string' && account.cookies.trim());
    if (accounts.length) return accounts;
    const cookies = settings?.flowCookies?.trim();
    return cookies ? [{ name: 'Default account', cookies }] : [];
};

export const validateFlowCookies = (input) => {
    try {
        const cookies = JSON.parse(input);
        if (!Array.isArray(cookies)) throw new Error('not an array');
        if (!cookies.some(cookie => cookie && cookie.name && Object.prototype.hasOwnProperty.call(cookie, 'value'))) {
            throw new Error('no usable cookies');
        }
        return JSON.stringify(cookies);
    } catch {
        throw new Error('Paste a JSON cookie array exported from a browser signed in to Google Flow');
    }
};
