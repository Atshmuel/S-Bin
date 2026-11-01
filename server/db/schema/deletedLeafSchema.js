import mongoose from "mongoose";

// A mesh leaf whose bin was deleted. A leaf has no broker account, so a deletion
// never reaches it: it keeps reporting through its gateway with keys that still
// verify, and without this the relay would make its bin again at the next reading.
// The entry goes when the leaf joins the organization again.
export const deletedLeafSchema = new mongoose.Schema({
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true },
    macAddress: { type: String, required: true },
    deletedAt: { type: Date, default: Date.now },
}, { versionKey: false });

deletedLeafSchema.index({ orgId: 1, macAddress: 1 }, { unique: true });
