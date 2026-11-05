import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, newestVersion, organizationsLevel, versionsLevel } from '../utils/firmware.js';

const rows = [
    { organization: 'a', version: '2.8.1', count: 3 },
    { organization: 'a', version: '2.7.4', count: 2 },
    { organization: 'a', version: null, count: 1 },
    { organization: 'b', version: '2.8.1', count: 4 },
    { organization: 'b', version: '2.10.0', count: 1 },
];

describe('compareVersions', () => {
    test('compares each part as a number', () => {
        assert.ok(compareVersions('2.8.1', '2.8.0') > 0);
        assert.ok(compareVersions('2.10.0', '2.9.0') > 0);
        assert.ok(compareVersions('2.7.4', '2.8.0') < 0);
        assert.equal(compareVersions('2.8.1', '2.8.1'), 0);
    });
});

describe('newestVersion', () => {
    test('is the highest any device runs', () => {
        assert.equal(newestVersion(rows), '2.10.0');
    });
    test('is null when no device reported a version', () => {
        assert.equal(newestVersion([{ organization: 'a', version: null, count: 2 }]), null);
        assert.equal(newestVersion([]), null);
    });
});

describe('organizationsLevel', () => {
    test('counts each organization\'s devices and those behind the newest', () => {
        assert.deepEqual(organizationsLevel(rows, '2.10.0'), [
            { organization: 'a', devices: 6, behind: 5 },
            { organization: 'b', devices: 5, behind: 4 },
        ]);
    });
    test('a device without a version is not behind', () => {
        assert.deepEqual(organizationsLevel([{ organization: 'a', version: null, count: 2 }], null),
            [{ organization: 'a', devices: 2, behind: 0 }]);
    });
});

describe('versionsLevel', () => {
    test('adds the organizations up per version, the newest first and unknown last', () => {
        assert.deepEqual(versionsLevel(rows, '2.10.0'), [
            { version: '2.10.0', devices: 1, behind: false },
            { version: '2.8.1', devices: 7, behind: true },
            { version: '2.7.4', devices: 2, behind: true },
            { version: null, devices: 1, behind: false },
        ]);
    });
});
