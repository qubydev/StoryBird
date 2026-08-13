// One settings editor, two scopes. On the dashboard it edits the defaults every
// storyboard inherits; inside a storyboard it edits overrides that apply to
// that storyboard alone, marking which values have diverged from the defaults.
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FaBrain, FaInfoCircle, FaUsers, FaKey, FaPlus, FaTrash, FaUndo, FaCheckCircle, FaEdit, FaImage } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { validateFlowCookies, IMAGE_MODEL_OPTIONS } from '../../lib/settings';

const CUSTOM_MODEL = '__custom__';

const ImageModelPicker = ({ value, onChange }) => {
    const isKnown = IMAGE_MODEL_OPTIONS.some(option => option.value === value);
    const [custom, setCustom] = useState(!isKnown && !!value);

    return (
        <div className="space-y-2">
            <select
                value={custom ? CUSTOM_MODEL : value}
                onChange={event => {
                    if (event.target.value === CUSTOM_MODEL) {
                        setCustom(true);
                        return;
                    }
                    setCustom(false);
                    onChange(event.target.value);
                }}
                className="h-9 w-full cursor-pointer rounded-md border border-input bg-background px-3 text-sm"
            >
                {IMAGE_MODEL_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
                <option value={CUSTOM_MODEL}>Another model…</option>
            </select>

            {custom && (
                <Input
                    value={value}
                    onChange={event => onChange(event.target.value)}
                    placeholder="Type the model name exactly as Flow shows it"
                    className="h-9"
                />
            )}
        </div>
    );
};

const OverrideBadge = ({ overridden, onReset }) => {
    if (!overridden) return <span className="text-[11px] font-medium text-slate-400">Using global default</span>;
    return (
        <button type="button" onClick={onReset} className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 transition hover:bg-violet-200">
            <FaUndo className="size-2.5" /> Overridden — reset to global
        </button>
    );
};

const Field = ({ label, icon: Icon, scope, overridden, onReset, children, hint }) => (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Icon className="text-slate-400" /> {label}
            </h3>
            {scope === 'project' && <OverrideBadge overridden={overridden} onReset={onReset} />}
        </div>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
        {children}
    </section>
);

const FlowAccountsEditor = ({ accounts, onChange }) => {
    const [editingIndex, setEditingIndex] = useState(null);

    const update = (index, field, value) => {
        onChange(accounts.map((account, position) => position === index ? { ...account, [field]: value } : account));
    };

    const remove = (index) => {
        onChange(accounts.filter((_, position) => position !== index));
        setEditingIndex(current => (current === index ? null : current !== null && current > index ? current - 1 : current));
    };

    const add = () => {
        onChange([...accounts, { name: '', cookies: '' }]);
        setEditingIndex(accounts.length);
    };

    const finishEditing = (index) => {
        const account = accounts[index];
        if (account?.cookies?.trim()) {
            try {
                update(index, 'cookies', validateFlowCookies(account.cookies));
            } catch (error) {
                toast.error(error.message);
                return;
            }
        }
        setEditingIndex(null);
    };

    return (
        <div className="space-y-3">
            {accounts.map((account, index) => (
                <div key={index} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    {editingIndex === index ? (
                        <>
                            <div className="mb-2 flex min-w-0 items-center gap-2">
                                <Input value={account.name} onChange={event => update(index, 'name', event.target.value)} placeholder={`Account ${index + 1} name`} className="h-9 min-w-0" />
                                <Button type="button" size="icon" variant="ghost" onClick={() => remove(index)} className="h-9 w-9 text-red-500 hover:bg-red-50" title="Remove account">
                                    <FaTrash />
                                </Button>
                            </div>
                            <Textarea
                                value={account.cookies}
                                onChange={event => update(index, 'cookies', event.target.value)}
                                className="h-32 min-w-0 resize-y whitespace-pre-wrap break-all font-mono text-xs"
                                placeholder="Paste this account's complete exported Google cookie JSON array"
                            />
                            <div className="mt-2 flex justify-end">
                                <Button type="button" size="sm" variant="outline" onClick={() => finishEditing(index)} className="h-8 text-xs">
                                    <FaCheckCircle className="mr-1.5" /> Done
                                </Button>
                            </div>
                        </>
                    ) : (
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-800">{account.name || `Flow account ${index + 1}`}</p>
                                <p className={`mt-0.5 flex items-center gap-1.5 text-xs ${account.cookies?.trim() ? 'text-green-600' : 'text-amber-600'}`}>
                                    <FaCheckCircle /> {account.cookies?.trim() ? 'Cookies configured' : 'No cookies yet'}
                                </p>
                            </div>
                            <div className="flex shrink-0 gap-1">
                                <Button type="button" size="sm" variant="outline" onClick={() => setEditingIndex(index)} className="h-8 text-xs text-slate-600"><FaEdit className="mr-1.5" /> Edit</Button>
                                <Button type="button" size="icon" variant="ghost" onClick={() => remove(index)} className="h-8 w-8 text-red-500 hover:bg-red-50" title="Remove account">
                                    <FaTrash />
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            ))}
            <Button type="button" variant="outline" onClick={add} className="w-full border-dashed text-blue-600 hover:bg-blue-50">
                <FaPlus className="mr-2" /> Add account
            </Button>
        </div>
    );
};

/**
 * @param scope        'global' on the dashboard, 'project' inside a storyboard
 * @param values       resolved values to display
 * @param onChange     (key, value) — writes a default or an override
 * @param isOverridden (key) => boolean, project scope only
 * @param onReset      (key) => void, drops an override
 */
const SettingsPanel = ({ scope, values, onChange, isOverridden = () => false, onReset = () => {} }) => {
    const field = (key) => ({
        scope,
        overridden: isOverridden(key),
        onReset: () => onReset(key),
    });

    return (
        <div className="space-y-4">
            <Field label="LLM provider" icon={FaBrain} hint="Used for scene grouping, character detection and image prompts." {...field('llmProvider')}>
                <select
                    value={values.llmProvider}
                    onChange={event => onChange('llmProvider', event.target.value)}
                    className="h-9 w-full cursor-pointer rounded-md border border-input bg-background px-3 text-sm"
                >
                    <option value="openrouter">OpenRouter</option>
                    <option value="groq">Groq</option>
                </select>
            </Field>

            <Field
                label="Image model"
                icon={FaImage}
                hint="Picked in Flow's own model menu when each scene is generated. If Flow does not offer this model, it keeps its current one and the image is still generated."
                {...field('imageModel')}
            >
                <ImageModelPicker value={values.imageModel || ''} onChange={value => onChange('imageModel', value)} />
            </Field>

            <Field label="Prompt instructions" icon={FaInfoCircle} hint="Style, character detail and atmosphere guidance added to every image prompt." {...field('instructions')}>
                <Textarea
                    value={values.instructions}
                    onChange={event => onChange('instructions', event.target.value)}
                    className="h-32 resize-y text-sm"
                    placeholder="For example: cinematic 1920s film noir, muted colour palette, dramatic side lighting."
                />
            </Field>

            <Field label="Flow accounts" icon={FaUsers} hint="Image generation runs one job per account, so more accounts means faster runs." {...field('flowAccounts')}>
                <FlowAccountsEditor accounts={values.flowAccounts || []} onChange={accounts => onChange('flowAccounts', accounts)} />
            </Field>

            <Field label="Flow cookies (fallback)" icon={FaKey} hint="Used only when no Flow accounts are configured above." {...field('flowCookies')}>
                <Textarea
                    value={values.flowCookies}
                    onChange={event => onChange('flowCookies', event.target.value)}
                    className="h-24 resize-y whitespace-pre-wrap break-all font-mono text-xs"
                    placeholder='[{ "name": "SID", "value": "..." }]'
                />
            </Field>
        </div>
    );
};

export default SettingsPanel;
