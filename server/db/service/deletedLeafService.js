import { deletedLeafModel } from "../models/models.js";

// The mesh leaves whose bins were deleted (see deletedLeafSchema.js). Never at
// the cost of the deletion itself, so a failure is only logged.

// Remembers the leaves among the deleted bins: only a mesh-only bin is one (a
// gateway has a broker account, and the deletion resets it).
export async function rememberDeletedLeaves(bins) {
    const leaves = (bins ?? []).filter(bin => bin?.meshOnly && bin.macAddress && bin.ownerId);
    if (leaves.length === 0) return;
    try {
        await deletedLeafModel.bulkWrite(leaves.map(bin => ({
            updateOne: {
                filter: { orgId: bin.ownerId, macAddress: bin.macAddress.toUpperCase() },
                update: { $setOnInsert: { deletedAt: new Date() } },
                upsert: true,
            },
        })));
    } catch (error) {
        console.error("Could not remember the deleted leaves:", error?.message ?? error);
    }
}

export async function isDeletedLeaf(orgId, macAddress) {
    return Boolean(await deletedLeafModel.exists({ orgId, macAddress: macAddress.toUpperCase() }));
}

// A leaf that joins its organization again, or becomes a gateway there, is welcome.
export async function forgetDeletedLeaf(orgId, macAddress) {
    try {
        await deletedLeafModel.deleteOne({ orgId, macAddress: macAddress.toUpperCase() });
    } catch (error) {
        console.error(`Could not forget the deleted leaf ${macAddress}:`, error?.message ?? error);
    }
}
