import mongoose from "mongoose";

// A one-time join code of an organization (see utils/joinCodes.js). Only what
// the server needs to check a JOIN is kept, never the code itself; it goes by
// itself once it has expired.
export const joinCodeSchema = new mongoose.Schema({
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    codeId: { type: String, required: true, unique: true },
    joinKey: { type: String, required: true, select: false },
    // The first leaf to use it; no other MAC can after that.
    boundMac: { type: String, default: null },
    failedProofs: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

joinCodeSchema.set("toJSON", { transform: (_doc, ret) => { delete ret.joinKey; return ret; } });
