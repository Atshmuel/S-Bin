import { binLogModel } from "../models/models.js";

// A bin's role changed (see ROLE_CHANGE_CODES in utils/faults.js): one system
// entry in its log, at the level and battery it last had. Never at the cost of
// the change itself, so a failure is only logged.
export async function recordRoleChange(bin, code) {
    try {
        const status = bin.status ?? {};
        const level = status.levelValid === false ? null : status.level ?? null;
        await binLogModel.create({
            binId: bin._id,
            type: "log",
            severity: code === "gateway_lost_sim" ? "warning" : "info",
            source: "system",
            health: status.health,
            oldLevel: level,
            newLevel: level,
            battery: status.battery ?? 0,
            weight: status.weight ?? null,
            faults: [{ code }],
        });
    } catch (error) {
        console.error(`Could not log the role change (${code}) of ${bin._id}:`, error?.message ?? error);
    }
}
