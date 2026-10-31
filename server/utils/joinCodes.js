import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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
//   encKey  = HMAC(joinKey, "S-Bin join enc v1"); AES-256-GCM, a random 12-byte IV,
//             MAC + nonce as the associated data, keyId + leafKey + beaconKey inside

const JOIN_KEY_LABEL = "S-Bin join key v1";
const JOIN_ID_LABEL = "S-Bin join id v1";
const JOIN_PROOF_LABEL = "S-Bin join proof v1";
const JOIN_ENC_LABEL = "S-Bin join enc v1";
const JOIN_CODE_BYTES = 16;
const PROOF_BYTES = 16;
const IV_BYTES = 12;

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

const encKeyOf = joinKeyHex => hmac(Buffer.from(joinKeyHex, "hex"), JOIN_ENC_LABEL);

// The leaf's keys for its JOIN, sealed so only the holder of the code opens them.
export function sealJoinReply({ joinKey, mac, nonce, keyId, leafKey, beaconKey }) {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", encKeyOf(joinKey), iv);
    cipher.setAAD(Buffer.concat([macBytes(mac), Buffer.from(nonce, "hex")]));
    const ciphertext = Buffer.concat([cipher.update(Buffer.concat([Buffer.from([keyId]), Buffer.from(leafKey, "hex"), Buffer.from(beaconKey, "hex")])), cipher.final()]);
    return { iv: iv.toString("hex"), ciphertext: ciphertext.toString("hex"), tag: cipher.getAuthTag().toString("hex") };
}

// What the leaf does with it (here for the tests): the keys, or null if the
// reply is not for this JOIN or was changed.
export function openJoinReply({ joinKey, mac, nonce, iv, ciphertext, tag }) {
    try {
        const decipher = createDecipheriv("aes-256-gcm", encKeyOf(joinKey), Buffer.from(iv, "hex"));
        decipher.setAAD(Buffer.concat([macBytes(mac), Buffer.from(nonce, "hex")]));
        decipher.setAuthTag(Buffer.from(tag, "hex"));
        const plain = Buffer.concat([decipher.update(Buffer.from(ciphertext, "hex")), decipher.final()]);
        return { keyId: plain[0], leafKey: plain.subarray(1, 33).toString("hex"), beaconKey: plain.subarray(33, 65).toString("hex") };
    } catch {
        return null;
    }
}
