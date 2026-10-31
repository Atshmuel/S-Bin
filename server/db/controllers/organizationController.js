import mongoose from "mongoose";
import { organizationModel } from "../models/models.js";
import { deleteOrgRefs } from "../service/sharedService.js";
import { COST_SETTINGS, THRESHOLD_SETTINGS, MAX_MESH_AWAKE_WINDOW_SECONDS, REPORT_INTERVAL_OPTIONS_MINUTES } from "../../utils/constants.js";
import { ROLES } from "../../utils/constants.js";
import { generateRegistrationCode } from "../../utils/registrationCode.js";
import { createJoinCode } from "../service/joinService.js";

const MESH_SETTINGS_PROJECTION = {
    name: 1, meshAwakeWindowSeconds: 1, reportIntervalMinutes: 1, reportStartHour: 1, fleet: 1, depot: 1, routePlanningHour: 1, lastAutoPlan: 1,
    clusterUntilZoom: 1, costs: 1, thresholds: 1, registrationCode: 1,
};


export async function getOrganizations(req, res) {
    const { id } = req.params;
    let query = {};
    if (id) {
        query._id = id;
    }
    try {
        const orgs = await organizationModel.find(query, { __v: 0 })
        return res.status(200).json(orgs);
    } catch (error) {
        return res.status(500).json({ message: error?.message || "Internal server error 'getOrganizations'" });
    }
}

export async function createOrganization(req, res) {
    const { name } = req.body;
    try {
        const newOrg = await organizationModel.create({ name, registrationCode: generateRegistrationCode() });
        return res.status(201).json(newOrg);
    } catch (error) {
        return res.status(500).json({ message: error?.message || "Internal server error 'createOrganization'" });
    }
}

export async function removeOrganization(req, res) {
    const { id } = req.params;
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const deletion = await deleteOrgRefs(id);

        return res.status(201).json({ message: 'Organization removed successfully', deletion });
    } catch (error) {
        return res.status(500).json({ message: error?.message || "Internal server error 'removeOrganization'" });
    }
}

export async function updateOrganization(req, res) {
    const { id } = req.params;
    const { name } = req.body;
    try {
        const updatedOrg = await organizationModel.findByIdAndUpdate(id, { name }, { new: true });
        return res.status(201).json(updatedOrg);
    } catch (error) {
        return res.status(500).json({ message: error?.message || "Internal server error 'updateOrganization'" });
    }
}

// Owners manage every organization's mesh settings; admins only their own.
// Anyone else reads their own (a driver its trucks and depot, everyone the
// cut-offs that color the devices), but not what collecting costs.
export async function getMeshSettings(req, res) {
    const { role, org } = req.user;
    const query = role === ROLES.OWNER ? {} : { _id: org };
    // Costs and the registration code are for owners and admins.
    const isManager = [ROLES.OWNER, ROLES.ADMIN].includes(role);
    const { costs, registrationCode, ...forOthers } = MESH_SETTINGS_PROJECTION;
    try {
        const organizations = await organizationModel.find(query, isManager ? MESH_SETTINGS_PROJECTION : forOthers)
            .sort({ name: 1 });
        // An organization from before the codes gets its first one when a manager looks.
        if (isManager) {
            for (const organization of organizations.filter(org => !org.registrationCode)) {
                organization.registrationCode = generateRegistrationCode();
                await organizationModel.updateOne({ _id: organization._id, registrationCode: null }, { $set: { registrationCode: organization.registrationCode } });
            }
        }
        return res.status(200).json({ organizations });
    } catch (error) {
        return res.status(500).json({ message: error?.message || "Internal server error 'getMeshSettings'" });
    }
}

// A one-time join code for a leaf about to be added: owners for any
// organization, admins for their own. The code is shown once, here.
export async function createOrganizationJoinCode(req, res) {
    const { orgId } = req.params;
    const { role, org, id } = req.user;
    if (!mongoose.Types.ObjectId.isValid(orgId)) {
        return res.status(400).json({ message: "Invalid organization ID." });
    }
    if (role !== ROLES.OWNER && orgId !== org) {
        return res.status(403).json({ message: "You can only add devices to your own organization." });
    }
    try {
        if (!await organizationModel.exists({ _id: orgId })) {
            return res.status(404).json({ message: "Organization not found." });
        }
        return res.status(201).json(await createJoinCode(orgId, id));
    } catch (error) {
        return res.status(500).json({ message: error?.message || "Internal server error 'createOrganizationJoinCode'" });
    }
}

export async function updateMeshSettings(req, res) {
    const { orgId } = req.params;
    const { meshAwakeWindowSeconds, reportIntervalMinutes, reportStartHour } = req.body ?? {};
    const { role, org } = req.user;

    if (!mongoose.Types.ObjectId.isValid(orgId)) {
        return res.status(400).json({ message: "Invalid organization ID." });
    }
    if (role !== ROLES.OWNER && orgId !== org) {
        return res.status(403).json({ message: "You can only change your own organization's settings." });
    }
    if (meshAwakeWindowSeconds === undefined && reportIntervalMinutes === undefined && reportStartHour === undefined) {
        return res.status(400).json({
            message: "Nothing to update: send meshAwakeWindowSeconds, reportIntervalMinutes and/or reportStartHour."
        });
    }
    if (meshAwakeWindowSeconds !== undefined &&
        (!Number.isInteger(meshAwakeWindowSeconds) ||
            meshAwakeWindowSeconds < 1 ||
            meshAwakeWindowSeconds > MAX_MESH_AWAKE_WINDOW_SECONDS)) {
        return res.status(400).json({
            message: `meshAwakeWindowSeconds must be an integer between 1 and ${MAX_MESH_AWAKE_WINDOW_SECONDS}.`
        });
    }
    if (reportIntervalMinutes !== undefined && !REPORT_INTERVAL_OPTIONS_MINUTES.includes(reportIntervalMinutes)) {
        return res.status(400).json({
            message: `reportIntervalMinutes must be one of ${REPORT_INTERVAL_OPTIONS_MINUTES.join(", ")}.`
        });
    }
    if (reportStartHour !== undefined &&
        (!Number.isInteger(reportStartHour) || reportStartHour < 0 || reportStartHour > 23)) {
        return res.status(400).json({ message: "reportStartHour must be an integer between 0 and 23." });
    }

    try {
        const organization = await organizationModel.findByIdAndUpdate(
            orgId,
            {
                $set: {
                    ...(meshAwakeWindowSeconds === undefined ? {} : { meshAwakeWindowSeconds }),
                    ...(reportIntervalMinutes === undefined ? {} : { reportIntervalMinutes }),
                    ...(reportStartHour === undefined ? {} : { reportStartHour }),
                }
            },
            { new: true, runValidators: true, projection: MESH_SETTINGS_PROJECTION }
        );
        if (!organization) {
            return res.status(404).json({ message: "Organization not found." });
        }
        return res.status(200).json({ organization });
    } catch (error) {
        return res.status(500).json({ message: error?.message || "Internal server error 'updateMeshSettings'" });
    }
}

// The organization's trucks, depot and nightly planning hour, which its routes
// are planned with: owners for any organization, admins for their own.
// `fleet` replaces the whole list; `depot` is { location: [lng, lat], address }
// or null; `routePlanningHour` is a local hour (0-23) or null (no nightly plan).
export async function updateFleetSettings(req, res) {
    const { id } = req.params;
    const { fleet, depot, routePlanningHour } = req.body ?? {};
    const { role, org } = req.user;

    if (role !== ROLES.OWNER && id !== org) {
        return res.status(403).json({ message: "You can only change your own organization's settings." });
    }
    if (fleet !== undefined && !Array.isArray(fleet)) {
        return res.status(400).json({ message: "fleet must be a list of truck types." });
    }
    if (depot !== undefined && depot !== null && typeof depot !== "object") {
        return res.status(400).json({ message: "depot must be { location: [lng, lat], address } or null." });
    }

    try {
        const organization = await organizationModel.findByIdAndUpdate(
            id,
            {
                $set: {
                    ...(fleet === undefined ? {} : {
                        fleet: fleet.map(({ _id, name, preset, count, capacityKg, litersPer100Km }) => ({
                            ...(mongoose.Types.ObjectId.isValid(_id) ? { _id } : {}), name, preset, count, capacityKg, litersPer100Km,
                        })),
                    }),
                    ...(depot === undefined ? {} : { depot: depot && { location: depot.location, address: depot.address ?? "" } }),
                    ...(routePlanningHour === undefined ? {} : { routePlanningHour }),
                },
            },
            { new: true, runValidators: true, projection: MESH_SETTINGS_PROJECTION }
        );
        if (!organization) return res.status(404).json({ message: "Organization not found." });
        return res.status(200).json({ organization });
    } catch (error) {
        if (error?.name === "ValidationError" || error?.name === "CastError") {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: error?.message || "Internal server error 'updateFleetSettings'" });
    }
}

// The organization's map settings (owners for any organization, admins for
// their own): `clusterUntilZoom`, the zoom from which each device shows on its
// own, a whole level within CLUSTER_ZOOM_RANGE (the schema refuses others).
export async function updateMapSettings(req, res) {
    const { id } = req.params;
    const { clusterUntilZoom } = req.body ?? {};
    const { role, org } = req.user;
    if (role !== ROLES.OWNER && id !== org) {
        return res.status(403).json({ message: "You can only change your own organization's settings." });
    }
    try {
        const organization = await organizationModel.findByIdAndUpdate(
            id,
            { $set: { ...(clusterUntilZoom === undefined ? {} : { clusterUntilZoom }) } },
            { new: true, runValidators: true, projection: MESH_SETTINGS_PROJECTION },
        );
        if (!organization) return res.status(404).json({ message: "Organization not found." });
        return res.status(200).json({ organization });
    } catch (error) {
        if (error?.name === "ValidationError" || error?.name === "CastError") {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: error?.message || "Internal server error 'updateMapSettings'" });
    }
}

// What collecting costs the organization (owners for any organization, admins
// for their own): any of COST_SETTINGS' fields, each a number in its range
// (the schema refuses others).
export async function updateCostSettings(req, res) {
    const { id } = req.params;
    const { role, org } = req.user;
    if (role !== ROLES.OWNER && id !== org) {
        return res.status(403).json({ message: "You can only change your own organization's settings." });
    }
    const changes = Object.entries(req.body ?? {}).filter(([field]) => field in COST_SETTINGS);
    if (!changes.length) return res.status(400).json({ message: `Send any of ${Object.keys(COST_SETTINGS).join(", ")}.` });
    if (changes.some(([, value]) => typeof value !== "number" || !Number.isFinite(value))) {
        return res.status(400).json({ message: "Each cost must be a number." });
    }
    try {
        const organization = await organizationModel.findByIdAndUpdate(
            id,
            { $set: Object.fromEntries(changes.map(([field, value]) => [`costs.${field}`, value])) },
            { new: true, runValidators: true, projection: MESH_SETTINGS_PROJECTION },
        );
        if (!organization) return res.status(404).json({ message: "Organization not found." });
        return res.status(200).json({ organization });
    } catch (error) {
        if (error?.name === "ValidationError" || error?.name === "CastError") {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: error?.message || "Internal server error 'updateCostSettings'" });
    }
}

// The organization's fullness and battery cut-offs (owners for any
// organization, admins for their own): any of THRESHOLD_SETTINGS' fields. They
// are checked together with the ones kept, so warning stays on the safe side
// of critical.
export async function updateThresholdSettings(req, res) {
    const { id } = req.params;
    const { role, org } = req.user;
    if (role !== ROLES.OWNER && id !== org) {
        return res.status(403).json({ message: "You can only change your own organization's settings." });
    }
    const changes = Object.entries(req.body ?? {}).filter(([field]) => field in THRESHOLD_SETTINGS);
    if (!changes.length) return res.status(400).json({ message: `Send any of ${Object.keys(THRESHOLD_SETTINGS).join(", ")}.` });
    try {
        const organization = await organizationModel.findById(id, MESH_SETTINGS_PROJECTION);
        if (!organization) return res.status(404).json({ message: "Organization not found." });
        for (const [field, value] of changes) organization.thresholds[field] = value;
        await organization.save();
        return res.status(200).json({ organization });
    } catch (error) {
        if (error?.name === "ValidationError" || error?.name === "CastError") {
            return res.status(400).json({ message: Object.values(error.errors ?? {})[0]?.message ?? error.message });
        }
        return res.status(500).json({ message: error?.message || "Internal server error 'updateThresholdSettings'" });
    }
}

// A new registration code for the organization (owners for any, admins for
// their own); devices registered already keep working, new ones need it.
export async function regenerateRegistrationCode(req, res) {
    const { id } = req.params;
    const { role, org } = req.user;
    if (role !== ROLES.OWNER && id !== org) {
        return res.status(403).json({ message: "You can only change your own organization's settings." });
    }
    try {
        const organization = await organizationModel.findByIdAndUpdate(id, { $set: { registrationCode: generateRegistrationCode() } },
            { new: true, projection: MESH_SETTINGS_PROJECTION });
        if (!organization) return res.status(404).json({ message: "Organization not found." });
        return res.status(200).json({ organization });
    } catch (error) {
        return res.status(500).json({ message: error?.message || "Internal server error 'regenerateRegistrationCode'" });
    }
}
