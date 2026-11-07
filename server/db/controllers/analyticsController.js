import mongoose from 'mongoose'
import { binLogModel, binModel, deviceDiagnosticModel, organizationModel, routeModel, userModel } from '../models/models.js'
import { UNKNOWN_VERSION, VERSION_PATTERN, compareVersions, newestVersion, organizationsLevel, versionsLevel } from '../../utils/firmware.js'
import { READINGS_FILTER, WITH_PROBLEMS_FILTER, batteryTrendsByBin, readingsByBin } from '../service/readingsService.js'
import { describeFaults } from '../../utils/faults.js'
import { BINS_ONLY_FILTER, receivedAtOf, scopeToOrganization } from '../../utils/helpers.js'
import { getOrgDeviceSettingsShared, intervalsByOrg } from '../service/sharedService.js'
import { DASHBOARD_SECTIONS, devicesWithReasons } from './dashboardController.js'
import { costsOverview } from '../service/costsService.js'
import { refreshStaleFillRates } from '../service/fillRateService.js'
import { organizationThresholds, scopedThresholds } from '../service/thresholdService.js'
import { DEFAULT_THRESHOLDS, thresholdExpression, thresholdsFor } from '../../utils/thresholds.js'
import { lastDays, organizationDays, scopedOrganizations } from '../service/statsService.js'
import {
    ANALYTICS_RANGES_DAYS, BATTERY_BUCKETS, BATTERY_SOON_DAYS, BATTERY_SOON_LIST_LIMIT, BATTERY_TREND_DAYS,
    DEFAULT_RANGE_DAYS, FILL_RATE_WINDOW_DAYS, FULL_SOON_HOURS, FULL_SOON_LIST_LIMIT, FULLNESS_BUCKETS,
    GATEWAY_LIST_LIMIT, LEAST_RELIABLE_LIMIT, PROBLEM_BINS_LIMIT, RELIABILITY_DAYS, OFFLINE_AFTER_MISSED_REPORTS,
    AI_BRIEFING_DAYS, AI_BRIEFING_DEVICE_LIMIT, DAY_MS, HOUR_MS, ROLES,
} from '../../utils/constants.js'
import {
    HEALTH_CAUSE_NAMES,
    batteryDaysLeft, binFullness, collectionDueAt, dayKey, daysBetween, detectCollections, fillRatePerDay,
    FULLNESS_EXPRESSION, fullnessPercent, healthCauses, isValidTimeZone, rangeStart, rankProblemBins, reportReliability, timingPoints, trendPerDay, weekdayTotals,
} from '../../utils/analytics.js'

// Each section of the bin page and the analytics page is its own request, so
// sections load in parallel and a slow one holds up nothing else. Every
// response is aggregated to what its chart draws; raw logs never leave.

// Only device reports: maintenance notes and system entries carry no readings.

function parseRangeDays(value) {
    const days = Number(value);
    return ANALYTICS_RANGES_DAYS.includes(days) ? days : DEFAULT_RANGE_DAYS;
}

// The viewer's time zone for day buckets on the analytics page (bins in
// several zones share one chart); UTC when the client sends none.
function requestTimeZone(req) {
    return isValidTimeZone(req.query.tz) ? req.query.tz : 'UTC';
}

function toReading(log) {
    return {
        at: log.createdAt,
        level: log.newLevel ?? null,
        weight: log.weight ?? null,
        battery: log.battery ?? null,
    };
}

async function binReadings(binId, since, extraFields = {}) {
    const logs = await binLogModel.find(
        { binId, ...READINGS_FILTER, createdAt: { $gte: since } },
        { createdAt: 1, newLevel: 1, weight: 1, battery: 1, ...extraFields },
    ).sort({ createdAt: 1 }).lean();
    return logs;
}


function scopedBins(user, filter, projection) {
    return binModel.find(scopeToOrganization(filter, user), projection).lean();
}

// The logs' filter for every device in the user's scope (scopedBins with no
// filter): none for an owner looking at every organization, whose scope is
// all logs, rather than thousands of ids for the database to look up one by
// one. A deleted device's logs go with it (deleteDeviceData).
function scopedLogsFilter(user, bins) {
    return user.role === ROLES.OWNER && !user.selectedOrg ? {} : { binId: { $in: bins.map(bin => bin._id) } };
}

// When each device first reported (kept logs only), in one query: one query
// per device does not scale to thousands of them.
async function firstReportTimes(binIds, logsFilter = { binId: { $in: binIds } }) {
    const firsts = await binLogModel.aggregate([
        { $match: { ...logsFilter, ...READINGS_FILTER } },
        { $group: { _id: '$binId', at: { $min: '$createdAt' } } },
    ]);
    const byId = new Map(firsts.map(first => [String(first._id), first.at]));
    return new Map(binIds.map(binId => [String(binId), byId.get(String(binId)) ?? null]));
}

// ---- Bin page: GET /api/bins/:id/analytics/:section ----

async function binFillRate(bin) {
    if (bin.kind === 'gateway') return { applicable: false };
    const readings = (await binReadings(bin._id, rangeStart(FILL_RATE_WINDOW_DAYS))).map(toReading);
    const fullness = binFullness(bin);
    const ratePerDay = fillRatePerDay(readings);
    const { fullnessCritical } = await organizationThresholds(bin.ownerId);
    return {
        applicable: true,
        fullness,
        ratePerDay,
        collectionDueAt: collectionDueAt(fullness, ratePerDay, Date.now(), fullnessCritical),
        criticalPercent: fullnessCritical,
    };
}

async function binHistory(bin, { days }) {
    const readings = (await binReadings(bin._id, rangeStart(days))).map(toReading);
    return {
        points: readings,
        collections: detectCollections(readings).map(collection => collection.at),
    };
}

async function binCollections(bin, { days }) {
    const readings = (await binReadings(bin._id, rangeStart(days))).map(toReading);
    return { collections: detectCollections(readings).reverse() };
}

async function binBattery(bin, { days }) {
    const timeZone = bin.timezone || 'UTC';
    const [daily, recent] = await Promise.all([
        binLogModel.aggregate([
            { $match: { binId: bin._id, ...READINGS_FILTER, createdAt: { $gte: rangeStart(days) } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: timeZone } },
                    battery: { $avg: '$battery' },
                    awakeSeconds: { $avg: '$lastAwakeSeconds' },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        binReadings(bin._id, rangeStart(BATTERY_TREND_DAYS)),
    ]);
    const ratePerDay = trendPerDay(recent.map(toReading), 'battery');
    const { batteryCritical } = await organizationThresholds(bin.ownerId);
    return {
        daily: daily.map(day => ({
            day: day._id,
            battery: Math.round(day.battery),
            awakeSeconds: day.awakeSeconds === null ? null : Math.round(day.awakeSeconds),
        })),
        battery: bin.status?.battery ?? null,
        ratePerDay,
        daysLeft: batteryDaysLeft(bin.status?.battery, ratePerDay, batteryCritical),
        criticalPercent: batteryCritical,
    };
}

async function binConnection(bin, { days }) {
    const logs = await binReadings(bin._id, rangeStart(days), { connection: 1, rssi: 1, hops: 1 });
    return {
        points: logs.map(log => ({
            at: log.createdAt,
            via: log.connection ?? null,
            rssi: log.rssi ?? null,
            hops: log.hops ?? null,
        })),
    };
}

// How long each report took to reach the server and, for owners only (the raw
// diagnostics are theirs), what the device said about its own timing: a leaf's
// wake guard and clock uncertainty, a gateway's stage times. Diagnostics are
// kept shorter than logs, so those figures go back less far.
async function binTiming(bin, { days, isOwner }) {
    const since = rangeStart(days);
    const logs = await binReadings(bin._id, since);
    const diagnosticsByLog = new Map();
    if (isOwner) {
        const stored = await deviceDiagnosticModel.find({ binId: bin._id, createdAt: { $gte: since } }, { logId: 1, diagnostics: 1 }).lean();
        for (const entry of stored) diagnosticsByLog.set(String(entry.logId), entry.diagnostics);
    }
    return {
        points: timingPoints(logs.map(log => ({
            at: log.createdAt,
            receivedAt: receivedAtOf(log._id),
            diagnostics: diagnosticsByLog.get(String(log._id)),
        }))),
    };
}

async function binReliability(bin) {
    const now = new Date();
    const [{ reportIntervalMinutes }, firstReports, counts] = await Promise.all([
        getOrgDeviceSettingsShared(bin.ownerId),
        firstReportTimes([bin._id]),
        Promise.all(RELIABILITY_DAYS.map(days => binLogModel.countDocuments({
            binId: bin._id, ...READINGS_FILTER, createdAt: { $gte: rangeStart(days) },
        }))),
    ]);
    return Object.fromEntries(RELIABILITY_DAYS.map((days, i) => [
        `days${days}`,
        reportReliability(counts[i], rangeStart(days), now, reportIntervalMinutes, firstReports.get(String(bin._id))),
    ]));
}

const BIN_SECTIONS = {
    'fill-rate': binFillRate,
    history: binHistory,
    collections: binCollections,
    battery: binBattery,
    connection: binConnection,
    timing: binTiming,
    reliability: binReliability,
};

export async function getBinAnalytics(req, res) {
    const section = BIN_SECTIONS[req.params.section];
    if (!section) return res.status(404).json({ message: `Unknown analytics section '${req.params.section}'.` });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: `Invalid id: '${req.params.id}'` });
    }
    try {
        const bin = await binModel.findOne(
            scopeToOrganization({ _id: new mongoose.Types.ObjectId(req.params.id) }, req.user),
            { macAddress: 0, deviceKey: 0 },
        ).lean();
        if (!bin) return res.status(404).json({ message: 'Bin not found.' });
        res.status(200).json(await section(bin, { days: parseRangeDays(req.query.range), isOwner: req.user.role === ROLES.OWNER }));
    } catch (error) {
        res.status(500).json({ message: error?.message || 'Failed to load the analytics.' });
    }
}

// ---- Analytics page: GET /api/overviews/:section ----

// Bins expected to need collecting soon (by their fill rate, see
// fillRateService, up to their organization's critical fullness), worked out
// by the database: the counts within each of
// FULL_SOON_HOURS and the soonest FULL_SOON_LIST_LIMIT. Bins that already need
// collecting are left out: the dashboard's "almost full" tile counts them.
export async function fullSoon(user) {
    const now = Date.now();
    const scope = scopeToOrganization({ ...BINS_ONLY_FILTER }, user);
    const [thresholds] = await Promise.all([scopedThresholds(user), refreshStaleFillRates(scope, now)]);
    const critical = thresholdExpression(thresholds, 'fullnessCritical');
    const by = hours => new Date(now + hours * HOUR_MS);
    const [result] = await binModel.aggregate([
        { $match: { ...scope, 'status.fillRatePerDay': { $gt: 0 } } },
        { $addFields: { fullness: { $round: [FULLNESS_EXPRESSION, 0] } } },
        { $match: { $expr: { $lt: ['$fullness', critical] } } },
        {
            $addFields: {
                collectionDueAt: {
                    $toDate: {
                        $add: [now, { $multiply: [{ $divide: [{ $subtract: [critical, '$fullness'] }, '$status.fillRatePerDay'] }, DAY_MS] }],
                    },
                },
            },
        },
        { $match: { collectionDueAt: { $lte: by(FULL_SOON_HOURS.at(-1)) } } },
        {
            $facet: {
                counts: [{
                    $group: {
                        _id: null,
                        ...Object.fromEntries(FULL_SOON_HOURS.map(hours => [
                            `within${hours}h`, { $sum: { $cond: [{ $lte: ['$collectionDueAt', by(hours)] }, 1, 0] } },
                        ])),
                    },
                }],
                bins: [
                    { $sort: { collectionDueAt: 1, _id: 1 } },
                    { $limit: FULL_SOON_LIST_LIMIT },
                    { $project: { binName: 1, fullness: 1, ratePerDay: '$status.fillRatePerDay', collectionDueAt: 1 } },
                ],
            },
        },
    ]);
    const counts = result.counts[0] ?? {};
    return {
        counts: Object.fromEntries(FULL_SOON_HOURS.map(hours => [`within${hours}h`, counts[`within${hours}h`] ?? 0])),
        bins: result.bins,
    };
}

function bucketCounts(values, buckets) {
    return buckets.map(([from, to]) => ({
        from,
        to: Math.min(to, 100),
        count: values.filter(value => value >= from && value < to).length,
    }));
}

// Counted in the database: a few rows back instead of every bin. The fullness
// is rounded as fullnessPercent() rounds it (half up; $round is half to even).
async function fullnessDistribution(user) {
    const rounded = { $floor: { $add: ['$fullness', 0.5] } };
    const groups = await binModel.aggregate([
        { $match: scopeToOrganization({ ...BINS_ONLY_FILTER }, user) },
        { $project: { fullness: FULLNESS_EXPRESSION } },
        {
            $group: {
                _id: {
                    $switch: {
                        branches: [
                            { case: { $eq: ['$fullness', null] }, then: 'unknown' },
                            ...FULLNESS_BUCKETS.map(([from, to], index) => ({
                                case: { $and: [{ $gte: [rounded, from] }, { $lt: [rounded, to] }] }, then: index,
                            })),
                        ],
                        default: 'outside',
                    },
                },
                count: { $sum: 1 },
            },
        },
    ]);
    const counts = new Map(groups.map(group => [group._id, group.count]));
    return {
        buckets: FULLNESS_BUCKETS.map(([from, to], index) => ({ from, to: Math.min(to, 100), count: counts.get(index) ?? 0 })),
        unknown: counts.get('unknown') ?? 0,
    };
}

// The range's days (the last `days`, ending today) in numbers across the
// organizations in the user's scope, from each one's days (see statsService).
async function scopedDays(user, days, timeZone) {
    const dayList = lastDays(days, timeZone);
    const organizations = await scopedOrganizations(user, {});
    const perOrganization = await Promise.all(organizations.map(organization => organizationDays(organization, dayList)));
    return dayList.map(day => {
        const ofDay = perOrganization.map(stats => stats.get(day)).filter(Boolean);
        const total = key => ofDay.reduce((sum, stat) => sum + stat[key], 0);
        return {
            day,
            collections: total('collections'),
            fullnessBeforeSum: total('fullnessBeforeSum'),
            fullnessBeforeCount: total('fullnessBeforeCount'),
            weighedKg: total('weighedKg'),
            weighedCollections: total('weighedCollections'),
        };
    });
}

function average(values) {
    return values.length > 0 ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

const averageFullness = (sum, count) => count > 0 ? Math.round(sum / count) : null;

async function collectionsOverview(user, { days, timeZone }) {
    const daily = await scopedDays(user, days, timeZone);
    const total = key => daily.reduce((sum, day) => sum + day[key], 0);
    return {
        daily: daily.map(day => ({ day: day.day, count: day.collections, avgFullnessBefore: averageFullness(day.fullnessBeforeSum, day.fullnessBeforeCount) })),
        total: total('collections'),
        avgFullnessBefore: averageFullness(total('fullnessBeforeSum'), total('fullnessBeforeCount')),
    };
}

// The range's emptyings by day of the week (see weekdayTotals), from the same
// daily statistics as the emptyings chart.
async function weekdaysOverview(user, { days, timeZone }) {
    return { weekdays: weekdayTotals(await scopedDays(user, days, timeZone)) };
}

async function wasteOverview(user, { days, timeZone }) {
    const daily = await scopedDays(user, days, timeZone);
    const round = kg => Math.round(kg * 10) / 10;
    return {
        daily: daily.map(day => ({ day: day.day, kg: round(day.weighedKg) })),
        totalKg: round(daily.reduce((sum, day) => sum + day.weighedKg, 0)),
        weighedCollections: daily.reduce((sum, day) => sum + day.weighedCollections, 0),
    };
}

async function batteryOverview(user) {
    // Every device has a battery, gateways included.
    const [bins, thresholds] = await Promise.all([
        scopedBins(user, {}, { binName: 1, kind: 1, ownerId: 1, 'status.battery': 1 }),
        scopedThresholds(user),
    ]);
    const trends = await batteryTrendsByBin(scopedLogsFilter(user, bins), rangeStart(BATTERY_TREND_DAYS));
    const soon = bins.map(bin => ({
        _id: bin._id,
        binName: bin.binName,
        kind: bin.kind,
        battery: bin.status?.battery ?? null,
        daysLeft: batteryDaysLeft(bin.status?.battery,
            trends.get(String(bin._id)) ?? null, thresholdsFor(thresholds, bin.ownerId).batteryCritical),
    }))
        .filter(bin => bin.daysLeft !== null && bin.daysLeft <= BATTERY_SOON_DAYS)
        .sort((a, b) => a.daysLeft - b.daysLeft);
    return {
        buckets: bucketCounts(bins.map(bin => bin.status?.battery).filter(Number.isFinite), BATTERY_BUCKETS),
        soonDays: BATTERY_SOON_DAYS,
        soon: soon.slice(0, BATTERY_SOON_LIST_LIMIT),
    };
}

async function connectivityOverview(user) {
    const days = RELIABILITY_DAYS[0];
    const start = rangeStart(days);
    const now = new Date();
    const bins = await scopedBins(user, {}, { binName: 1, kind: 1, ownerId: 1, 'status.connection': 1 });
    const logsFilter = scopedLogsFilter(user, bins);
    const [counts, intervals, firstReports] = await Promise.all([
        binLogModel.aggregate([
            { $match: { ...logsFilter, ...READINGS_FILTER, createdAt: { $gte: start } } },
            { $group: { _id: '$binId', count: { $sum: 1 } } },
        ]),
        intervalsByOrg(bins),
        firstReportTimes(bins.map(bin => bin._id), logsFilter),
    ]);
    const received = new Map(counts.map(count => [String(count._id), count.count]));
    const names = new Map(bins.map(bin => [String(bin._id), bin.binName]));

    const gateways = new Map();
    for (const bin of bins) {
        const { via, gatewayId, rssi } = bin.status?.connection ?? {};
        if (via !== 'mesh' || !gatewayId) continue;
        const gateway = gateways.get(String(gatewayId)) ?? { _id: gatewayId, leaves: 0, rssi: [] };
        gateway.leaves++;
        if (Number.isFinite(rssi)) gateway.rssi.push(rssi);
        gateways.set(String(gatewayId), gateway);
    }

    const reliability = bins.map(bin => ({
        _id: bin._id,
        binName: bin.binName,
        ...reportReliability(received.get(String(bin._id)) ?? 0, start, now,
            intervals.get(String(bin.ownerId)), firstReports.get(String(bin._id))),
    })).filter(bin => bin.percent !== null);

    return {
        share: {
            cellular: bins.filter(bin => bin.status?.connection?.via === 'cellular').length,
            mesh: bins.filter(bin => bin.status?.connection?.via === 'mesh').length,
            unknown: bins.filter(bin => !bin.status?.connection?.via).length,
        },
        // The busiest gateways; the count says how many there are in all.
        gatewayCount: gateways.size,
        gateways: [...gateways.values()]
            .sort((a, b) => b.leaves - a.leaves)
            .slice(0, GATEWAY_LIST_LIMIT)
            .map(gateway => ({
                _id: gateway._id,
                binName: names.get(String(gateway._id)) ?? null,
                leaves: gateway.leaves,
                avgRssi: average(gateway.rssi),
            })),
        reliabilityDays: days,
        averageReliability: average(reliability.map(bin => bin.percent)),
        leastReliable: reliability
            .filter(bin => bin.percent < 100)
            .sort((a, b) => a.percent - b.percent)
            .slice(0, LEAST_RELIABLE_LIMIT),
    };
}

async function healthCausesOverview(user, { days, timeZone }) {
    const bins = await scopedBins(user, {}, { _id: 1 });
    const start = rangeStart(days);
    // Counted per day, fault codes and message in the database: there are few
    // distinct ones, so this returns far fewer rows than there are logs.
    const groups = await binLogModel.aggregate([
        { $match: { ...scopedLogsFilter(user, bins), ...READINGS_FILTER, createdAt: { $gte: start }, ...WITH_PROBLEMS_FILTER } },
        {
            $group: {
                _id: {
                    day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: timeZone } },
                    codes: '$faults.code',
                    message: '$message',
                },
                count: { $sum: 1 },
            },
        },
    ]);
    const byDay = new Map(daysBetween(start, timeZone).map(day => [
        day, Object.fromEntries(HEALTH_CAUSE_NAMES.map(cause => [cause, 0])),
    ]));
    for (const group of groups) {
        const counts = byDay.get(group._id.day);
        if (!counts) continue;
        const faults = (group._id.codes ?? []).map(code => ({ code }));
        for (const cause of healthCauses({ faults, message: group._id.message })) counts[cause] += group.count;
    }
    return { daily: [...byDay].map(([day, counts]) => ({ day, ...counts })) };
}

// ---- Collection routes: what was driven, collected and confirmed ----

// The routes of the range in the user's scope (an owner's picked organization,
// or all of them; anyone else's own), by their service day.
function routeScope({ role, org, selectedOrg }) {
    if (role === ROLES.OWNER) return selectedOrg ? { orgId: new mongoose.Types.ObjectId(selectedOrg) } : {}
    return { orgId: new mongoose.Types.ObjectId(org) }
}

// How the range's routes went: routes finished, bins collected and skipped,
// what the bins' reports said about the collections marked (the confirmed
// share counts only claims a report settled either way), the time a route
// took against the time planned (routes a driver finished; a route the day's
// end closed has no real end), and per day the stops done and skipped.
// Owners and admins also get each driver's figures.
async function routesOverview(user, { days, timeZone }) {
    const start = rangeStart(days);
    const startDay = dayKey(start, timeZone);
    const routes = await routeModel.find(
        { ...routeScope(user), serviceDay: { $gte: startDay }, status: { $ne: 'cancelled' } },
        { status: 1, serviceDay: 1, driverId: 1, startedAt: 1, finishedAt: 1, closedByDay: 1, durationSeconds: 1, plannedDurationSeconds: 1,
            'stops.status': 1, 'stops.claim.by': 1, 'stops.verification.status': 1 },
    ).lean();
    const stops = routes.flatMap(route => route.stops.map(stop => ({ ...stop, route })));
    const done = stops.filter(stop => stop.status === 'done');
    const verdicts = status => done.filter(stop => stop.verification?.status === status).length;
    const [confirmed, contradicted, unverified] = ['confirmed', 'contradicted', 'unverified'].map(verdicts);
    const timed = routes.filter(route => route.status === 'finished' && !route.closedByDay && route.startedAt && route.finishedAt);
    const minutes = seconds => Math.round(seconds / 60);
    const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

    const overview = {
        routes: routes.length,
        finished: routes.filter(route => route.status === 'finished').length,
        collected: done.length,
        skipped: stops.filter(stop => stop.status === 'skipped').length,
        confirmed, contradicted, unverified,
        confirmedPercent: confirmed + contradicted ? Math.round(confirmed / (confirmed + contradicted) * 100) : null,
        timedRoutes: timed.length,
        avgActualMinutes: timed.length ? minutes(average(timed.map(route => (route.finishedAt - route.startedAt) / 1000))) : null,
        avgPlannedMinutes: timed.length ? minutes(average(timed.map(route => route.plannedDurationSeconds ?? route.durationSeconds ?? 0))) : null,
        daily: daysBetween(start, timeZone).map(day => ({
            day,
            done: stops.filter(stop => stop.route.serviceDay === day && stop.status === 'done').length,
            skipped: stops.filter(stop => stop.route.serviceDay === day && stop.status === 'skipped').length,
        })),
    };
    if (![ROLES.OWNER, ROLES.ADMIN].includes(user.role)) return overview;

    // Per driver, by who marked the stops: the routes they drove, what they
    // collected, what the reports said, and minutes per collected stop on the
    // routes they finished themselves.
    const byDriver = new Map();
    for (const stop of done) {
        const id = String(stop.claim?.by ?? '');
        if (!id) continue;
        const driver = byDriver.get(id) ?? { _id: id, routes: new Set(), collected: 0, confirmed: 0, contradicted: 0 };
        driver.routes.add(String(stop.route._id));
        driver.collected++;
        if (stop.verification?.status === 'confirmed') driver.confirmed++;
        if (stop.verification?.status === 'contradicted') driver.contradicted++;
        byDriver.set(id, driver);
    }
    const names = new Map((await userModel.find({ _id: { $in: [...byDriver.keys()] } }, { name: 1 }).lean()).map(u => [String(u._id), u.name]));
    overview.drivers = [...byDriver.values()].map(driver => {
        const own = timed.filter(route => driver.routes.has(String(route._id)));
        const ownStops = own.reduce((sum, route) => sum + route.stops.filter(stop => stop.status === 'done').length, 0);
        return {
            _id: driver._id,
            name: names.get(driver._id) ?? null,
            routes: driver.routes.size,
            collected: driver.collected,
            confirmed: driver.confirmed,
            contradicted: driver.contradicted,
            confirmedPercent: driver.confirmed + driver.contradicted ? Math.round(driver.confirmed / (driver.confirmed + driver.contradicted) * 100) : null,
            minutesPerStop: ownStops ? Math.round(own.reduce((sum, route) => sum + (route.finishedAt - route.startedAt) / 60000, 0) / ownStops * 10) / 10 : null,
        };
    }).sort((a, b) => b.collected - a.collected);
    return overview;
}

// The bins with the most trouble in the range (see rankProblemBins): skipped
// stops and contradicted collections from the routes, days with a health
// problem from the logs. Both are counted by the database, per bin.
async function problemBinsOverview(user, { days, timeZone }) {
    const start = rangeStart(days);
    const bins = await scopedBins(user, {}, { binName: 1, kind: 1, 'status.fillRatePerDay': 1 });
    const ids = bins.map(bin => bin._id);
    const [stopGroups, problemDays] = await Promise.all([
        routeModel.aggregate([
            { $match: { ...routeScope(user), serviceDay: { $gte: dayKey(start, timeZone) }, status: { $ne: 'cancelled' } } },
            { $unwind: '$stops' },
            {
                $match: {
                    'stops.binId': { $in: ids },
                    $or: [{ 'stops.status': 'skipped' }, { 'stops.status': 'done', 'stops.verification.status': 'contradicted' }],
                },
            },
            {
                $group: {
                    _id: { binId: '$stops.binId', status: '$stops.status', reason: '$stops.skipReason' },
                    count: { $sum: 1 },
                },
            },
        ]),
        binLogModel.aggregate([
            { $match: { ...scopedLogsFilter(user, bins), ...READINGS_FILTER, createdAt: { $gte: start }, ...WITH_PROBLEMS_FILTER } },
            { $group: { _id: { binId: '$binId', day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: timeZone } } } } },
            { $group: { _id: '$_id.binId', days: { $sum: 1 } } },
        ]),
    ]);
    return {
        bins: rankProblemBins(
            bins,
            stopGroups.map(group => ({ binId: group._id.binId, status: group._id.status, reason: group._id.reason, count: group.count })),
            problemDays.map(entry => ({ binId: entry._id, days: entry.days })),
            PROBLEM_BINS_LIMIT,
        ),
    };
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

// Firmware versions, one level per request: an owner's organizations, an
// organization's versions (an admin starts here, with their own), the devices
// on one version (?organization=, ?version=, "unknown" for none reported).
async function firmwareOverview(user, { query }) {
    const isOwner = user.role === ROLES.OWNER;
    if (!isOwner && user.role !== ROLES.ADMIN) throw httpError(403, 'Only owners and admins see the firmware versions.');
    const organizationId = isOwner ? query.organization : String(user.org);
    if (organizationId && !mongoose.Types.ObjectId.isValid(organizationId)) throw httpError(400, `Invalid organization: '${organizationId}'`);
    const { version } = query;
    if (version && version !== UNKNOWN_VERSION && !VERSION_PATTERN.test(version)) throw httpError(400, `Invalid version: '${version}'`);

    const groups = await binModel.aggregate([
        { $match: scopeToOrganization({}, user) },
        { $group: { _id: { organization: '$ownerId', version: '$status.firmwareVersion' }, count: { $sum: 1 } } },
    ]);
    const rows = groups.map(group => ({ organization: String(group._id.organization), version: group._id.version ?? null, count: group.count }));
    const newest = newestVersion(rows);

    if (!organizationId) {
        const levels = organizationsLevel(rows, newest);
        const organizations = await organizationModel.find({ _id: { $in: levels.map(level => level.organization) } }, { name: 1 }).lean();
        const names = new Map(organizations.map(org => [String(org._id), org.name]));
        return {
            level: 'organizations',
            newest,
            organizations: levels.map(level => ({ _id: level.organization, name: names.get(level.organization) ?? null, devices: level.devices, behind: level.behind }))
                .sort((a, b) => b.behind - a.behind || String(a.name).localeCompare(String(b.name))),
        };
    }

    const organization = await organizationModel.findById(organizationId, { name: 1 }).lean();
    if (!organization) throw httpError(404, 'Organization not found.');
    const organizationRef = { _id: organizationId, name: organization.name };
    const organizationRows = rows.filter(row => row.organization === organizationId);
    if (!version) return { level: 'versions', newest, organization: organizationRef, versions: versionsLevel(organizationRows, newest) };

    const devices = await binModel.find(
        scopeToOrganization({ ownerId: new mongoose.Types.ObjectId(organizationId), 'status.firmwareVersion': version === UNKNOWN_VERSION ? null : version }, user),
        { binName: 1, kind: 1, 'status.updatedAt': 1 },
    ).sort({ binName: 1 }).lean();
    return {
        level: 'devices',
        newest,
        organization: organizationRef,
        version,
        behind: version !== UNKNOWN_VERSION && newest !== null && compareVersions(version, newest) < 0,
        devices: devices.map(device => ({ _id: device._id, name: device.binName, kind: device.kind ?? 'bin', lastReportAt: device.status?.updatedAt ?? null })),
    };
}

const OVERVIEW_SECTIONS = {
    firmware: firmwareOverview,
    'full-soon': fullSoon,
    'fullness-distribution': fullnessDistribution,
    collections: collectionsOverview,
    weekdays: weekdaysOverview,
    waste: wasteOverview,
    battery: batteryOverview,
    connectivity: connectivityOverview,
    'health-causes': healthCausesOverview,
    routes: routesOverview,
    'problem-bins': problemBinsOverview,
    costs: costsOverview,
    ...DASHBOARD_SECTIONS,
};

export async function getOverviewSection(req, res) {
    const section = OVERVIEW_SECTIONS[req.params.section];
    if (!section) return res.status(404).json({ message: `Unknown analytics section '${req.params.section}'.` });
    try {
        res.status(200).json(await section(req.user, {
            days: parseRangeDays(req.query.range),
            timeZone: requestTimeZone(req),
            query: req.query,
        }));
    } catch (error) {
        res.status(error?.status ?? 500).json({ message: error?.message || 'Failed to load the analytics.' });
    }
}

// ---- The AI overview's input: GET /api/overviews/ai-ov ----

function roundTo(value, decimals = 0) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

// What the fleet looks like now and how it is heading, for the AI overview:
// the numbers the dashboard and analytics already compute, per device by
// name, without ids or internal fields. Devices needing attention come first.
export async function buildFleetBriefing(user) {
    const now = Date.now();
    const devices = await devicesWithReasons(user);
    if (devices.length === 0) return null;
    const names = new Map(devices.map(device => [String(device._id), device.binName]));
    const ids = devices.map(device => device._id);
    const weekStart = rangeStart(AI_BRIEFING_DAYS, now);

    const [readings, firstReports, weekCounts, problemLogs, intervals, thresholds] = await Promise.all([
        readingsByBin(ids, rangeStart(Math.max(FILL_RATE_WINDOW_DAYS, BATTERY_TREND_DAYS), now)),
        firstReportTimes(ids),
        binLogModel.aggregate([
            { $match: { binId: { $in: ids }, ...READINGS_FILTER, createdAt: { $gte: weekStart } } },
            { $group: { _id: '$binId', count: { $sum: 1 } } },
        ]),
        binLogModel.find(
            { binId: { $in: ids }, ...READINGS_FILTER, createdAt: { $gte: weekStart }, ...WITH_PROBLEMS_FILTER },
            { faults: 1, message: 1 },
        ).lean(),
        intervalsByOrg(devices),
        scopedThresholds(user),
    ]);
    const reportsThisWeek = new Map(weekCounts.map(count => [String(count._id), count.count]));

    let emptyings = 0;
    let kgCollected = 0;
    const fullnessAtEmptying = [];
    const briefed = devices.map(device => {
        const id = String(device._id);
        const isGatewayDevice = device.kind === 'gateway';
        const deviceReadings = readings.get(id) ?? [];
        const weekReadings = deviceReadings.filter(reading => reading.at >= weekStart);
        const collections = isGatewayDevice ? [] : detectCollections(weekReadings);
        emptyings += collections.length;
        for (const collection of collections) {
            if (collection.kgRemoved !== null) kgCollected += collection.kgRemoved;
            if (collection.fullnessBefore !== null) fullnessAtEmptying.push(collection.fullnessBefore);
        }
        const ratePerDay = isGatewayDevice ? null : fillRatePerDay(deviceReadings.filter(
            reading => reading.at >= rangeStart(FILL_RATE_WINDOW_DAYS, now)));
        // Hours until the bin needs collecting, 0 if it already does; null
        // without a rising trend.
        const cutOffs = thresholdsFor(thresholds, device.ownerId);
        const dueAt = isGatewayDevice ? null : collectionDueAt(device.fullness, ratePerDay, now, cutOffs.fullnessCritical);
        const hoursUntilCollection = dueAt === null ? null : (dueAt.getTime() - now) / HOUR_MS;
        const batteryRate = trendPerDay(deviceReadings.filter(
            reading => reading.at >= rangeStart(BATTERY_TREND_DAYS, now)), 'battery');
        const lastReport = device.status?.updatedAt ?? null;
        const reliability = reportReliability(reportsThisWeek.get(id) ?? 0, weekStart, new Date(now),
            intervals.get(String(device.ownerId)), firstReports.get(id));
        const via = device.status?.connection?.via;
        return {
            name: device.binName,
            type: isGatewayDevice ? 'gateway' : via === 'mesh' ? 'bin reporting through a gateway' : 'bin with its own cellular connection',
            ...(via === 'mesh' ? { gateway: names.get(String(device.status.connection.gatewayId)) ?? null } : {}),
            needsAttention: device.reasons,
            ...(isGatewayDevice ? {} : {
                fullnessPercent: device.fullness,
                weightKg: device.status?.scale === 'ok' ? roundTo(device.status.weight, 1) : null,
                fillRatePercentPerDay: roundTo(ratePerDay, 1),
                hoursUntilCollectionNeeded: roundTo(hoursUntilCollection),
                emptiedThisWeek: collections.length,
            }),
            batteryPercent: device.status?.battery ?? null,
            batteryDaysUntilCritical: roundTo(batteryDaysLeft(device.status?.battery, batteryRate, cutOffs.batteryCritical)),
            health: device.status?.health ?? null,
            reportedProblem: describeFaults(device.status?.faults) || device.status?.healthMessage || null,
            hoursSinceLastReport: lastReport ? roundTo((now - new Date(lastReport).getTime()) / HOUR_MS, 1) : null,
            onTimeReportsPercentThisWeek: reliability.percent,
        };
    });
    // The most urgent first: most reasons, then the fullest; the rest may be cut.
    briefed.sort((a, b) => b.needsAttention.length - a.needsAttention.length ||
        (b.fullnessPercent ?? -1) - (a.fullnessPercent ?? -1));

    // One organization's cut-offs, or the defaults when the briefing spans several.
    const rules = thresholds.size === 1 ? [...thresholds.values()][0] : DEFAULT_THRESHOLDS;
    const problemsByCause = Object.fromEntries(HEALTH_CAUSE_NAMES.map(cause => [cause, 0]));
    for (const log of problemLogs) {
        for (const cause of healthCauses(log)) problemsByCause[cause]++;
    }

    return {
        generatedAt: new Date(now).toISOString(),
        rules: {
            fullnessMeans: 'the fill level or the weight against the bin\'s reference load, whichever is higher',
            fullnessWarningPercent: rules.fullnessWarning,
            fullnessCriticalPercent: rules.fullnessCritical,
            batteryWarningPercent: rules.batteryWarning,
            batteryCriticalPercent: rules.batteryCritical,
            ...(thresholds.size > 1 ? { cutOffsNote: 'each organization may set its own cut-offs; these are the defaults' } : {}),
            offlineMeans: `missed ${OFFLINE_AFTER_MISSED_REPORTS} scheduled reports in a row`,
            gatewayNote: 'a gateway relays the reports of the bins that report through it; when it is offline, they go silent too',
        },
        totals: {
            bins: devices.filter(device => device.kind !== 'gateway').length,
            gateways: devices.filter(device => device.kind === 'gateway').length,
            almostFull: devices.filter(device => device.reasons.includes('full')).length,
            offline: devices.filter(device => device.reasons.includes('offline')).length,
            maintenanceDue: devices.filter(device => device.reasons.includes('maintenance')).length,
            lowBattery: devices.filter(device => device.reasons.includes('battery')).length,
        },
        lastSevenDays: {
            emptyings,
            averageFullnessAtEmptyingPercent: average(fullnessAtEmptying),
            kgCollected: roundTo(kgCollected, 1),
            problemReportsByCause: problemsByCause,
        },
        devices: briefed.slice(0, AI_BRIEFING_DEVICE_LIMIT),
        devicesOmitted: Math.max(briefed.length - AI_BRIEFING_DEVICE_LIMIT, 0),
    };
}
