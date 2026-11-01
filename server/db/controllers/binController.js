import mongoose from 'mongoose'
import { binModel, organizationModel } from '../models/models.js'
import { appendFilter, BINS_ONLY_FILTER, healthRank, listSortStages, scopeToOrganization } from '../../utils/helpers.js'
import { FULLNESS_EXPRESSION } from '../../utils/analytics.js'
import { isLngLat } from '../../utils/geo.js'
import {
    DEFAULT_PAGE_SIZE, MAP_CELL_PX, MAP_VIEW_LIMIT, ROLES,
} from '../../utils/constants.js'
import { deleteDeviceData, getOrgDeviceSettingsShared, invalidateOrgStats, updateMaintenance } from '../service/sharedService.js'
import { scopedThresholds } from '../service/thresholdService.js'
import { deleteDeviceAccounts } from '../../mqtt/brokerAccounts.js'
import { rememberDeletedLeaves } from '../service/deletedLeafService.js'
import { thresholdExpression } from '../../utils/thresholds.js'
import { reservedBinIds } from '../service/routeService.js'
import { removeBinConfig } from '../../mqtt/mqttHandlers.js';

// The bins page's sortable columns (see listSortStages). The plain fields have
// indexes per organization; the health rank is computed per bin.
const BIN_SORT_FIELDS = Object.freeze({
    level: 'status.level',
    weight: 'status.weight',
    battery: 'status.battery',
    health: healthRank('$status.health'),
});

export async function getBin(req, res) {
    const { id } = req.params;

    let query = {}
    query = appendFilter(query, true, '_id', new mongoose.Types.ObjectId(id))
    query = scopeToOrganization(query, req.user)

    // The raw diagnostics are for owners (2k); anyone else gets the bin without them.
    const pipeline = [
        { $match: query },
        { $project: { macAddress: 0, ...(req.user.role === ROLES.OWNER ? {} : { 'status.diagnostics': 0 }) } }
    ]

    try {
        const binData = await binModel.aggregate(pipeline);

        if (!binData) return res.status(404).json({ message: "Bin not found." });

        // The bins whose last report this device relayed. Any device with a SIM
        // can relay for mesh leaves: a gateway, or a bin that is also a gateway.
        const device = binData[0];
        if (device) {
            device.connectedLeaves = await binModel.find(
                { ownerId: device.ownerId, 'status.connection.gatewayId': device._id },
                { binName: 1, 'status.updatedAt': 1, 'status.connection.hops': 1, 'status.connection.rssi': 1 }
            ).lean();
            // When the device next reports, which is when it gets queued instructions.
            const { reportIntervalMinutes, reportStartHour } = await getOrgDeviceSettingsShared(device.ownerId);
            device.reportSchedule = { reportIntervalMinutes, reportStartHour };
            // A leaf links to the gateway its last report came through.
            const gatewayId = device.status?.connection?.gatewayId;
            if (gatewayId) {
                device.gateway = await binModel.findOne(
                    { _id: gatewayId, ownerId: device.ownerId },
                    { binName: 1 }
                ).lean();
            }
        }

        res.status(200).json({ binData })
    } catch (error) {
        res.status(500).json({ message: error?.message || error })
    }
}

export async function getAllUserBins(req, res) {
    const { page, limit, search } = req.query

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || DEFAULT_PAGE_SIZE;
    const skip = (pageNum - 1) * limitNum;

    let query = {}
    query = scopeToOrganization(query, req.user)

    if (search) {
        query.binName = { $regex: search, $options: 'i' };
    }
    // Sorted and paged before anything is joined, so only the page's bins
    // are read in full.
    const pipeline = [
        { $match: query },
        ...listSortStages(req.query, BIN_SORT_FIELDS, { _id: 1 }),
        { $skip: skip },
        { $limit: limitNum },
        // Diagnostics are for the bin page only.
        { $project: { macAddress: 0, _sortRank: 0, 'status.diagnostics': 0 } },
    ]

    try {
        const [binsData, total] = await Promise.all([
            binModel.aggregate(pipeline),
            binModel.countDocuments(query),
        ]);

        res.status(200).json({ binsData, total })
    } catch (error) {
        res.status(500).json({ message: error?.message || error })
    }
}

// ---- The map page: GET /api/bins/map and /api/bins/map/extent ----
// Locations are stored [lng, lat] (see utils/geo.js), so a map box is a range
// on each of the two coordinates.

// What a marker and its popup show; no device key or MAC address.
const MAP_MARKER_PROJECTION = Object.freeze({
    binName: 1, kind: 1, location: 1, ownerId: 1,
    'status.level': 1, 'status.levelValid': 1, 'status.weight': 1, 'status.scale': 1, 'status.battery': 1,
    'status.health': 1, 'status.faults': 1, 'status.healthMessage': 1, 'status.updatedAt': 1, 'status.connection': 1,
});

function wrapLongitude(lng) {
    return ((lng + 180) % 360 + 360) % 360 - 180;
}

// The filter for a box given in degrees; null when the box is not one.
function mapBoxFilter({ south, west, north, east }) {
    const [s, w, n, e] = [south, west, north, east].map(Number);
    if (![s, w, n, e].every(Number.isFinite) || s > n || w > e) return null;
    const filter = { 'location.coordinates.1': { $gte: s, $lte: n } };
    if (e - w >= 360) return filter; // the whole world across
    const [from, to] = [wrapLongitude(w), wrapLongitude(e)];
    // A box across the date line is two ranges.
    return from <= to
        ? { ...filter, 'location.coordinates.0': { $gte: from, $lte: to } }
        : { ...filter, $or: [{ 'location.coordinates.0': { $gte: from } }, { 'location.coordinates.0': { $lte: to } }] };
}

// How urgent a device's marker is, as its color shows it: 0 good, 1
// warning, 2 critical; a bin by its fullness, a gateway by its battery,
// against its organization's cut-offs (`thresholds`, by organization id).
function markerUrgency(thresholds) {
    const cutOff = field => thresholdExpression(thresholds, field);
    return {
        $cond: [
            { $eq: ['$kind', 'gateway'] },
            {
                $switch: {
                    branches: [
                        { case: { $lte: ['$status.battery', cutOff('batteryCritical')] }, then: 2 },
                        { case: { $lte: ['$status.battery', cutOff('batteryWarning')] }, then: 1 },
                    ],
                    default: 0,
                },
            },
            {
                $let: {
                    vars: { fullness: FULLNESS_EXPRESSION },
                    in: {
                        $switch: {
                            branches: [
                                { case: { $gte: ['$$fullness', cutOff('fullnessCritical')] }, then: 2 },
                                { case: { $gte: ['$$fullness', cutOff('fullnessWarning')] }, then: 1 },
                            ],
                            default: 0,
                        },
                    },
                },
            },
        ],
    };
}

// The view's devices grouped into a grid of about MAP_CELL_PX on screen at
// this zoom (Leaflet's world is 256 px across at zoom 0): per cell, how many,
// where on average, and the most urgent.
function mapCells(query, { south, north }, zoom, thresholds) {
    const lngStep = 360 * MAP_CELL_PX / (256 * 2 ** zoom);
    const latStep = lngStep * Math.cos((Number(south) + Number(north)) / 2 * Math.PI / 180);
    return binModel.aggregate([
        { $match: query },
        {
            $project: {
                lng: { $arrayElemAt: ['$location.coordinates', 0] },
                lat: { $arrayElemAt: ['$location.coordinates', 1] },
                urgency: markerUrgency(thresholds),
            },
        },
        {
            $group: {
                _id: { row: { $floor: { $divide: ['$lat', latStep] } }, col: { $floor: { $divide: ['$lng', lngStep] } } },
                count: { $sum: 1 },
                lat: { $avg: '$lat' },
                lng: { $avg: '$lng' },
                urgency: { $max: '$urgency' },
            },
        },
        { $project: { _id: 0, count: 1, lat: 1, lng: 1, urgency: 1 } },
    ]);
}

// The map's view (?south&west&north&east&zoom). Up to MAP_VIEW_LIMIT devices
// come as markers: a leaf with its gateway's name and a gateway with how many
// devices it relays for, even when those are outside the view. More come as
// grid cells, so every count stays true however many there are.
export async function getMapBins(req, res) {
    const box = mapBoxFilter(req.query);
    if (!box) return res.status(400).json({ message: 'A map box needs south, west, north and east in degrees.' });
    const query = scopeToOrganization(box, req.user);
    const zoom = Number(req.query.zoom);
    try {
        const total = await binModel.countDocuments(query);
        if (total > MAP_VIEW_LIMIT && Number.isFinite(zoom)) {
            return res.status(200).json({ total, cells: await mapCells(query, req.query, zoom, await scopedThresholds(req.user)) });
        }
        const bins = await binModel.find(query, MAP_MARKER_PROJECTION).sort({ 'status.level': -1, _id: 1 }).limit(MAP_VIEW_LIMIT).lean();
        const ids = bins.map(bin => bin._id);
        const gatewayIds = [...new Set(bins
            .filter(bin => bin.status?.connection?.via === 'mesh' && bin.status.connection.gatewayId)
            .map(bin => String(bin.status.connection.gatewayId)))];
        const [gateways, relays] = await Promise.all([
            binModel.find(scopeToOrganization({ _id: { $in: gatewayIds.map(id => new mongoose.Types.ObjectId(id)) } }, req.user),
                { binName: 1 }).lean(),
            binModel.aggregate([
                { $match: { 'status.connection.via': 'mesh', 'status.connection.gatewayId': { $in: ids } } },
                { $group: { _id: '$status.connection.gatewayId', count: { $sum: 1 } } },
            ]),
        ]);
        const gatewayNames = new Map(gateways.map(gateway => [String(gateway._id), gateway.binName]));
        const relayCounts = new Map(relays.map(relay => [String(relay._id), relay.count]));
        res.status(200).json({
            total,
            bins: bins.map(bin => ({
                ...bin,
                gatewayName: gatewayNames.get(String(bin.status?.connection?.gatewayId)) ?? null,
                relayCount: relayCounts.get(String(bin._id)) ?? 0,
            })),
        });
    } catch (error) {
        res.status(500).json({ message: error?.message || error });
    }
}

// The box around all the user's devices, where the map first opens; null
// when there are none.
export async function getMapExtent(req, res) {
    try {
        const [extent] = await binModel.aggregate([
            { $match: scopeToOrganization({ 'location.coordinates.1': { $exists: true } }, req.user) },
            {
                $group: {
                    _id: null,
                    south: { $min: { $arrayElemAt: ['$location.coordinates', 1] } },
                    north: { $max: { $arrayElemAt: ['$location.coordinates', 1] } },
                    west: { $min: { $arrayElemAt: ['$location.coordinates', 0] } },
                    east: { $max: { $arrayElemAt: ['$location.coordinates', 0] } },
                },
            },
            { $project: { _id: 0 } },
        ]);
        res.status(200).json({ extent: extent ?? null });
    } catch (error) {
        res.status(500).json({ message: error?.message || error });
    }
}

// The devices within `radius` meters of `coordinates` ([lng, lat]), in the
// health filter and fullness range; an owner's ?org= narrows them to one
// organization, and excludeReserved leaves out bins another route holds (what
// a new route could still take).
export async function getBinsInUserRadius(req, res) {
    const { coordinates, radius, health, minLevel, maxLevel, excludeReserved } = req.body
    if (!isLngLat(coordinates)) return res.status(400).json({ message: 'coordinates must be [lng, lat].' })

    if (!radius || typeof radius !== "number") return res.status(400).json({ message: 'Radius is mandatory!' })

    let query = {};
    query = scopeToOrganization(query, req.user)
    query = appendFilter(query, health && health !== "all", 'status.health', health)
    if (excludeReserved) {
        const orgId = req.user.role === ROLES.OWNER ? req.user.selectedOrg : req.user.org
        query = { ...query, _id: { $nin: await reservedBinIds(orgId) } }
    }
    // The range is on fullness (level or weight, whichever is higher), the
    // value the markers are colored by.
    const fullnessStages = []
    if (minLevel !== undefined || maxLevel !== undefined) {
        // Gateways have no fullness; without a range filter they stay on the map.
        query = { ...query, ...BINS_ONLY_FILTER }
        fullnessStages.push(
            { $addFields: { fullness: FULLNESS_EXPRESSION } },
            {
                $match: {
                    fullness: {
                        $gte: minLevel !== undefined ? Number(minLevel) : 0,
                        $lte: maxLevel !== undefined ? Number(maxLevel) : 100,
                    },
                },
            },
        )
    }

    try {
        let binsData = await binModel.aggregate(
            [
                {
                    $geoNear: {
                        near: { type: "Point", coordinates },
                        distanceField: "distance",
                        spherical: true,
                        maxDistance: radius,
                        query,
                    },
                },
                ...fullnessStages,
                // Diagnostics stay out: a planner's search can return thousands of bins.
                { $project: { macAddress: 0, deviceKey: 0, 'status.diagnostics': 0 } }
            ]
        )

        res.status(200).json({ binsData: binsData || [] })
    } catch (error) {
        res.status(500).json({ message: error?.message || error })
    }
}

export async function updateBinName(req, res) {
    const { id } = req.params
    const { name } = req.body

    let filter = {}
    filter = appendFilter(filter, true, '_id', id)
    filter = scopeToOrganization(filter, req.user)

    try {
        const updatedBin = await binModel.findOneAndUpdate(filter, { $set: { binName: name } }, { new: true, runValidators: true }).select('-macAddress')

        if (!updatedBin) return res.status(404).json({ message: "Bin not found or not owned by you." });

        res.status(200).json({ bin: updatedBin })
    } catch (error) {
        res.status(500).json({ message: error?.message || error })
    }
}

export async function updateBinMaintenance(req, res) {
    const { id } = req.params
    const { id: technicianId } = req.user
    const { notes } = req.body
    try {
        const success = await updateMaintenance(id, notes, technicianId)
        if (!success) {
            return res.status(404).json({ message: 'Bin not found' });
        }
        return res.json({ message: 'Service recorded' });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
}

export async function deleteBin(req, res) {
    const { id } = req.params;
    let query = {}
    query = scopeToOrganization(query, req.user)
    query = appendFilter(query, true, '_id', id)

    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const deleteBinResult = await binModel.findOneAndDelete(query, { session });
        if (!deleteBinResult) {
            await session.abortTransaction();
            return res.status(404).json({ message: "Bin not found or access denied" });
        }

        const deleteLogsResult = await deleteDeviceData([deleteBinResult._id], session)

        removeBinConfig(deleteBinResult.macAddress)

        await session.commitTransaction();
        deleteDeviceAccounts([deleteBinResult.macAddress]);
        await rememberDeletedLeaves([deleteBinResult]);
        await invalidateOrgStats([deleteBinResult.ownerId]);
        return res.status(200).json({
            message: 'Bins and logs deleted successfully',
            deletedLogs: deleteLogsResult
        });

    } catch (error) {
        await session.abortTransaction();
        console.error("Failed to delete bin:", error);
        return res.status(500).json({ message: "Failed to delete bin", error: error.message });
    }
    finally {
        session.endSession();
    }
}

export async function deleteBinsBatch(req, res) {
    const binIds = req.binIds

    let query = {}
    query = scopeToOrganization(query, req.user)
    query = appendFilter(query, true, '_id', { $in: binIds })

    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const binsToDelete = await binModel.find(query, "_id macAddress ownerId meshOnly", { session });
        const binsToDeleteIds = binsToDelete.map(b => b._id);

        if (binsToDeleteIds.length === 0) {
            await session.abortTransaction();
            return res.status(404).json({ message: "No bins found to delete or access denied" });
        }

        const deleteBinsResult = await binModel.deleteMany({ _id: { $in: binsToDeleteIds } }, { session });
        const deleteLogsResult = await deleteDeviceData(binsToDeleteIds, session)

        binsToDelete.forEach(bin => {
            removeBinConfig(bin.macAddress);
        })
        await session.commitTransaction();
        deleteDeviceAccounts(binsToDelete.map(bin => bin.macAddress));
        await rememberDeletedLeaves(binsToDelete);
        await invalidateOrgStats([...new Set(binsToDelete.map(bin => String(bin.ownerId)))]);

        return res.status(200).json({
            message: 'Bins and logs deleted successfully',
            deletedBins: deleteBinsResult.deletedCount,
            deletedLogs: deleteLogsResult
        });

    } catch (error) {
        await session.abortTransaction();
        console.error("Failed to delete bins batch:", error);
        return res.status(500).json({ message: "Failed to delete bins batch", error: error.message });
    }
    finally {
        session.endSession();
    }
}

export function removeBinConfigViaMAC(req, res) {
    const { macId } = req.params;

    try {
        removeBinConfig(macId);
        return res.status(200).json({ message: 'Bin configuration removed successfully' });
    } catch (error) {
        console.error("Failed to remove bin configuration:", error);
        return res.status(500).json({ message: "Failed to remove bin configuration", error: error.message });
    }

}
