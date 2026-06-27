/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PinOrder, PrivateChannelSortStore, settings } from "@plugins/pinDms";
import { useForceUpdater } from "@utils/react";
import { UserStore } from "@webpack/common";

export interface Category {
    id: string;
    name: string;
    color: number;
    channels: string[];
    collapsed?: boolean;
}

let forceUpdateDms: (() => void) | undefined = undefined;
let lastPrivateChannelIds: string[] | null = null;
const lastSortOrder = new Map<string, number>();
export let currentUserCategories: Category[] = [];

export async function init() {
    const userId = UserStore.getCurrentUser()?.id;
    if (userId == null) return;

    currentUserCategories = settings.store.userBasedCategoryList[userId] ??= [];
    forceUpdateDms?.();
}

export function usePinnedDms() {
    forceUpdateDms = useForceUpdater();
    settings.use(["pinOrder", "canCollapseDmSection", "dmSectionCollapsed", "userBasedCategoryList"]);
}

export function getCategory(id: string) {
    return currentUserCategories.find(c => c.id === id);
}

export function getCategoryByIndex(index: number) {
    return currentUserCategories[index];
}

export function createCategory(category: Category) {
    currentUserCategories.push(category);
}

export function addChannelToCategory(channelId: string, categoryId: string) {
    const category = currentUserCategories.find(c => c.id === categoryId);
    if (category == null) return;

    if (category.channels.includes(channelId)) return;

    // Reassign to a new array (rather than in-place push) so the channels reference
    // changes on mutation, keeping the getCategoryChannels sorted-array cache valid.
    category.channels = [...category.channels, channelId];
}

export function removeChannelFromCategory(channelId: string) {
    const category = currentUserCategories.find(c => c.channels.includes(channelId));
    if (category == null) return;

    category.channels = category.channels.filter(c => c !== channelId);
}

export function removeCategory(categoryId: string) {
    const categoryIndex = currentUserCategories.findIndex(c => c.id === categoryId);
    if (categoryIndex === -1) return;

    currentUserCategories.splice(categoryIndex, 1);
}

export function collapseCategory(id: string, value = true) {
    const category = currentUserCategories.find(c => c.id === id);
    if (category == null) return;

    category.collapsed = value;
}

// Utils
export function isPinned(id: string) {
    return currentUserCategories.some(c => c.channels.includes(id));
}

export function categoryLen() {
    return currentUserCategories.length;
}

export function getSections() {
    return currentUserCategories.reduce((acc, category) => {
        acc.push(category.channels.length === 0 ? 1 : category.channels.length);
        return acc;
    }, [] as number[]);
}

function getSortOrder(ids: string[]) {
    if (ids !== lastPrivateChannelIds) {
        lastPrivateChannelIds = ids;
        lastSortOrder.clear();
        for (let i = 0; i < ids.length; i++) {
            lastSortOrder.set(ids[i], i);
        }
    }
    return lastSortOrder;
}

// Memoizes the sorted channel list per category so repeated per-row calls within a
// render pass reuse one sorted array instead of recomputing the copy + sort each time.
// Keyed by the category's channels array reference and the private-channel id list
// identity (getSortOrder rebuilds its shared order Map in place, so the Map reference is
// not a safe key — the source ids array identity is). Either changing invalidates.
const sortedChannelsCache = new WeakMap<Category, { channels: string[]; ids: string[]; sorted: string[]; }>();

export function getCategoryChannels(category: Category): string[] {
    if (category.channels.length === 0) return [];

    if (settings.store.pinOrder === PinOrder.LastMessage) {
        const sortedChannels = PrivateChannelSortStore.getPrivateChannelIds();
        const order = getSortOrder(sortedChannels);

        const cached = sortedChannelsCache.get(category);
        if (cached != null && cached.channels === category.channels && cached.ids === sortedChannels) {
            return cached.sorted;
        }

        const sorted = [...category.channels].sort((a, b) => {
            return (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity);
        });
        sortedChannelsCache.set(category, { channels: category.channels, ids: sortedChannels, sorted });
        return sorted;
    }

    return category.channels;
}

export function getAllUncollapsedChannels() {
    return currentUserCategories
        .filter(c => !c.collapsed)
        .flatMap(getCategoryChannels);
}

// Move categories
export const canMoveArrayInDirection = (array: any[], index: number, direction: -1 | 1) => {
    const a = array[index];
    const b = array[index + direction];

    return a && b;
};

export const canMoveCategoryInDirection = (id: string, direction: -1 | 1) => {
    const categoryIndex = currentUserCategories.findIndex(m => m.id === id);
    return canMoveArrayInDirection(currentUserCategories, categoryIndex, direction);
};

export const canMoveCategory = (id: string) => canMoveCategoryInDirection(id, -1) || canMoveCategoryInDirection(id, 1);

export const canMoveChannelInDirection = (channelId: string, direction: -1 | 1) => {
    const category = currentUserCategories.find(c => c.channels.includes(channelId));
    if (category == null) return false;

    const channelIndex = category.channels.indexOf(channelId);
    return canMoveArrayInDirection(category.channels, channelIndex, direction);
};

function swapElementsInArray(array: any[], index1: number, index2: number) {
    if (!array[index1] || !array[index2]) return;
    [array[index1], array[index2]] = [array[index2], array[index1]];
}

export function moveCategory(id: string, direction: -1 | 1) {
    const a = currentUserCategories.findIndex(m => m.id === id);
    const b = a + direction;

    swapElementsInArray(currentUserCategories, a, b);
}

export function moveChannel(channelId: string, direction: -1 | 1) {
    const category = currentUserCategories.find(c => c.channels.includes(channelId));
    if (category == null) return;

    const a = category.channels.indexOf(channelId);
    const b = a + direction;

    // Reassign to a new array so the channels reference changes on reorder, keeping
    // the getCategoryChannels sorted-array cache valid.
    const next = [...category.channels];
    swapElementsInArray(next, a, b);
    category.channels = next;
}
