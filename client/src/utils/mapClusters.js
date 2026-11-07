import L from "leaflet"
import { STATUS_COLORS } from "./binHelpers"


const STATUS_RANK = {
    [STATUS_COLORS.good]: 0,
    [STATUS_COLORS.warning]: 1,
    [STATUS_COLORS.critical]: 2,
}

// A group's marker: the count of its devices, ringed in the color of its most
// urgent device, so a full bin is not hidden inside a group.
export function createClusterIcon(cluster) {
    const colors = cluster.getAllChildMarkers().map((marker) => marker.options.markerColor)
    const worst = colors.reduce(
        (current, color) => ((STATUS_RANK[color] ?? 0) > (STATUS_RANK[current] ?? 0) ? color : current),
        STATUS_COLORS.good,
    )
    return L.divIcon({
        html: `<div class="bin-cluster" style="--cluster-color: ${worst}">${cluster.getChildCount()}</div>`,
        className: "",
        iconSize: [44, 44],
    })
}

// A grid cell the server counted (a crowded view): the same marker as a
// group, with its count and the color of its most urgent device (0 good,
// 1 warning, 2 critical).
const URGENCY_COLORS = Object.freeze([STATUS_COLORS.good, STATUS_COLORS.warning, STATUS_COLORS.critical])

export function createCellIcon(count, urgency) {
    const label = count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count)
    return L.divIcon({
        html: `<div class="bin-cluster" style="--cluster-color: ${URGENCY_COLORS[urgency] ?? STATUS_COLORS.good}">${label}</div>`,
        className: "",
        iconSize: [44, 44],
    })
}

// A route's stop: a pin in the route's blue with its place in the driving
// order, and a dot in its fullness color; unlike a group's count.
export const ROUTE_COLOR = "#2563eb"
// A stop already done is grey with a check.
// A stop's marker: its number in driving order, or a check once done, or a
// dash, faded, when skipped (so a skipped stop never reads as one to do).
export function createStopIcon(order, color, status = "planned") {
    const done = status === "done", skipped = status === "skipped"
    return L.divIcon({
        html: `<div style="position:relative;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:${done || skipped ? "#9ca3af" : ROUTE_COLOR};opacity:${skipped ? 0.55 : 1};color:#fff;font-weight:700;font-size:12px;border:2px ${skipped ? "dashed" : "solid"} #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)">${done ? "✓" : skipped ? "–" : order}<span style="position:absolute;right:-3px;bottom:-3px;width:11px;height:11px;border-radius:9999px;background:${color};border:2px solid #fff"></span></div>`,
        className: "",
        iconSize: [28, 28],
    })
}

// Where a route starts and ends (the depot, or the planner's start point).
export function createRouteEndIcon(label) {
    return L.divIcon({
        html: `<div style="display:flex;align-items:center;justify-content:center;white-space:nowrap;padding:4px 8px;border-radius:9999px;background:#0f172a;color:#fff;font-weight:600;border:2px solid #fff;font-size:12px;box-shadow:0 1px 4px rgba(0,0,0,.4)">${label}</div>`,
        className: "",
        iconSize: null,
        iconAnchor: [0, 12],
    })
}

// Where the user is ("my location"): a blue dot in a white ring with a soft
// halo, drawn here rather than Leaflet's default pin, whose image the build
// does not carry.
export function createUserLocationIcon() {
    return L.divIcon({
        html: `<div style="width:18px;height:18px;border-radius:9999px;background:${ROUTE_COLOR};border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25),0 1px 4px rgba(0,0,0,.45)"></div>`,
        className: "",
        iconSize: [18, 18],
        popupAnchor: [0, -10],
    })
}
