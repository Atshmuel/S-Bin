import { BINS_EP } from "@/utils/constants";
import { request } from "./request";

export function getMeshSettings() {
    return request(`${BINS_EP}/mesh-settings`);
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
