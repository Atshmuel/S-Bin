// Planning numbers derived from the logs: fill rate, collections, battery
// trend and report reliability. Pure functions over readings sorted oldest
// first, each { at: Date, level, weight, battery }, level in % and weight in
// kg, either null when the device had none.

import { FAULT_CAUSES } from "./faults.js";
import {
    BATTERY_CRITICAL_PERCENT, COLLECTION_LEVEL_DROP, COLLECTION_WEIGHT_DROP_MIN_KG, COLLECTION_WEIGHT_DROP_RATIO,
    FULLNESS_CRITICAL_PERCENT, MIN_TREND_POINTS, MIN_TREND_SPAN_MS, WEIGHT_REFERENCE_KG, DAY_MS, MINUTE_MS,
} from './constants.js';

export function rangeStart(days, now = Date.now()) {
    return new Date(now - days * DAY_MS);
}

// Whichever of the fill level and the weight is closer to full (as the client
// shows it); null when the bin reported neither.
export function fullnessPercent(level, weightKg) {
    const parts = [];
    if (Number.isFinite(level)) parts.push(level);
    if (Number.isFinite(weightKg)) parts.push(Math.min(weightKg / WEIGHT_REFERENCE_KG * 100, 100));
    return parts.length > 0 ? Math.round(Math.max(...parts)) : null;
}

// A bin's fullness now, from the values its status trusts: a level the
// sensor read fine and a weight from a scale that read fine.
export function binFullness(bin) {
    return fullnessPercent(
        bin.status?.levelValid === false ? null : bin.status?.level,
        bin.status?.scale === 'ok' ? bin.status?.weight : null,
    );
}

// fullnessPercent() as a MongoDB expression over a bin's status, for queries
// that filter on it; null for a device with neither (a gateway).
export const FULLNESS_EXPRESSION = Object.freeze({
    $max: [
        { $cond: [{ $ne: ['$status.levelValid', false] }, '$status.level', null] },
        {
            $cond: [
                { $and: [{ $eq: ['$status.scale', 'ok'] }, { $isNumber: '$status.weight' }] },
                { $min: [100, { $multiply: [{ $divide: ['$status.weight', WEIGHT_REFERENCE_KG] }, 100] }] },
                null,
            ],
        },
    ],
});

// Emptyings: a level drop of COLLECTION_LEVEL_DROP points or a weight drop of
// COLLECTION_WEIGHT_DROP_RATIO and at least COLLECTION_WEIGHT_DROP_MIN_KG,
// each against the last report that had that value, so a report without a
// level does not hide a collection.
export function detectCollections(readings) {
    const collections = [];
    let lastLevel = null;
    let lastWeight = null;
    for (const reading of readings) {
        const levelDropped = lastLevel !== null && Number.isFinite(reading.level) &&
            lastLevel - reading.level >= COLLECTION_LEVEL_DROP;
        const weightDropped = lastWeight !== null && Number.isFinite(reading.weight) &&
            lastWeight - reading.weight >= COLLECTION_WEIGHT_DROP_MIN_KG &&
            reading.weight <= lastWeight * (1 - COLLECTION_WEIGHT_DROP_RATIO);
        if (levelDropped || weightDropped) {
            collections.push({
                at: reading.at,
                levelBefore: lastLevel,
                weightBefore: lastWeight,
                fullnessBefore: fullnessPercent(lastLevel, lastWeight),
                kgRemoved: lastWeight !== null && Number.isFinite(reading.weight)
                    ? Math.max(lastWeight - reading.weight, 0)
                    : null,
            });
        }
        if (Number.isFinite(reading.level)) lastLevel = reading.level;
        if (Number.isFinite(reading.weight)) lastWeight = reading.weight;
    }
    return collections;
}

// The least-squares slope of a value per day; null with too few points or
// too short a span to mean anything.
export function trendPerDay(readings, key) {
    const points = readings.filter(reading => Number.isFinite(reading[key]));
    if (points.length < MIN_TREND_POINTS ||
        points[points.length - 1].at - points[0].at < MIN_TREND_SPAN_MS) {
        return null;
    }
    const origin = points[0].at.getTime();
    const xs = points.map(point => (point.at.getTime() - origin) / DAY_MS);
    const ys = points.map(point => point[key]);
    const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
    const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
    let covariance = 0;
    let variance = 0;
    for (let i = 0; i < xs.length; i++) {
        covariance += (xs[i] - meanX) * (ys[i] - meanY);
        variance += (xs[i] - meanX) ** 2;
    }
    return variance > 0 ? covariance / variance : null;
}

// How fast the bin's fullness rises since its last collection, in % per day,
// so a bin that fills by weight more than by level is forecast by its weight.
export function fillRatePerDay(readings) {
    const collections = detectCollections(readings);
    const since = collections.length > 0 ? collections[collections.length - 1].at : null;
    const sinceCollection = since ? readings.filter(reading => reading.at >= since) : readings;
    return trendPerDay(sinceCollection.map(reading => ({
        at: reading.at,
        fullness: fullnessPercent(reading.level, reading.weight),
    })), "fullness");
}

// When the bin reaches its organization's critical fullness (`critical`) and
// needs collecting at its fill rate; now if it already has, null without a
// rising trend.
export function collectionDueAt(fullness, ratePerDay, now = Date.now(), critical = FULLNESS_CRITICAL_PERCENT) {
    if (!Number.isFinite(fullness)) return null;
    if (fullness >= critical) return new Date(now);
    if (!(ratePerDay > 0)) return null;
    return new Date(now + (critical - fullness) / ratePerDay * DAY_MS);
}

// Days until the battery reaches its organization's critical level
// (`critical`) at its recent trend; null when it is not draining (or
// charging, or too little data).
export function batteryDaysLeft(battery, ratePerDay, critical = BATTERY_CRITICAL_PERCENT) {
    if (!Number.isFinite(battery) || !(ratePerDay < 0)) return null;
    return Math.max((battery - critical) / -ratePerDay, 0);
}

// Reports received against the slots in the window, counted from the
// device's first report ever (null: it never reported); extra reports (a
// "report now") never push it past 100%.
export function reportReliability(received, windowStart, windowEnd, intervalMinutes, firstReportAt) {
    if (!firstReportAt) return { received, expected: 0, percent: null };
    const firstMs = new Date(firstReportAt).getTime();
    const start = Math.max(windowStart.getTime(), firstMs);
    // The first report is a slot of its own when it falls in the window.
    const expected = Math.floor((windowEnd.getTime() - start) / (intervalMinutes * MINUTE_MS)) +
        (firstMs >= windowStart.getTime() ? 1 : 0);
    if (expected <= 0) return { received, expected: 0, percent: null };
    return { received, expected, percent: Math.round(Math.min(received / expected, 1) * 100) };
}

// The calendar day of an instant in a time zone, as YYYY-MM-DD.
export function dayKey(date, timeZone) {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
        .format(date);
}

// Every day from start to now, so a chart has its empty days too.
export function daysBetween(start, timeZone, now = Date.now()) {
    const days = [];
    for (let at = start.getTime(); at <= now + DAY_MS; at += DAY_MS / 2) {
        const day = dayKey(new Date(Math.min(at, now)), timeZone);
        if (days[days.length - 1] !== day) days.push(day);
    }
    return days;
}

export function isValidTimeZone(timeZone) {
    if (typeof timeZone !== "string" || timeZone.length === 0) return false;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone });
        return true;
    } catch {
        return false;
    }
}

// What an older firmware's or server's English health message says went
// wrong; a message can name several causes. Newer logs carry fault codes.
const HEALTH_CAUSES = Object.freeze({
    fillSensor: /A02|Empty-bin calibration/,
    battery: /AXP2101|Battery level/,
    scale: /HX711/,
    gps: /GNSS/,
    connectivity: /SIM card|cellular network/i,
});

// The causes of a log's problems: from its fault codes (see utils/faults.js)
// and, for logs from before them, its English message. Each cause once.
export function healthCauses({ faults, message } = {}) {
    const causes = new Set((faults ?? []).map(fault => FAULT_CAUSES[fault.code]).filter(Boolean));
    if (typeof message === "string") {
        for (const [cause, pattern] of Object.entries(HEALTH_CAUSES)) {
            if (pattern.test(message)) causes.add(cause);
        }
    }
    return [...causes];
}

export const HEALTH_CAUSE_NAMES = Object.freeze(Object.keys(HEALTH_CAUSES));
