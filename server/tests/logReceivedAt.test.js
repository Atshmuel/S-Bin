import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { receivedAtOf } from '../utils/helpers.js';

describe('receivedAtOf', () => {
    test('is the time inside the ID, to the second', () => {
        const stored = new Date('2026-11-04T20:17:10.000Z');
        const id = mongoose.Types.ObjectId.createFromTime(stored.getTime() / 1000);
        assert.equal(receivedAtOf(id).getTime(), stored.getTime());
    });
    test('takes an ID as text too', () => {
        const id = mongoose.Types.ObjectId.createFromTime(1_788_000_000);
        assert.equal(receivedAtOf(String(id)).getTime(), 1_788_000_000_000);
    });
});
