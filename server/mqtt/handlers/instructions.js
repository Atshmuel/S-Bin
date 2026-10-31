import mongoose from "mongoose";
import { getBinByMacAndKeyShared, getOrgDeviceSettingsShared } from "../../db/service/sharedService.js";
import { mqttClient } from "../mqttClient.js";
import { BIN_ACK_TOPIC } from "../mqttTopics.js";
import { binModel, deviceInstructionModel } from "../../db/models/models.js";
import { getNextReportSchedule } from "../../utils/deviceSchedule.js";
import { INSTRUCTION_RESULT_MAX_LENGTH, LEAF_INSTRUCTION_TYPES, MAX_LEAF_INSTRUCTIONS } from "../../utils/constants.js";
import { generateRandomToken } from "../../utils/helpers.js";
import { deleteDeviceAccounts } from "../brokerAccounts.js";
import { recordRoleChange } from "../../db/service/roleChangeService.js";

// The oldest pending command of each leaf this gateway relays for.
async function pendingLeafInstructions(gateway) {
    const leaves = await binModel.find(
        { ownerId: gateway.ownerId, "status.connection.via": "mesh", "status.connection.gatewayId": gateway._id },
        { macAddress: 1 }
    ).lean();
    if (leaves.length === 0) return [];
    const macByLeaf = new Map(leaves.map(leaf => [leaf._id.toString(), leaf.macAddress]));
    const pending = await deviceInstructionModel.find({
        binId: { $in: leaves.map(leaf => leaf._id) },
        status: "pending",
        type: { $in: LEAF_INSTRUCTION_TYPES },
    }).sort({ createdAt: 1 }).lean();
    const oldestPerLeaf = new Map();
    for (const instruction of pending) {
        const leafId = instruction.binId.toString();
        if (!oldestPerLeaf.has(leafId)) oldestPerLeaf.set(leafId, instruction);
    }
    return [...oldestPerLeaf.values()].slice(0, MAX_LEAF_INSTRUCTIONS)
        .map(instruction => ({ ...instruction, leafMac: macByLeaf.get(instruction.binId.toString()) }));
}

// A gateway that ran become_leaf: its bin becomes a mesh leaf's (meshOnly, a
// key nobody holds) and its broker account goes, so a later SIM makes it a
// gateway again through registration, in the same bin.
async function demoteToLeaf(binId) {
    const bin = await binModel.findOneAndUpdate(
        { _id: binId, meshOnly: { $ne: true } },
        { $set: { meshOnly: true, deviceKey: generateRandomToken() } },
        { projection: { macAddress: 1, status: 1 } }
    );
    if (bin) {
        await recordRoleChange(bin, "became_leaf");
        await deleteDeviceAccounts([bin.macAddress]);
        console.log(`[Mesh] ${bin.macAddress} became a mesh leaf.`);
    }
}

// Records a device's result for one of its commands; a repeat of a result
// already recorded is accepted, another final status is not. Returns the
// instruction, or null when the result does not apply.
export async function applyInstructionResult(binId, { instructionId, status, result }) {
    const instruction = await recordInstructionResult(binId, { instructionId, status, result });
    if (instruction?.type === "become_leaf" && instruction.status === "completed") {
        await demoteToLeaf(binId);
    }
    return instruction;
}

async function recordInstructionResult(binId, { instructionId, status, result }) {
    if (!mongoose.Types.ObjectId.isValid(instructionId) ||
        !["completed", "failed"].includes(status) ||
        (result !== undefined && (typeof result !== "string" || result.length > INSTRUCTION_RESULT_MAX_LENGTH))) {
        return null;
    }
    const instruction = await deviceInstructionModel.findOneAndUpdate(
        { _id: instructionId, binId, status: "pending" },
        { $set: { status, completedAt: new Date(), ...(result === undefined ? {} : { result }) } },
        { new: true }
    );
    if (instruction) return instruction;
    const existing = await deviceInstructionModel.findOne({ _id: instructionId, binId });
    return existing?.status === status ? existing : null;
}

export async function handleInstructionCheck(mac, { deviceKey }) {
    if (!deviceKey) {
        console.warn(`Instruction check rejected for ${mac}: missing device key.`);
        return;
    }

    const bin = await getBinByMacAndKeyShared(mac, deviceKey);
    if (!bin) {
        console.warn(`Instruction check rejected for ${mac}: invalid device credentials.`);
        return;
    }

    const pendingInstructions = await deviceInstructionModel.find({
        binId: bin._id,
        status: "pending"
    })
        .sort({ createdAt: 1 })
        .limit(2)
        .lean();
    const instructions = pendingInstructions.map(({ _id, type, payload }) => ({
        id: _id.toString(),
        type,
        payload
    }));
    const leafInstructions = await pendingLeafInstructions(bin);

    const { meshAwakeWindowSeconds, reportIntervalMinutes, reportStartHour } = await getOrgDeviceSettingsShared(bin.ownerId);
    const { timeZone, nextWakeEpoch, followingWakeEpoch, sleepDurationSeconds } =
        getNextReportSchedule(bin.location.coordinates, reportIntervalMinutes, reportStartHour);
    const response = JSON.stringify({
        status: "instruction_check",
        instructions,
        leafInstructions: leafInstructions.map(({ _id, leafMac, type, payload }) => ({
            leafMac,
            id: _id.toString(),
            type,
            payload,
        })),
        timeZone,
        nextWakeEpoch,
        followingWakeEpoch,
        sleepDurationSeconds,
        meshAwakeWindowSeconds,
    });
    mqttClient.publish(`${BIN_ACK_TOPIC}/${mac}`, response, { qos: 1 }, async error => {
        if (error) {
            console.error(`Failed to reply to instruction check for ${mac}:`, error);
            return;
        }
        const delivered = [...pendingInstructions, ...leafInstructions];
        if (delivered.length > 0) {
            try {
                await deviceInstructionModel.updateMany(
                    {
                        _id: { $in: delivered.map(instruction => instruction._id) },
                        status: "pending"
                    },
                    {
                        $inc: { deliveryAttempts: 1 },
                        $set: { lastDeliveredAt: new Date() }
                    }
                );
            } catch (updateError) {
                console.error(`Failed to record instruction delivery attempts for ${mac}:`, updateError);
            }
        }
    });
}

export async function handleInstructionResult(mac, { deviceKey, instructionId, status, result }) {
    if (!deviceKey) {
        console.warn(`Invalid instruction result received for ${mac}.`);
        return;
    }

    const bin = await getBinByMacAndKeyShared(mac, deviceKey);
    if (!bin) {
        console.warn(`Instruction result rejected for ${mac}: invalid device credentials.`);
        return;
    }

    const instruction = await applyInstructionResult(bin._id, { instructionId, status, result });
    if (!instruction) {
        console.warn(`Instruction result ignored for ${mac}: invalid, missing, or a different final status.`);
        return;
    }

    mqttClient.publish(`${BIN_ACK_TOPIC}/${mac}`, JSON.stringify({
        status: "instruction_result",
        instructionId: instruction._id.toString(),
        accepted: true
    }), { qos: 1 }, error => {
        if (error) {
            console.error(`Failed to acknowledge instruction result for ${mac}:`, error);
        }
    });
}
