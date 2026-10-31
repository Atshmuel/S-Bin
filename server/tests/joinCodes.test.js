import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    generateJoinCode, joinMaterial, joinProof, joinProofMatches, normalizeJoinCode, openJoinReply, sealJoinReply,
} from '../utils/joinCodes.js';

// Vectors computed independently in Python (the firmware's tests use the same).
const CODE = '0102030405060708090a0b0c0d0e0f10';
const JOIN_KEY = '5c94c0e2876675462e62df6874e9072fb92115daf3c11a340d21faaf047e0b06';
const CODE_ID = 'f5fcaba3';
const MAC = '28:84:85:38:66:44';
const ORG_ID = '699760a44e48dff9a082101e';
const NONCE = '0102030405060708';
const PROOF = '67e62c0a9ebcd28ab187e30c63baeaaa';
const LEAF_KEY = 'ec03733de0bf2c674dfc3e02c081c88c503009e4964933e52b28b7905cb8f3fa';
const BEACON_KEY = '89ff271e100fda114251b8fa137674bb0351fe9fd2a0d616fbfbd120c1f5e7ad';

describe('join code material', () => {
    test('matches the independent computation', () => {
        assert.deepEqual(joinMaterial(CODE), { joinKey: JOIN_KEY, codeId: CODE_ID });
    });
    test('a new code is 128 random bits, different each time', () => {
        const a = generateJoinCode();
        assert.match(a.code, /^[0-9a-f]{32}$/);
        assert.notEqual(a.code, generateJoinCode().code);
        assert.deepEqual(joinMaterial(a.code), { joinKey: a.joinKey, codeId: a.codeId });
    });
    test('a typed code is read without case, spaces or dashes', () => {
        assert.equal(normalizeJoinCode('0102 0304-0506 0708-090A 0B0C-0D0E 0F10'), CODE);
        assert.equal(normalizeJoinCode(CODE.slice(2)), null);
        assert.equal(normalizeJoinCode('z'.repeat(32)), null);
        assert.equal(normalizeJoinCode(undefined), null);
    });
});

describe('join proof', () => {
    test('matches the independent computation', () => {
        assert.equal(joinProof(JOIN_KEY, MAC, ORG_ID, NONCE), PROOF);
        assert.ok(joinProofMatches(JOIN_KEY, MAC, ORG_ID, NONCE, PROOF));
    });
    test('is for one MAC, organization, nonce and code', () => {
        assert.ok(!joinProofMatches(JOIN_KEY, '44:1D:64:BD:63:6C', ORG_ID, NONCE, PROOF));
        assert.ok(!joinProofMatches(JOIN_KEY, MAC, '699760a44e48dff9a082101f', NONCE, PROOF));
        assert.ok(!joinProofMatches(JOIN_KEY, MAC, ORG_ID, '0102030405060709', PROOF));
        assert.ok(!joinProofMatches(joinMaterial('ff'.repeat(16)).joinKey, MAC, ORG_ID, NONCE, PROOF));
    });
    test('refuses what is not a proof', () => {
        assert.ok(!joinProofMatches(JOIN_KEY, MAC, ORG_ID, NONCE, PROOF.slice(2)));
        assert.ok(!joinProofMatches(JOIN_KEY, MAC, ORG_ID, NONCE, undefined));
    });
});

describe('join reply', () => {
    const sealed = () => sealJoinReply({ joinKey: JOIN_KEY, mac: MAC, nonce: NONCE, keyId: 2, leafKey: LEAF_KEY, beaconKey: BEACON_KEY });
    test('opens with the code\'s key to the keys sent', () => {
        const reply = sealed();
        assert.equal(reply.iv.length, 24);
        assert.equal(reply.ciphertext.length, 130);
        assert.equal(reply.tag.length, 32);
        assert.deepEqual(openJoinReply({ joinKey: JOIN_KEY, mac: MAC, nonce: NONCE, ...reply }),
            { keyId: 2, leafKey: LEAF_KEY, beaconKey: BEACON_KEY });
    });
    test('does not open for another code, MAC or nonce, or when changed', () => {
        const reply = sealed();
        const open = override => openJoinReply({ joinKey: JOIN_KEY, mac: MAC, nonce: NONCE, ...reply, ...override });
        assert.equal(open({ joinKey: joinMaterial('ff'.repeat(16)).joinKey }), null);
        assert.equal(open({ mac: '44:1D:64:BD:63:6C' }), null);
        assert.equal(open({ nonce: '0102030405060709' }), null);
        assert.equal(open({ ciphertext: `00${reply.ciphertext.slice(2)}` }), null);
        assert.equal(open({ tag: `00${reply.tag.slice(2)}` }), null);
    });
    test('is new each time (a random IV)', () => {
        assert.notEqual(sealed().iv, sealed().iv);
    });
});
