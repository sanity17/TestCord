/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyWithToast, fetchUserProfile, getGuildAcronym } from "@utils/discord";
import { Guild } from "@vencord/discord-types";
import { FluxDispatcher, Forms, GuildMemberCountStore, GuildMemberStore, GuildStore, IconUtils, NavigationRouter, React, RelationshipStore, Text, TextInput, Tooltip, useEffect, useMemo, UserProfileStore, UserStore, useState } from "@webpack/common";

function getMutualFriendsCountVal(userId: string): number {
    try {
        return UserProfileStore?.getMutualFriendsCount(userId) ?? 0;
    } catch {
        return 0;
    }
}

function getMutualFriendsList(userId: string): any[] {
    try {
        return UserProfileStore?.getMutualFriends(userId) ?? [];
    } catch {
        return [];
    }
}

function getMutualGuildsList(userId: string, currentGuildId?: string) {
    try {
        const storeMutual = UserProfileStore?.getMutualGuilds(userId);
        if (storeMutual) {
            const mappedList: Array<{ guild: Guild; iconUrl: string | null; }> = [];
            for (const mg of storeMutual) {
                let guildObj: Guild | null = null;
                const anyMg = mg as any;
                if (anyMg.guild && typeof anyMg.guild === "object" && anyMg.guild.id) {
                    guildObj = anyMg.guild;
                } else if (anyMg.id) {
                    guildObj = GuildStore.getGuild(anyMg.id);
                } else if (typeof anyMg.guild === "string") {
                    guildObj = GuildStore.getGuild(anyMg.guild);
                }

                if (!guildObj) continue;
                if (currentGuildId && guildObj.id === currentGuildId) continue;

                const iconUrl = guildObj.icon
                    ? (IconUtils.getGuildIconURL({
                        id: guildObj.id,
                        icon: guildObj.icon,
                        canAnimate: true,
                        size: 20
                    }) ?? null)
                    : null;
                mappedList.push({ guild: guildObj, iconUrl });
            }
            return mappedList;
        }
    } catch (e) {
        console.error("Error fetching store mutual guilds:", e);
    }

    const localMutual: Array<{ guild: Guild; iconUrl: string | null; }> = [];
    try {
        const allGuilds = GuildStore.getGuilds();
        for (const guild of Object.values(allGuilds)) {
            if ((!currentGuildId || guild.id !== currentGuildId) && GuildMemberStore.isMember(guild.id, userId)) {
                const iconUrl = guild.icon
                    ? (IconUtils.getGuildIconURL({
                        id: guild.id,
                        icon: guild.icon,
                        canAnimate: true,
                        size: 20
                    }) ?? null)
                    : null;
                localMutual.push({ guild, iconUrl });
            }
        }
    } catch (e) {
        console.error("Error fetching local mutual guilds:", e);
    }
    return localMutual;
}

const profileFetchQueue: string[] = [];
let isProcessingQueue = false;

async function processProfileQueue() {
    if (isProcessingQueue || profileFetchQueue.length === 0) return;
    isProcessingQueue = true;

    while (profileFetchQueue.length > 0) {
        const userId = profileFetchQueue.shift();
        if (userId) {
            try {
                await fetchUserProfile(userId, { with_mutual_guilds: true, with_mutual_friends_count: true }, false);
            } catch (e) {
                console.error("Failed to fetch profile for queue:", userId, e);
            }
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }

    isProcessingQueue = false;
}

function queueProfileFetch(userId: string) {
    const hasFriendsCount = UserProfileStore?.getMutualFriendsCount(userId) !== undefined;
    const hasMutualGuilds = UserProfileStore?.getMutualGuilds(userId) !== undefined;
    if (hasFriendsCount && hasMutualGuilds) return;
    if (profileFetchQueue.includes(userId)) return;
    profileFetchQueue.push(userId);
    processProfileQueue();
}

interface MemberRowProps {
    m: any;
    guild: Guild;
    sortField: string;
    isFriend: boolean;
    profileUpdateCounter: number;
}

function MemberRow({ m, guild, sortField, isFriend, profileUpdateCounter }: MemberRowProps) {
    const u = UserStore.getUser(m.userId);
    const mutualFriendsCount = getMutualFriendsCountVal(m.userId);
    const mutualGuilds = getMutualGuildsList(m.userId, guild.id);

    const showMutualFriends = sortField === "mutual-friends";

    useEffect(() => {
        queueProfileFetch(m.userId);
    }, [m.userId]);

    const tooltipText = (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "4px" }}>
            <div style={{ fontWeight: "bold", borderBottom: "1px solid var(--border-modifier-accent)", paddingBottom: "4px", marginBottom: "4px" }}>
                Shared Servers ({mutualGuilds.length})
            </div>
            {mutualGuilds.slice(0, 10).map(({ guild }) => (
                <div key={guild.id} style={{ whiteSpace: "nowrap" }}>
                    {guild.name}
                </div>
            ))}
            {mutualGuilds.length > 10 && (
                <div style={{ fontStyle: "italic", opacity: 0.8 }}>
                    + {mutualGuilds.length - 10} more
                </div>
            )}
        </div>
    );

    const mutualFriendsList = getMutualFriendsList(m.userId);
    const mutualFriendsTooltipText = (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "4px" }}>
            <div style={{ fontWeight: "bold", borderBottom: "1px solid var(--border-modifier-accent)", paddingBottom: "4px", marginBottom: "4px" }}>
                Mutual Friends ({mutualFriendsCount})
            </div>
            {mutualFriendsList.slice(0, 10).map(mf => {
                const userObj = mf.user || UserStore.getUser(mf.key || mf.id);
                if (!userObj) return null;
                return (
                    <div key={mf.key || mf.id || userObj.id} style={{ whiteSpace: "nowrap" }}>
                        {userObj.globalName || userObj.username}
                    </div>
                );
            })}
            {mutualFriendsList.length > 10 && (
                <div style={{ fontStyle: "italic", opacity: 0.8 }}>
                    + {mutualFriendsList.length - 10} more
                </div>
            )}
        </div>
    );

    return (
        <div className="gt-member-row">
            <span
                className="gt-member-name"
                onClick={() => copyWithToast(m.nick || (u as any)?.globalName || u?.username || "Unknown")}
                style={{ cursor: "pointer" }}
            >
                {m.nick || (u as any)?.globalName || u?.username || "Unknown"}
            </span>
            <span
                className="gt-member-tag"
                onClick={() => u?.username && copyWithToast(u.username)}
                style={{ cursor: u?.username ? "pointer" : undefined }}
            >
                {u?.username ? `@${u.username}` : ""}
            </span>
            <div className="gt-member-mutuals">
                {isFriend && <span className="gt-pill gt-pill-good">Friend</span>}
                {showMutualFriends ? (
                    mutualFriendsCount > 0 && (
                        <Tooltip text={mutualFriendsTooltipText}>
                            {tooltipProps => (
                                <div {...tooltipProps} className="gt-mutual-friends-list">
                                    {mutualFriendsList.slice(0, 4).map(mf => {
                                        const userObj = mf.user || UserStore.getUser(mf.key || mf.id);
                                        if (!userObj) return null;
                                        const avatarUrl = IconUtils.getUserAvatarURL(userObj, false, 20);
                                        const displayName = userObj.globalName || userObj.username;
                                        return (
                                            <div key={mf.key || mf.id || userObj.id} className="gt-friend-avatar" title={displayName}>
                                                {avatarUrl ? (
                                                    <img src={avatarUrl} alt={userObj.username} style={{ borderRadius: "50%", width: 20, height: 20 }} />
                                                ) : (
                                                    <div className="gt-avatar-acronym" style={{ borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, background: "var(--background-secondary)" }}>
                                                        {getGuildAcronym({ name: displayName } as any)}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {mutualFriendsCount > 4 && (
                                        <div className="gt-friend-count">
                                            +{mutualFriendsCount - 4}
                                        </div>
                                    )}
                                </div>
                            )}
                        </Tooltip>
                    )
                ) : (
                    mutualGuilds.length > 0 && (
                        <div className="gt-mutual-guilds">
                            {mutualGuilds.slice(0, 4).map(({ guild, iconUrl }) => (
                                <Tooltip key={guild.id} text={guild.name}>
                                    {tooltipProps => (
                                        <div
                                            {...tooltipProps}
                                            className="gt-guild-icon"
                                            style={{ cursor: "pointer" }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                NavigationRouter.transitionToGuild(guild.id);
                                            }}
                                        >
                                            {iconUrl ? (
                                                <img src={iconUrl} alt={guild.name} />
                                            ) : (
                                                <div className="gt-guild-acronym">{getGuildAcronym(guild)}</div>
                                            )}
                                        </div>
                                    )}
                                </Tooltip>
                            ))}
                            {mutualGuilds.length > 4 && (
                                <Tooltip text={tooltipText}>
                                    {tooltipProps => (
                                        <div {...tooltipProps} className="gt-guild-count">
                                            +{mutualGuilds.length - 4}
                                        </div>
                                    )}
                                </Tooltip>
                            )}
                        </div>
                    )
                )}
            </div>

            <span
                className="gt-member-id"
                onClick={() => copyWithToast(m.userId)}
                style={{ cursor: "pointer" }}
            >
                {m.userId}
            </span>
        </div>
    );
}

export function MembersTab({ guild }: { guild: Guild; }) {
    const [filter, setFilter] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const [profileUpdateCounter, setProfileUpdateCounter] = useState(0);

    useEffect(() => {
        const handleProfileSuccess = () => {
            setProfileUpdateCounter(prev => prev + 1);
        };
        FluxDispatcher.subscribe("USER_PROFILE_FETCH_SUCCESS", handleProfileSuccess);
        return () => {
            FluxDispatcher.unsubscribe("USER_PROFILE_FETCH_SUCCESS", handleProfileSuccess);
        };
    }, []);

    const members = useMemo(() => {
        const m = (GuildMemberStore as any).getMembers?.(guild.id) ?? [];
        return m;
    }, [guild.id]);

    const totalMembers = useMemo(() => {
        return GuildMemberCountStore?.getMemberCount(guild.id) ?? (guild as any).memberCount ?? "?";
    }, [guild.id]);

    const parsedQuery = useMemo(() => {
        let clean = filter;
        let sort = "default";

        const match = filter.match(/\bsort:([a-zA-Z0-9_-]+)\b/i);
        if (match) {
            const val = match[1].toLowerCase();
            if (val === "friends" || val === "friendsonly") {
                sort = "friends";
            } else if (val === "mutual-servers" || val === "mutualservers") {
                sort = "mutual-servers";
            } else if (val === "mutual-friends" || val === "mutualfriends") {
                sort = "mutual-friends";
            } else if (val === "name") {
                sort = "name";
            }
            clean = filter.replace(/\bsort:[a-zA-Z0-9_-]+\s*/i, "").trim();
        }

        return { cleanFilter: clean, sortField: sort };
    }, [filter]);

    const { cleanFilter, sortField } = parsedQuery;

    const autocompleteState = useMemo(() => {
        const match = filter.match(/(?:^|\s)(sort:[a-zA-Z0-9_-]*)$/i);
        if (!match) return { show: false, query: "", options: [] };

        const query = match[1].substring(5).toLowerCase();
        const allOptions = [
            { key: "sort:name", label: "Name (A-Z)", desc: "Sort alphabetically by member name" },
            { key: "sort:friends", label: "Friends First", desc: "Show friends at the top of the list" },
            { key: "sort:mutual-friends", label: "Mutual Friends", desc: "Sort by count of shared friends" },
            { key: "sort:mutual-servers", label: "Mutual Servers", desc: "Sort by count of shared servers" },
            { key: "sort:default", label: "Default Order", desc: "Reset to default cached order" }
        ];

        const filteredOpts = allOptions.filter(opt =>
            opt.key.toLowerCase().includes("sort:" + query) ||
            opt.label.toLowerCase().includes(query)
        );

        return {
            show: true,
            query,
            options: filteredOpts
        };
    }, [filter]);

    useEffect(() => {
        setActiveIndex(0);
    }, [autocompleteState.options.length]);

    const handleSelectSuggestion = (suggestionKey: string) => {
        const match = filter.match(/(.*)(?:^|\s)(sort:[a-zA-Z0-9_-]*)$/i);
        const prefix = match ? match[1] : "";
        const space = prefix ? " " : "";
        setFilter(prefix + space + suggestionKey + " ");
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!autocompleteState.show || autocompleteState.options.length === 0) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex(prev => (prev + 1) % autocompleteState.options.length);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex(prev => (prev - 1 + autocompleteState.options.length) % autocompleteState.options.length);
        } else if (e.key === "Enter") {
            e.preventDefault();
            const selectedOpt = autocompleteState.options[activeIndex];
            if (selectedOpt) {
                handleSelectSuggestion(selectedOpt.key);
            }
        }
    };

    const sortedAndFiltered = useMemo(() => {
        let result = [...members];
        if (cleanFilter) {
            const f = cleanFilter.toLowerCase();
            result = result.filter((m: any) => {
                const u = UserStore.getUser(m.userId);
                return (
                    m.userId?.includes(cleanFilter) ||
                    m.nick?.toLowerCase().includes(f) ||
                    u?.username?.toLowerCase().includes(f) ||
                    (u as any)?.globalName?.toLowerCase().includes(f)
                );
            });
        }

        if (sortField !== "default") {
            const memberMeta = new Map<string, {
                name: string;
                isFriend: boolean;
                mutualFriends: number;
                mutualServers: number;
            }>();

            for (const m of result) {
                const u = UserStore.getUser(m.userId);
                const name = (m.nick || (u as any)?.globalName || u?.username || "Unknown").toLowerCase();
                const isFriend = RelationshipStore.isFriend(m.userId);
                const mutualFriends = getMutualFriendsCountVal(m.userId);
                const mutualServers = getMutualGuildsList(m.userId, guild.id).length;

                memberMeta.set(m.userId, { name, isFriend, mutualFriends, mutualServers });
            }

            result.sort((a: any, b: any) => {
                const metaA = memberMeta.get(a.userId)!;
                const metaB = memberMeta.get(b.userId)!;

                let comparison = 0;
                if (sortField === "name") {
                    comparison = metaA.name.localeCompare(metaB.name);
                    return comparison;
                } else if (sortField === "friends") {
                    comparison = (metaA.isFriend ? 1 : 0) - (metaB.isFriend ? 1 : 0);
                    return -comparison;
                } else if (sortField === "mutual-friends") {
                    comparison = metaA.mutualFriends - metaB.mutualFriends;
                    return -comparison;
                } else if (sortField === "mutual-servers") {
                    comparison = metaA.mutualServers - metaB.mutualServers;
                    return -comparison;
                }
                return 0;
            });
        }

        return result.slice(0, 500);
    }, [members, cleanFilter, sortField, profileUpdateCounter]);

    return (
        <div className="gt-members">
            <Forms.FormTitle tag="h2" style={{ marginBottom: 12 }}>
                {`Members (${members.length} cached, ${totalMembers} total)`}
            </Forms.FormTitle>
            <Text variant="text-xs/normal" style={{ color: "var(--text-muted)", marginBottom: 8 }}>
                Only members currently loaded by your client are shown. Scroll the member list in Discord to load more.
            </Text>
            <div className="gt-controls-row">
                <TextInput
                    placeholder="Filter by name/nick/ID or type sort:…"
                    value={filter}
                    onChange={setFilter}
                    onKeyDown={handleKeyDown}
                    className="gt-input gt-search"
                />
                {autocompleteState.show && autocompleteState.options.length > 0 && (
                    <div className="gt-autocomplete-menu">
                        {autocompleteState.options.map((opt, idx) => (
                            <div
                                key={opt.key}
                                className={`gt-autocomplete-item ${idx === activeIndex ? "active" : ""}`}
                                onClick={() => handleSelectSuggestion(opt.key)}
                                onMouseEnter={() => setActiveIndex(idx)}
                            >
                                <span className="gt-autocomplete-key">{opt.key}</span>
                                <span className="gt-autocomplete-label">{opt.label}</span>
                                <span className="gt-autocomplete-desc">{opt.desc}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <div className="gt-search-hint">
                💡 Tip: Type <span className="gt-code">sort:name</span>, <span className="gt-code">sort:friends</span>, <span className="gt-code">sort:mutual-friends</span>, or <span className="gt-code">sort:mutual-servers</span> to sort the list.
            </div>
            <div className="gt-member-list">
                {sortedAndFiltered.map((m: any) => {
                    const isFriend = RelationshipStore.isFriend(m.userId);
                    return (
                        <MemberRow
                            key={m.userId}
                            m={m}
                            guild={guild}
                            sortField={sortField}
                            isFriend={isFriend}
                            profileUpdateCounter={profileUpdateCounter}
                        />
                    );
                })}
            </div>
        </div>
    );
}
