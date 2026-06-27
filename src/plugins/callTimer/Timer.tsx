/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useFixedTimer } from "@utils/react";
import { formatDurationMs } from "@utils/text";
import { Tooltip, useMemo } from "@webpack/common";

import { settings } from "./index";
import { TimerIcon } from "./TimerIcon";
import { TimerText } from "./timerText";

export function Timer({ time }: Readonly<{ time: number; }>) {
    const durationMs = useFixedTimer({ initialTime: time });
    const { format, showSeconds, showRoleColor } = settings.store;

    const formatted = useMemo(
        () => formatDurationMs(durationMs, format === "human", showSeconds),
        [durationMs, format, showSeconds]
    );
    const defaultColorClassName = useMemo(
        () => showRoleColor ? "" : "usernameFont__71dd5 username__73ce9",
        [showRoleColor]
    );

    if (settings.store.showWithoutHover) {
        return <TimerText text={formatted} className={defaultColorClassName} />;
    } else {
        // show as a tooltip
        return (
            <Tooltip text={formatted}>
                {({ onMouseEnter, onMouseLeave }) => (
                    <div
                        onMouseEnter={onMouseEnter}
                        onMouseLeave={onMouseLeave}
                        role="tooltip"
                    >
                        <TimerIcon />
                    </div>
                )}
            </Tooltip>
        );
    }
}
