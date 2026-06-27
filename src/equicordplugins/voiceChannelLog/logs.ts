/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { VoiceChannelLogEntry } from "./types";

const MAX_LOG_ENTRIES = 1000;

const vcLogs = new Map<string, VoiceChannelLogEntry[]>();
// Cached snapshots keyed by channelId. useSyncExternalStore compares snapshots by
// reference identity, so getVcLogs must return a stable reference between changes
// and a fresh reference after each mutation. We mutate the live array in place
// (O(1) append instead of an O(n) spread copy) and invalidate the snapshot here.
const vcLogSnapshots = new Map<string, VoiceChannelLogEntry[]>();
let vcLogSubscriptions: (() => void)[] = [];

let callStartTime: Date | null = null;

export function getCallStartTime(): Date | null {
    return callStartTime;
}

export function setCallStartTime(time: Date | null) {
    callStartTime = time;
}

const EMPTY_LOGS: VoiceChannelLogEntry[] = [];

export function getVcLogs(channelId?: string): VoiceChannelLogEntry[] {
    if (!channelId) return EMPTY_LOGS;
    let snapshot = vcLogSnapshots.get(channelId);
    if (!snapshot) {
        const live = vcLogs.get(channelId);
        snapshot = live ? live.slice() : EMPTY_LOGS;
        vcLogSnapshots.set(channelId, snapshot);
    }
    return snapshot;
}

export function addLogEntry(entry: VoiceChannelLogEntry) {
    let arr = vcLogs.get(entry.channelId);
    if (!arr) {
        arr = [];
        vcLogs.set(entry.channelId, arr);
    }
    arr.push(entry);
    if (arr.length > MAX_LOG_ENTRIES) arr.splice(0, arr.length - MAX_LOG_ENTRIES);
    // Invalidate the cached snapshot so the next getVcLogs returns a fresh reference.
    vcLogSnapshots.delete(entry.channelId);
    vcLogSubscriptions.forEach(fn => fn());
}

export function clearLogs(channelId?: string) {
    if (!channelId) return;
    vcLogs.set(channelId, []);
    vcLogSnapshots.delete(channelId);
    vcLogSubscriptions.forEach(fn => fn());
}

export function clearAllLogs() {
    vcLogs.clear();
    vcLogSnapshots.clear();
    vcLogSubscriptions.forEach(fn => fn());
}

export function vcLogSubscribe(listener: () => void) {
    vcLogSubscriptions = [...vcLogSubscriptions, listener];
    return () => {
        vcLogSubscriptions = vcLogSubscriptions.filter(l => l !== listener);
    };
}
