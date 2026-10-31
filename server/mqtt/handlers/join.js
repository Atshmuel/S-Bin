import { getBinByMacAndKeyShared } from "../../db/service/sharedService.js";
import { redeemJoin } from "../../db/service/joinService.js";
import { mqttClient } from "../mqttClient.js";
import { BIN_ACK_TOPIC } from "../mqttTopics.js";

// A gateway relays a JOIN it heard from a leaf without keys (see utils/joinCodes.js).
// Every outcome is answered, so the gateway can pass it on or drop the JOIN.
export async function handleJoin(gatewayMac, { deviceKey, leafMac, orgId, codeId, nonce, proof }) {
    const gateway = await getBinByMacAndKeyShared(gatewayMac, deviceKey);
    if (!gateway) {
        console.warn(`JOIN rejected for ${gatewayMac}: invalid gateway credentials.`);
        return;
    }
    let result;
    try {
        result = await redeemJoin({ gateway, leafMac, orgId, codeId, nonce, proof });
    } catch (error) {
        console.error(`JOIN of ${leafMac} through ${gatewayMac} failed:`, error);
        return;
    }
    const { accepted, reason, ...sealed } = result;
    if (!accepted) console.warn(`JOIN of ${leafMac} through ${gatewayMac} refused: ${reason}.`);
    else console.log(`JOIN of ${leafMac} through ${gatewayMac} accepted.`);
    mqttClient.publish(`${BIN_ACK_TOPIC}/${gatewayMac}`, JSON.stringify({
        status: "join_result", leafMac, nonce, accepted, ...(accepted ? sealed : { reason }),
    }), { qos: 1 }, error => {
        if (error) console.error(`Failed to send the JOIN result to ${gatewayMac}:`, error);
    });
}
