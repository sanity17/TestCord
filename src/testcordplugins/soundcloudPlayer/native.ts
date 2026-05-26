/*
 * Equicord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * SoundCloud Player — native.ts (main process Electron)
 *
 * All HTTP requests go through Electron's net.fetch to
 * bypass Discord's CSP which blocks fetch() from the renderer.
 */

import { IpcMainInvokeEvent, net } from "electron";

// ─── Fetch via Electron's net.fetch ──────────────────────────────────────────

async function netGet(url: string, headers?: Record<string, string>): Promise<string> {
    const resp = await net.fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Referer": "https://soundcloud.com/",
            ...(headers ?? {}),
        }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.text();
}

// ─── Dynamic SoundCloud client_id fetch ─────────────────────────────────
// Same logic as sc_fetch_client_id / sc_parse_js_for_clientid in C:
//   Step 1: GET soundcloud.com → extract <script src="...">
//   Step 2: GET the last JS bundle → look for client_id:"XXXXXXXX"

export async function fetchSoundCloudClientId(_: IpcMainInvokeEvent): Promise<string | null> {
    try {
        // Step 1: load soundcloud.com
        const html = await netGet("https://soundcloud.com/", {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        });

        // Extract JS bundle URLs
        const scriptUrls: string[] = [];
        const re = /<script[^>]+src="(https:\/\/[^"]+\.js[^"]*)"[^>]*>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) {
            const url = m[1];
            if (!url.includes("cookielaw") && !url.includes("analytics") && !url.includes("st-f"))
                scriptUrls.push(url);
        }

        if (scriptUrls.length === 0) return null;

        // Step 2: test JS bundles (look in the most recent ones)
        for (const jsUrl of scriptUrls.slice(-5).reverse()) {
            try {
                const js = await netGet(jsUrl);

                // Patterns updated for 2024/2025
                const patterns = [
                    /client_id\s*:\s*"([a-zA-Z0-9]{32})"/,
                    /client_id\s*=\s*"([a-zA-Z0-9]{32})"/,
                    /client_id\s*:\s*'([a-zA-Z0-9]{32})'/,
                    /client_id\s*=\s*'([a-zA-Z0-9]{32})'/,
                    /"client_id"\s*:\s*"([a-zA-Z0-9]{32})"/,
                ];
                for (const pat of patterns) {
                    const match = js.match(pat);
                    if (match?.[1]) return match[1];
                }
            } catch { /* try the next one */ }
        }

        return null;
    } catch (e: any) {
        console.error("[SoundCloudPlayer] fetchClientId error:", e?.message);
        return null;
    }
}

// ─── Track search ──────────────────────────────────────────────────────

export async function searchSoundCloud(
    _: IpcMainInvokeEvent,
    query: string,
    clientId: string
): Promise<string | null> {
    try {
        const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=20`;
        return await netGet(url);
    } catch (e: any) {
        // Return the HTTP code to detect client_id expiration
        throw new Error(e?.message ?? String(e));
    }
}

// ─── Stream URL resolution ───────────────────────────────────────────

export async function resolveStreamUrl(_: IpcMainInvokeEvent, url: string, clientId: string): Promise<string | null> {
    try {
        // Add client_id to the stream URL if missing
        const streamUrl = new URL(url);
        streamUrl.searchParams.set("client_id", clientId);

        // Do a manual fetch following redirects to get the final URL
        const resp = await net.fetch(streamUrl.toString(), {
            redirect: "follow",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Referer": "https://soundcloud.com/",
            }
        });

        if (!resp.ok) {
            console.error(`[SoundCloudNative] Stream resolution failed: ${resp.status}`);
            return null;
        }

        // If it's an HLS stream (m3u8), the API returns a JSON containing the real URL
        const text = await resp.text();
        try {
            const json = JSON.parse(text);
            return json.url || null;
        } catch {
            // If it's not JSON, it might already be the direct URL (rare case)
            return resp.url;
        }
    } catch (e: any) {
        console.error("[SoundCloudNative] resolveStreamUrl error:", e?.message);
        return null;
    }
}

export async function resolveTrack(
    _: IpcMainInvokeEvent,
    trackId: string,
    clientId: string
): Promise<string | null> {
    try {
        const url = `https://api-v2.soundcloud.com/tracks/${trackId}?client_id=${clientId}`;
        return await netGet(url);
    } catch (e: any) {
        throw new Error(e?.message ?? String(e));
    }
}
