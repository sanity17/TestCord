/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Simple YouTube ad blocker for embeds
(function() {
    "use strict";

    if (window.__testcordYoutubeAdblockInjected) return;
    window.__testcordYoutubeAdblockInjected = true;

    let scheduled = false;

    // Block ad-related elements
    const blockAds = () => {
        // Hide ad containers
        const adSelectors = [
            ".video-ads",
            ".ytp-ad-module",
            ".ytp-ad-overlay-container",
            ".ytp-ad-player-overlay",
            ".ytp-ad-text",
            ".ytp-ad-preview-container",
            "ytd-player-legacy-desktop-watch-ads-renderer"
        ];

        document.querySelectorAll(adSelectors.join(",")).forEach(el => {
            el.style.display = "none";
        });

        // Skip ads if possible
        document.querySelector(".ytp-ad-skip-button, .ytp-skip-ad-button")?.click();
    };

    const scheduleBlockAds = () => {
        if (scheduled) return;

        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            blockAds();
        });
    };

    const observer = new MutationObserver(scheduleBlockAds);

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener("DOMContentLoaded", () => {
            observer.observe(document.body, { childList: true, subtree: true });
            scheduleBlockAds();
        }, { once: true });
    }

    // Run immediately and keep a low-frequency fallback for YouTube player state changes.
    blockAds();
    setInterval(scheduleBlockAds, 5000);
})();
