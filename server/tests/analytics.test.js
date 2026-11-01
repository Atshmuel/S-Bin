import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    batteryDaysLeft, binFullness, collectionDueAt, dayKey, daysBetween, detectCollections, fillRatePerDay,
    fullnessPercent, healthCauses, isValidTimeZone, reportReliability, trendPerDay,
} from '../utils/analytics.js';
import { DAY_MS, FULLNESS_CRITICAL_PERCENT, HOUR_MS } from '../utils/constants.js';

const T0 = Date.UTC(2026, 9, 1);
const at = days => new Date(T0 + days * DAY_MS);
const reading = (days, level, weight = null) => ({ at: at(days), level, weight, battery: null });

describe('fullnessPercent', () => {
    test('is the higher of the level and the weight against the reference', () => {
        assert.equal(fullnessPercent(40, 125), 50);
        assert.equal(fullnessPercent(70, 125), 70);
    });
    test('caps the weight at 100% and rounds', () => {
        assert.equal(fullnessPercent(10, 500), 100);
        assert.equal(fullnessPercent(33.4, null), 33);
    });
    test('is null without a level or a weight', () => {
        assert.equal(fullnessPercent(null, null), null);
    });
});

describe('binFullness', () => {
    test('ignores a level the sensor could not read', () => {
        assert.equal(binFullness({ status: { level: 90, levelValid: false, weight: 50, scale: 'ok' } }), 20);
    });
    test('ignores the weight of a scale that is not ok', () => {
        assert.equal(binFullness({ status: { level: 30, weight: 200, scale: 'failed' } }), 30);
    });
    test('is null for a device with neither (a gateway)', () => {
        assert.equal(binFullness({ status: { levelValid: false, weight: null } }), null);
    });
});

describe('detectCollections', () => {
    test('a level drop of 30 points is an emptying, 25 is not', () => {
        assert.equal(detectCollections([reading(0, 80), reading(1, 45)]).length, 1);
        assert.equal(detectCollections([reading(0, 80), reading(1, 55)]).length, 0);
    });
    test('a report without a level does not hide one', () => {
        const collections = detectCollections([reading(0, 80), reading(1, null, 20), reading(2, 40)]);
        assert.deepEqual(collections.map(c => c.at), [at(2)]);
        assert.equal(collections[0].levelBefore, 80);
    });
    test('a weight drop needs half the weight and at least 2 kg', () => {
        const emptied = detectCollections([reading(0, null, 100), reading(1, null, 40)]);
        assert.equal(emptied.length, 1);
        assert.equal(emptied[0].kgRemoved, 60);
        assert.equal(emptied[0].fullnessBefore, 40);
        assert.equal(detectCollections([reading(0, null, 3), reading(1, null, 1.6)]).length, 0);
        assert.equal(detectCollections([reading(0, null, 120), reading(1, null, 90)]).length, 0);
    });
    test('scale noise near empty is no emptying', () => {
        const noise = [0.087, 0.1, 0.065, 0.012, 0].map((kg, i) => reading(i / 2, 0, kg));
        assert.equal(detectCollections(noise).length, 0);
    });
});

describe('trendPerDay', () => {
    test('is the slope per day', () => {
        const points = [0, 1, 2, 3].map(day => reading(day, 10 + 5 * day));
        assert.equal(trendPerDay(points, 'level'), 5);
    });
    test('is null with too few points or too short a span', () => {
        assert.equal(trendPerDay([reading(0, 10), reading(1, 20)], 'level'), null);
        assert.equal(trendPerDay([0, 0.2, 0.4].map(day => reading(day, 10 + day)), 'level'), null);
    });
});

describe('fillRatePerDay', () => {
    test('follows the weight when it rises faster than the level', () => {
        const readings = [0, 1, 2, 3, 4].map(day => reading(day, 20, 50 + 12.5 * day));
        assert.equal(fillRatePerDay(readings), 5);
    });
    test('counts only since the last emptying', () => {
        const readings = [reading(0, 70), reading(1, 80), reading(2, 90),
            ...[3, 4, 5, 6].map(day => reading(day, 5 + 4 * (day - 3)))];
        assert.equal(fillRatePerDay(readings), 4);
    });
    test('is null without readings', () => {
        assert.equal(fillRatePerDay([]), null);
    });
});

describe('collectionDueAt', () => {
    const now = T0;
    test('is when the bin reaches the critical fullness at its rate', () => {
        const hours = (FULLNESS_CRITICAL_PERCENT - 50) / 10 * 24;
        assert.equal(collectionDueAt(50, 10, now).getTime(), now + hours * HOUR_MS);
    });
    test('is now for a bin already there, null for one not filling', () => {
        assert.equal(collectionDueAt(FULLNESS_CRITICAL_PERCENT, 0, now).getTime(), now);
        assert.equal(collectionDueAt(50, 0, now), null);
        assert.equal(collectionDueAt(50, -2, now), null);
        assert.equal(collectionDueAt(null, 10, now), null);
    });
});

describe('batteryDaysLeft', () => {
    test('is the days until the critical level at the trend', () => {
        assert.equal(batteryDaysLeft(80, -2), 30);
        assert.equal(batteryDaysLeft(15, -1), 0);
    });
    test('is null when the battery is not draining', () => {
        assert.equal(batteryDaysLeft(80, 1), null);
        assert.equal(batteryDaysLeft(80, null), null);
    });
});

describe('reportReliability', () => {
    const end = at(7);
    const start = at(0);
    test('counts the slots of the window for a device older than it', () => {
        assert.deepEqual(reportReliability(14, start, end, 720, at(-30)), { received: 14, expected: 14, percent: 100 });
        assert.equal(reportReliability(7, start, end, 720, at(-30)).percent, 50);
    });
    test('never goes above 100% (extra reports)', () => {
        assert.equal(reportReliability(20, start, end, 720, at(-30)).percent, 100);
    });
    test('counts from the first report, which is a slot of its own', () => {
        assert.equal(reportReliability(3, start, end, 720, at(6)).expected, 3);
    });
    test('has no percent for a device that never reported', () => {
        assert.deepEqual(reportReliability(0, start, end, 720, null), { received: 0, expected: 0, percent: null });
    });
});

describe('days', () => {
    test('dayKey is the calendar day in the time zone', () => {
        const lateEvening = new Date(Date.UTC(2026, 9, 23, 22, 30));
        assert.equal(dayKey(lateEvening, 'UTC'), '2026-10-23');
        assert.equal(dayKey(lateEvening, 'Asia/Jerusalem'), '2026-10-24');
    });
    test('daysBetween lists every day, the empty ones too', () => {
        const days = daysBetween(new Date(Date.UTC(2026, 9, 20, 10)), 'UTC', Date.UTC(2026, 9, 23, 10));
        assert.deepEqual(days, ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    });
    test('isValidTimeZone', () => {
        assert.equal(isValidTimeZone('Asia/Jerusalem'), true);
        assert.equal(isValidTimeZone('Nope/Zone'), false);
        assert.equal(isValidTimeZone(''), false);
        assert.equal(isValidTimeZone(undefined), false);
    });
});

describe('healthCauses', () => {
    test('names every cause the fault codes give, each once', () => {
        assert.deepEqual(healthCauses({ faults: [{ code: 'distance_sensor' }, { code: 'battery_low' }, { code: 'calibration_failed' }] }),
            ['fillSensor', 'battery']);
        assert.deepEqual(healthCauses({ faults: [{ code: 'scale', cycles: 2 }] }), ['scale']);
    });
    test('counts a device that cannot reach the server as a connectivity problem', () => {
        assert.deepEqual(healthCauses({ faults: [{ code: 'sim_missing' }] }), ['connectivity']);
        assert.deepEqual(healthCauses({ faults: [{ code: 'cellular_unavailable', cycles: 2 }, { code: 'sim_missing' }] }), ['connectivity']);
        assert.deepEqual(healthCauses({ faults: [{ code: 'sim_missing' }, { code: 'battery_low' }] }), ['connectivity', 'battery']);
    });
    test('reads an older log\'s English message', () => {
        assert.deepEqual(healthCauses({ message: 'A02 not responding. Battery level is low.' }), ['fillSensor', 'battery']);
        assert.deepEqual(healthCauses({ message: 'HX711 not responding.' }), ['scale']);
    });
    test('is empty without a problem', () => {
        assert.deepEqual(healthCauses({}), []);
        assert.deepEqual(healthCauses(), []);
        assert.deepEqual(healthCauses({ faults: [{ code: 'bin_full' }], message: 'All good.' }), []);
    });
});
