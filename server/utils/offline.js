// Which devices are offline and why, for the dashboard and the offline alert.
// A device is offline once it has missed OFFLINE_AFTER_MISSED_REPORTS reports
// in a row. A leaf reports through a gateway: when that gateway went silent at
// about the same time, the gateway is the cause, not the leaf.

import { MINUTE_MS, OFFLINE_AFTER_MISSED_REPORTS, OFFLINE_GRACE_MS } from './constants.js';

export function lastReportAt(device) {
    return device.status?.updatedAt ?? device.createdAt ?? null;
}

export function isOffline(device, intervalMinutes, now) {
    const lastReport = lastReportAt(device);
    const allowedMs = OFFLINE_AFTER_MISSED_REPORTS * intervalMinutes * MINUTE_MS + OFFLINE_GRACE_MS;
    return !lastReport || now - new Date(lastReport).getTime() > allowedMs;
}

// The device a leaf's last report came through: the leaf that relayed it when
// there was one, else its gateway; null for a device with its own connection.
export function upstreamId(device) {
    const connection = device.status?.connection;
    return connection?.via === 'mesh' ? connection.viaLeafId ?? connection.gatewayId ?? null : null;
}

// Whether the upstream went silent with the device: a working one would have
// reported again a slot after the device's last report, so it has not
// reported since half an interval after it.
function upstreamSilent(device, upstream, intervalMinutes) {
    const upstreamLast = lastReportAt(upstream);
    if (!upstreamLast) return true;
    return new Date(upstreamLast).getTime() <
        new Date(lastReportAt(device)).getTime() + intervalMinutes * MINUTE_MS / 2;
}

// Each offline device's cause by its id: { cause: 'gateway', gatewayId } when
// its upstream is silent too (or { cause: 'relay', relayId } when that upstream is
// the leaf that relayed it, itself named by its own cause), otherwise { cause: 'self' }. Intervals maps an
// organization's id to its report interval in minutes.
export function offlineCauses(devices, intervals, now) {
    const byId = new Map(devices.map(device => [String(device._id), device]));
    const causes = new Map();
    for (const device of devices) {
        const intervalMinutes = intervals.get(String(device.ownerId));
        if (!isOffline(device, intervalMinutes, now)) continue;
        const upstream = byId.get(String(upstreamId(device)));
        const viaRelay = Boolean(device.status?.connection?.viaLeafId);
        causes.set(String(device._id), upstream && upstreamSilent(device, upstream, intervalMinutes)
            ? (viaRelay ? { cause: 'relay', relayId: upstream._id } : { cause: 'gateway', gatewayId: upstream._id })
            : { cause: 'self' });
    }
    return causes;
}
