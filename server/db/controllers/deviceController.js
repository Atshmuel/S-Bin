import { timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { binModel, organizationModel } from "../models/models.js";
import { registerDevice } from "../service/deviceRegistrationService.js";
import { registrationCodeMatches } from "../../utils/registrationCode.js";
import { ensureMeshKey } from "../service/meshKeyService.js";

// A new device registers over HTTPS (no user session): its MAC, organization,
// the organization's registration code, its GPS location ([lat, lng]) and
// battery; it gets its device key, first schedule and the organization's mesh
// key (a gateway signs the mesh's packets with it). A wrong code or
// organization is the same 403, so neither can be probed.
export async function registerDeviceOverHttps(req, res) {
    const { mac, orgId, code, location, battery, kind } = req.body ?? {};
    try {
        const org = mongoose.Types.ObjectId.isValid(orgId)
            ? await organizationModel.findById(orgId, { registrationCode: 1 }).lean()
            : null;
        if (!org || !registrationCodeMatches(code, org.registrationCode)) {
            return res.status(403).json({ message: "Unknown organization or wrong registration code." });
        }
        const { status, ...registered } = await registerDevice({ mac, orgId, location, battery, kind });
        if (status === "invalid") return res.status(400).json({ message: "mac, location [lat, lng] and battery (0-100) are required." });
        if (status === "exists") return res.status(409).json({ message: "This device is already registered." });
        if (status !== "registered") return res.status(403).json({ message: "Unknown organization or wrong registration code." });
        return res.status(201).json({ ...registered, ...await ensureMeshKey(orgId) });
    } catch (error) {
        console.error("HTTPS device registration failed:", error);
        return res.status(500).json({ message: "Registration failed." });
    }
}

// Whether two device keys are the same, in constant time.
function sameKey(stored, sent) {
    const a = Buffer.from(String(stored ?? ""));
    const b = Buffer.from(sent);
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

// A device the broker refused asks whether it still exists (its MAC and
// device key): 200 when its bin is there with that key, 410 when its bin was
// deleted (it then resets and opens its setup page), 403 when the MAC is
// there with another key. Only 410 resets a device, so a broker that lost its
// accounts never wipes the fleet.
export async function deviceStatus(req, res) {
    const { mac, deviceKey } = req.body ?? {};
    if (typeof mac !== "string" || typeof deviceKey !== "string" || !deviceKey) {
        return res.status(400).json({ message: "mac and deviceKey are required." });
    }
    try {
        const bin = await binModel.findOne({ macAddress: mac }, { deviceKey: 1 }).lean();
        if (!bin) return res.status(410).json({ status: "deleted" });
        if (!sameKey(bin.deviceKey, deviceKey)) return res.status(403).json({ message: "Wrong device key." });
        return res.status(200).json({ status: "active" });
    } catch (error) {
        console.error("Device status check failed:", error);
        return res.status(500).json({ message: "Status check failed." });
    }
}
