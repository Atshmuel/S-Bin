import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFaults, describeFaults, FAULT_CODES, ROLE_CHANGE_CODES } from '../utils/faults.js';

describe('cleanFaults', () => {
    test('keeps known device codes with their numbers in range', () => {
        assert.deepEqual(cleanFaults([
            { code: 'distance_sensor', cycles: 2, mm: -1 },
            { code: 'gps', cycles: 1 },
        ]), [{ code: 'distance_sensor', cycles: 2, mm: -1 }, { code: 'gps', cycles: 1 }]);
    });
    test('drops unknown and server codes, repeats and bad entries', () => {
        assert.deepEqual(cleanFaults([
            { code: 'nonsense' }, { code: 'bin_full' }, null, 'pmu', { code: 'pmu' }, { code: 'pmu', cycles: 2 },
        ]), [{ code: 'pmu' }]);
    });
    test('drops numbers out of range, not the fault', () => {
        assert.deepEqual(cleanFaults([{ code: 'fill_calculation', cycles: 9, mm: 1.5 }]), [{ code: 'fill_calculation' }]);
        assert.deepEqual(cleanFaults([{ code: 'calibration_failed', mm: 50000 }]), [{ code: 'calibration_failed' }]);
    });
    test('is empty for anything but a list', () => {
        assert.deepEqual(cleanFaults(undefined), []);
        assert.deepEqual(cleanFaults({ code: 'gps' }), []);
    });
});

describe('describeFaults', () => {
    test('words each fault in English, in order', () => {
        assert.equal(describeFaults([{ code: 'bin_full' }, { code: 'scale', cycles: 2 }]),
            'Bin is almost full. The scale reading failed in 2 or more consecutive reporting cycles.');
        assert.equal(describeFaults([{ code: 'instructions_expired', types: ['report_now', 'stay_awake'] }]),
            'Device did not pick up pending instructions (report_now, stay_awake) within 3 days; it may be offline or out of coverage.');
    });
    test('is null without any', () => {
        assert.equal(describeFaults([]), null);
        assert.equal(describeFaults(undefined), null);
    });
});

describe('role changes', () => {
    test('are system codes: a device cannot send them, and each has its words', () => {
        for (const code of ROLE_CHANGE_CODES) {
            assert.ok(FAULT_CODES.includes(code));
            assert.deepEqual(cleanFaults([{ code }]), []);
            assert.ok(describeFaults([{ code }]));
        }
    });
});
