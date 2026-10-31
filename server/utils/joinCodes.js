import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// How a leaf without a SIM gets its mesh keys (2n, the JOIN). The add-bin wizard
// makes a one-time join code of 128 random bits and gives it to the leaf's
// setup page; it is never sent over the air. The leaf proves it holds the code
// in its JOIN, and the server answers with the leaf's two keys sealed under a
// key made from the code. The firmware makes the same keys (SbinMeshJoin.cpp):
// keep the labels in step, the tests share its vectors.
//
//   joinKey = HMAC(code, "S-Bin join key v1")
//   codeId  = first 4 bytes of HMAC(joinKey, "S-Bin join id v1"), told in the JOIN
//   proof   = first 16 bytes of HMAC(joinKey, "S-Bin join proof v1" + MAC + orgId + nonce)
//   reply   = keyId + leafKey + beaconKey (65 bytes), encrypted and then authenticated with HMAC
//             alone, so the leaf needs no other primitive: a random 12-byte IV;
//             keystream block i = HMAC(HMAC(joinKey, "S-Bin join enc v1"), IV + i), 3 blocks;
//             tag = first 16 bytes of HMAC(HMAC(joinKey, "S-Bin join mac v1"),
//                   "S-Bin join reply v1" + MAC + nonce + IV + ciphertext)

const JOIN_KEY_LABEL = "S-Bin join key v1";
const JOIN_ID_LABEL = "S-Bin join id v1";
const JOIN_PROOF_LABEL = "S-Bin join proof v1";
const JOIN_ENC_LABEL = "S-Bin join enc v1";
const JOIN_MAC_LABEL = "S-Bin join mac v1";
const JOIN_REPLY_LABEL = "S-Bin join reply v1";
const JOIN_CODE_BYTES = 16;
const PROOF_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PLAIN_BYTES = 65;

const isHex = (value, bytes) => typeof value === "string" && new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`).test(value);
const hmac = (key, ...parts) => createHmac("sha256", key).update(Buffer.concat(parts.map(part => Buffer.from(part)))).digest();
const macBytes = mac => Buffer.from(mac.replaceAll(":", ""), "hex");

export const isJoinCodeId = value => isHex(value, 4);
export const isJoinNonce = value => isHex(value, 8);
export const isJoinProof = value => isHex(value, PROOF_BYTES);
export const isOrgIdHex = value => isHex(value, 12);

// What a code someone typed or pasted means: 32 hex characters, without case,
// spaces or dashes; null when it is not one.
export function normalizeJoinCode(typed) {
    const code = typeof typed === "string" ? typed.toLowerCase().replace(/[\s-]/g, "") : "";
    return isHex(code, JOIN_CODE_BYTES) ? code : null;
}

// The two things the server keeps of a code (never the code itself).
export function joinMaterial(code) {
    const joinKey = hmac(Buffer.from(code, "hex"), JOIN_KEY_LABEL);
    return {
        joinKey: joinKey.toString("hex"),
        codeId: hmac(joinKey, JOIN_ID_LABEL).subarray(0, 4).toString("hex"),
    };
}

export function generateJoinCode() {
    const code = randomBytes(JOIN_CODE_BYTES).toString("hex");
    return { code, ...joinMaterial(code) };
}

const proofOf = (joinKeyHex, mac, orgIdHex, nonceHex) =>
    hmac(Buffer.from(joinKeyHex, "hex"), JOIN_PROOF_LABEL, macBytes(mac), Buffer.from(orgIdHex, "hex"), Buffer.from(nonceHex, "hex"))
        .subarray(0, PROOF_BYTES);

export const joinProof = (joinKeyHex, mac, orgIdHex, nonceHex) => proofOf(joinKeyHex, mac, orgIdHex, nonceHex).toString("hex");

export function joinProofMatches(joinKeyHex, mac, orgIdHex, nonceHex, proofHex) {
    if (!isJoinProof(proofHex)) return false;
    return timingSafeEqual(proofOf(joinKeyHex, mac, orgIdHex, nonceHex), Buffer.from(proofHex, "hex"));
}

const subKey = (joinKeyHex, label) => hmac(Buffer.from(joinKeyHex, "hex"), label);
const keystream = (joinKeyHex, iv) => {
    const key = subKey(joinKeyHex, JOIN_ENC_LABEL);
    return Buffer.concat([0, 1, 2].map(block => hmac(key, iv, Buffer.from([block])))).subarray(0, PLAIN_BYTES);
};
const replyTag = (joinKeyHex, mac, nonce, iv, ciphertext) =>
    hmac(subKey(joinKeyHex, JOIN_MAC_LABEL), JOIN_REPLY_LABEL, macBytes(mac), Buffer.from(nonce, "hex"), iv, ciphertext).subarray(0, TAG_BYTES);
const xor = (a, b) => Buffer.from(a.map((byte, i) => byte ^ b[i]));

// The leaf's keys for its JOIN, sealed so only the holder of the code opens them.
// (iv is random; a test passes one to compare with another implementation.)
export function sealJoinReply({ joinKey, mac, nonce, keyId, leafKey, beaconKey, iv = randomBytes(IV_BYTES) }) {
    const plain = Buffer.concat([Buffer.from([keyId]), Buffer.from(leafKey, "hex"), Buffer.from(beaconKey, "hex")]);
    const ciphertext = xor(plain, keystream(joinKey, iv));
    return {
        iv: iv.toString("hex"),
        ciphertext: ciphertext.toString("hex"),
        tag: replyTag(joinKey, mac, nonce, iv, ciphertext).toString("hex"),
    };
}

// What the leaf does with it (here for the tests): the keys, or null if the
// reply is not for this JOIN or was changed.
export function openJoinReply({ joinKey, mac, nonce, iv, ciphertext, tag }) {
    if (!isHex(iv, IV_BYTES) || !isHex(ciphertext, PLAIN_BYTES) || !isHex(tag, TAG_BYTES)) return null;
    const ivBytes = Buffer.from(iv, "hex");
    const cipherBytes = Buffer.from(ciphertext, "hex");
    if (!timingSafeEqual(replyTag(joinKey, mac, nonce, ivBytes, cipherBytes), Buffer.from(tag, "hex"))) return null;
    const plain = xor(cipherBytes, keystream(joinKey, ivBytes));
    return { keyId: plain[0], leafKey: plain.subarray(1, 33).toString("hex"), beaconKey: plain.subarray(33, 65).toString("hex") };
}
