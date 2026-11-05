import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIssues, missedReports, nextIssues } from '../utils/deviceIssues.js';

const at = new Date('2026-10-28T05:00:00Z');
const later = days => new Date(at.getTime() + days * 86400000);

describe('device issues', () => {
    test('a scheduled wake with a good cell and steady sensor shows nothing', () => {
        const found = detectIssues({ resetReason: 'deepsleep', wakeCause: 'timer', network: { rsrp: -95 }, chipTempC: 31,
            distanceSamples: 5, distanceSpreadMm: 2, stages: { modemMs: 3000, networkMs: 4000, mqttMs: 5000 } });
        assert.ok(Object.values(found).every(({ present }) => !present));
        assert.deepEqual(nextIssues([], found, at), []);
    });
    test('a power-on nothing woke is an unexpected restart; it stays a week', () => {
        const open = nextIssues([], detectIssues({ resetReason: 'poweron', wakeCause: 'undefined' }), at);
        assert.deepEqual(open.map(issue => issue.type), ['unexpected_restart']);
        const calm = detectIssues({ resetReason: 'deepsleep', wakeCause: 'timer' });
        assert.equal(nextIssues(open, calm, later(6)).length, 1);
        assert.equal(nextIssues(open, calm, later(8)).length, 0);
    });
    test('a weak signal needs two reports in a row, and closes when it recovers', () => {
        assert.equal(detectIssues({ network: { rsrp: -118 } }, { network: { rsrp: -100 } }).weak_signal.present, false);
        const found = detectIssues({ network: { rsrp: -118 } }, { network: { rsrp: -115 } });
        const open = nextIssues([], found, at);
        assert.deepEqual(open, [{ type: 'weak_signal', since: at, lastSeenAt: at, value: -118 }]);
        const still = nextIssues(open, found, later(1));
        assert.equal(still[0].since, at);
        assert.equal(nextIssues(still, detectIssues({ network: { rsrp: -100 } }, { network: { rsrp: -118 } }), later(2)).length, 0);
    });
    test('a report without the data leaves the issue as it was', () => {
        const open = [{ type: 'overheating', since: at, lastSeenAt: at, value: 75 }];
        assert.deepEqual(nextIssues(open, detectIssues({ firmwareVersion: '1.0.0' }), later(1)), open);
    });
    test('a noisy sensor, a slow cycle and a leaf losing its gateway', () => {
        const found = detectIssues({ distanceSamples: 2, stages: { modemMs: 30000, networkMs: 25000, mqttMs: 9000 }, missedCycles: 2, beaconRssi: -70 });
        assert.equal(found.noisy_sensor.present, true);
        assert.equal(found.slow_cycle.present, true);
        assert.equal(found.weak_mesh_link.present, true);
        assert.equal(detectIssues({ beaconRssi: -95 }).weak_mesh_link.present, true);
    });
});

describe('missed reports', () => {
    const HOUR = 3600000;
    const slot = hours => new Date(at.getTime() + hours * HOUR);
    test('a report on time, or a little late, missed nothing', () => {
        assert.equal(missedReports(slot(0), slot(12), 720), 0);
        assert.equal(missedReports(slot(0), slot(17), 720), 0);
    });
    test('a gap over one and a half intervals counts the reports skipped', () => {
        assert.equal(missedReports(slot(0), slot(19), 720), 1);
        assert.equal(missedReports(slot(0), slot(24), 720), 1);
        assert.equal(missedReports(slot(0), slot(36), 720), 2);
    });
    test('has nothing to compare without a previous report or an interval', () => {
        assert.equal(missedReports(undefined, slot(24), 720), 0);
        assert.equal(missedReports(slot(0), slot(24), undefined), 0);
    });
    test('the issue stays a week after the last miss, and a good report does not close it', () => {
        const open = nextIssues([], { missed_report: { present: true, value: 1 } }, at);
        assert.deepEqual(open, [{ type: 'missed_report', since: at, lastSeenAt: at, value: 1 }]);
        assert.equal(nextIssues(open, detectIssues({ resetReason: 'deepsleep', wakeCause: 'timer' }), later(6)).length, 1);
        assert.equal(nextIssues(open, detectIssues({ resetReason: 'deepsleep', wakeCause: 'timer' }), later(8)).length, 0);
    });
});
