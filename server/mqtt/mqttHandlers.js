import { handleDeviceLog } from "./handlers/telemetry.js";
import { handleRelay } from "./handlers/relay.js";
import { handleJoin } from "./handlers/join.js";
import { handleInstructionCheck, handleInstructionResult } from "./handlers/instructions.js";

export { removeBinConfig } from "./handlers/commands.js";

export async function handleMqttMessage(topic, payload) {
    const parts = topic.split("/"); // bins/<mac>/update/<field>
    if (parts.length !== 4) {
        console.warn("Unknown topic format:", topic);
        return;
    }

    const mac = parts[1];
    const field = parts[3];
    console.log(`Received message for bin ${mac} on field ${field}:`, payload);
    switch (field) {
        case "log":
            await handleDeviceLog(mac, payload);
            break;
        case "instructions":
            await handleInstructionCheck(mac, payload);
            break;
        case "instruction-result":
            await handleInstructionResult(mac, payload);
            break;
        case "relay":
            await handleRelay(mac, payload);
            break;
        case "join":
            await handleJoin(mac, payload);
            break;
        default:
            console.log("Unknown topic:", field);
    }
}
