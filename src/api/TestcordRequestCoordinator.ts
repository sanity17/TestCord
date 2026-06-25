/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { sleep } from "@utils/misc";

export interface CoordinatedRequestOptions<T> {
    key: string;
    run: () => Promise<T>;
    ttlMs?: number;
    scope?: string;
    minDelayMs?: number;
    cacheable?: (value: T) => boolean;
}

interface CacheEntry {
    expiresAt: number;
    value: unknown;
}

const inFlight = new Map<string, Promise<unknown>>();
const cache = new Map<string, CacheEntry>();
const scopeChains = new Map<string, Promise<void>>();

function isEnabled(): boolean {
    return Settings.plugins.TestcordHelper?.CarefulNetwork === true;
}

async function waitForScope(scope: string, minDelayMs: number): Promise<void> {
    const previous = scopeChains.get(scope) ?? Promise.resolve();
    const next = previous.then(() => sleep(minDelayMs), () => sleep(minDelayMs));
    scopeChains.set(scope, next);
    await next;
    if (scopeChains.get(scope) === next) scopeChains.delete(scope);
}

export async function request<T>({ key, run, ttlMs, scope, minDelayMs, cacheable }: CoordinatedRequestOptions<T>): Promise<T> {
    if (!isEnabled()) return await run();

    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;

    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = (async () => {
        if (scope && minDelayMs) await waitForScope(scope, minDelayMs);
        const value = await run();
        if (ttlMs && (cacheable?.(value) ?? value != null)) {
            cache.set(key, { expiresAt: Date.now() + ttlMs, value });
        }
        return value;
    })();

    inFlight.set(key, promise);
    try {
        return await promise;
    } finally {
        inFlight.delete(key);
    }
}

export function invalidate(key: string): void {
    if (!isEnabled()) return;
    cache.delete(key);
    inFlight.delete(key);
}

export function invalidatePrefix(prefix: string): void {
    if (!isEnabled()) return;
    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key);
    }

    for (const key of inFlight.keys()) {
        if (key.startsWith(prefix)) inFlight.delete(key);
    }
}
