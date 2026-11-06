import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { binLoadKg, reservationExpiry, routeAccessFilter, RouteError, serviceDayOf, skipReasonOf } from '../db/service/routeService.js';
import { ROLES, ROUTE_RESERVATION_GRACE_HOURS, WEIGHT_REFERENCE_KG } from '../utils/constants.js';

const ORG = '6ac6b379636100b8e7ef5304';
const USER = '6acd42f6abb3e3d8cb8f8247';

describe('serviceDayOf', () => {
    test('is the date in the time zone, not in UTC', () => {
        // 22:30 UTC on 24/10 is already 25/10 in Israel (UTC+2 in winter).
        const lateUtc = new Date(Date.UTC(2026, 9, 24, 22, 30));
        assert.equal(serviceDayOf(lateUtc, 'Asia/Jerusalem'), '2026-10-25');
        assert.equal(serviceDayOf(lateUtc, 'UTC'), '2026-10-24');
    });
});

describe('reservationExpiry', () => {
    test('is the grace after the service day', () => {
        const expected = Date.UTC(2026, 9, 26) + ROUTE_RESERVATION_GRACE_HOURS * 3600 * 1000;
        assert.equal(reservationExpiry('2026-10-25').getTime(), expected);
    });
});

describe('routeAccessFilter', () => {
    test('owners see every organization, or the one they picked', () => {
        assert.deepEqual(routeAccessFilter({ id: USER, role: ROLES.OWNER }), {});
        assert.deepEqual(routeAccessFilter({ id: USER, role: ROLES.OWNER, selectedOrg: ORG }),
            { orgId: new mongoose.Types.ObjectId(ORG) });
    });
    test('admins see their organization, drivers their own routes', () => {
        assert.deepEqual(routeAccessFilter({ id: USER, role: ROLES.ADMIN, org: ORG }), { orgId: new mongoose.Types.ObjectId(ORG) });
        assert.deepEqual(routeAccessFilter({ id: USER, role: ROLES.DRIVER, org: ORG }), { driverId: new mongoose.Types.ObjectId(USER) });
    });
    test('nobody else sees routes', () => {
        for (const role of [ROLES.USER, ROLES.TECHNICIAN]) {
            assert.equal(routeAccessFilter({ id: USER, role, org: ORG }), null);
        }
        assert.equal(routeAccessFilter({ id: USER, role: ROLES.ADMIN, org: null }), null);
    });
});

describe('binLoadKg', () => {
    test('a working scale gives the weight, otherwise the fullness of a full bin', () => {
        assert.equal(binLoadKg({ status: { scale: 'ok', weight: 41.2 }, fullness: 90 }), 42);
        assert.equal(binLoadKg({ status: { scale: 'error', weight: 41.2 }, fullness: 80 }), 0.8 * WEIGHT_REFERENCE_KG);
    });
    test('never less than 1 kg', () => {
        assert.equal(binLoadKg({ status: {}, fullness: 0 }), 1);
    });
});

describe('skipReasonOf', () => {
    test('takes a known reason, and none', () => {
        assert.equal(skipReasonOf('no_access'), 'no_access');
        assert.equal(skipReasonOf(undefined), undefined);
        assert.equal(skipReasonOf(null), undefined);
        assert.equal(skipReasonOf(''), undefined);
    });
    test('refuses another with a 400', () => {
        assert.throws(() => skipReasonOf('tired'), error => error instanceof RouteError && error.status === 400);
    });
});
