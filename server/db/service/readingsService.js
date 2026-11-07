import { binLogModel } from "../models/models.js";
import { DAY_MS, MIN_TREND_POINTS, MIN_TREND_SPAN_MS } from "../../utils/constants.js";

// A device's sensor readings (its reports), as the analytics and the route
// planner read them.
export const READINGS_FILTER = Object.freeze({ type: "log", source: "sensor" });
// Logs that name a problem: fault codes, or an older firmware's English message.
export const WITH_PROBLEMS_FILTER = Object.freeze({
    $or: [{ "faults.0": { $exists: true } }, { message: { $exists: true, $ne: null } }],
});

// Readings of many bins at once, from `since` (until `until`, when given),
// grouped per bin and sorted oldest first.
export async function readingsByBin(binIds, since, until = null) {
    const groups = await binLogModel.aggregate([
        { $match: { binId: { $in: binIds }, ...READINGS_FILTER, createdAt: { $gte: since, ...(until ? { $lt: until } : {}) } } },
        { $sort: { createdAt: 1 } },
        {
            $group: {
                _id: '$binId',
                readings: { $push: { at: '$createdAt', level: '$newLevel', weight: '$weight', battery: '$battery' } },
            },
        },
    ]);
    return new Map(groups.map(group => [String(group._id), group.readings.map(reading => ({
        at: reading.at,
        level: reading.level ?? null,
        weight: reading.weight ?? null,
        battery: reading.battery ?? null,
    }))]));
}

// Each device's battery trend in % per day since `since`, for the devices the
// logs filter selects: trendPerDay()'s least-squares slope (null with too few
// readings or too short a span), from sums the database adds up per device,
// so one row per device comes back instead of every reading.
export async function batteryTrendsByBin(logsFilter, since) {
    const days = { $divide: [{ $subtract: ['$createdAt', since] }, DAY_MS] };
    const groups = await binLogModel.aggregate([
        { $match: { ...logsFilter, ...READINGS_FILTER, createdAt: { $gte: since }, battery: { $type: 'number' } } },
        { $project: { binId: 1, createdAt: 1, battery: 1, x: days } },
        {
            $group: {
                _id: '$binId',
                n: { $sum: 1 },
                sumX: { $sum: '$x' },
                sumY: { $sum: '$battery' },
                sumXY: { $sum: { $multiply: ['$x', '$battery'] } },
                sumXX: { $sum: { $multiply: ['$x', '$x'] } },
                first: { $min: '$createdAt' },
                last: { $max: '$createdAt' },
            },
        },
    ]);
    return new Map(groups.map(({ _id, n, sumX, sumY, sumXY, sumXX, first, last }) => {
        if (n < MIN_TREND_POINTS || last - first < MIN_TREND_SPAN_MS) return [String(_id), null];
        const variance = sumXX - sumX * sumX / n;
        return [String(_id), variance > 0 ? (sumXY - sumX * sumY / n) / variance : null];
    }));
}
