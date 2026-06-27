/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyWithToast } from "@utils/discord";
import { Guild } from "@vencord/discord-types";
import { Forms, GuildRoleStore, PermissionsBits, React, TextInput, useMemo, useState } from "@webpack/common";

import { PERM_LABELS } from "./PermissionsTab";

interface RoleRowProps {
    r: any;
    isSelected: boolean;
    onToggle: (id: string) => void;
}

function RoleRow({ r, isSelected, onToggle }: RoleRowProps) {
    const colorHex = r.colorString || (r.color ? `#${r.color.toString(16).padStart(6, "0")}` : "#949ba4");

    const rolePerms = BigInt(r.permissions ?? 0);
    const isAdmin = (rolePerms & BigInt(PermissionsBits?.ADMINISTRATOR ?? 0x8n)) !== 0n;

    // Only scan the permission bitfield when this row is expanded; the perms box
    // is otherwise hidden, so computing it for every collapsed role is wasted work.
    const enabledPerms = useMemo(() => {
        if (!isSelected || isAdmin) return [] as Array<[string, string]>;
        return Object.entries(PERM_LABELS).filter(([key]) => {
            const bit = (PermissionsBits as any)?.[key];
            return bit != null && (rolePerms & BigInt(bit)) !== 0n;
        }) as Array<[string, string]>;
    }, [isSelected, isAdmin, rolePerms]);

    return (
        <div className={`gt-role-item-wrap ${isSelected ? "active" : ""}`}>
            <div
                className="gt-role-row"
                onClick={() => onToggle(r.id)}
                style={{ cursor: "pointer" }}
            >
                <span
                    className="gt-role-dot clickable"
                    style={{ background: colorHex }}
                    onClick={e => {
                        e.stopPropagation();
                        copyWithToast(colorHex);
                    }}
                    title={`Click to copy: ${colorHex}`}
                />
                <span
                    className="gt-role-name"
                    style={{ color: colorHex ?? undefined }}
                >
                     {r.name}
                </span>
                <span
                    className="gt-role-copy-btn"
                    onClick={e => {
                        e.stopPropagation();
                        copyWithToast(r.name);
                    }}
                    title={`Copy name: ${r.name}`}
                    style={{ cursor: "pointer", opacity: 0.6, fontSize: 11 }}
                >
                    📋
                </span>
                <span className="gt-role-meta" onClick={e => e.stopPropagation()}>
                    {r.hoist && <span className="gt-pill">hoist</span>}
                    {r.mentionable && <span className="gt-pill">mention</span>}
                    {r.managed && <span className="gt-pill">managed</span>}
                    {r.tags?.bot_id && <span className="gt-pill">bot</span>}
                    {r.tags?.premium_subscriber !== undefined && <span className="gt-pill">booster</span>}
                    <span
                        className="gt-role-id"
                        onClick={() => copyWithToast(r.id)}
                        style={{ cursor: "pointer", textDecoration: "underline" }}
                    >
                        {r.id}
                    </span>
                </span>
            </div>
            <div className={`gt-role-perms-box gt-collapsible-content ${isSelected ? "" : "gt-collapsed"}`}>
                <div className="gt-role-perms-title">
                    {isAdmin ? "Administrator (All Permissions Granted)" : "Enabled Permissions:"}
                </div>
                {!isAdmin && enabledPerms.length === 0 ? (
                    <div className="gt-role-perm-none">None</div>
                ) : !isAdmin ? (
                    <div className="gt-role-perms-grid">
                        {enabledPerms.map(([key, label]) => (
                            <span key={key} className="gt-pill gt-pill-good">
                                {label}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export function RolesTab({ guild }: { guild: Guild; }) {
    const [filter, setFilter] = useState("");
    const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

    const roles = useMemo(() => {
        const rolesObj = GuildRoleStore.getRolesSnapshot(guild.id) ?? {};
        return Object.values(rolesObj) as any[];
    }, [guild.id]);

    const sorted = useMemo(() => {
        return [...roles].sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
    }, [roles]);

    const filtered = useMemo(() => {
        const f = filter.toLowerCase();
        return sorted.filter(r =>
            !filter || r.name?.toLowerCase().includes(f) || r.id?.includes(filter)
        );
    }, [sorted, filter]);

    const handleToggle = React.useCallback((id: string) => {
        setSelectedRoleId(prev => (prev === id ? null : id));
    }, []);

    return (
        <div className="gt-roles">
            <Forms.FormSection title={`Roles (${roles.length})`}>
                <TextInput
                    placeholder="Filter roles by name or ID…"
                    value={filter}
                    onChange={setFilter}
                    className="gt-input gt-search"
                />
                <div className="gt-role-list">
                    {filtered.map(r => (
                        <RoleRow
                            key={r.id}
                            r={r}
                            isSelected={selectedRoleId === r.id}
                            onToggle={handleToggle}
                        />
                    ))}
                </div>
            </Forms.FormSection>
        </div>
    );
}
