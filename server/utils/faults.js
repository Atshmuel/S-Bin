// What went wrong with a reading, as codes instead of sentences: the client
// words them in the user's language, and the server in English only for its
// emails and the AI overview. A device sends its own (from firmware 1.3.0;
// older firmware sends an English `message`, kept as it came); the server adds
// the fullness and battery ones, and its system entries have theirs (the role
// changes: a gateway losing or getting back its SIM, a leaf becoming a gateway
// and back, so an owner knows when to turn a gateway without a SIM into a leaf).

// A device's own faults, each with how many reporting cycles in a row it has
// lasted (2: two or more) and, for the distance sensor, the distance it read.
// The last two come from a gateway that reports through another one.
export const DEVICE_FAULT_CODES = Object.freeze([
    "calibration_failed", "distance_sensor", "fill_calculation", "pmu", "gps", "scale",
    "sim_missing", "cellular_unavailable",
]);
export const SERVER_FAULT_CODES = Object.freeze([
    "bin_full", "bin_filling", "battery_critical", "battery_low", "instructions_expired",
    "gateway_lost_sim", "gateway_got_sim", "became_gateway", "became_leaf",
]);
export const ROLE_CHANGE_CODES = Object.freeze(["gateway_lost_sim", "gateway_got_sim", "became_gateway", "became_leaf"]);
export const FAULT_CODES = Object.freeze([...DEVICE_FAULT_CODES, ...SERVER_FAULT_CODES]);
const MAX_FAULT_CYCLES = 2;
const MIN_FAULT_MM = -1;
const MAX_FAULT_MM = 20000;

// A device's faults that check out: known codes, once each, with their
// numbers only when in range. A bad entry is dropped, never the report.
export function cleanFaults(raw) {
    if (!Array.isArray(raw)) return [];
    const clean = new Map();
    for (const fault of raw.slice(0, DEVICE_FAULT_CODES.length)) {
        if (!fault || typeof fault !== "object" || !DEVICE_FAULT_CODES.includes(fault.code) || clean.has(fault.code)) continue;
        const within = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
        clean.set(fault.code, {
            code: fault.code,
            ...(within(fault.cycles, 1, MAX_FAULT_CYCLES) ? { cycles: fault.cycles } : {}),
            ...(within(fault.mm, MIN_FAULT_MM, MAX_FAULT_MM) ? { mm: fault.mm } : {}),
        });
    }
    return [...clean.values()];
}

// The part of the device each code is about, for the analytics' causes.
export const FAULT_CAUSES = Object.freeze({
    calibration_failed: "fillSensor",
    distance_sensor: "fillSensor",
    fill_calculation: "fillSensor",
    pmu: "battery",
    battery_low: "battery",
    battery_critical: "battery",
    scale: "scale",
    gps: "gps",
    sim_missing: "connectivity",
    cellular_unavailable: "connectivity",
});

const inCycles = cycles => cycles >= MAX_FAULT_CYCLES ? "in 2 or more consecutive reporting cycles" : "in the previous reporting cycle";
const FAULT_TEXT = Object.freeze({
    bin_full: () => "Bin is almost full.",
    bin_filling: () => "Bin is filling up.",
    battery_critical: () => "Battery level is critical.",
    battery_low: () => "Battery level is low.",
    calibration_failed: ({ mm }) => `Empty-bin calibration failed${mm !== undefined ? ` (distance ${mm} mm)` : ""}.`,
    distance_sensor: ({ cycles }) => `The distance sensor did not answer ${inCycles(cycles)}.`,
    fill_calculation: ({ cycles, mm }) => `The fill level could not be worked out${mm !== undefined ? ` at ${mm} mm` : ""} ${inCycles(cycles)}.`,
    pmu: ({ cycles }) => `The power chip or battery measurement failed ${inCycles(cycles)}.`,
    gps: ({ cycles }) => `The GPS refresh failed ${cycles >= MAX_FAULT_CYCLES ? "in 2 or more consecutive monthly attempts" : "in the previous monthly attempt"}.`,
    scale: ({ cycles }) => `The scale reading failed ${inCycles(cycles)}.`,
    sim_missing: () => "There is no SIM card in the device; it reports through another gateway.",
    cellular_unavailable: () => "The device cannot reach the cellular network; it reports through another gateway.",
    gateway_lost_sim: () => "The gateway lost its SIM card and now reports through another gateway. If the SIM was taken out on purpose, turn it into a mesh leaf.",
    gateway_got_sim: () => "The gateway has a SIM card again and reports by itself.",
    became_gateway: () => "The mesh leaf found a SIM card and became a gateway.",
    became_leaf: () => "The gateway became a mesh leaf and reports through another gateway.",
    instructions_expired: ({ types }) => `Device did not pick up pending instructions${types?.length ? ` (${types.join(", ")})` : ""} within 3 days; it may be offline or out of coverage.`,
});

// The faults in English, for the emails and the AI overview; null without any.
export function describeFaults(faults) {
    const text = (faults ?? []).filter(fault => FAULT_TEXT[fault.code]).map(fault => FAULT_TEXT[fault.code](fault)).join(" ");
    return text || null;
}
