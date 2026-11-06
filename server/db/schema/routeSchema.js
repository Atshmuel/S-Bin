import mongoose from "mongoose";
import { OPEN_ROUTE_STATUSES, ROUTE_SKIP_REASONS, ROUTE_SOURCES, ROUTE_STATUSES, ROUTE_STOP_STATUSES, ROUTE_TYPES } from "../../utils/constants.js";

// What a driver said about a stop: who, when, and where their phone was.
const claimSchema = new mongoose.Schema({
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, required: true },
    // [lng, lat], as bins store theirs; absent when the phone gave no position.
    position: { type: [Number], default: undefined },
    accuracyMeters: Number,
    distanceMeters: Number,
}, { _id: false });

// What the bin's next report said about a claim, and how full it read then.
const verificationSchema = new mongoose.Schema({
    status: { type: String, enum: ["confirmed", "contradicted", "unverified"], required: true },
    at: { type: Date, required: true },
    logId: { type: mongoose.Schema.Types.ObjectId, ref: "BinLog" },
    fullness: Number,
}, { _id: false });

// One bin on a route. Its name and location are copied when planned, so the
// route still reads right if the bin is renamed or moved later.
const stopSchema = new mongoose.Schema({
    binId: { type: mongoose.Schema.Types.ObjectId, ref: "Bin", required: true },
    binName: String,
    location: { type: [Number], required: true },
    order: { type: Number, required: true },
    fullnessAtPlan: Number,
    loadKg: Number,
    status: { type: String, enum: ROUTE_STOP_STATUSES, default: "planned" },
    // When a skipped stop was skipped (Previous undoes whatever came last).
    skippedAt: Date,
    skipReason: { type: String, enum: ROUTE_SKIP_REASONS },
    claim: { type: claimSchema, default: null },
    verification: { type: verificationSchema, default: null },
}, { _id: false });

// The truck as it was when the route was planned (the fleet can change later).
// A truck type counts several trucks; `unit` (1 to its count) is which one, so
// a type has at most one open route per truck on a day.
const routeTruckSchema = new mongoose.Schema({
    truckTypeId: { type: mongoose.Schema.Types.ObjectId, required: true },
    unit: { type: Number, required: true, min: 1 },
    name: String,
    preset: String,
    capacityKg: Number,
}, { _id: false });

// A planned route of one organization: one truck's collection or a maintenance
// visit, for one service day (a date in the organization's time zone).
export const routeSchema = new mongoose.Schema({
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true },
    type: { type: String, enum: ROUTE_TYPES, required: true },
    source: { type: String, enum: ROUTE_SOURCES, required: true },
    status: { type: String, enum: ROUTE_STATUSES, default: "planned" },
    serviceDay: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    timeZone: { type: String, required: true },
    truck: { type: routeTruckSchema, default: null },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // [lng, lat]; the route ends at `end` (the depot), or at its last stop.
    start: { type: [Number], required: true },
    end: { type: [Number], default: undefined },
    fromDepot: { type: Boolean, default: false },
    // The line, distance and time from where the route stands ("Re-order from
    // here" replaces them); the planned ones are kept as planned, to compare.
    geometry: String,
    distanceMeters: Number,
    durationSeconds: Number,
    plannedDistanceMeters: Number,
    plannedDurationSeconds: Number,
    loadKg: Number,
    // Bins that matched but did not fit: past the optimizer's limit or the truck.
    leftOut: { type: Number, default: 0 },
    stops: { type: [stopSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    startedAt: Date,
    finishedAt: Date,
    // Closed by the day's end rather than by its driver.
    closedByDay: { type: Boolean, default: false },
    cancelledAt: Date,
}, { timestamps: true });

routeSchema.index({ orgId: 1, serviceDay: -1, status: 1 });
routeSchema.index({ driverId: 1, serviceDay: -1 });
// The claims a bin's next report settles.
routeSchema.index({ "stops.binId": 1, "stops.status": 1 });
// One open route per truck on a day, even when two are planned in the same moment.
routeSchema.index(
    { orgId: 1, serviceDay: 1, "truck.truckTypeId": 1, "truck.unit": 1 },
    { unique: true, partialFilterExpression: { status: { $in: OPEN_ROUTE_STATUSES }, "truck.unit": { $exists: true } } },
);
