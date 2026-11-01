import mongoose from "mongoose";
import { faultSchema } from "./faultSchema.js";
import { add } from 'date-fns'
import { DAY_MS, DEVICE_ISSUE_TYPES, FIRST_SERVICE_AFTER_DAYS, MAX_LAST_AWAKE_SECONDS, SERVICE_INTERVAL_DAYS } from '../../utils/constants.js'
export const binSchema = new mongoose.Schema({
    binName: {
        type: String,
        required: true,
    },
    // "gateway" is a mesh gateway without a fill sensor (e.g. mounted on a
    // pole); it is kept out of fill-level, collection and statistics features.
    kind: {
        type: String,
        enum: ["bin", "gateway"],
        default: "bin",
    },
    deviceKey: {
        type: String,
        required: true,
        unique: true,
    },
    // Created from a reading a gateway relayed: a leaf whose device key it never
    // got. Only such a bin can be taken over by a registration with its MAC (a
    // leaf that found a SIM and became a gateway); see registerDevice.
    meshOnly: {
        type: Boolean,
        default: false,
    },
    location: {
        type: {
            type: String,
            enum: ["Point"],
            default: "Point"
        },
        coordinates: {
            type: [Number],
            required: true,
            validate: {
                validator: arr => arr.length === 2,
                message: "Coordinates must be [lng, lat] (GeoJSON)"
            }
        },
    },
    status: {
        health: {
            type: String,
            enum: ["good", "warning", "critical"],
            default: "good"
        },
        // The device's own faults at its last report (see utils/faults.js);
        // healthMessage is an older firmware's English text instead.
        faults: { type: [faultSchema], default: undefined },
        healthMessage: { type: String, default: "" },
        levelValid: { type: Boolean, default: true },
        level: { type: Number, default: 0, required: true },
        // Kilograms, or null without a working, calibrated scale (see scale).
        weight: { type: Number, default: null },
        // The bin's scale as its last report gave it; null for a device without
        // one (a leaf, or firmware before the scale).
        scale: { type: String, enum: ["ok", "uncalibrated", "failed"], default: null },
        battery: { type: Number, default: 0, required: true },
        lastAwakeSeconds: { type: Number, min: 1, max: MAX_LAST_AWAKE_SECONDS, default: null },
        // How the last report arrived: the bin's own cellular link or a mesh gateway.
        connection: {
            via: { type: String, enum: ["cellular", "mesh"], default: null },
            gatewayId: { type: mongoose.Schema.Types.ObjectId, ref: "Bin", default: null },
            // The leaf that carried the report to the gateway, when it came by more than one hop.
            viaLeafId: { type: mongoose.Schema.Types.ObjectId, ref: "Bin", default: null },
            hops: { type: Number, min: 1, max: 8, default: null },
            rssi: { type: Number, min: -128, max: 0, default: null },
        },
        // Relayed message IDs already stored, so gateway retries are not stored twice.
        recentMeshMessageIds: { type: [Number], default: [] },
        updatedAt: { type: Date, default: Date.now },
        // The device's latest diagnostics (see utils/diagnostics.js) and its
        // firmware, kept from its last report that had them.
        diagnostics: { type: mongoose.Schema.Types.Mixed, default: undefined },
        firmwareVersion: { type: String, default: null },
        // Its open problems, from its diagnostics (utils/deviceIssues.js): what,
        // since when, last seen, and the value that showed it.
        issues: {
            type: [new mongoose.Schema({
                type: { type: String, enum: DEVICE_ISSUE_TYPES, required: true },
                since: { type: Date, required: true },
                lastSeenAt: { type: Date, required: true },
                value: mongoose.Schema.Types.Mixed,
            }, { _id: false })],
            default: [],
        },
        // How fast it fills since its last emptying (% a day; null without a
        // rising trend), and when that was worked out: stale once a report
        // came after it (see db/service/fillRateService.js).
        fillRatePerDay: { type: Number, default: null },
        fillRateAt: { type: Date, default: null },
        // When the daily offline email named this device for its current
        // outage; null while it reports (the job clears it once it is back).
        offlineAlertSentAt: { type: Date, default: null },
    },
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Organization",
        required: true
    },
    timezone: {
        type: String,
        default: null,
    },
    maintenance: {
        lastServiceAt: { type: Date, default: Date.now },
        nextServiceAt: { type: Date, default: () => add(new Date(), { days: FIRST_SERVICE_AFTER_DAYS }) },
        notes: String,
        technicianId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    macAddress: {
        type: String,
        unique: true,
        sparse: true,
        default: null,
        match: /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/
    },
}, { timestamps: true });


binSchema.methods.recordService = function (notes, technicianId) {
    const now = new Date();
    this.maintenance.lastServiceAt = now;
    this.maintenance.nextServiceAt = new Date(now.getTime() + SERVICE_INTERVAL_DAYS * DAY_MS);
    if (notes) this.maintenance.notes = notes;
    if (technicianId) this.maintenance.technicianId = technicianId;
    return this.save();
}

binSchema.index({ ownerId: 1 });
// The bins page's sorts within an organization, _id breaking ties.
binSchema.index({ ownerId: 1, 'status.level': -1, _id: -1 });
binSchema.index({ ownerId: 1, 'status.weight': -1, _id: -1 });
binSchema.index({ ownerId: 1, 'status.battery': -1, _id: -1 });
binSchema.index({ macAddress: 1, deviceKey: 1 });
binSchema.index({ location: "2dsphere" });
