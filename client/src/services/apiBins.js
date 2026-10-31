import { BINS_EP } from "@/utils/constants";
import { toLngLat } from "@/utils/geo";
import { request } from "./request";

//get bins
export function getAllUserBins(page = 1, limit = 10, search = "", sort = null, org = null) {
    const order = sort ? `&sort=${sort.sort}&order=${sort.order}` : "";
    const orgParam = org ? `&org=${org}` : "";
    return request(`${BINS_EP}/all?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}${order}${orgParam}`);
}

// A map view: { total, bins } (marker fields only), or for a crowded view
// { total, cells } with a count per grid cell.
export function getMapBins({ south, west, north, east, zoom }) {
    return request(`${BINS_EP}/map?${new URLSearchParams({ south, west, north, east, zoom })}`);
}

// The box around all the user's devices, where the map opens: { extent };
// `orgId` narrows an owner's to one organization.
export function getMapExtent(orgId) {
    return request(`${BINS_EP}/map/extent${orgId ? `?org=${orgId}` : ""}`);
}

export function getBin({ id }) {
    return request(`${BINS_EP}/${id}`);
}

// `coordinates` is the search centre as the address bar has it, [lat, lng];
// `org` an owner's organization; excludeReserved leaves out bins on other routes.
export function getBinsInUserRadius({ coordinates, radius, health = null, minLevel = null, maxLevel = null, org = null, excludeReserved = false }) {
    return request(`${BINS_EP}/radius${org ? `?org=${org}` : ""}`, {
        method: "POST",
        body: { coordinates: toLngLat(coordinates), radius: +radius * 1000, health, minLevel, maxLevel, ...(excludeReserved ? { excludeReserved } : {}) },
    });
}

//end

export function updateBinMaintenance({ id, notes }) {
    return request(`${BINS_EP}/maintenance/${id}`, { method: "PATCH", body: { notes } });
}

export function updateBinName({ id, name }) {
    return request(`${BINS_EP}/name/${id}`, { method: "PATCH", body: { name } });
}

export function deleteBinsBatch({ binIds = [] }) {
    return request(BINS_EP, { method: "DELETE", body: { binIds } });
}

export function deleteBinById({ id }) {
    return request(`${BINS_EP}/${id}`, { method: "DELETE" });
}

export function deleteBinViaMac(macId) {
    return request(`${BINS_EP}/mac/${macId}`, { method: "DELETE" });
}
