import mongoose from 'mongoose'
import { binLogModel, binModel, organizationModel } from '../models/models.js'
import { recentContradictions } from '../service/routeService.js'
import { BINS_ONLY_FILTER, scopeToOrganization } from '../../utils/helpers.js'
import { intervalsByOrg } from '../service/sharedService.js'
import { binFullness, fullnessPercent } from '../../utils/analytics.js'
import { lastReportAt, offlineCauses } from '../../utils/offline.js'
import { batteryLevel, fullnessLevel, thresholdsFor } from '../../utils/thresholds.js'
import { thresholdsByOrganization } from '../service/thresholdService.js'
import {
    ATTENTION_LIST_LIMIT, DEVICES_SHARE_MS, OFFLINE_AFTER_MISSED_REPORTS,
    RECENT_LOGS_LIMIT, HOUR_MS, RECENT_LOGS_HOURS, ROLES, ROUTE_CONTRADICTION_RECENT_HOURS,
} from '../../utils/constants.js'

// The dashboard's sections, served like the analytics page's (one request
// each, /api/overviews/<section>). Bins go out without their device key or
// MAC address: the key is what a device authenticates with.

// Diagnostics stay out too: every device is read here, and none of them is
// shown. So do the fields no section or the AI overview reads (about a sixth
// of the bytes).
const BIN_PUBLIC_PROJECTION = Object.freeze({
    deviceKey: 0, macAddress: 0, __v: 0, 'status.recentMeshMessageIds': 0, 'status.diagnostics': 0,
    'status.offlineAlertSentAt': 0, 'status.fillRateAt': 0, 'status.lastAwakeSeconds': 0,
});

function isGatewayBin(bin) {
    return bin.kind === 'gateway';
}

// One read of a fleet's devices, shared for DEVICES_SHARE_MS by the requests
// that ask for it (the dashboard's four sections, the AI overview): every
// device of an organization is several MB from the database. Callers only
// read the list. Keyed by what it depends on: the fleet and whether the user
// is an owner (owners also get the devices' own problems).
const sharedDevices = new Map();

export function devicesWithReasons(user) {
    const fleet = user.role === ROLES.OWNER ? `owner:${user.selectedOrg ?? 'all'}` : `org:${user.org}`;
    const now = Date.now();
    for (const [key, entry] of sharedDevices) {
        if (now - entry.at >= DEVICES_SHARE_MS) sharedDevices.delete(key);
    }
    const shared = sharedDevices.get(fleet);
    if (shared) return shared.devices;
    const devices = readDevicesWithReasons(user);
    sharedDevices.set(fleet, { devices, at: now });
    // A failed read is not kept: the next request tries again.
    devices.catch(() => sharedDevices.delete(fleet));
    return devices;
}

// The user's devices, each with why it needs attention (possibly none); an
// offline device also says why it is: { cause: 'self' } or, for a leaf behind
// a silent gateway, { cause: 'gateway', gatewayId, gatewayName } (or, behind a
// silent relay leaf, { cause: 'relay', relayId, relayName }).
async function readDevicesWithReasons(user) {
    const now = Date.now();
    const devices = await binModel.find(scopeToOrganization({}, user), BIN_PUBLIC_PROJECTION).lean();
    const intervals = await intervalsByOrg(devices);
    const orgIds = [...new Set(devices.map(device => String(device.ownerId)))].map(id => new mongoose.Types.ObjectId(id));
    const contradicted = new Set((await recentContradictions(orgIds, new Date(now - ROUTE_CONTRADICTION_RECENT_HOURS * HOUR_MS)))
        .map(claim => String(claim.binId)));
    const causes = offlineCauses(devices, intervals, now);
    const thresholds = await thresholdsByOrganization({ _id: { $in: orgIds } });
    const names = new Map(devices.map(device => [String(device._id), device.binName]));
    return devices.map(device => {
        const fullness = isGatewayBin(device) ? null : binFullness(device);
        const cause = causes.get(String(device._id));
        const cutOffs = thresholdsFor(thresholds, device.ownerId);
        const reasons = [];
        if (fullnessLevel(fullness, cutOffs) === 'critical') reasons.push('full');
        if (device.maintenance?.nextServiceAt && new Date(device.maintenance.nextServiceAt) < new Date(now)) {
            reasons.push('maintenance');
        }
        if (cause) reasons.push('offline');
        if (['warning', 'critical'].includes(batteryLevel(device.status?.battery, cutOffs))) reasons.push('battery');
        if (['warning', 'critical'].includes(device.status?.health)) reasons.push('health');
        if (contradicted.has(String(device._id))) reasons.push('contradicted');
        // A device's own problems (its diagnostics) are for owners.
        if (user.role === ROLES.OWNER && device.status?.issues?.length) reasons.push('device');
        return {
            ...device,
            fullness,
            reasons,
            ...(cause ? {
                offlineCause: cause.cause === 'gateway'
                    ? { ...cause, gatewayName: names.get(String(cause.gatewayId)) ?? null }
                    : cause.cause === 'relay'
                        ? { ...cause, relayName: names.get(String(cause.relayId)) ?? null }
                        : cause,
            } : {}),
        };
    });
}

// The bins' average fullness, rounded; null when none reported one.
function averageFullness(bins) {
    const fullnesses = bins.map(bin => bin.fullness).filter(value => value !== null);
    return fullnesses.length > 0
        ? Math.round(fullnesses.reduce((sum, value) => sum + value, 0) / fullnesses.length)
        : null;
}

// The tiles' counts: almost full, overdue maintenance and the average fullness.
async function summary(user) {
    const devices = await devicesWithReasons(user);
    const bins = devices.filter(device => !isGatewayBin(device));
    return {
        totalBins: bins.length,
        almostFull: bins.filter(bin => bin.reasons.includes('full')).length,
        requiringMaintenance: devices.filter(device => device.reasons.includes('maintenance')).length,
        averageFullness: averageFullness(bins),
    };
}

// Owners only: each organization's numbers in one row, those with the most
// devices needing attention first, so the one to look at stands out.
async function organizations(user) {
    if (user.role !== ROLES.OWNER) {
        throw Object.assign(new Error('Only an owner sees every organization.'), { status: 403 });
    }
    const [devices, orgs] = await Promise.all([
        devicesWithReasons(user),
        organizationModel.find(user.selectedOrg ? { _id: user.selectedOrg } : {}, { name: 1 }).lean(),
    ]);
    const rows = orgs.map(org => {
        const own = devices.filter(device => String(device.ownerId) === String(org._id));
        const bins = own.filter(device => !isGatewayBin(device));
        return {
            _id: org._id,
            name: org.name,
            bins: bins.length,
            gateways: own.length - bins.length,
            needsAttention: own.filter(device => device.reasons.length > 0).length,
            offline: own.filter(device => device.reasons.includes('offline')).length,
            almostFull: bins.filter(bin => bin.reasons.includes('full')).length,
            averageFullness: averageFullness(bins),
        };
    });
    rows.sort((a, b) => b.needsAttention - a.needsAttention || a.name.localeCompare(b.name));
    return { organizations: rows };
}

// Devices that stopped reporting, gateways included: a silent gateway also
// silences every leaf behind it.
async function offline(user) {
    const devices = (await devicesWithReasons(user)).filter(device => device.reasons.includes('offline'));
    return {
        count: devices.length,
        missedReports: OFFLINE_AFTER_MISSED_REPORTS,
        devices: devices
            .sort((a, b) => new Date(lastReportAt(a)) - new Date(lastReportAt(b)))
            .slice(0, ATTENTION_LIST_LIMIT)
            .map(device => ({ _id: device._id, binName: device.binName, kind: device.kind, lastReport: lastReportAt(device) })),
    };
}

// Devices that need attention, with the reasons; the map shows those that need
// a visit (full, maintenance due or offline), the table all of them.
async function attention(user) {
    const devices = (await devicesWithReasons(user)).filter(device => device.reasons.length > 0);
    // Most reasons first, then the fullest.
    devices.sort((a, b) => b.reasons.length - a.reasons.length || (b.fullness ?? -1) - (a.fullness ?? -1));
    return { total: devices.length, devices: devices.slice(0, ATTENTION_LIST_LIMIT) };
}

// The last day's reports and events, newest first, with each bin's name and
// its fullness at that report, as the attention table beside it shows it.
// Gateways' logs stay out, as in the other fleet statistics.
async function recentLogs(user) {
    const bins = await binModel.find(scopeToOrganization({ ...BINS_ONLY_FILTER }, user), { binName: 1 }).lean();
    const names = new Map(bins.map(bin => [String(bin._id), bin.binName]));
    const logs = await binLogModel.find(
        { binId: { $in: bins.map(bin => bin._id) }, createdAt: { $gte: new Date(Date.now() - RECENT_LOGS_HOURS * HOUR_MS) } },
        { binId: 1, type: 1, severity: 1, newLevel: 1, weight: 1, health: 1, faults: 1, message: 1, createdAt: 1 },
    ).sort({ createdAt: -1 }).limit(RECENT_LOGS_LIMIT).lean();
    return {
        logs: logs.map(log => ({
            ...log,
            binName: names.get(String(log.binId)) ?? null,
            fullness: fullnessPercent(log.newLevel, log.weight),
        })),
    };
}

export const DASHBOARD_SECTIONS = {
    summary,
    offline,
    attention,
    'recent-logs': recentLogs,
    organizations,
};
