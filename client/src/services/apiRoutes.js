import { ROUTES_EP } from "@/utils/constants";
import { request } from "./request";

// A day's routes ({ serviceDay, routes }): `day` is YYYY-MM-DD (today in the
// organization's time zone when left out), `org` an owner's organization.
export function getRoutes({ day, org, status } = {}) {
    const params = new URLSearchParams(Object.entries({ day, org, status }).filter(([, value]) => value));
    return request(`${ROUTES_EP}${params.size ? `?${params}` : ""}`);
}

export function getRoute({ id }) {
    return request(`${ROUTES_EP}/${id}`);
}

// The active drivers a route of the organization can be given.
export function getRouteDrivers({ org }) {
    return request(`${ROUTES_EP}/drivers${org ? `?org=${org}` : ""}`);
}

// Plans the organization's day now, as the nightly plan does: { plan } with its
// routes, bins and what was left (409 when today is already planned).
export function planDayNow({ org } = {}) {
    return request(`${ROUTES_EP}/plan-day${org ? `?org=${org}` : ""}`, { method: "POST" });
}

// Plans and stores a route: { route } (null with a `reason` when nothing matched or fitted).
export function createRoute(body) {
    return request(ROUTES_EP, { method: "POST", body });
}

// Deletes a route for good (owners).
export function deleteRoute({ id }) {
    return request(`${ROUTES_EP}/${id}`, { method: "DELETE" });
}

// Changes a route: { driverId }, { truckTypeId } or { status: "cancelled" }.
export function updateRoute({ id, ...changes }) {
    return request(`${ROUTES_EP}/${id}`, { method: "PATCH", body: changes });
}

// ---- Driving. A position is the phone's [lng, lat].

// Starts driving (or goes back to it); with a position, the stops still to do
// are re-ordered from there.
export function startRoute({ id, position }) {
    return request(`${ROUTES_EP}/${id}/start`, { method: "POST", body: position ? { position } : {} });
}

export function markStopDone({ id, binId, position, accuracyMeters }) {
    return request(`${ROUTES_EP}/${id}/stops/${binId}/done`, { method: "POST", body: { ...(position ? { position, accuracyMeters } : {}) } });
}

export function undoStopDone({ id, binId }) {
    return request(`${ROUTES_EP}/${id}/stops/${binId}/done`, { method: "DELETE" });
}

// `reason` is one of the server's ROUTE_SKIP_REASONS.
export function skipStop({ id, binId, reason }) {
    return request(`${ROUTES_EP}/${id}/stops/${binId}/skip`, { method: "POST", body: reason ? { reason } : {} });
}

export function undoSkipStop({ id, binId }) {
    return request(`${ROUTES_EP}/${id}/stops/${binId}/skip`, { method: "DELETE" });
}

export function finishRoute({ id }) {
    return request(`${ROUTES_EP}/${id}/finish`, { method: "POST" });
}

