import { binModel, joinCodeModel } from "../models/models.js";
import { JOIN_CODE_TTL_MS, MAX_ACTIVE_JOIN_CODES, MAX_JOIN_PROOF_FAILURES } from "../../utils/constants.js";
import {
    generateJoinCode, isJoinCodeId, isJoinNonce, isJoinProof, isOrgIdHex, joinProofMatches, sealJoinReply,
} from "../../utils/joinCodes.js";
import { deriveBeaconKey, deriveLeafKey, isMacAddress } from "../../utils/meshKeys.js";
import { ensureMeshKey } from "./meshKeyService.js";

// A new join code for the organization's next leaf, shown once to the person
// adding it. Only the newest few unused ones are kept.
export async function createJoinCode(orgId, userId) {
    const { code, codeId, joinKey } = generateJoinCode();
    const expiresAt = new Date(Date.now() + JOIN_CODE_TTL_MS);
    await joinCodeModel.create({ orgId, codeId, joinKey, createdBy: userId, expiresAt });
    const surplus = await joinCodeModel.find({ orgId, boundMac: null }, { _id: 1 })
        .sort({ createdAt: -1 }).skip(MAX_ACTIVE_JOIN_CODES).lean();
    if (surplus.length > 0) {
        await joinCodeModel.deleteMany({ _id: { $in: surplus.map(entry => entry._id) } });
    }
    return { code, expiresAt };
}

// A leaf's JOIN, relayed by one of the organization's gateways. Accepted: the
// leaf's keys, sealed under the code. Refused: why, for the log and the gateway
// (never which part of a proof was wrong).
export async function redeemJoin({ gateway, leafMac, orgId, codeId, nonce, proof }) {
    if (!isMacAddress(leafMac) || !isOrgIdHex(orgId) || !isJoinCodeId(codeId) || !isJoinNonce(nonce) || !isJoinProof(proof)) {
        return { accepted: false, reason: "invalid_envelope" };
    }
    const mac = leafMac.toUpperCase();
    if (!gateway.ownerId.equals(orgId)) return { accepted: false, reason: "organization_mismatch" };

    const entry = await joinCodeModel.findOne({ codeId: codeId.toLowerCase(), orgId }).select("+joinKey");
    if (!entry || entry.expiresAt <= new Date()) return { accepted: false, reason: "invalid_code" };
    if (entry.boundMac && entry.boundMac !== mac) return { accepted: false, reason: "code_used" };
    if (!joinProofMatches(entry.joinKey, mac, orgId, nonce, proof)) {
        entry.failedProofs += 1;
        if (entry.failedProofs >= MAX_JOIN_PROOF_FAILURES) await entry.deleteOne();
        else await entry.save();
        return { accepted: false, reason: "invalid_code" };
    }

    // A device that already has a bin keeps it, in its own organization; a
    // registered gateway has a device key and needs no leaf keys.
    const existing = await binModel.findOne({ macAddress: mac }, { ownerId: 1, meshOnly: 1 }).lean();
    if (existing && !existing.ownerId.equals(orgId)) return { accepted: false, reason: "mac_in_other_organization" };
    if (existing && !existing.meshOnly) return { accepted: false, reason: "mac_is_gateway" };

    const current = await ensureMeshKey(orgId);
    if (!current) return { accepted: false, reason: "invalid_code" };
    const bound = await joinCodeModel.updateOne(
        { _id: entry._id, $or: [{ boundMac: null }, { boundMac: mac }] },
        { $set: { boundMac: mac } },
    );
    if (bound.matchedCount === 0) return { accepted: false, reason: "code_used" };

    return {
        accepted: true,
        keyId: current.meshKeyId,
        ...sealJoinReply({
            joinKey: entry.joinKey, mac, nonce, keyId: current.meshKeyId,
            leafKey: deriveLeafKey(current.meshKey, mac), beaconKey: deriveBeaconKey(current.meshKey),
        }),
    };
}
