import { BINS_EP } from "@/utils/constants";
import { request } from "./request";

export function getMeshSettings() {
    return request(`${BINS_EP}/mesh-settings`);
}

// A new generation of the organization's mesh key; the answer is only its number.
export function rotateMeshKey(orgId) {
    return request(`${BINS_EP}/mesh-settings/${orgId}/rotate-mesh-key`, { method: "POST" });
}

// A one-time code for the leaf about to be added (a device without a SIM card).
export function createJoinCode(orgId) {
    return request(`${BINS_EP}/mesh-settings/${orgId}/join-code`, { method: "POST" });
}

export function updateMeshSettings({ orgId, meshAwakeWindowSeconds, reportIntervalMinutes, reportStartHour }) {
    return request(`${BINS_EP}/mesh-settings/${orgId}`, {
        method: "PATCH",
        body: { meshAwakeWindowSeconds, reportIntervalMinutes, reportStartHour },
    });
}
