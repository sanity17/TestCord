/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { disableCacheLimits, resetCacheLimits } from "@utils/cacheLimits";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findAll, findByPropsLazy } from "@webpack";

const logger = new Logger("OptimizerPremium");

const THROTTLED_CLASS_TOKENS = ["activity", "subText", "botText", "clanTag"] as const;

const settings = definePluginSettings({
    domThrottle: {
        type: OptionType.BOOLEAN,
        description: "Defer non-critical visual updates (activity, subText, botText, clan tags) via MutationObserver. Safe — does not patch appendChild.",
        default: true
    },
    domThrottleDelay: {
        type: OptionType.SLIDER,
        description: "Delay in ms applied to throttled DOM updates. Higher delays free more CPU but make those UI bits update slower.",
        markers: [25, 50, 100, 150, 250, 500],
        default: 100,
        stickToMarkers: false
    },
    disableSpringAnimations: {
        type: OptionType.BOOLEAN,
        description: "Skip all react-spring animations across the client. Major responsiveness boost on low-end machines.",
        default: false
    },
    animationFrameReduction: {
        type: OptionType.SLIDER,
        description: "Drop frames from requestAnimationFrame. 0 disables, higher values skip more frames.",
        markers: [0, 25, 50, 75, 100],
        default: 0
    },
    networkCache: {
        type: OptionType.BOOLEAN,
        description: "Cache static image responses (png, jpg, webp, gif) in memory to cut redundant fetches. Bounded by entry count and TTL.",
        default: true
    },
    networkCacheMinutes: {
        type: OptionType.SLIDER,
        description: "How long, in minutes, the network cache keeps entries before evicting them.",
        markers: [1, 5, 10, 15, 30, 60],
        default: 5,
        stickToMarkers: false
    },
    networkCacheMaxEntries: {
        type: OptionType.SLIDER,
        description: "Hard cap on cached image entries. Oldest entries are evicted first when exceeded.",
        markers: [50, 100, 200, 500, 1000],
        default: 200,
        stickToMarkers: false
    },
    forceLowImageQuality: {
        type: OptionType.BOOLEAN,
        description: "Rewrite Discord CDN image URLs to request smaller sizes. Saves bandwidth and decode cost.",
        default: false
    },
    pauseOffscreenMedia: {
        type: OptionType.BOOLEAN,
        description: "Auto-pause videos and animated content that scroll out of view.",
        default: true
    },
    memoryManagement: {
        type: OptionType.BOOLEAN,
        description: "Periodically check JS heap pressure and trim caches when usage is high. Requires Chromium performance.memory.",
        default: true
    },
    memoryCheckSeconds: {
        type: OptionType.SLIDER,
        description: "Seconds between memory pressure checks.",
        markers: [10, 30, 60, 120, 300],
        default: 30,
        stickToMarkers: false
    },
    optimizeTooltips: {
        type: OptionType.BOOLEAN,
        description: "Skip the unnecessary flushSync inside Discord's tooltip module. Smoother tooltip transitions.",
        default: true,
        restartNeeded: true
    },
    optimizeEmojiCache: {
        type: OptionType.BOOLEAN,
        description: "Cache repeat emoji-pack getter calls to avoid re-walking emoji lists on every render.",
        default: true,
        restartNeeded: true
    },
    killLoadingSpinner: {
        type: OptionType.BOOLEAN,
        description: "Strip the app loading spinner. It's pretty but it has measurable cost.",
        default: true,
        restartNeeded: true
    },
    killConfettiCanvas: {
        type: OptionType.BOOLEAN,
        description: "Remove the SpriteCanvas used for confetti, particles and similar visual effects.",
        default: true,
        restartNeeded: true
    },
    killGatewayAnalytics: {
        type: OptionType.BOOLEAN,
        description: "Drop the analytics flush block that JSON.stringifies the gateway READY payload.",
        default: true,
        restartNeeded: true
    },
    virtualizeMessages: {
        type: OptionType.BOOLEAN,
        description: "Apply CSS containment to messages so the browser skips work on offscreen rows.",
        default: true
    },
    optimizeTextRendering: {
        type: OptionType.BOOLEAN,
        description: "Apply optimizeSpeed text-rendering on message content. Faster text layout on large channels.",
        default: true
    },
    killBackdropBlur: {
        type: OptionType.BOOLEAN,
        description: "Strip backdrop-filter blur effects (popouts, modals, overlays). Massive GPU win on integrated graphics.",
        default: false
    },
    forcePassiveListeners: {
        type: OptionType.BOOLEAN,
        description: "Force wheel, touchstart, touchmove and mousewheel listeners to passive mode. Reduces scroll input lag.",
        default: true
    },
    suppressConsoleSpam: {
        type: OptionType.BOOLEAN,
        description: "Suppress Discord's noisy console.log/debug output. Console.error and console.warn still pass through.",
        default: true
    },
    freezeGifsUntilHover: {
        type: OptionType.BOOLEAN,
        description: "Freeze animated GIFs using canvas capture (shows first frame, plays on hover). More precise but uses per-image canvas overhead.",
        default: false
    },
    gifFreezeMethod: {
        type: OptionType.SELECT,
        description: "GIF freeze method. Canvas captures first frame, CSS hides until hover (more efficient but shows blank space before hover).",
        options: [
            { label: "Canvas (first frame preview)", value: "canvas", default: true },
            { label: "CSS content-visibility (more efficient)", value: "css" },
        ],
        disabled: () => !settings.store.freezeGifsUntilHover,
    },
    throttleResizeObservers: {
        type: OptionType.BOOLEAN,
        description: "Coalesce ResizeObserver callbacks via rAF. Prevents layout thrash during window resize and dynamic UI changes.",
        default: true,
        restartNeeded: true
    },
    reduceMotion: {
        type: OptionType.BOOLEAN,
        description: "Apply prefers-reduced-motion globally. Disables transitions and CSS animations.",
        default: false
    },
    killWillChange: {
        type: OptionType.BOOLEAN,
        description: "Strip will-change hints Discord scatters around. Reduces GPU memory and layer explosions.",
        default: true
    },
    lazyEmbedImages: {
        type: OptionType.BOOLEAN,
        description: "Force loading=lazy and decoding=async on every embed/attachment image.",
        default: true
    },
    disableTypingIndicator: {
        type: OptionType.BOOLEAN,
        description: "Hide the 'X is typing...' indicator. The animated dots cause continuous repaints.",
        default: false
    },
    verboseLogging: {
        type: OptionType.BOOLEAN,
        description: "Log optimization activity to the console. Disable for production.",
        default: false
    },
    cacheLimitsEnabled: {
        type: OptionType.BOOLEAN,
        description: "Cap internal plugin caches (diffs, translations, ZIP previews, logged messages, voice stats) to prevent unbounded memory growth. Disable if you have RAM to spare and want maximum cache hit rate.",
        default: true
    },
    debounceScrollHandlers: {
        type: OptionType.BOOLEAN,
        description: "Debounce scroll event handlers to prevent excessive scroll-triggered updates. WARNING: May cause issues.",
        default: false,
        restartNeeded: true,
        hidden: true
    },
    lazyIframes: {
        type: OptionType.BOOLEAN,
        description: "Defer iframe loading until they scroll into view. Reduces initial page load cost. hcaptcha iframes are excluded to prevent breaking verification.",
        default: true
    },
    disableAnimatedHeaders: {
        type: OptionType.BOOLEAN,
        description: "Remove animated gradient effects in header areas. Pure cosmetic, big GPU savings.",
        default: false
    },
    optimizeImageDecoding: {
        type: OptionType.BOOLEAN,
        description: "Force images to decode asynchronously and preload critical images. Smoother first paint.",
        default: true
    },
    throttleMutationObservers: {
        type: OptionType.BOOLEAN,
        description: "Consolidate multiple MutationObservers into a single shared observer with priority dispatch.",
        default: true,
        restartNeeded: true
    },
    suppressReactionAnimations: {
        type: OptionType.BOOLEAN,
        description: "Strip entrance/exit animations from reaction buttons. Those pop/glow transitions cause layout on every reaction add.",
        default: true,
        restartNeeded: true
    },
    messageContentVisibility: {
        type: OptionType.BOOLEAN,
        description: "Apply content-visibility: auto on message list items so the browser skips layout/paint for offscreen messages entirely. Stronger than contain.",
        default: false
    },
    suppressEmbedPreviews: {
        type: OptionType.BOOLEAN,
        description: "Stop link preview (embed) auto-generation from the client side. Reduces network and DOM cost. Actual link previews from other users still show.",
        default: false,
        restartNeeded: true
    },
    disableAnimatedEmoji: {
        type: OptionType.BOOLEAN,
        description: "Force all emoji to render as static. Cuts continuous re-decode of animated emoji in active channels.",
        default: false
    },
    limitConcurrentRequests: {
        type: OptionType.SLIDER,
        description: "Cap concurrent network requests. 0 = unlimited. Prevents browser connection throttling from saturating the limit.",
        markers: [0, 6, 12, 24, 50],
        default: 0,
        stickToMarkers: false
    },
    suppressGifAutoplay: {
        type: OptionType.BOOLEAN,
        description: "Prevent GIFs in embeds from autoplaying. Only plays when you hover the embed. Cuts decode CPU dramatically.",
        default: false
    },
    debounceFluxMessages: {
        type: OptionType.SLIDER,
        description: "Debounce MESSAGE_CREATE dispatches by this many ms. 0 = no debounce. Helpful in very active channels — messages batch into fewer renders.",
        markers: [0, 50, 100, 200, 500],
        default: 0,
        stickToMarkers: false
    },

    // --- Advanced CSS optimizations ---

    containMemberList: {
        type: OptionType.BOOLEAN,
        description: "Apply content-visibility and layout containment to the member list. Offscreen members skip layout and paint entirely. Best in large servers.",
        default: false
    },
    containServerList: {
        type: OptionType.BOOLEAN,
        description: "Apply layout containment to the server/guild list. Reduces layout cost from avatar position changes.",
        default: false
    },
    hideVoicePanel: {
        type: OptionType.BOOLEAN,
        description: "Hide the voice channel status/activity panel in the channel list. Saves DOM update cost from voice state changes.",
        default: false
    },
    hideActivityPanel: {
        type: OptionType.BOOLEAN,
        description: "Hide the 'Now Playing' game activity panel at the bottom of the channel list. Stops constant game-status repaints.",
        default: false
    },
    hideServerBanner: {
        type: OptionType.BOOLEAN,
        description: "Hide the server banner image at the top of the channel list. Saves image decode and paint cost.",
        default: false
    },
    hideAvatarDecorations: {
        type: OptionType.BOOLEAN,
        description: "Hide avatar decorations (nitro profile customisation). Saves image decode for each decorated avatar in view.",
        default: false
    },
    suppressProfileEffects: {
        type: OptionType.BOOLEAN,
        description: "Hide animated profile effects. Cuts GPU compositing cost from profile backgrounds.",
        default: false
    },
    hideServerBoosting: {
        type: OptionType.BOOLEAN,
        description: "Hide the server boost progress bar above the channel list.",
        default: false
    },
    hideNitroUpsell: {
        type: OptionType.BOOLEAN,
        description: "Hide nitro upsell elements and promotional buttons.",
        default: false
    },
    hideServerGuide: {
        type: OptionType.BOOLEAN,
        description: "Hide server guide and home channel prompts.",
        default: false
    },
    hideServerOnboarding: {
        type: OptionType.BOOLEAN,
        description: "Hide server onboarding prompts and resource channels.",
        default: false
    },
    hideSoundboardButton: {
        type: OptionType.BOOLEAN,
        description: "Hide the soundboard button from the chat bar.",
        default: false
    },
    hideGiftButton: {
        type: OptionType.BOOLEAN,
        description: "Hide the gift button from the chat bar.",
        default: false
    },
    suppressChannelAnimations: {
        type: OptionType.BOOLEAN,
        description: "Remove channel list entry, exit, and hover animation effects.",
        default: false
    },
    suppressUnreadBadgeAnimations: {
        type: OptionType.BOOLEAN,
        description: "Remove the pulsing animation on unread message badges.",
        default: false
    },
    suppressMentionBadgeAnimations: {
        type: OptionType.BOOLEAN,
        description: "Remove the bouncing animation on mention badges.",
        default: false
    },
    suppressStickerAnimation: {
        type: OptionType.BOOLEAN,
        description: "Force all stickers to render as static images. Cuts decode cost for animated stickers in busy channels.",
        default: false
    },
    suppressEmbedAutoLoad: {
        type: OptionType.BOOLEAN,
        description: "Delay loading images inside link embeds. Saves network and decode cost for image-heavy embed chains. Images lazy-load as you scroll.",
        default: false
    },
    containForumPosts: {
        type: OptionType.BOOLEAN,
        description: "Apply content-visibility to forum channel post previews. Offscreen posts skip layout and paint.",
        default: false
    },
    suppressEmojiPickerAnimations: {
        type: OptionType.BOOLEAN,
        description: "Disable emoji picker entrance and hover animations.",
        default: false
    },
    hideStickerButton: {
        type: OptionType.BOOLEAN,
        description: "Hide the sticker picker button from the chat bar.",
        default: false
    },
    killMessageEffects: {
        type: OptionType.BOOLEAN,
        description: "Hide per-message effect animations (fireworks, sparkles, etc). CSS-based, does not use webpack patches.",
        default: false
    },

    // --- New performance features ---

    limitMessageCache: {
        type: OptionType.BOOLEAN,
        description: "Periodically trim Discord's MessageStore for channels not viewed recently. Frees memory from inactive channels.",
        default: false
    },
    limitMessageCacheMinutes: {
        type: OptionType.SLIDER,
        description: "Minutes of inactivity before a channel's message cache is trimmed.",
        markers: [5, 10, 15, 30, 60],
        default: 15,
        stickToMarkers: false
    },
    throttlePresenceUpdates: {
        type: OptionType.BOOLEAN,
        description: "Debounce PRESENCE_UPDATES dispatches to batch rapid status changes into fewer renders.",
        default: false
    },
    debounceReactionUpdates: {
        type: OptionType.BOOLEAN,
        description: "Batch rapid MESSAGE_REACTION_ADD/REMOVE dispatches so reaction spam doesn't cause per-event re-renders.",
        default: false
    },
    throttleVoiceStateUpdates: {
        type: OptionType.BOOLEAN,
        description: "Debounce VOICE_STATE_UPDATES dispatches to batch rapid voice channel movements into fewer renders.",
        default: false
    },
    debounceChannelSelect: {
        type: OptionType.BOOLEAN,
        description: "Debounce rapid CHANNEL_SELECT dispatches (e.g. keyboard arrow navigation) to skip intermediate channels.",
        default: false
    },
    freezeAnimatedAvatars: {
        type: OptionType.BOOLEAN,
        description: "Show first frame of animated avatars, playing animation on hover. Reduces continuous decode cost.",
        default: false
    },
    reduceAvatarQuality: {
        type: OptionType.BOOLEAN,
        description: "Request smaller avatar images from Discord CDN. Reduces image decode time and memory. May appear slightly blurry on high-DPI screens.",
        default: false
    },
    containDmList: {
        type: OptionType.BOOLEAN,
        description: "Apply CSS containment to DM list rows. Reduces layout cost when presence/status changes.",
        default: false
    },
    containEmbeds: {
        type: OptionType.BOOLEAN,
        description: "Apply CSS containment to embed elements so the browser can skip painting offscreen embeds.",
        default: false
    },
    lazyEmojiPicker: {
        type: OptionType.BOOLEAN,
        description: "Apply CSS containment to emoji picker grid items. Reduces layout/paint cost when picker is open.",
        default: false
    },
    optimizeToasts: {
        type: OptionType.BOOLEAN,
        description: "Remove animations and apply containment to notification toasts. Smoother toast appearance.",
        default: false
    },
    simplifySpoilers: {
        type: OptionType.BOOLEAN,
        description: "Replace blur overlay on spoiler content with simpler solid color. Reduces GPU compositing cost.",
        default: false
    },
    suppressSkeletonAnimation: {
        type: OptionType.BOOLEAN,
        description: "Stop shimmer/skeleton loading animations. Pure cosmetic, reduces repaint during channel loading.",
        default: false
    },

    // --- Very high performance features ---

    killSentry: {
        type: OptionType.BOOLEAN,
        description: "Block Discord's Sentry error reporting entirely. Eliminates heavy error serialization, WebSocket uploads, and stack trace walking. Major CPU and network savings.",
        default: false,
        restartNeeded: true
    },
    killPerformanceMetrics: {
        type: OptionType.BOOLEAN,
        description: "Neutralize Discord's internal performance.mark and performance.measure calls. Reduces GC pressure from constant metric recording.",
        default: true
    },
    suppressConsoleTimers: {
        type: OptionType.BOOLEAN,
        description: "Block console.time and console.timeEnd calls. These create internal timer objects even when console output is suppressed.",
        default: true
    },
    killHoverTransitions: {
        type: OptionType.BOOLEAN,
        description: "Remove hover, focus, and active state transitions across the entire client. Eliminates per-mouse-move repaints.",
        default: false
    },
    preconnectDiscordCdn: {
        type: OptionType.BOOLEAN,
        description: "Insert preconnect hints to Discord's CDN on startup. Warms DNS+TLS so the first image load is faster.",
        default: true,
        restartNeeded: true
    },
    forceCompositingLayers: {
        type: OptionType.BOOLEAN,
        description: "Add contain:content on major scroll containers to force GPU compositing layers. Reduces CPU-side paint work on scroll.",
        default: false,
        restartNeeded: true
    },
    suppressIdleCallback: {
        type: OptionType.BOOLEAN,
        description: "Replace requestIdleCallback with a faster MessageChannel-based scheduler. Reduces idle callback latency for deferred work.",
        default: false,
        restartNeeded: true
    }
});

interface CacheEntry {
    response: Response;
    timestamp: number;
}

interface SpringMod {
    Globals?: { assign?: (opts: Record<string, unknown>) => void; };
    Springs?: unknown;
}

export default definePlugin({
    name: "optimizerPremium",
    description: "All-in-one performance suite: webpack patches (tooltip, emoji, spinner, confetti, analytics, reactions), bounded image cache, react-spring skip, offscreen media pause, MutationObserver DOM throttle, CSS containment (messages, members, DMs, embeds, servers, channels, forum, emoji picker), backdrop-blur/sticker/effect/upsell/spoiler suppression, lazy images/iframes, rAF reduction, passive listeners, console suppression, ResizeObserver throttle, memory manager, GIF freeze, concurrency limit, flux debounce/throttle (presence, reactions, voice, channel select), message cache trimmer, animated avatar freeze, avatar quality reducer, cache limits.",
    tags: ["Utility", "Developers"],
    authors: [TestcordDevs.x2b, TestcordDevs.SirPhantom89],
    settings,

    patches: [
        {
            find: "this.state.shouldShowTooltip!==",
            predicate: () => settings.store.optimizeTooltips,
            replacement: [
                {
                    match: /\i\.flushSync\(\(\)=>\{this\.setState\(\{shouldShowTooltip:(\i)\}\)\}\)/,
                    replace: (_m, p) => `this.__open=${p},this.setState({shouldShowTooltip:${p}})`
                },
                {
                    match: /if\(this\.state\.shouldShowTooltip!==(\i)\)/,
                    replace: "if(this.__open!==$1)"
                }
            ]
        },
        {
            find: "this.rebuildFavoriteEmojisWithoutFetchingLatest()",
            predicate: () => settings.store.optimizeEmojiCache,
            replacement: [
                {
                    match: /(\i)=>\{let \i=(\i)\[null==\i\?(\i)\.kod:\i\];null!=\i&&\((\i)\(\)\.each\(\i\.usableEmojis,(\i)\),\i\(\)\.each\(\i\.emoticons,(\i)\)\)\};/,
                    replace: (_m, e, q, k, a, n, r) =>
                        `${e}=>{` +
                        `const t=${q}[null==${e}?${k}.kod:${e}];` +
                        "const usableEmojis=t?.usableEmojis;" +
                        "const emoticons=t?.emoticons;" +
                        `null!=t&&(${a}().each(usableEmojis,${n}),${a}().each(emoticons,${r}))` +
                        "};"
                }
            ]
        },
        {
            find: /\i\.\i\.getAppSpinnerSources\(\)/,
            predicate: () => settings.store.killLoadingSpinner,
            replacement: {
                match: /let \i=\i\.\i\.getAppSpinnerSources\(\).+?;(\i\.\i).+?\)\}/,
                replace: "$1=()=>null;"
            }
        },
        {
            find: "\"SpriteCanvas-module_spriteCanvasHidden",
            predicate: () => settings.store.killConfettiCanvas,
            replacement: {
                match: /,\i\.createElement\("canvas",\{.+?\)\}\)/,
                replace: ""
            }
        },
        {
            find: "getDispatchHandler needs to be passed in first!",
            predicate: () => settings.store.killGatewayAnalytics,
            replacement: {
                match: /let \i=Date\.now\(\),(\i=\i\.Z\.flush\(\i,\i\));\i\.\i\.showPerformanceTelemetry\?.+?Telemetry\(.+?,\i\)/,
                replace: "$1"
            }
        },
        {
            find: /reactionAnimations/,
            predicate: () => settings.store.suppressReactionAnimations,
            replacement: {
                match: /reactionAnimations:\i,/,
                replace: "reactionAnimations:{reactionPop:{},reactionBurst:{}},",
            }
        },
        {
            // Kill Sentry init — patch the DSN to empty so the SDK never boots
            find: /Sentry\.init\(?\{.*?dsn/i,
            predicate: () => settings.store.killSentry,
            replacement: {
                match: /\i\.init\(\{[^}]*dsn:/,
                replace: "$&\"\","
            },
            noWarn: true
        }
    ],

    originals: {} as {
        rAF?: typeof window.requestAnimationFrame;
        cAF?: typeof window.cancelAnimationFrame;
        fetch?: typeof window.fetch;
        addEventListener?: typeof EventTarget.prototype.addEventListener;
        resizeObserver?: typeof ResizeObserver;
        console?: { log: typeof console.log; debug: typeof console.debug; info: typeof console.info; };
        _perfMark?: typeof performance.mark;
        _perfMeasure?: typeof performance.measure;
        _consoleTime?: typeof console.time;
        _consoleTimeEnd?: typeof console.timeEnd;
        _consoleTimeLog?: typeof console.timeLog;
        rIC?: typeof window.requestIdleCallback;
        cIC?: typeof window.cancelIdleCallback;
    },
    springs: [] as SpringMod[],
    networkCache: new Map<string, CacheEntry>(),
    networkCacheOrder: [] as string[],
    cacheCleanupTimer: null as ReturnType<typeof setInterval> | null,
    memoryTimer: null as ReturnType<typeof setInterval> | null,
    intersectionObserver: null as IntersectionObserver | null,
    lazyIframeObserver: null as IntersectionObserver | null,
    mediaMutationObserver: null as MutationObserver | null,
    pausedMedia: new WeakSet<HTMLMediaElement>(),
    optimizerStyleEl: null as HTMLStyleElement | null,
    extraStyleEl: null as HTMLStyleElement | null,
    domThrottleStyleEl: null as HTMLStyleElement | null,
    domThrottleObserver: null as MutationObserver | null,
    domThrottleTimers: new Map<Element, ReturnType<typeof setTimeout>>(),
    gifMutationObserver: null as MutationObserver | null,
    gifManagedImages: new WeakSet<HTMLImageElement>(),
    gifBlobUrls: new Set<string>(),
    lazyImageObserver: null as MutationObserver | null,
    rafFakeHandles: new Map<number, true>(),
    rafFakeCounter: 1 << 30,
    rafFrameCounter: 0,
    consolidatedObserver: null as MutationObserver | null,
    observerCallbacks: new Map<string, (records: MutationRecord[]) => void>(),
    animatedEmojiObserver: null as MutationObserver | null,
    gifAutoplayObserver: null as MutationObserver | null,
    gifAutoplayCleanups: new WeakMap<HTMLVideoElement, () => void>(),
    fluxDispatchOriginal: null as ((event: any) => void) | null,
    _fluxMessageTimer: null as ReturnType<typeof setTimeout> | null,
    avatarObserver: null as MutationObserver | null,
    cacheTrimTimer: null as ReturnType<typeof setInterval> | null,
    originalRIC: null as typeof window.requestIdleCallback | null,
    originalCIC: null as typeof window.cancelIdleCallback | null,
    preconnectLink: null as HTMLLinkElement | null,
    preconnectLink2: null as HTMLLinkElement | null,
    hoverTransitionStyleEl: null as HTMLStyleElement | null,
    compositingStyleEl: null as HTMLStyleElement | null,

    start() {
        if (settings.store.verboseLogging) logger.info("Starting optimizer suite");

        if (settings.store.throttleMutationObservers) this.installConsolidatedObserver();
        if (settings.store.domThrottle) this.installDomThrottle();
        if (settings.store.animationFrameReduction > 0) this.installRafReduction();
        if (settings.store.networkCache || settings.store.forceLowImageQuality || settings.store.limitConcurrentRequests > 0) this.installNetworkLayer();
        if (settings.store.disableSpringAnimations) this.installSpringSkip();
        if (settings.store.memoryManagement) this.installMemoryManager();
        if (settings.store.pauseOffscreenMedia) this.installOffscreenMediaPause();
        if (settings.store.virtualizeMessages || settings.store.optimizeTextRendering) this.installCSSOptimizations();
        if (settings.store.forcePassiveListeners) this.installPassiveListeners();
        if (settings.store.suppressConsoleSpam) this.installConsoleSuppression();
        if (settings.store.throttleResizeObservers) this.installResizeObserverThrottle();
        if (settings.store.freezeGifsUntilHover && settings.store.gifFreezeMethod !== "css") this.installGifFreezer();
        if (settings.store.lazyEmbedImages) this.installLazyImages();
        if (settings.store.lazyIframes) this.installLazyIframes();
        if (settings.store.optimizeImageDecoding) this.installImageDecodingOptimization();
        if (settings.store.disableAnimatedEmoji) this.installDisableAnimatedEmoji();
        if (settings.store.suppressGifAutoplay) this.installSuppressGifAutoplay();
        if (settings.store.debounceFluxMessages > 0 || settings.store.throttlePresenceUpdates || settings.store.debounceReactionUpdates || settings.store.throttleVoiceStateUpdates || settings.store.debounceChannelSelect) this.installFluxPipeline();
        if (settings.store.killPerformanceMetrics) this.installPerfMetricsBlocker();
        if (settings.store.suppressConsoleTimers) this.installConsoleTimerBlocker();
        if (settings.store.killHoverTransitions) this.installHoverTransitionKiller();
        if (settings.store.preconnectDiscordCdn) this.installPreconnect();
        if (settings.store.forceCompositingLayers) this.installCompositingLayers();
        if (settings.store.suppressIdleCallback) this.installIdleCallbackOptimizer();
        if (settings.store.limitMessageCache) this.installMessageCacheTrimmer();
        if (settings.store.freezeAnimatedAvatars) this.installAnimatedAvatarOptimizer();
        if (settings.store.reduceAvatarQuality) this.installAvatarQualityReducer();
        this.installExtraCSS();

        if (settings.store.cacheLimitsEnabled) {
            resetCacheLimits();
            if (settings.store.verboseLogging) logger.info("Plugin cache limits active");
        } else {
            disableCacheLimits();
            if (settings.store.verboseLogging) logger.info("Plugin cache limits disabled");
        }

        if (settings.store.verboseLogging) logger.info("Started");
    },

    stop() {
        if (settings.store.verboseLogging) logger.info("Stopping, restoring originals");

        this.teardownConsolidatedObserver();
        this.teardownDomThrottle();
        this.restoreRafReduction();
        this.restoreSpringSkip();
        this.teardownMemoryManager();
        this.teardownOffscreenMediaPause();
        this.teardownCSSOptimizations();
        this.restorePassiveListeners();
        this.restoreConsoleSuppression();
        this.restoreResizeObserverThrottle();
        this.teardownGifFreezer();
        this.teardownLazyImages();
        this.teardownLazyIframes();
        this.teardownImageDecodingOptimization();
        this.teardownExtraCSS();
        this.teardownDisableAnimatedEmoji();
        this.teardownSuppressGifAutoplay();
        this.teardownFluxPipeline();
        this.teardownPerfMetricsBlocker();
        this.teardownConsoleTimerBlocker();
        this.teardownHoverTransitionKiller();
        this.teardownPreconnect();
        this.teardownCompositingLayers();
        this.teardownIdleCallbackOptimizer();
        this.teardownMessageCacheTrimmer();
        this.teardownAnimatedAvatarOptimizer();
        this.teardownAvatarQualityReducer();
        this.restoreNetworkLayer();

        this.networkCache.clear();
        this.networkCacheOrder.length = 0;

        resetCacheLimits();
    },

    installConsolidatedObserver() {
        if (typeof MutationObserver === "undefined") return;

        const callbacks = this.observerCallbacks;

        this.consolidatedObserver = new MutationObserver(records => {
            for (const cb of callbacks.values()) {
                try {
                    cb(records);
                } catch (err) {
                    if (settings.store.verboseLogging) logger.warn("Consolidated observer callback error", err);
                }
            }
        });

        this.consolidatedObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        if (settings.store.verboseLogging) logger.info("Installed consolidated MutationObserver");
    },

    teardownConsolidatedObserver() {
        if (this.consolidatedObserver) {
            this.consolidatedObserver.disconnect();
            this.consolidatedObserver = null;
            this.observerCallbacks.clear();
        }
    },

    installDomThrottle() {
        const delay = settings.store.domThrottleDelay;
        const matches = (el: Element): boolean => {
            const cn = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "";
            if (!cn) return false;
            for (const tok of THROTTLED_CLASS_TOKENS) if (cn.indexOf(tok) !== -1) return true;
            return false;
        };

        this.domThrottleStyleEl = document.createElement("style");
        this.domThrottleStyleEl.id = "op-dom-throttle";
        this.domThrottleStyleEl.textContent = "[data-op-throttled]{visibility:hidden!important}";
        document.head.appendChild(this.domThrottleStyleEl);

        const timers = this.domThrottleTimers;

        const apply = (el: HTMLElement) => {
            const existing = timers.get(el);
            if (existing !== undefined) {
                clearTimeout(existing);
            }
            el.setAttribute("data-op-throttled", "1");
            const t = setTimeout(() => {
                el.removeAttribute("data-op-throttled");
                timers.delete(el);
            }, delay);
            timers.set(el, t);
        };

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof HTMLElement)) continue;
                    if (node instanceof HTMLIFrameElement) continue;
                    if (node.querySelector?.("iframe")) continue;
                    if (matches(node)) apply(node);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("domThrottle", callback);
        } else {
            this.domThrottleObserver = new MutationObserver(callback);
            this.domThrottleObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownDomThrottle() {
        this.observerCallbacks.delete("domThrottle");
        if (this.domThrottleObserver) {
            this.domThrottleObserver.disconnect();
            this.domThrottleObserver = null;
        }
        for (const t of this.domThrottleTimers.values()) clearTimeout(t);
        this.domThrottleTimers.clear();
        document.querySelectorAll("[data-op-throttled]").forEach(el => el.removeAttribute("data-op-throttled"));
        if (this.domThrottleStyleEl) {
            this.domThrottleStyleEl.remove();
            this.domThrottleStyleEl = null;
        }
    },

    installRafReduction() {
        this.originals.rAF = window.requestAnimationFrame;
        this.originals.cAF = window.cancelAnimationFrame;

        const reduction = Math.min(100, Math.max(0, settings.store.animationFrameReduction)) / 100;
        const skipEvery = Math.ceil(1 + reduction * 3);
        const fakeHandles = this.rafFakeHandles;
        const origRaf = this.originals.rAF;
        const origCaf = this.originals.cAF;

        window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
            this.rafFrameCounter++;
            if (reduction > 0 && this.rafFrameCounter % skipEvery !== 0) {
                const id = this.rafFakeCounter++;
                fakeHandles.set(id, true);
                return id;
            }
            return origRaf.call(window, cb);
        };

        window.cancelAnimationFrame = (handle: number) => {
            if (fakeHandles.has(handle)) {
                fakeHandles.delete(handle);
                return;
            }
            origCaf.call(window, handle);
        };
    },

    restoreRafReduction() {
        if (this.originals.rAF) {
            window.requestAnimationFrame = this.originals.rAF;
            this.originals.rAF = undefined;
        }
        if (this.originals.cAF) {
            window.cancelAnimationFrame = this.originals.cAF;
            this.originals.cAF = undefined;
        }
        this.rafFakeHandles.clear();
    },

    installNetworkLayer() {
        const originalFetch = window.fetch.bind(window);
        this.originals.fetch = window.fetch;

        const cacheEnabled = settings.store.networkCache;
        const concurrencyLimit = settings.store.limitConcurrentRequests;
        const cacheMs = settings.store.networkCacheMinutes * 60 * 1000;
        const maxEntries = Math.max(10, settings.store.networkCacheMaxEntries | 0);
        const lowQuality = settings.store.forceLowImageQuality;
        const cache = this.networkCache;
        const order = this.networkCacheOrder;
        const isImage = (url: string) => /\.(png|jpe?g|gif|webp)(?:$|[?#])/i.test(url);
        const isDiscordCdn = (url: string) => /(?:cdn|media)\.discord(?:app)?\.(?:com|net)/.test(url);

        const stripCacheBusting = (u: URL) => {
            u.searchParams.delete("v");
            u.searchParams.delete("expires");
            u.searchParams.delete("sig");
        };

        const normalizeCacheKey = (url: string): string => {
            try {
                const u = new URL(url, window.location.origin);
                stripCacheBusting(u);
                return u.toString();
            } catch {
                return url;
            }
        };

        const rewriteSize = (url: string): string => {
            if (!lowQuality || !isDiscordCdn(url)) return url;
            try {
                const u = new URL(url, window.location.origin);
                const size = u.searchParams.get("size");
                if (size && Number(size) > 96) u.searchParams.set("size", "96");
                if (!size && /avatars|emojis|icons|banners/.test(u.pathname)) u.searchParams.set("size", "96");
                return u.toString();
            } catch {
                return url;
            }
        };

        const touch = (key: string) => {
            const idx = order.indexOf(key);
            if (idx !== -1) order.splice(idx, 1);
            order.push(key);
        };
        const evict = () => {
            while (order.length > maxEntries) {
                const k = order.shift();
                if (k) cache.delete(k);
            }
        };

        const queue: Array<() => void> = [];
        let active = 0;

        const dequeue = () => {
            active--;
            if (queue.length > 0 && active < concurrencyLimit) {
                const next = queue.shift();
                if (next) next();
            }
        };

        window.fetch = function patched(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
            const finalUrl = rewriteSize(rawUrl);
            const method = init?.method?.toUpperCase() ?? (input instanceof Request ? input.method.toUpperCase() : "GET");
            const useCache = cacheEnabled && isImage(finalUrl) && method === "GET";

            if (useCache) {
                const cacheKey = normalizeCacheKey(finalUrl);
                const hit = cache.get(cacheKey);
                if (hit && Date.now() - hit.timestamp < cacheMs) {
                    touch(cacheKey);
                    return Promise.resolve(hit.response.clone());
                }
                if (hit) {
                    cache.delete(cacheKey);
                    const idx = order.indexOf(cacheKey);
                    if (idx !== -1) order.splice(idx, 1);
                }
            }

            const target: RequestInfo | URL = finalUrl !== rawUrl
                ? (typeof input === "string" ? finalUrl : new Request(finalUrl, input instanceof Request ? input : undefined))
                : input;

            const doFetch = () => {
                active++;
                return originalFetch(target, init).then(res => {
                    if (useCache && res.ok) {
                        const cacheKey = normalizeCacheKey(finalUrl);
                        cache.set(cacheKey, { response: res.clone(), timestamp: Date.now() });
                        touch(cacheKey);
                        evict();
                    }
                    if (concurrencyLimit > 0) dequeue();
                    return res;
                }, err => {
                    if (concurrencyLimit > 0) dequeue();
                    throw err;
                });
            };

            if (concurrencyLimit > 0 && active >= concurrencyLimit) {
                return new Promise<Response>((resolve, reject) => {
                    queue.push(() => { doFetch().then(resolve, reject); });
                });
            }
            return doFetch();
        };

        if (cacheEnabled) {
            this.cacheCleanupTimer = setInterval(() => {
                const now = Date.now();
                for (const [k, v] of cache) {
                    if (now - v.timestamp > cacheMs) {
                        cache.delete(k);
                        const idx = order.indexOf(k);
                        if (idx !== -1) order.splice(idx, 1);
                    }
                }
            }, Math.max(60_000, cacheMs / 2));
        }
    },

    restoreNetworkLayer() {
        if (this.originals.fetch) {
            window.fetch = this.originals.fetch;
            this.originals.fetch = undefined;
        }
        if (this.cacheCleanupTimer !== null) {
            clearInterval(this.cacheCleanupTimer);
            this.cacheCleanupTimer = null;
        }
    },

    installSpringSkip() {
        if (this.springs.length === 0) {
            const mods = findAll(mod => {
                const m = mod as SpringMod;
                return typeof m?.Globals === "object" && typeof m?.Springs === "object";
            }) as SpringMod[];
            this.springs = mods;
        }
        for (const spring of this.springs) {
            spring.Globals?.assign?.({ skipAnimation: true });
        }
    },

    restoreSpringSkip() {
        for (const spring of this.springs) {
            spring.Globals?.assign?.({ skipAnimation: false });
        }
        this.springs = [];
    },

    installMemoryManager() {
        const intervalMs = settings.store.memoryCheckSeconds * 1000;
        const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number; }; };
        if (!perf.memory) {
            if (settings.store.verboseLogging) logger.info("performance.memory unavailable; memory manager idle");
            return;
        }

        this.memoryTimer = setInterval(() => {
            try {
                const m = perf.memory;
                if (!m) return;
                const ratio = m.usedJSHeapSize / m.jsHeapSizeLimit;
                if (ratio > 0.75) {
                    if (this.networkCache.size > 50) {
                        const half = Math.floor(this.networkCacheOrder.length / 2);
                        for (let i = 0; i < half; i++) {
                            const k = this.networkCacheOrder.shift();
                            if (k) this.networkCache.delete(k);
                        }
                    }
                    const win = window as Window & { gc?: () => void; };
                    if (typeof win.gc === "function") {
                        win.gc();
                        if (settings.store.verboseLogging) logger.info(`GC triggered at heap ratio ${(ratio * 100).toFixed(1)}%`);
                    } else if (settings.store.verboseLogging) {
                        logger.info(`Heap ratio ${(ratio * 100).toFixed(1)}% — trimmed caches (gc unavailable)`);
                    }
                }
            } catch (err) {
                if (settings.store.verboseLogging) logger.warn("Memory pressure check failed", err);
            }
        }, intervalMs);
    },

    teardownMemoryManager() {
        if (this.memoryTimer !== null) {
            clearInterval(this.memoryTimer);
            this.memoryTimer = null;
        }
    },

    installOffscreenMediaPause() {
        if (typeof IntersectionObserver === "undefined") return;
        const paused = this.pausedMedia;

        this.intersectionObserver = new IntersectionObserver(entries => {
            for (const entry of entries) {
                const { target } = entry;
                if (!(target instanceof HTMLMediaElement)) continue;
                if (entry.isIntersecting) {
                    if (paused.has(target)) {
                        paused.delete(target);
                        target.play().catch(() => undefined);
                    }
                } else if (!target.paused) {
                    paused.add(target);
                    target.pause();
                }
            }
        }, { threshold: 0.05 });

        const watch = (root: ParentNode) => {
            const media = root.querySelectorAll("video, audio");
            for (const el of media) this.intersectionObserver?.observe(el);
        };

        watch(document.body);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLMediaElement) {
                        this.intersectionObserver?.observe(node);
                    } else if (node instanceof Element) {
                        watch(node);
                    }
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("offscreenMedia", callback);
        } else {
            this.mediaMutationObserver = new MutationObserver(callback);
            this.mediaMutationObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownOffscreenMediaPause() {
        this.observerCallbacks.delete("offscreenMedia");
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }
        if (this.mediaMutationObserver) {
            this.mediaMutationObserver.disconnect();
            this.mediaMutationObserver = null;
        }
    },

    installCSSOptimizations() {
        const rules: string[] = [];
        if (settings.store.virtualizeMessages) {
            rules.push("[class*=\"messageListItem_\"] { contain: layout style; }");
        }
        if (settings.store.optimizeTextRendering) {
            rules.push(
                "[class*=\"messageContent_\"], [class*=\"markup_\"] { text-rendering: optimizeSpeed; }",
                "[class*=\"chatContent_\"] { contain: style layout; }"
            );
        }
        if (rules.length) {
            this.optimizerStyleEl = document.createElement("style");
            this.optimizerStyleEl.id = "op-css-optimizations";
            this.optimizerStyleEl.textContent = rules.join("\n");
            document.head.appendChild(this.optimizerStyleEl);
        }
    },

    teardownCSSOptimizations() {
        if (this.optimizerStyleEl) {
            this.optimizerStyleEl.remove();
            this.optimizerStyleEl = null;
        }
    },

    installPassiveListeners() {
        const PASSIVE_EVENTS = new Set(["wheel", "mousewheel", "touchstart", "touchmove", "touchend"]);
        const originalAdd = EventTarget.prototype.addEventListener;
        this.originals.addEventListener = originalAdd;

        EventTarget.prototype.addEventListener = function patched(
            this: EventTarget,
            type: string,
            listener: EventListenerOrEventListenerObject | null,
            options?: boolean | AddEventListenerOptions
        ): void {
            if (PASSIVE_EVENTS.has(type) && listener != null) {
                if (typeof options === "boolean" || options === undefined) {
                    options = { capture: !!options, passive: true };
                } else if (options.passive === undefined) {
                    options = { ...options, passive: true };
                }
            }
            return originalAdd.call(this, type, listener, options);
        } as typeof EventTarget.prototype.addEventListener;
    },

    restorePassiveListeners() {
        if (this.originals.addEventListener) {
            EventTarget.prototype.addEventListener = this.originals.addEventListener;
            this.originals.addEventListener = undefined;
        }
    },

    installConsoleSuppression() {
        this.originals.console = {
            log: console.log,
            debug: console.debug,
            info: console.info
        };
        const noop = () => undefined;
        console.log = noop;
        console.debug = noop;
        console.info = noop;
    },

    restoreConsoleSuppression() {
        if (this.originals.console) {
            console.log = this.originals.console.log;
            console.debug = this.originals.console.debug;
            console.info = this.originals.console.info;
            this.originals.console = undefined;
        }
    },

    installResizeObserverThrottle() {
        if (typeof ResizeObserver === "undefined") return;
        const Native = ResizeObserver;
        this.originals.resizeObserver = Native;

        class ThrottledResizeObserver {
            private _observer: ResizeObserver;
            private _pendingEntries: ResizeObserverEntry[] = [];
            private _timerId: ReturnType<typeof setTimeout> | null = null;
            private _userCb: ResizeObserverCallback;

            constructor(callback: ResizeObserverCallback) {
                this._userCb = callback;
                this._observer = new Native(entries => {
                    this._pendingEntries.push(...entries);
                    if (this._timerId !== null) return;
                    this._timerId = setTimeout(() => {
                        const flushed = this._pendingEntries;
                        this._pendingEntries = [];
                        this._timerId = null;
                        try {
                            this._userCb(flushed, this._observer);
                        } catch (err) {
                            if (settings.store.verboseLogging) logger.warn("ResizeObserver cb threw", err);
                        }
                    }, 0);
                });
            }

            observe(target: Element, options?: ResizeObserverOptions) { this._observer.observe(target, options); }
            unobserve(target: Element) { this._observer.unobserve(target); }
            disconnect() {
                if (this._timerId !== null) clearTimeout(this._timerId);
                this._timerId = null;
                this._pendingEntries = [];
                this._observer.disconnect();
            }

            static [Symbol.hasInstance](inst: unknown) {
                return inst instanceof Native || (inst != null && (inst as any)._observer instanceof Native);
            }
        }

        (window as unknown as { ResizeObserver: typeof ResizeObserver; }).ResizeObserver =
            ThrottledResizeObserver as unknown as typeof ResizeObserver;
    },

    restoreResizeObserverThrottle() {
        if (this.originals.resizeObserver) {
            (window as unknown as { ResizeObserver: typeof ResizeObserver; }).ResizeObserver = this.originals.resizeObserver;
            this.originals.resizeObserver = undefined;
        }
    },

    installGifFreezer() {
        const sharedCanvas = document.createElement("canvas");
        const ctx = sharedCanvas.getContext("2d");
        const blobUrls = this.gifBlobUrls;

        const isAnimated = (img: HTMLImageElement) => /\.gif(?:$|[?#])/i.test(img.src);

        const freeze = (img: HTMLImageElement) => {
            if (!ctx) return;
            if (!isAnimated(img)) return;
            if (this.gifManagedImages.has(img)) return;
            this.gifManagedImages.add(img);

            const originalSrc = img.currentSrc || img.src;
            let frozenUrl: string | null = null;

            const buildFrozen = () => {
                if (frozenUrl) return frozenUrl;
                if (!img.naturalWidth || !img.naturalHeight) return null;
                try {
                    sharedCanvas.width = img.naturalWidth;
                    sharedCanvas.height = img.naturalHeight;
                    ctx.clearRect(0, 0, sharedCanvas.width, sharedCanvas.height);
                    ctx.drawImage(img, 0, 0);
                    sharedCanvas.toBlob(b => {
                        if (!b) return;
                        if (frozenUrl) { URL.revokeObjectURL(frozenUrl); blobUrls.delete(frozenUrl); }
                        frozenUrl = URL.createObjectURL(b);
                        blobUrls.add(frozenUrl);
                        if (img.dataset.opGifState !== "playing") img.src = frozenUrl;
                    }, "image/png");
                    return null;
                } catch {
                    return null;
                }
            };

            const onLoad = () => buildFrozen();
            if (img.complete) buildFrozen(); else img.addEventListener("load", onLoad, { once: true });

            img.dataset.opGifState = "frozen";
            const onEnter = () => {
                img.dataset.opGifState = "playing";
                img.src = originalSrc;
            };
            const onLeave = () => {
                img.dataset.opGifState = "frozen";
                if (frozenUrl) img.src = frozenUrl;
            };
            img.addEventListener("mouseenter", onEnter);
            img.addEventListener("mouseleave", onLeave);

            (img as any).__opCleanup = () => {
                img.removeEventListener("mouseenter", onEnter);
                img.removeEventListener("mouseleave", onLeave);
                img.removeEventListener("load", onLoad);
                if (frozenUrl) { URL.revokeObjectURL(frozenUrl); blobUrls.delete(frozenUrl); }
                frozenUrl = null;
            };
        };

        document.querySelectorAll<HTMLImageElement>("img").forEach(freeze);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLImageElement) freeze(node);
                    else if (node instanceof Element) node.querySelectorAll<HTMLImageElement>("img").forEach(freeze);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("gifFreezer", callback);
        } else {
            this.gifMutationObserver = new MutationObserver(callback);
            this.gifMutationObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownGifFreezer() {
        this.observerCallbacks.delete("gifFreezer");
        if (this.gifMutationObserver) {
            this.gifMutationObserver.disconnect();
            this.gifMutationObserver = null;
        }
        document.querySelectorAll<HTMLImageElement>("img").forEach(img => {
            const cleanup = (img as any).__opCleanup;
            if (typeof cleanup === "function") {
                cleanup();
                delete (img as any).__opCleanup;
            }
            delete img.dataset.opGifState;
        });
        for (const url of this.gifBlobUrls) URL.revokeObjectURL(url);
        this.gifBlobUrls.clear();
    },

    installLazyImages() {
        const apply = (img: HTMLImageElement) => {
            if (img.dataset.opLazy === "1") return;
            img.dataset.opLazy = "1";
            if (!img.hasAttribute("loading")) img.loading = "lazy";
            if (!img.hasAttribute("decoding")) img.decoding = "async";
        };
        document.querySelectorAll<HTMLImageElement>("img").forEach(apply);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLImageElement) apply(node);
                    else if (node instanceof Element) node.querySelectorAll<HTMLImageElement>("img").forEach(apply);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("lazyImages", callback);
        } else {
            this.lazyImageObserver = new MutationObserver(callback);
            this.lazyImageObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownLazyImages() {
        this.observerCallbacks.delete("lazyImages");
        if (this.lazyImageObserver) {
            this.lazyImageObserver.disconnect();
            this.lazyImageObserver = null;
        }
    },

    installLazyIframes() {
        if (typeof IntersectionObserver === "undefined") return;

        this.lazyIframeObserver = new IntersectionObserver(entries => {
            for (const entry of entries) {
                const { target } = entry;
                if (!(target instanceof HTMLIFrameElement)) continue;
                if (entry.isIntersecting && target.dataset.opLazyLoad !== "loaded") {
                    target.dataset.opLazyLoad = "loaded";
                    if (target.dataset.src) {
                        target.src = target.dataset.src;
                    }
                }
            }
        }, { threshold: 0 });

        const observeIframe = (iframe: HTMLIFrameElement) => {
            if (iframe.dataset.opLazyLoad) return;
            const src = iframe.src || "";
            if (/\.hcaptcha\.com/i.test(src)) return;
            if (/discord\.com|\.youtube\.com|\.youtu\.be|\.spotify\.com/i.test(src)) return;
            iframe.dataset.opLazyLoad = "pending";
            if (src && !iframe.dataset.src) {
                iframe.dataset.src = src;
                iframe.src = "about:blank";
            }
            this.lazyIframeObserver?.observe(iframe);
        };

        document.querySelectorAll<HTMLIFrameElement>("iframe").forEach(observeIframe);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLIFrameElement) observeIframe(node);
                    else if (node instanceof Element) node.querySelectorAll<HTMLIFrameElement>("iframe").forEach(observeIframe);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("lazyIframes", callback);
        }
    },

    teardownLazyIframes() {
        this.observerCallbacks.delete("lazyIframes");
        if (this.lazyIframeObserver) {
            this.lazyIframeObserver.disconnect();
            this.lazyIframeObserver = null;
        }
        document.querySelectorAll<HTMLIFrameElement>("iframe[data-src]").forEach(iframe => {
            const orig = iframe.dataset.src;
            if (orig) {
                iframe.src = orig;
                delete iframe.dataset.src;
            }
            delete iframe.dataset.opLazyLoad;
        });
    },

    installImageDecodingOptimization() {
        const apply = (img: HTMLImageElement) => {
            if (img.dataset.opDecoding === "1") return;
            img.dataset.opDecoding = "1";
            if (!img.hasAttribute("decoding")) img.decoding = "async";
        };

        document.querySelectorAll<HTMLImageElement>("img").forEach(apply);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLImageElement) apply(node);
                    else if (node instanceof Element) node.querySelectorAll<HTMLImageElement>("img").forEach(apply);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("imageDecoding", callback);
        }
    },

    teardownImageDecodingOptimization() {
        this.observerCallbacks.delete("imageDecoding");
    },

    installExtraCSS() {
        const rules: string[] = [];

        if (settings.store.killBackdropBlur) {
            rules.push(
                "[class*=\"backdrop_\"], [class*=\"layer_\"], [class*=\"popout_\"], [class*=\"modal_\"] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }"
            );
        }
        if (settings.store.reduceMotion) {
            rules.push(
                "*, *::before, *::after { animation-duration: 0.001ms !important; animation-delay: 0ms !important; transition-duration: 0.001ms !important; transition-delay: 0ms !important; }"
            );
        }
        if (settings.store.killWillChange) {
            rules.push(
                "[style*=\"will-change\"], [class*=\"scroller_\"], [class*=\"messageListItem_\"] { will-change: auto !important; }"
            );
        }
        if (settings.store.disableTypingIndicator) {
            rules.push("[class*=\"typing_\"], [class*=\"typingDots_\"] { display: none !important; }");
        }
        if (settings.store.disableAnimatedHeaders) {
            rules.push(
                "[class*=\"header_\"], [class*=\"banner_\"] { animation: none !important; transition: none !important; }"
            );
        }
        if (settings.store.messageContentVisibility) {
            rules.push(
                "[class*=\"messageListItem_\"] { content-visibility: auto; contain-intrinsic-size: 90px; }",
                "[class*=\"scrollerInner_\"] > [class*=\"divider\"] { contain-intrinsic-size: 0; }"
            );
        }
        if (settings.store.suppressEmbedPreviews) {
            rules.push(
                "article[class*=\"embed_\"], [class*=\"embedWrapper_\"], [class*=\"embedFull_\"], [class*=\"embedInner_\"] { display: none !important; }"
            );
        }

        // --- Advanced CSS optimizations ---
        if (settings.store.freezeGifsUntilHover && settings.store.gifFreezeMethod === "css") {
            rules.push(
                "img[src*=\".gif\"]:not([class*=\"emoji\"]):not([data-op-gif-suppressed=\"1\"]) { content-visibility: hidden; }",
                "img[src*=\".gif\"]:not([class*=\"emoji\"]):hover { content-visibility: visible; }"
            );
        }
        if (settings.store.containMemberList) {
            rules.push(
                "[class*=\"membersWrap_\"], [class*=\"members_\"] { contain: layout style; content-visibility: auto; contain-intrinsic-size: 48px; }",
                "[class*=\"member_\"], [class*=\"membersGroup_\"] { contain: layout style; }"
            );
        }
        if (settings.store.containServerList) {
            rules.push(
                "[class*=\"guilds_\"], [class*=\"guildList_\"] { contain: layout style; content-visibility: auto; contain-intrinsic-size: 48px; }"
            );
        }
        if (settings.store.hideVoicePanel) {
            rules.push(
                "[class*=\"voicePanel_\"], [class*=\"voiceCall_\"] { display: none !important; }",
                "[class*=\"chatToasts_\"] { display: none !important; }"
            );
        }
        if (settings.store.hideActivityPanel) {
            rules.push(
                "[class*=\"activityPanel_\"], [class*=\"nowPlaying_\"][class*=\"panel_\"], [class*=\"whatsNew_\"][class*=\"panel_\"] { display: none !important; }"
            );
        }
        if (settings.store.hideServerBanner) {
            rules.push(
                "[class*=\"bannerImage_\"], [class*=\"bannerImg_\"] { display: none !important; }",
                "[class*=\"animatedBanner_\"] { display: none !important; }"
            );
        }
        if (settings.store.hideAvatarDecorations) {
            rules.push(
                "[class*=\"avatarDecoration_\"], img[class*=\"decoration_\"], [class*=\"profileEffect_\"], video[src*=\"decorations\"] { display: none !important; }"
            );
        }
        if (settings.store.suppressProfileEffects) {
            rules.push(
                "[class*=\"profileEffects_\"], [class*=\"effect_\"][class*=\"profile_\"], video[class*=\"effect_\"] { display: none !important; }"
            );
        }
        if (settings.store.hideServerBoosting) {
            rules.push(
                "[class*=\"boostBar_\"] { display: none !important; }",
                "[class*=\"boostedGuild_\"] { display: none !important; }"
            );
        }
        if (settings.store.hideNitroUpsell) {
            rules.push(
                "[class*=\"upsell_\"] { display: none !important; }",
                "[class*=\"premiumUpsell_\"], [class*=\"premiumPromo_\"] { display: none !important; }",
                "[href*=\"/shop\"] { display: none !important; }",
                "[data-testid*=\"upsell\"] { display: none !important; }"
            );
        }
        if (settings.store.hideServerGuide) {
            rules.push("[class*=\"homeBanner_\"], [class*=\"serverGuide_\"] { display: none !important; }");
        }
        if (settings.store.hideServerOnboarding) {
            rules.push(
                "[class*=\"onboarding_\"] { display: none !important; }",
                "[class*=\"onboardingStep_\"] { display: none !important; }"
            );
        }
        if (settings.store.hideSoundboardButton) {
            rules.push(
                "[class*=\"soundButton_\"], [class*=\"soundboardButton_\"], button[aria-label*=\"Soundboard\"] { display: none !important; }"
            );
        }
        if (settings.store.hideGiftButton) {
            rules.push(
                "button[aria-label*=\"Send a gift\"], button[aria-label*=\"Gift\"], [class*=\"giftButton_\"] { display: none !important; }"
            );
        }
        if (settings.store.hideStickerButton) {
            rules.push(
                "button[aria-label*=\"Sticker\"], [class*=\"stickerButton_\"], button[class*=\"stickerButton\"] { display: none !important; }"
            );
        }
        if (settings.store.suppressChannelAnimations) {
            rules.push(
                "[class*=\"channel_\"], [class*=\"channel_\"] * { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }",
                "[class*=\"sidebar_\"] { animation: none !important; transition: none !important; }"
            );
        }
        if (settings.store.suppressUnreadBadgeAnimations) {
            rules.push(
                "[class*=\"unread_\"] { animation: none !important; }",
                "[class*=\"badge_\"]:not([class*=\"mention_\"]) { animation: none !important; transition: none !important; }"
            );
        }
        if (settings.store.suppressMentionBadgeAnimations) {
            rules.push(
                "[class*=\"mention_\"] { animation: none !important; }",
                "[class*=\"badgePulse_\"] { animation: none !important; }"
            );
        }
        if (settings.store.suppressStickerAnimation) {
            rules.push(
                "[class*=\"sticker_\"][class*=\"asset_\"] video { display: none !important; }",
                "[class*=\"sticker_\"][class*=\"asset_\"] img[src*=\"gif\"] { content-visibility: hidden !important; }",
                "[class*=\"stickerResults_\"] video { display: none !important; }"
            );
        }
        if (settings.store.suppressEmbedAutoLoad) {
            rules.push(
                "article[class*=\"embed_\"] img:not([class*=\"emoji\"]) { content-visibility: hidden; }"
            );
        }
        if (settings.store.containForumPosts) {
            rules.push(
                "[class*=\"container_\"][class*=\"grid_\"] { contain: layout style; content-visibility: auto; contain-intrinsic-size: 200px; }",
                "[class*=\"mainCard_\"] { content-visibility: auto; contain-intrinsic-size: 140px; }"
            );
        }
        if (settings.store.suppressEmojiPickerAnimations) {
            rules.push(
                "[class*=\"emojiPicker_\"] *, [class*=\"emojiPicker_\"] *::before, [class*=\"emojiPicker_\"] *::after { animation-duration: 0.001ms !important; animation-delay: 0ms !important; transition-duration: 0.001ms !important; transition-delay: 0ms !important; }"
            );
        }
        if (settings.store.killMessageEffects) {
            rules.push(
                "[class*=\"effectsWrapper_\"], [class*=\"effects_\"], [class*=\"messageEffects_\"] { display: none !important; }",
                "canvas[class*=\"effectsCanvas_\"] { display: none !important; }"
            );
        }

        // --- New CSS containment features ---
        if (settings.store.containDmList) {
            rules.push(
                "[class*=\"privateChannels_\"], [class*=\"channel_\"][class*=\"interactive_\"] { contain: layout style; content-visibility: auto; contain-intrinsic-size: 48px; }"
            );
        }
        if (settings.store.containEmbeds) {
            rules.push(
                "article[class*=\"embed_\"], [class*=\"embedFull_\"], [class*=\"embedInner_\"] { contain: layout style; content-visibility: auto; contain-intrinsic-size: 200px; }"
            );
        }
        if (settings.store.lazyEmojiPicker) {
            rules.push(
                "[class*=\"emojiPicker_\"] [class*=\"emojiItem_\"] { contain: layout style; content-visibility: auto; contain-intrinsic-size: 32px; }"
            );
        }
        if (settings.store.optimizeToasts) {
            rules.push(
                "[class*=\"toast_\"] { animation: none !important; transition: none !important; contain: layout style; }"
            );
        }
        if (settings.store.simplifySpoilers) {
            rules.push(
                "[class*=\"spoilerContent_\"] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; background: var(--background-primary) !important; }"
            );
        }
        if (settings.store.suppressSkeletonAnimation) {
            rules.push(
                "[class*=\"skeleton_\"], [class*=\"skeletonWave_\"], [class*=\"skeletonContainer_\"] { animation: none !important; }"
            );
        }

        if (!rules.length) return;
        this.extraStyleEl = document.createElement("style");
        this.extraStyleEl.id = "op-extra-optimizations";
        this.extraStyleEl.textContent = rules.join("\n");
        document.head.appendChild(this.extraStyleEl);
    },

    teardownExtraCSS() {
        if (this.extraStyleEl) {
            this.extraStyleEl.remove();
            this.extraStyleEl = null;
        }
    },

    installDisableAnimatedEmoji() {
        const isDiscordEmoji = (url: string) => /(?:cdn|media)\.discord(?:app)?\.(?:com|net)\/emojis\//.test(url);
        const rewrite = (img: HTMLImageElement) => {
            const src = img.src || img.currentSrc;
            if (!src) return;
            if (!/\/(?:a_|[0-9]+\.gif)/.test(src)) return;
            if (!isDiscordEmoji(src)) return;
            if (img.dataset.opEmojiStatic === "1") return;
            img.dataset.opEmojiStatic = "1";
            const staticSrc = src.replace(/\.gif(?:\?.*)?$/, ".webp").replace(/(\?.*)?$/, "?size=48&quality=lossless");
            if (staticSrc !== src) img.src = staticSrc;
        };

        document.querySelectorAll<HTMLImageElement>("img[class*=\"emoji\"], img[src*=\"emojis\"]").forEach(rewrite);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node instanceof HTMLImageElement) {
                        if (node.classList.contains("emoji") || node.src.includes("emojis")) rewrite(node);
                    } else {
                        node.querySelectorAll<HTMLImageElement>("img[class*=\"emoji\"], img[src*=\"emojis\"]").forEach(rewrite);
                    }
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("disableAnimatedEmoji", callback);
        } else {
            this.animatedEmojiObserver = new MutationObserver(callback);
            this.animatedEmojiObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownDisableAnimatedEmoji() {
        this.observerCallbacks.delete("disableAnimatedEmoji");
        if (this.animatedEmojiObserver) {
            this.animatedEmojiObserver.disconnect();
            this.animatedEmojiObserver = null;
        }
    },

    installSuppressGifAutoplay() {
        const cleanups = this.gifAutoplayCleanups;

        const pause = (el: HTMLVideoElement | HTMLImageElement) => {
            if (el.dataset.opGifSuppressed === "1") return;
            const src = el.src || el.currentSrc;
            if (!/\.gif|giphy|tenor|media\.discord/i.test(src) && !(el instanceof HTMLVideoElement)) return;
            el.dataset.opGifSuppressed = "1";

            if (el instanceof HTMLVideoElement && !el.paused) {
                el.pause();
                const onEnter = () => el.play().catch(() => undefined);
                const onLeave = () => el.pause();
                el.addEventListener("mouseenter", onEnter);
                el.addEventListener("mouseleave", onLeave);
                cleanups.set(el, () => {
                    el.removeEventListener("mouseenter", onEnter);
                    el.removeEventListener("mouseleave", onLeave);
                });
            }
        };

        document.querySelectorAll<HTMLVideoElement>("video[src*=\"gif\"], video[src*=\"media.discord\"]").forEach(pause);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node instanceof HTMLVideoElement && /gif|media\.discord/i.test(node.src)) pause(node);
                    else node.querySelectorAll<HTMLVideoElement>("video[src*=\"gif\"], video[src*=\"media.discord\"]").forEach(pause);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("suppressGifAutoplay", callback);
        } else {
            this.gifAutoplayObserver = new MutationObserver(callback);
            this.gifAutoplayObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownSuppressGifAutoplay() {
        this.observerCallbacks.delete("suppressGifAutoplay");
        if (this.gifAutoplayObserver) {
            this.gifAutoplayObserver.disconnect();
            this.gifAutoplayObserver = null;
        }
        document.querySelectorAll<HTMLVideoElement>("video[data-op-gif-suppressed]").forEach(video => {
            const cleanup = this.gifAutoplayCleanups.get(video);
            if (cleanup) cleanup();
            delete video.dataset.opGifSuppressed;
        });
        this.gifAutoplayCleanups = new WeakMap();
    },

    installFluxPipeline() {
        try {
            const { FluxDispatcher } = require("@webpack/common") as any;
            if (!FluxDispatcher?.dispatch) return;

            const original = FluxDispatcher.dispatch.bind(FluxDispatcher);
            this.fluxDispatchOriginal = original;

            const messageDelay = settings.store.debounceFluxMessages;
            const messageQueue: any[] = [];
            let messageTimer: ReturnType<typeof setTimeout> | null = null;

            const throttledTypes: Record<string, { events: any[]; timer: ReturnType<typeof setTimeout> | null; delay: number; }> = {};
            if (settings.store.throttlePresenceUpdates) {
                throttledTypes["PRESENCE_UPDATES"] = { events: [], timer: null, delay: 200 };
            }
            if (settings.store.debounceReactionUpdates) {
                throttledTypes["MESSAGE_REACTION_ADD"] = { events: [], timer: null, delay: 100 };
                throttledTypes["MESSAGE_REACTION_REMOVE"] = { events: [], timer: null, delay: 100 };
            }
            if (settings.store.throttleVoiceStateUpdates) {
                throttledTypes["VOICE_STATE_UPDATES"] = { events: [], timer: null, delay: 200 };
            }
            if (settings.store.debounceChannelSelect) {
                throttledTypes["CHANNEL_SELECT"] = { events: [], timer: null, delay: 80 };
            }

            const self = this;
            FluxDispatcher.dispatch = function (event: any) {
                const type = event?.type;

                if (messageDelay > 0 && type === "MESSAGE_CREATE") {
                    messageQueue.push(event);
                    if (messageTimer) clearTimeout(messageTimer);
                    messageTimer = setTimeout(() => {
                        messageTimer = null;
                        self._fluxMessageTimer = null;
                        const batch = messageQueue.splice(0);
                        for (const e of batch) original(e);
                    }, messageDelay);
                    self._fluxMessageTimer = messageTimer;
                    return;
                }

                const q = type && throttledTypes[type];
                if (q) {
                    q.events.push(event);
                    if (q.timer) clearTimeout(q.timer);
                    q.timer = setTimeout(() => {
                        q.timer = null;
                        const batch = q.events;
                        q.events = [];
                        for (const e of batch) original(e);
                    }, q.delay);
                    return;
                }

                original(event);
            };
        } catch (err) {
            if (settings.store.verboseLogging) logger.warn("Failed to install flux pipeline", err);
        }
    },

    teardownFluxPipeline() {
        if (this._fluxMessageTimer !== null) {
            clearTimeout(this._fluxMessageTimer);
            this._fluxMessageTimer = null;
        }
        if (this.fluxDispatchOriginal) {
            try {
                const { FluxDispatcher } = require("@webpack/common") as any;
                if (FluxDispatcher) FluxDispatcher.dispatch = this.fluxDispatchOriginal;
            } catch { /* ignore */ }
            this.fluxDispatchOriginal = null;
        }
    },

    installPerfMetricsBlocker() {
        this.originals._perfMark = performance.mark.bind(performance);
        this.originals._perfMeasure = performance.measure.bind(performance);
        // ponytail: return type varies by spec, cast to any for noop
        performance.mark = (() => { }) as any;
        performance.measure = (() => { }) as any;
    },

    teardownPerfMetricsBlocker() {
        if (this.originals._perfMark) {
            performance.mark = this.originals._perfMark;
            this.originals._perfMark = undefined;
        }
        if (this.originals._perfMeasure) {
            performance.measure = this.originals._perfMeasure;
            this.originals._perfMeasure = undefined;
        }
    },

    installConsoleTimerBlocker() {
        this.originals._consoleTime = console.time.bind(console);
        this.originals._consoleTimeEnd = console.timeEnd.bind(console);
        this.originals._consoleTimeLog = console.timeLog.bind(console);
        console.time = () => undefined;
        console.timeEnd = () => undefined;
        console.timeLog = () => undefined;
    },

    teardownConsoleTimerBlocker() {
        if (this.originals._consoleTime) {
            console.time = this.originals._consoleTime;
            this.originals._consoleTime = undefined;
        }
        if (this.originals._consoleTimeEnd) {
            console.timeEnd = this.originals._consoleTimeEnd;
            this.originals._consoleTimeEnd = undefined;
        }
        if (this.originals._consoleTimeLog) {
            console.timeLog = this.originals._consoleTimeLog;
            this.originals._consoleTimeLog = undefined;
        }
    },

    installHoverTransitionKiller() {
        const css = "*,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important}";
        this.hoverTransitionStyleEl = document.createElement("style");
        this.hoverTransitionStyleEl.id = "op-kill-hover";
        this.hoverTransitionStyleEl.textContent = css;
        document.head.appendChild(this.hoverTransitionStyleEl);
    },

    teardownHoverTransitionKiller() {
        if (this.hoverTransitionStyleEl) {
            this.hoverTransitionStyleEl.remove();
            this.hoverTransitionStyleEl = null;
        }
    },

    installPreconnect() {
        const link = document.createElement("link");
        link.rel = "preconnect";
        link.href = "https://cdn.discordapp.com";
        link.crossOrigin = "anonymous";
        document.head.appendChild(link);
        this.preconnectLink = link;

        const link2 = document.createElement("link");
        link2.rel = "dns-prefetch";
        link2.href = "https://media.discordapp.net";
        document.head.appendChild(link2);
        this.preconnectLink2 = link2;
    },

    teardownPreconnect() {
        if (this.preconnectLink) {
            this.preconnectLink.remove();
            this.preconnectLink = null;
        }
        if (this.preconnectLink2) {
            this.preconnectLink2.remove();
            this.preconnectLink2 = null;
        }
    },

    installCompositingLayers() {
        const css = "[class*=\"scroller_\"][class*=\"content_\"]{contain:content}[class*=\"guilds\"]{contain:layout}[class*=\"membersWrap_\"]{contain:layout}";
        this.compositingStyleEl = document.createElement("style");
        this.compositingStyleEl.id = "op-compositing";
        this.compositingStyleEl.textContent = css;
        document.head.appendChild(this.compositingStyleEl);
    },

    teardownCompositingLayers() {
        if (this.compositingStyleEl) {
            this.compositingStyleEl.remove();
            this.compositingStyleEl = null;
        }
    },

    installIdleCallbackOptimizer() {
        const Channel = typeof MessageChannel !== "undefined" ? new MessageChannel() : null;
        if (!Channel) return;

        this.originals.rIC = window.requestIdleCallback;
        this.originals.cIC = window.cancelIdleCallback;

        const scheduled = new Map<number, { cb: IdleRequestCallback; timer: ReturnType<typeof setTimeout> }>();
        let nextId = 1;

        Channel.port1.onmessage = (e: MessageEvent) => {
            const entry = scheduled.get(e.data);
            if (entry) {
                scheduled.delete(e.data);
                try { entry.cb({ didTimeout: false, timeRemaining: () => 16 }); } catch { /* swallow */ }
            }
        };

        window.requestIdleCallback = ((cb: IdleRequestCallback, _opts?: { timeout?: number }) => {
            const id = nextId++;
            const timer = setTimeout(() => Channel.port2.postMessage(id), 0);
            scheduled.set(id, { cb, timer });
            return id;
        }) as typeof window.requestIdleCallback;

        window.cancelIdleCallback = ((handle: number) => {
            const entry = scheduled.get(handle);
            if (entry) {
                clearTimeout(entry.timer);
                scheduled.delete(handle);
            }
        }) as typeof window.cancelIdleCallback;
    },

    teardownIdleCallbackOptimizer() {
        if (this.originals.rIC) {
            window.requestIdleCallback = this.originals.rIC;
            this.originals.rIC = undefined;
        }
        if (this.originals.cIC) {
            window.cancelIdleCallback = this.originals.cIC;
            this.originals.cIC = undefined;
        }
    },

    installMessageCacheTrimmer() {
        const intervalMs = 60_000;
        const inactivityMs = settings.store.limitMessageCacheMinutes * 60_000;
        this.cacheTrimTimer = setInterval(() => {
            try {
                const { MessageStore, ChannelStore, SelectedChannelStore } = require("@webpack/common") as any;
                if (!MessageStore?.getCachedMessages && !MessageStore?.getMessages) return;
                const currentId = SelectedChannelStore?.getChannelId?.();
                const channels = ChannelStore?.getAll?.() ?? [];
                for (const ch of channels) {
                    if (ch.id === currentId) continue;
                    const msgs = MessageStore.getMessages?.(ch.id);
                    if (!msgs || typeof msgs.size !== "number") continue;
                    if (msgs.size > 50) {
                        MessageStore.clearCache?.(ch.id);
                    }
                }
            } catch { /* silent */ }
        }, intervalMs);
    },

    teardownMessageCacheTrimmer() {
        if (this.cacheTrimTimer !== null) {
            clearInterval(this.cacheTrimTimer);
            this.cacheTrimTimer = null;
        }
    },

    installAnimatedAvatarOptimizer() {
        const freeze = (img: HTMLImageElement) => {
            if (img.dataset.opAvFrozen === "1") return;
            const src = img.src || img.currentSrc;
            if (!src || !/\/(?:a_|[0-9]+\.gif)/.test(src)) return;
            if (!img.classList.contains("avatar") && !img.closest("[class*=\"avatar\"]")) return;
            img.dataset.opAvFrozen = "1";
            const staticSrc = src.replace(/\.gif(?:\?.*)?$/, ".png").replace(/\?size=\d+/, "?size=80");
            const originalSrc = src;
            img.src = staticSrc;
            const onEnter = () => { img.src = originalSrc; };
            const onLeave = () => { img.src = staticSrc; };
            img.addEventListener("mouseenter", onEnter);
            img.addEventListener("mouseleave", onLeave);
            (img as any).__opAvCleanup = () => {
                img.removeEventListener("mouseenter", onEnter);
                img.removeEventListener("mouseleave", onLeave);
            };
        };

        document.querySelectorAll<HTMLImageElement>("img[class*=\"avatar\"]").forEach(freeze);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node instanceof HTMLImageElement && node.classList.contains("avatar")) freeze(node);
                    else node.querySelectorAll<HTMLImageElement>("img[class*=\"avatar\"]").forEach(freeze);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("freezeAnimatedAvatars", callback);
        } else {
            this.avatarObserver = new MutationObserver(callback);
            this.avatarObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownAnimatedAvatarOptimizer() {
        this.observerCallbacks.delete("freezeAnimatedAvatars");
        if (this.avatarObserver) {
            this.avatarObserver.disconnect();
            this.avatarObserver = null;
        }
        document.querySelectorAll<HTMLImageElement>("img[data-op-av-frozen]").forEach(img => {
            const cleanup = (img as any).__opAvCleanup;
            if (typeof cleanup === "function") {
                cleanup();
                delete (img as any).__opAvCleanup;
            }
            delete img.dataset.opAvFrozen;
        });
    },

    installAvatarQualityReducer() {
        const rewrite = (img: HTMLImageElement) => {
            if (img.dataset.opAvQuality === "1") return;
            const src = img.src || img.currentSrc;
            if (!src.includes("cdn.discord") && !src.includes("media.discord")) return;
            if (!img.classList.contains("avatar") && !img.closest("[class*=\"avatar\"]") && !img.closest("[class*=\"member\"]")) return;
            img.dataset.opAvQuality = "1";
            try {
                const url = new URL(src, window.location.origin);
                const size = url.searchParams.get("size");
                if (!size || Number(size) > 32) url.searchParams.set("size", "32");
                if (url.toString() !== src) img.src = url.toString();
            } catch { /* ignore */ }
        };

        document.querySelectorAll<HTMLImageElement>("img[class*=\"avatar\"], [class*=\"member\"] img").forEach(rewrite);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node instanceof HTMLImageElement && (node.classList.contains("avatar") || node.closest("[class*=\"member\"]"))) rewrite(node);
                    else node.querySelectorAll<HTMLImageElement>("img[class*=\"avatar\"], [class*=\"member\"] img").forEach(rewrite);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("avatarQualityReducer", callback);
        }
    },

    teardownAvatarQualityReducer() {
        this.observerCallbacks.delete("avatarQualityReducer");
    }
});
