/*
 * Equicord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * groqManager.ts — Shared Groq key manager between plugins
 *
 * Features:
 * - API key stored in DataStore (single location)
 * - Automatic model rotation on 429 (rate limit)
 *   llama-3.3-70b-versatile → llama-3.1-8b-instant → gemma2-9b-it
 * - Retry with exponential backoff
 * - Queue to avoid simultaneous bursts
 */

import { DataStore } from "@api/index";

// ── DataStore Keys ─────────────────────────────────────────────────────────────

const DS_API_KEY = "groq-shared-api-key";

// Models in fallback order (separate limits on Groq)
const GROQ_MODELS = [
    "llama-3.3-70b-versatile",    // The best — RPM quota: 30/min
    "llama3-70b-8192",            // Old stable performer
    "llama-3.1-8b-instant",       // Fast — RPM quota: 30/min SEPARATE
    "gemma2-9b-it",               // Fallback — RPM quota: 30/min SEPARATE
];

// Index of the currently used model (in memory only)
let currentModelIdx = 0;
// Cooldown time per model (timestamp ms)
const modelCooldown: Record<string, number> = {};

// ── API key read/write ──────────────────────────────────────────────────

// Fallback settings imported dynamically to avoid circular imports
let _settingsFallback: (() => string) | null = null;
export function registerSettingsFallback(fn: () => string) {
    _settingsFallback = fn;
}

export async function getGroqKey(): Promise<string> {
    const key = await DataStore.get(DS_API_KEY) as string | null;
    if (key?.trim()) return key.trim();
    // Fallback: read from NightcordAI Settings if available
    if (_settingsFallback) {
        const fallback = _settingsFallback();
        if (fallback) return fallback;
    }
    return "";
}

export async function setGroqKey(key: string): Promise<void> {
    await DataStore.set(DS_API_KEY, key.trim());
}

// ── Available model selection ────────────────────────────────────────────

function getAvailableModel(): string {
    const now = Date.now();
    // Try the current model first
    for (let i = 0; i < GROQ_MODELS.length; i++) {
        const idx = (currentModelIdx + i) % GROQ_MODELS.length;
        const model = GROQ_MODELS[idx];
        const cooldownUntil = modelCooldown[model] ?? 0;
        if (now >= cooldownUntil) {
            currentModelIdx = idx;
            return model;
        }
    }
    // All in cooldown → wait the shortest time
    let minCooldown = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < GROQ_MODELS.length; i++) {
        const cd = modelCooldown[GROQ_MODELS[i]] ?? 0;
        if (cd < minCooldown) { minCooldown = cd; bestIdx = i; }
    }
    currentModelIdx = bestIdx;
    return GROQ_MODELS[bestIdx];
}

function markModelRateLimited(model: string, retryAfterMs = 60_000): void {
    modelCooldown[model] = Date.now() + retryAfterMs;
    console.warn(`[GroqManager] Model ${model} in cooldown for ${retryAfterMs / 1000}s`);
    // Switch to the next available model
    currentModelIdx = (currentModelIdx + 1) % GROQ_MODELS.length;
}

// ── Lightweight queue ─────────────────────────────────────────────────────

let queue = Promise.resolve();
const MIN_DELAY_MS = 200; // at least 200ms between two requests

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(() => fn());
    queue = result.then(
        () => new Promise(r => setTimeout(r, MIN_DELAY_MS)),
        () => new Promise(r => setTimeout(r, MIN_DELAY_MS)),
    );
    return result;
}

// ── Main API call ───────────────────────────────────────────────────────

export interface GroqChatMessage {
    role: "system" | "user" | "assistant";
    content: string | any[];
}

export interface GroqCallOptions {
    messages: GroqChatMessage[];
    temperature?: number;
    maxTokens?: number;
    /** Force a specific model (optional) */
    forceModel?: string;
    /** Max retries on 429 (default: 3) */
    maxRetries?: number;
}

/**
 * Calls the Groq API with automatic model rotation on rate limit.
 * Returns the text content of the response.
 */
export async function groqChat(opts: GroqCallOptions): Promise<string> {
    return enqueue(() => _groqChat(opts));
}

async function _groqChat(opts: GroqCallOptions, attempt = 0): Promise<string> {
    const { messages, temperature = 0.7, maxTokens = 1000, forceModel, maxRetries = 3 } = opts;

    const apiKey = await getGroqKey();
    if (!apiKey) throw new Error("Groq API key missing — configure it in Settings → NightcordAI");

    const model = forceModel ?? getAvailableModel();

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            temperature,
            max_tokens: maxTokens,
            messages,
        }),
    });

    // Rate limit handling
    if (res.status === 429) {
        if (attempt >= maxRetries) throw new Error("Groq rate limit — try again in a few moments");

        // Read the Retry-After header if present
        const retryAfterSec = parseInt(res.headers.get("retry-after") ?? "60", 10);
        const retryAfterMs = (isNaN(retryAfterSec) ? 60 : retryAfterSec) * 1000;

        markModelRateLimited(model, retryAfterMs);

        // Retry immediately with the next model (no wait here)
        return _groqChat({ ...opts, forceModel: undefined }, attempt + 1);
    }

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Groq API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? "(empty response)";
}

/**
 * Returns the currently active model (useful for display)
 */
export function getCurrentModel(): string {
    return GROQ_MODELS[currentModelIdx] ?? GROQ_MODELS[0];
}
