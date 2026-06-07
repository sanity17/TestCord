/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelToolbarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { MessageStore, showToast, Toasts } from "@webpack/common";

function CacheIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden="true" {...props}>
            <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 2v6h-3V5h3ZM5 19V9h3v10H5Zm5 0v-8h4v8h-4Z" />
            <path d="M21 13v-2h-2v2h-2v2h2v2h2v-2h2v-2h-2Z" />
        </svg>
    );
}

const settings = definePluginSettings({
    hardReset: {
        type: OptionType.BOOLEAN,
        description: "Hard reset (full page reload) instead of soft cache clear",
        default: false,
    },
});

function softReset(): string[] {
    const cleared: string[] = [];

    try {
        MessageStore.clearCache?.();
        cleared.push("Message cache");
    } catch { }

    if (typeof (window as any).gc === "function") {
        try {
            (window as any).gc();
            cleared.push("Garbage collection");
        } catch { }
    }

    return cleared;
}

function CacheResetButton() {
    const handleClick = () => {
        if (settings.store.hardReset) {
            location.reload();
            return;
        }

        const cleared = softReset();
        showToast(
            cleared.length > 0
                ? `Cache cleared: ${cleared.join(", ")}`
                : "Cache cleared",
            Toasts.Type.SUCCESS
        );
    };

    return (
        <ChannelToolbarButton
            icon={CacheIcon}
            tooltip={settings.store.hardReset ? "Hard Reset" : "Clear Cache"}
            onClick={handleClick}
        />
    );
}

export default definePlugin({
    name: "CacheResetButton",
    description: "Adds a button to clear Discord cache or hard reset to fix lag",
    tags: ["Utility", "Performance"],
    authors: [TestcordDevs.x2b],
    dependencies: ["HeaderBarAPI"],

    settings,

    headerBarButton: {
        location: "channeltoolbar",
        icon: CacheIcon,
        render: CacheResetButton,
        priority: 260,
    },
});
