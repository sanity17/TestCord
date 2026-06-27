/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, GuildStore, UserStore } from "@webpack/common";

const settings = definePluginSettings({
  translateUserIds: {
    type: OptionType.BOOLEAN,
    description: "Convert user IDs to clickable @ mentions",
    default: true,
  },
  translateChannelIds: {
    type: OptionType.BOOLEAN,
    description: "Convert channel IDs to clickable # references",
    default: true,
  },
  translateRoleIds: {
    type: OptionType.BOOLEAN,
    description: "Convert role IDs to clickable @& mentions",
    default: true,
  },
  translateMessageIds: {
    type: OptionType.BOOLEAN,
    description: "Convert message IDs to clickable links",
    default: false,
  },
  translateOwnMessages: {
    type: OptionType.BOOLEAN,
    description: "Translate IDs in your own sent messages",
    default: false,
  },
  minIdLength: {
    type: OptionType.NUMBER,
    description: "Minimum ID length to convert (Discord: 17-19 digits)",
    default: 17,
  },
  maxIdLength: {
    type: OptionType.NUMBER,
    description: "Maximum ID length to convert",
    default: 19,
  },
});

// Regex to detect Discord IDs (usually 17-19 digit numbers).
// Cache the compiled RegExp keyed by min-max so it is rebuilt only when the
// length settings actually change, instead of recompiling on every render.
let cachedIdRegex: RegExp | null = null;
let cachedIdRegexKey = "";
function createIdRegex(minLength: number, maxLength: number): RegExp {
  const key = `${minLength}-${maxLength}`;
  if (cachedIdRegex === null || cachedIdRegexKey !== key) {
    cachedIdRegex = new RegExp(`\\b\\d{${minLength},${maxLength}}\\b`, "g");
    cachedIdRegexKey = key;
  }
  // /g regex is reused across calls, so reset lastIndex before scanning.
  cachedIdRegex.lastIndex = 0;
  return cachedIdRegex;
}

// Check if an ID corresponds to a user
function isUserId(id: string): boolean {
  try {
    const user = UserStore.getUser(id);
    return user !== undefined && user !== null;
  } catch {
    return false;
  }
}

// Check if an ID corresponds to a channel
function isChannelId(id: string): boolean {
  try {
    const channel = ChannelStore.getChannel(id);
    return channel !== undefined && channel !== null;
  } catch {
    return false;
  }
}

// Check if an ID corresponds to a role (via current channel)
function isRoleId(id: string, channelId?: string): boolean {
  if (!channelId) return false;
  try {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel?.guild_id) return false;

    const guild = GuildStore.getGuild(channel.guild_id);
    if (!guild) return false;

    // Check if the role exists in the server
    return (guild as any).roles?.[id] !== undefined;
  } catch {
    return false;
  }
}

// Check if an ID is already in a Discord mention or URL
function isIdInContext(content: string, id: string, index: number): boolean {
  // Check context before the ID
  const beforeStart = Math.max(0, index - 5);
  const before = content.substring(beforeStart, index);

  // Check context after the ID
  const afterEnd = Math.min(content.length, index + id.length + 5);
  const after = content.substring(index + id.length, afterEnd);

  // Ignore if ID is part of an existing Discord mention
  if (
    before.includes("<@") ||
    before.includes("<#") ||
    before.includes("<@&")
  ) {
    return true;
  }

  // Ignore if ID is part of a URL
  if (before.match(/[:\/\.]/) || after.match(/[:\/\.]/)) {
    return true;
  }

  // Ignore if ID is preceded or followed by @ or #
  if (
    before.endsWith("@") ||
    before.endsWith("#") ||
    after.startsWith("@") ||
    after.startsWith("#")
  ) {
    return true;
  }

  return false;
}

// Main function to translate IDs to clickable mentions
function translateIds(content: string, channelId?: string): string {
  if (!content) return content;

  const {
    translateUserIds,
    translateChannelIds,
    translateRoleIds,
    translateMessageIds,
    minIdLength,
    maxIdLength,
  } = settings.store;

  if (
    !translateUserIds &&
    !translateChannelIds &&
    !translateRoleIds &&
    !translateMessageIds
  ) {
    return content;
  }

  const idRegex = createIdRegex(minIdLength, maxIdLength);
  let translatedContent = content;
  const processedIds = new Map<string, string>(); // ID -> replacement

  // Find all IDs and determine their replacements
  let match;
  const idMatches: Array<{ id: string; index: number }> = [];

  while ((match = idRegex.exec(content)) !== null) {
    const id = match[0];
    const { index } = match;

    // Check if ID is in a special context
    if (isIdInContext(content, id, index)) {
      continue;
    }

    // Avoid duplicates
    if (processedIds.has(id)) {
      continue;
    }

    // Determine ID type and appropriate replacement
    let replacement: string | null = null;

    if (translateUserIds && isUserId(id)) {
      replacement = `<@${id}>`;
    } else if (translateChannelIds && isChannelId(id)) {
      replacement = `<#${id}>`;
    } else if (translateRoleIds && channelId && isRoleId(id, channelId)) {
      replacement = `<@&${id}>`;
    } else if (translateMessageIds && channelId) {
      // For messages, create a Discord link
      const channel = ChannelStore.getChannel(channelId);
      if (channel?.guild_id) {
        replacement = `https://discord.com/channels/${channel.guild_id}/${channelId}/${id}`;
      } else {
        // DM
        replacement = `https://discord.com/channels/@me/${channelId}/${id}`;
      }
    }

    if (replacement) {
      processedIds.set(id, replacement);
      idMatches.push({ id, index });
    }
  }

  if (idMatches.length === 0) return translatedContent;

  // Build the output in a single forward pass: copy the gap before each match,
  // then the replacement, then the trailing remainder. This is O(contentLength)
  // total instead of O(N * contentLength) substring+concat per match.
  const parts: string[] = [];
  let lastEnd = 0;
  for (const { id, index } of idMatches) {
    const replacement = processedIds.get(id);
    if (!replacement) continue;
    parts.push(content.substring(lastEnd, index), replacement);
    lastEnd = index + id.length;
  }
  parts.push(content.substring(lastEnd));

  return parts.join("");
}

// Bounded LRU cache of translated content. This runs in the message content
// render path (the patched toAST), so the same unchanged message is processed
// on every re-render (scroll, hover, reactions, focus). Caching by message
// identity + content turns repeat renders into a single Map lookup.
const MAX_TRANSLATION_CACHE = 500;
const translationCache = new Map<string, string>();

function getCachedTranslation(key: string, content: string, channelId?: string): string {
  const cached = translationCache.get(key);
  if (cached !== undefined) {
    // Refresh recency for LRU ordering.
    translationCache.delete(key);
    translationCache.set(key, cached);
    return cached;
  }

  const result = translateIds(content, channelId);
  translationCache.set(key, result);
  if (translationCache.size > MAX_TRANSLATION_CACHE) {
    // Evict the least-recently-used entry (oldest insertion).
    const oldest = translationCache.keys().next().value;
    if (oldest !== undefined) translationCache.delete(oldest);
  }
  return result;
}

// Function to modify incoming messages
function modifyIncomingMessage(message: Message): string {
  if (!message.content) return message.content || "";

  // Check if message comes from current user
  const currentUser = UserStore.getCurrentUser();
  const messageAuthor = message.author;
  const isOwnMessage =
    currentUser?.id && messageAuthor?.id && messageAuthor.id === currentUser.id;

  // Don't modify current user's messages unless option is enabled
  if (isOwnMessage && !settings.store.translateOwnMessages) {
    return message.content;
  }

  // Don't modify messages that already contain Discord mentions
  // to avoid duplicates (except if it's just a message link)
  if (message.content.includes("<@") || message.content.includes("<#")) {
    return message.content;
  }

  const cacheKey = [
    message.id,
    message.editedTimestamp ?? "",
    message.channel_id ?? "",
    settings.store.translateUserIds,
    settings.store.translateChannelIds,
    settings.store.translateRoleIds,
    settings.store.translateMessageIds,
    settings.store.minIdLength,
    settings.store.maxIdLength,
    message.content
  ].join(":");
  return getCachedTranslation(cacheKey, message.content, message.channel_id);
}

export default definePlugin({
  name: "ID Translater",
  description:
    "Automatically translates Discord IDs to clickable @ mentions or # references",
    tags: ["Chat", "Utility"],
  authors: [TestcordDevs.x2b],
  isModified: true,

  settings,
  modifyIncomingMessage,

  patches: [
    {
      find: "!1,hideSimpleEmbedContent",
      replacement: {
        match: /(let{toAST:.{0,125}?)\(null!=\i\?\i:\i\).content/,
        replace:
          "const idTranslaterContent=$self.modifyIncomingMessage(arguments[2]?.contentMessage??arguments[1]);$1idTranslaterContent",
      },
    },
  ],

  start() {
    console.log(
      "[ID Translater] Plugin started - Automatic ID conversion enabled"
    );
  },

  stop() {
    console.log("[ID Translater] Plugin stopped");
  },
});
