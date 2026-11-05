// Firmware versions ("2.8.1", see the diagnostics' firmwareVersion) compared
// as numbers, so 2.10.0 is newer than 2.9.0. The device counts come grouped:
// rows of { organization, version, count }, a null version for a device that
// never reported one.

export const UNKNOWN_VERSION = 'unknown';
export const VERSION_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

// Negative when a is older than b, positive when newer, 0 when equal.
export function compareVersions(a, b) {
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const difference = (left[i] ?? 0) - (right[i] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

// The highest version any device runs; null when none has reported one.
export function newestVersion(rows) {
    return rows.reduce((best, { version }) => version && (!best || compareVersions(version, best) > 0) ? version : best, null);
}

const isBehind = (version, newest) => Boolean(version) && compareVersions(version, newest) < 0;

// Per organization: its devices and how many run a version behind the newest.
export function organizationsLevel(rows, newest) {
    const byOrganization = new Map();
    for (const { organization, version, count } of rows) {
        const entry = byOrganization.get(organization) ?? { organization, devices: 0, behind: 0 };
        entry.devices += count;
        if (isBehind(version, newest)) entry.behind += count;
        byOrganization.set(organization, entry);
    }
    return [...byOrganization.values()];
}

// Per version: how many devices run it; the newest first, devices without a
// version last.
export function versionsLevel(rows, newest) {
    const byVersion = new Map();
    for (const { version, count } of rows) {
        byVersion.set(version, (byVersion.get(version) ?? 0) + count);
    }
    return [...byVersion]
        .map(([version, devices]) => ({ version, devices, behind: isBehind(version, newest) }))
        .sort((a, b) => !a.version ? 1 : !b.version ? -1 : compareVersions(b.version, a.version));
}
