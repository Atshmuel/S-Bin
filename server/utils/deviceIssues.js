import { DAY_MS, MINUTE_MS, DEVICE_EVENT_ISSUE_DAYS, DEVICE_ISSUE_LIMITS as LIMITS, FAULT_RESET_REASONS } from "./constants.js";

// A device's problems, from its reports' diagnostics (see utils/diagnostics.js):
// each report says which conditions it shows, and the bin's open issues are
// updated from that. Pure.

const EVENT_TYPES = new Set(["unexpected_restart", "missed_report"]);
const known = value => value !== undefined && value !== null;

// How many reports a device skipped between its previous report and this one
// (both when the readings were taken), at its organization's interval: 0 when
// the gap is within the allowed ratio of one interval, or when there was no
// previous report to compare with.
export function missedReports(previousAt, at, intervalMinutes) {
    if (!previousAt || !at || !(intervalMinutes > 0)) return 0;
    const intervals = (new Date(at) - new Date(previousAt)) / (intervalMinutes * MINUTE_MS);
    return intervals > LIMITS.missedReportGapRatio ? Math.round(intervals) - 1 : 0;
}

// What a report shows, by type: true (present) or false (fine), with the value
// that decided it; a type the report has no data for is left out, so its
// issue stays as it was. `previous` is the device's diagnostics before this one.
export function detectIssues(diagnostics, previous = null) {
    const found = {};
    if (diagnostics.resetReason) {
        const powerCut = ["poweron", "external"].includes(diagnostics.resetReason) && diagnostics.wakeCause === "undefined";
        found.unexpected_restart = {
            present: FAULT_RESET_REASONS.includes(diagnostics.resetReason) || powerCut,
            value: diagnostics.resetReason,
        };
    }
    const rsrp = diagnostics.network?.rsrp;
    if (known(rsrp)) {
        const weak = value => known(value) && value < LIMITS.weakRsrpDbm;
        found.weak_signal = { present: weak(rsrp) && weak(previous?.network?.rsrp), value: rsrp };
    }
    const temperatures = [diagnostics.chipTempC, diagnostics.pmuTempC].filter(known);
    if (temperatures.length) {
        const hottest = Math.max(...temperatures);
        found.overheating = { present: hottest > LIMITS.hotTempC, value: hottest };
    }
    if (known(diagnostics.distanceSamples)) {
        const spread = diagnostics.distanceSpreadMm ?? 0;
        found.noisy_sensor = {
            present: diagnostics.distanceSamples < LIMITS.minDistanceSamples || spread > LIMITS.noisyDistanceSpreadMm,
            value: diagnostics.distanceSamples < LIMITS.minDistanceSamples ? diagnostics.distanceSamples : spread,
        };
    }
    const stages = diagnostics.stages;
    if (stages && [stages.modemMs, stages.networkMs, stages.mqttMs].some(known)) {
        const total = (stages.modemMs ?? 0) + (stages.networkMs ?? 0) + (stages.mqttMs ?? 0);
        found.slow_cycle = { present: total > LIMITS.slowCycleMs, value: total };
    }
    if (known(diagnostics.missedCycles) || known(diagnostics.beaconRssi)) {
        const missed = diagnostics.missedCycles ?? 0;
        found.weak_mesh_link = {
            present: missed >= LIMITS.leafMissedBeacons || (known(diagnostics.beaconRssi) && diagnostics.beaconRssi < LIMITS.weakBeaconRssiDbm),
            value: missed >= LIMITS.leafMissedBeacons ? missed : diagnostics.beaconRssi ?? null,
        };
    }
    return found;
}

// The open issues after a report at `at`: one present opens (or stays, its
// last time and value updated); a condition the report reads fine closes; an
// event closes DEVICE_EVENT_ISSUE_DAYS after it last happened.
export function nextIssues(open = [], found, at) {
    const byType = new Map(open.map(issue => [issue.type, issue]));
    for (const [type, { present, value }] of Object.entries(found)) {
        const issue = byType.get(type);
        if (present) {
            byType.set(type, { type, since: issue?.since ?? at, lastSeenAt: at, value });
        } else if (issue && !EVENT_TYPES.has(type)) {
            byType.delete(type);
        }
    }
    for (const [type, issue] of byType) {
        if (EVENT_TYPES.has(type) && at - new Date(issue.lastSeenAt) > DEVICE_EVENT_ISSUE_DAYS * DAY_MS) byType.delete(type);
    }
    return [...byType.values()];
}
