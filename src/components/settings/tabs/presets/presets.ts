/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { PlainSettings, Settings, SettingsStore } from "@api/Settings";
import { debounce } from "@shared/debounce";

export type ScopeKey = "plugins" | "themes" | "quickCss" | "dataStore";

export interface Preset {
    name: string;
    createdAt: number;
    // Full slice of settings.plugins: { [plugin]: { enabled, ...pluginSettings } }.
    // We keep the whole slice so apply can optionally restore tuned settings, not
    // just the on/off map.
    plugins: Record<string, { enabled: boolean;[setting: string]: any; }>;
    // Enabled theme filenames only. On apply we enable the ones that exist
    // locally and report any that are missing — we never write theme files.
    themes?: string[];
    // Raw QuickCSS text.
    quickCss?: string;
    // DataStore entries (key -> arbitrary value). May be large/sensitive.
    dataStore?: Record<string, any>;
    // Which scopes this preset actually captured (drives the apply path).
    // Absent => legacy preset, treated as plugins-only.
    scope?: ScopeKey[];
    // undefined = follow the global restore-on-apply default; true/false = override.
    restoreSettings?: boolean;
    // when true, this preset auto-resnapshots to current config on every settings change.
    // Live-backup tracks PLUGINS ONLY; other scopes are captured only at explicit save.
    liveBackup?: boolean;
}

type PresetStore = Record<string, Preset>;

// Presets live in their own native file at the shared (prod-level) dir so they
// persist across build flags (dev/prod/standalone), unlike settings.json which is
// per-build. We mirror the file in an in-memory cache: hydrate once via
// loadPresets(), every mutator writes the cache then persists it to disk.
let cache: PresetStore = {};
let hydrated = false;

const store = () => cache;
const persist = () => { VencordNative.presets.set(cache); };
// ponytail: 500ms debounce, fine for a settings file — coalesces bursts of changes.
const persistDebounced = debounce(persist, 500);

// Global restore-on-apply default. A UI preference, so the per-build renderer
// Settings is fine (only the presets themselves needed to be build-independent).
export const getRestoreDefault = () => Boolean((Settings as any).presetsRestoreDefault);
export const setRestoreDefault = (v: boolean) => { (Settings as any).presetsRestoreDefault = v; };

// UI preference: hide the per-row Duplicate button. Renderer Settings is fine
// (cosmetic, doesn't need to be build-independent like the presets themselves).
export const getHideDuplicate = () => Boolean((Settings as any).presetsHideDuplicate);
export const setHideDuplicate = (v: boolean) => { (Settings as any).presetsHideDuplicate = v; };

// Animation preferences. A master switch plus one flag per animated component.
// All default ON (undefined -> true) so existing behavior is preserved until the
// user opts out. Stored in renderer Settings (cosmetic, per-build is fine).
export const ANIM_KEYS = ["rowHover", "tabUnderline", "badgePulse", "fadeIn", "buttons", "gear", "jsonHover"] as const;
export type AnimKey = typeof ANIM_KEYS[number];

export const ANIM_LABELS: Record<AnimKey, { title: string; description: string; }> = {
    rowHover: { title: "Preset row hover", description: "The accent rail that slides in and the card lift when hovering a preset." },
    tabUnderline: { title: "Tab underline slide", description: "The sliding underline under the active tab in the preset modal." },
    badgePulse: { title: "Live badge pulse", description: "The pulsing dot on the 'live' badge." },
    fadeIn: { title: "Panel & row fade-ins", description: "Fade-in when switching modal tabs and when the Duplicate row appears/disappears." },
    buttons: { title: "Button hover & press", description: "Lift, glow and press-scale on all buttons." },
    gear: { title: "Gear icon rotate", description: "The settings gear rotating on hover." },
    jsonHover: { title: "JSON box hover", description: "The border/background highlight on the JSON editor box." },
};

// undefined (unset) = on. Only an explicit false disables.
export const getAnimMaster = () => (Settings as any).presetsAnimMaster !== false;
export const setAnimMaster = (v: boolean) => { (Settings as any).presetsAnimMaster = v; };

export const getAnim = (key: AnimKey) => (Settings as any)[`presetsAnim_${key}`] !== false;
export const setAnim = (key: AnimKey, v: boolean) => { (Settings as any)[`presetsAnim_${key}`] = v; };

// Live-backup engine: one global listener. Any preset flagged liveBackup re-snapshots
// itself whenever a plugin is toggled or a plugin setting changes, so it mirrors "now."
let liveBackupRegistered = false;
function ensureLiveBackup() {
    if (liveBackupRegistered) return;
    liveBackupRegistered = true;
    SettingsStore.addGlobalChangeListener((_, path) => {
        if (!path.startsWith("plugins.")) return;
        let dirty = false;
        for (const p of Object.values(cache)) {
            if (p.liveBackup) {
                p.plugins = structuredClone(PlainSettings.plugins);
                dirty = true;
            }
        }
        if (dirty) persistDebounced();
    });
}

/**
 * Load presets from the native file into the cache (called once on tab mount).
 * One-shot migration: if the shared file is empty but the old per-build
 * Settings.presets has data, carry it over so existing presets aren't stranded.
 * ponytail: migration guard, drop it once everyone's presets have moved.
 */
export async function loadPresets(): Promise<void> {
    if (hydrated) return;
    cache = (await VencordNative.presets.get()) ?? {};

    const legacy = (Settings as any).presets as PresetStore | undefined;
    if (Object.keys(cache).length === 0 && legacy && Object.keys(legacy).length > 0) {
        cache = structuredClone(legacy);
        persist();
    }
    hydrated = true;
    ensureLiveBackup();
}

export function setPresetRestore(name: string, value: boolean | undefined): void {
    const p = store()[name];
    if (!p) return;
    if (value === undefined) delete p.restoreSettings;
    else p.restoreSettings = value;
    persist();
}

export function setPresetLiveBackup(name: string, value: boolean): void {
    const p = store()[name];
    if (!p) return;
    p.liveBackup = value;
    // Snapshot immediately on enable so it starts in sync, not stale.
    if (value) p.plugins = structuredClone(PlainSettings.plugins);
    persist();
}

export function listPresets(): Preset[] {
    return Object.values(store()).sort((a, b) => b.createdAt - a.createdAt);
}

export function hasPreset(name: string): boolean {
    return name in store();
}


/**
 * Snapshot the current config into a named preset (overwrites same name).
 * `scope` selects what to capture; defaults to plugins-only for back-compat.
 * Async because themes/QuickCSS/DataStore reads cross the native bridge.
 */
export async function savePreset(name: string, createdAt: number, scope: ScopeKey[] = ["plugins"]): Promise<void> {
    const preset: Preset = { name, createdAt, plugins: {}, scope: [...scope] };

    if (scope.includes("plugins")) {
        // Deep-clone via PlainSettings so the stored preset doesn't alias the live proxy.
        preset.plugins = structuredClone(PlainSettings.plugins);
    }
    if (scope.includes("themes")) {
        preset.themes = [...((Settings as any).enabledThemes ?? [])];
    }
    if (scope.includes("quickCss")) {
        preset.quickCss = await VencordNative.quickCss.get().catch(() => "");
    }
    if (scope.includes("dataStore")) {
        const entries = await DataStore.entries().catch(() => [] as [IDBValidKey, any][]);
        preset.dataStore = Object.fromEntries(entries.map(([k, v]) => [String(k), v]));
    }

    store()[name] = preset;
    persist();
}

export function deletePreset(name: string): void {
    delete store()[name];
    persist();
}

export function renamePreset(from: string, to: string): void {
    const s = store();
    if (!s[from] || from === to) return;
    s[to] = { ...s[from], name: to };
    delete s[from];
    persist();
}

export function duplicatePreset(name: string, copyName: string, createdAt: number): void {
    const s = store();
    const src = s[name];
    if (!src) return;
    // structuredClone the whole preset so themes/quickCss/dataStore copy too.
    s[copyName] = { ...structuredClone(src), name: copyName, createdAt };
    delete s[copyName].liveBackup; // a copy shouldn't inherit live-tracking
    persist();
}

/** Which scopes a preset captured; legacy presets (no scope) are plugins-only. */
export function presetScope(preset: Preset): ScopeKey[] {
    return preset.scope ?? ["plugins"];
}

export interface ApplyResult {
    changed: boolean;
    // Theme names the preset wanted but that don't exist locally (skipped).
    missingThemes: string[];
}

/**
 * Apply a preset back onto live config. Restores every scope the preset captured:
 * - plugins: always writes `enabled`; if `restoreSettings`, the full settings slice.
 * - themes: enables stored theme names that EXIST locally; missing ones are
 *   skipped and returned in `missingThemes` (we never create theme files).
 * - quickCss / dataStore: overwrites wholesale.
 * Async because themes/QuickCSS/DataStore reads/writes cross the native bridge.
 */
export async function applyPreset(name: string, restoreSettings: boolean): Promise<ApplyResult> {
    const preset = store()[name];
    if (!preset) return { changed: false, missingThemes: [] };
    const scope = presetScope(preset);
    let changed = false;
    const missingThemes: string[] = [];

    if (scope.includes("plugins")) {
        for (const [plugin, saved] of Object.entries(preset.plugins)) {
            const current = (Settings.plugins[plugin] ??= { enabled: false });
            if (restoreSettings) Settings.plugins[plugin] = structuredClone(saved);
            else current.enabled = saved.enabled;
        }
        changed = true;
    }
    if (scope.includes("themes") && preset.themes) {
        const list = await VencordNative.themes.getThemesList().catch(() => [] as { fileName: string; content: string; }[]);
        const present = new Set(list.map(t => t.fileName));
        const toEnable: string[] = [];
        for (const themeName of preset.themes) {
            if (present.has(themeName)) toEnable.push(themeName);
            else missingThemes.push(themeName);
        }
        (Settings as any).enabledThemes = toEnable;
        changed = true;
    }
    if (scope.includes("quickCss") && preset.quickCss !== undefined) {
        await VencordNative.quickCss.set(preset.quickCss).catch(() => { });
        changed = true;
    }
    if (scope.includes("dataStore") && preset.dataStore) {
        for (const [k, v] of Object.entries(preset.dataStore)) {
            await DataStore.set(k, v).catch(() => { });
        }
        changed = true;
    }
    return { changed, missingThemes };
}

/** Serialize one preset to a shareable string. */
export function exportPreset(name: string): string | null {
    const preset = store()[name];
    if (!preset) return null;
    return JSON.stringify(preset, null, 4);
}

/** Serialize every preset to one blob (Export all). */
export function exportAllPresets(): string {
    return JSON.stringify(store(), null, 4);
}

export function getPreset(name: string): Preset | undefined {
    return store()[name];
}

/** Shape check shared by import + manual edit. Returns the parsed preset or null. */
export function validatePreset(obj: any): Preset | null {
    if (!obj || typeof obj.name !== "string" || !obj.name || typeof obj.plugins !== "object" || !obj.plugins) {
        return null;
    }
    return obj as Preset;
}

/** Coerce an arbitrary parsed object into a clean Preset (drops junk fields). */
function sanitize(parsed: Preset, name: string): Preset {
    const clean: Preset = {
        name,
        createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : 0,
        plugins: parsed.plugins && typeof parsed.plugins === "object" ? structuredClone(parsed.plugins) : {},
    };
    if (Array.isArray(parsed.themes)) clean.themes = parsed.themes.filter((t: any) => typeof t === "string");
    if (typeof parsed.quickCss === "string") clean.quickCss = parsed.quickCss;
    if (parsed.dataStore && typeof parsed.dataStore === "object") clean.dataStore = structuredClone(parsed.dataStore);
    if (Array.isArray(parsed.scope)) {
        const valid = parsed.scope.filter((s: any): s is ScopeKey => ["plugins", "themes", "quickCss", "dataStore"].includes(s));
        if (valid.length) clean.scope = valid;
    }
    if (typeof parsed.restoreSettings === "boolean") clean.restoreSettings = parsed.restoreSettings;
    if (parsed.liveBackup === true) clean.liveBackup = true;
    return clean;
}

/**
 * Store an already-parsed preset object. Returns the stored name, or null if the
 * object is malformed. Without an overrideName, an existing name is suffixed
 * " (imported)"; an overrideName is used verbatim (and overwrites a clash).
 */
export function importPresetObject(parsed: any, overrideName?: string): string | null {
    const valid = validatePreset(parsed);
    if (!valid) return null;

    const s = store();
    let name = overrideName?.trim() || valid.name;
    if (!overrideName && name in s) name = `${name} (imported)`;

    s[name] = sanitize(valid, name);
    persist();
    return name;
}

/** Parse a shared preset string and store it. Returns the stored name, or null. */
export function importPreset(raw: string): string | null {
    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    return importPresetObject(parsed);
}

/**
 * Replace a preset from hand-edited JSON. Validates on save. If the edited JSON's
 * name differs: moves to the new key unless it's already taken (then returns null).
 * Returns the stored name, or null on parse/validation/name-clash failure.
 */
export function updatePresetRaw(original: string, raw: string): string | null {
    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    const valid = validatePreset(parsed);
    if (!valid) return null;

    const s = store();
    const newName = valid.name;
    if (newName !== original && newName in s) return null; // refuse to clobber a different preset

    if (newName !== original) delete s[original];
    s[newName] = sanitize(valid, newName);
    persist();
    return newName;
}
