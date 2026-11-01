import { getBinByMacAndKeyShared } from "../../db/service/sharedService.js";
import { generateRandomToken } from "../../utils/helpers.js";
import { mqttClient } from "../mqttClient.js";
import { BIN_ACK_TOPIC } from "../mqttTopics.js";
import { binModel } from "../../db/models/models.js";
import { isDeletedLeaf } from "../../db/service/deletedLeafService.js";
import { getNextReportSchedule } from "../../utils/deviceSchedule.js";
import { fromDeviceLocation } from "../../utils/geo.js";
import { applyDeviceLog, isValidTelemetryRecord } from "./telemetry.js";
import { applyInstructionResult } from "./instructions.js";
import { MAX_MESH_HOPS, MAX_READING_AGE_MS, MAX_READING_AHEAD_MS, RECENT_MESH_MESSAGE_IDS } from "../../utils/constants.js";

const MAC_ADDRESS_PATTERN = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
// A leaf that missed its gateway sends queued readings later, and the gateway
// stamps each with when it was taken; a time beyond MAX_READING_AGE_MS or
// MAX_READING_AHEAD_MS is not trusted, and the reading is logged at its arrival.

// measuredAt is in UTC seconds; returns undefined when the arrival time should be used.
function readingTime(measuredAt, leafMac) {
    if (measuredAt === undefined) return undefined;
    const now = Date.now();
    const measuredAtMs = measuredAt * 1000;
    if (!Number.isInteger(measuredAt) || measuredAtMs > now + MAX_READING_AHEAD_MS ||
        measuredAtMs < now - MAX_READING_AGE_MS) {
        console.warn(`Ignoring the reading time ${measuredAt} of ${leafMac}; using its arrival time.`);
        return undefined;
    }
    // A gateway clock slightly ahead must not date a reading in the future.
    return new Date(Math.min(measuredAtMs, now));
}

function publishRelayResult(gatewayMac, leafMac, messageId, accepted, reason) {
    mqttClient.publish(`${BIN_ACK_TOPIC}/${gatewayMac}`, JSON.stringify({
        status: "relay_result",
        leafMac,
        messageId,
        accepted,
        ...(reason === undefined ? {} : { reason }),
    }), { qos: 1 }, error => {
        if (error) {
            console.error(`Failed to send relay result to ${gatewayMac}:`, error);
        }
    });
}

async function findOrCreateLeafBin(leafMac, gateway, record) {
    const existing = await binModel.findOne({ macAddress: leafMac });
    if (existing) return existing;

    try {
        return await binModel.create({
            binName: `Bin-${leafMac.slice(0, 5)}-${Date.now().toString().slice(-4)}`,
            macAddress: leafMac,
            ownerId: gateway.ownerId,
            deviceKey: generateRandomToken(),
            meshOnly: true,
            location: { type: "Point", coordinates: record.location },
            timezone: getNextReportSchedule(record.location).timeZone,
            status: { battery: record.battery },
        });
    } catch (error) {
        // Another gateway relayed the same new leaf at the same moment.
        if (error?.code === 11000) {
            return binModel.findOne({ macAddress: leafMac });
        }
        throw error;
    }
}

// A mesh gateway uploads a reading it took custody of from a leaf without a SIM.
// The leaf has no device key, so the authenticated gateway vouches for it; leaves
// are created in, and limited to, the gateway's organization.
export async function handleRelay(gatewayMac, { deviceKey, leafMac, messageId, hops, rssi, measuredAt, record, instructionResult }) {
    const gateway = await getBinByMacAndKeyShared(gatewayMac, deviceKey);
    if (!gateway) {
        console.warn(`Relay rejected for ${gatewayMac}: invalid gateway credentials.`);
        return;
    }
    if (typeof leafMac !== "string" || !MAC_ADDRESS_PATTERN.test(leafMac) ||
        !Number.isInteger(messageId) || messageId < 0 || messageId > 0xFFFFFFFF) {
        console.warn(`Relay from ${gatewayMac} has no valid leaf MAC or message ID.`);
        return;
    }
    // Permanent rejections are still answered so the gateway drops the record.
    if (leafMac.toUpperCase() === gatewayMac.toUpperCase() ||
        !Number.isInteger(hops) || hops < 1 || hops > MAX_MESH_HOPS ||
        (rssi !== undefined && (!Number.isInteger(rssi) || rssi < -128 || rssi > 0)) ||
        !record || typeof record !== "object" || Array.isArray(record)) {
        publishRelayResult(gatewayMac, leafMac, messageId, false, "invalid_envelope");
        return;
    }

    // A leaf whose bin was deleted keeps reporting (it has no broker account, so
    // the deletion never reached it): its bin is not made again. It is let back in
    // by joining again.
    const existing = await binModel.findOne({ macAddress: leafMac }, { kind: 1 }).lean();
    if (!existing && await isDeletedLeaf(gateway.ownerId, leafMac)) {
        console.warn(`Relay rejected: ${leafMac} was deleted from the organization.`);
        publishRelayResult(gatewayMac, leafMac, messageId, false, "leaf_deleted");
        return;
    }

    // A leaf without a location of its own stands at its gateway. Checked in
    // the device's [lat, lng], then stored as [lng, lat] like every location. A
    // gateway reporting through this one (a pole gateway without a SIM) has no
    // fill sensor, so its record needs no level.
    const [gatewayLng, gatewayLat] = gateway.location.coordinates;
    const deviceRecord = record.location === undefined ? { ...record, location: [gatewayLat, gatewayLng] } : record;
    if (!isValidTelemetryRecord(deviceRecord, existing?.kind ?? "bin")) {
        publishRelayResult(gatewayMac, leafMac, messageId, false, "invalid_record");
        return;
    }
    const leafRecord = { ...deviceRecord, location: fromDeviceLocation(deviceRecord.location) };

    const leaf = await findOrCreateLeafBin(leafMac, gateway, leafRecord);
    if (!leaf.ownerId.equals(gateway.ownerId)) {
        console.warn(`Relay rejected: leaf ${leafMac} belongs to another organization than gateway ${gatewayMac}.`);
        publishRelayResult(gatewayMac, leafMac, messageId, false, "organization_mismatch");
        return;
    }

    // A reading can carry the leaf's result for a command its gateway handed
    // over. Applied before the duplicate check, so a re-sent reading (its
    // first reply lost) still records it; an invalid result is only logged.
    if (instructionResult !== undefined) {
        const applied = instructionResult && typeof instructionResult === "object" &&
            await applyInstructionResult(leaf._id, instructionResult);
        if (!applied) {
            console.warn(`Ignoring the command result relayed for ${leafMac}.`);
        }
    }

    // Claim the message ID first so two gateways uploading the same reading
    // cannot both store it; release the claim if storing fails.
    const claim = await binModel.updateOne(
        { _id: leaf._id, "status.recentMeshMessageIds": { $ne: messageId } },
        { $push: { "status.recentMeshMessageIds": { $each: [messageId], $slice: -RECENT_MESH_MESSAGE_IDS } } }
    );
    if (claim.modifiedCount === 0) {
        console.log(`Duplicate relay of message ${messageId} for ${leafMac}; acknowledging again.`);
        publishRelayResult(gatewayMac, leafMac, messageId, true, "duplicate");
        return;
    }

    const takenAt = readingTime(measuredAt, leafMac);
    try {
        await applyDeviceLog(leaf, leafRecord, {
            via: "mesh",
            gatewayId: gateway._id,
            hops,
            rssi: rssi ?? null,
            measuredAt: takenAt,
        });
    } catch (error) {
        await binModel.updateOne(
            { _id: leaf._id },
            { $pull: { "status.recentMeshMessageIds": messageId } }
        );
        throw error;
    }

    const delay = takenAt ? `, taken ${Math.round((Date.now() - takenAt.getTime()) / 1000)} s ago` : "";
    console.log(`Stored relayed log for ${leafMac} via ${gatewayMac} (${hops} hop(s)${delay}).`);
    publishRelayResult(gatewayMac, leafMac, messageId, true);
}
