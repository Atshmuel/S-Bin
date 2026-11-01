import mongoose from "mongoose";
import { faultSchema } from "./faultSchema.js";
import { DAY_MS, LOG_RETENTION_DAYS, MAX_ABS_CLOCK_ERROR_SECONDS, MAX_ABS_DRIFT_PPM, MAX_LAST_AWAKE_SECONDS } from '../../utils/constants.js'

export const binLogSchema = new mongoose.Schema({
    binId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Bin",
        required: true,
        immutable: true,
    },
    type: {
        type: String,
        enum: ["maintenance", "error", "log"],
        default: "log",
    },
    severity: {
        type: String,
        enum: ["info", "warning", "critical"],
        default: "info",
    },
    oldLevel: Number,
    newLevel: { type: Number, default: null },
    battery: { type: Number, required: true },
    lastAwakeSeconds: { type: Number, min: 1, max: MAX_LAST_AWAKE_SECONDS },
    // Sleep-clock diagnostics: the device's drift estimate and how far its
    // clock was off when it synced.
    driftPpm: { type: Number, min: -MAX_ABS_DRIFT_PPM, max: MAX_ABS_DRIFT_PPM },
    clockErrorSeconds: { type: Number, min: -MAX_ABS_CLOCK_ERROR_SECONDS, max: MAX_ABS_CLOCK_ERROR_SECONDS },
    connection: { type: String, enum: ["cellular", "mesh"] },
    gatewayId: { type: mongoose.Schema.Types.ObjectId, ref: "Bin" },
    // The relaying leaf between this device and its gateway (hops above 1).
    viaLeafId: { type: mongoose.Schema.Types.ObjectId, ref: "Bin" },
    hops: { type: Number, min: 1, max: 8 },
    rssi: { type: Number, min: -128, max: 0 },
    // Kilograms, or null without a working, calibrated scale.
    weight: { type: Number, default: null },
    health: {
        type: String,
        enum: ["good", "warning", "critical"],
        default: "good"
    },
    source: {
        type: String,
        enum: ["sensor", "manual", "system"],
        default: "sensor",
    },
    // What went wrong (see utils/faults.js); `message` is an older firmware's
    // English text, or a technician's note.
    faults: { type: [faultSchema], default: undefined },
    message: String,

    // A log never changes once written: no updatedAt or version key.
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

// Every bin page and analytics query reads one bin's logs by time. The only
// other index is the one that deletes logs after LOG_RETENTION_DAYS; the logs
// page sorts its other columns without one (storage over sort speed).
binLogSchema.index({ binId: 1, createdAt: -1 });
binLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: LOG_RETENTION_DAYS * DAY_MS / 1000 });

binLogSchema.virtual("bin", {
    ref: "Bin",
    localField: 'binId',
    foreignField: "_id",
    justOne: true,
})

binLogSchema.set("toObject", { virtuals: true });
binLogSchema.set("toJSON", { virtuals: true });