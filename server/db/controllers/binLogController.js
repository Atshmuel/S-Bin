import mongoose from 'mongoose';
import { appendFilter, healthRank, listSortStages, scopeToOrganization } from '../../utils/helpers.js';
import { binLogModel, binModel } from '../models/models.js'
import { verifyBinOwner } from '../service/sharedService.js';
import { DEFAULT_PAGE_SIZE, ROLES } from "../../utils/constants.js";

// The logs page's sortable columns (see listSortStages). The plain fields have
// indexes, so a page is read in order; the ranks are computed per log.
const LOG_SORT_FIELDS = Object.freeze({
    createdAt: 'createdAt',
    newLevel: 'newLevel',
    weight: 'weight',
    battery: 'battery',
    severity: healthRank('$severity'),
    health: healthRank('$health'),
});

export async function getBinLog(req, res) {
    const { withBin } = req.query
    const { logId } = req.params;
    const { org: ownerId, role } = req.user

    let query = {}
    query = appendFilter(query, true, '_id', new mongoose.Types.ObjectId(logId))

    try {
        let logQuery = binLogModel.findOne(query, { __v: 0, updatedAt: 0 });
        if (withBin) {
            logQuery = logQuery.populate('bin')
        }
        const log = await logQuery;

        if (!log) return res.status(404).json({ message: "Bin not found." });

        let isBinOwner = role === ROLES.OWNER

        if (withBin && role !== ROLES.OWNER) {
            isBinOwner = log.bin.ownerId.toString() === ownerId;
        }
        else if (!withBin && role !== ROLES.OWNER) {
            isBinOwner = await verifyBinOwner(log.binId, ownerId)
        }
        if (!isBinOwner)
            return res.status(403).json({ message: 'This bin is not owned by you' })

        res.status(201).json({ log })
    } catch (error) {
        res.status(500).json({ message: error?.message || error })
    }
}

export async function getAllLogs(req, res) {
    const { org: ownerId, role } = req.user
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Number(req.query.limit) || DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * limit;

    const searchRaw = req.query.search;
    const search = (searchRaw !== undefined && searchRaw !== "") ? Number(searchRaw) : NaN;

    try {
        // Filter and page the logs first, then name only the page's bins:
        // joining every log to its bin before sorting does not fit in memory.
        const filter = {};
        // One bin's logs (its page), if the user may see that bin.
        const { binId } = req.query;
        if (binId !== undefined) {
            if (!mongoose.Types.ObjectId.isValid(binId)) {
                return res.status(400).json({ message: `Invalid binId: '${binId}'` });
            }
            if (!await binModel.exists(scopeToOrganization({ _id: new mongoose.Types.ObjectId(binId) }, req.user))) {
                return res.status(404).json({ message: 'Bin not found.' });
            }
            filter.binId = new mongoose.Types.ObjectId(binId);
        } else if (role !== ROLES.OWNER || req.user.selectedOrg) {
            const bins = await binModel.find(scopeToOrganization({}, req.user), { _id: 1 }).lean();
            filter.binId = { $in: bins.map(bin => bin._id) };
        }
        if (!isNaN(search)) filter.newLevel = search;

        const [pageLogs, total] = await Promise.all([
            binLogModel.aggregate([
                { $match: filter },
                ...listSortStages(req.query, LOG_SORT_FIELDS, { createdAt: -1, _id: -1 }),
                { $skip: skip },
                { $limit: limit },
                // Diagnostics are for the bin page only.
                { $project: { __v: 0, _sortRank: 0, diagnostics: 0 } },
            ]),
            binLogModel.countDocuments(filter),
        ]);
        const bins = await binModel.find({ _id: { $in: pageLogs.map(log => log.binId) } }, { binName: 1, kind: 1, ownerId: 1 }).lean();
        const byId = new Map(bins.map(bin => [String(bin._id), bin]));
        const logs = pageLogs.map(log => ({
            ...log,
            binName: byId.get(String(log.binId))?.binName ?? null,
            binKind: byId.get(String(log.binId))?.kind ?? null,
            // Its organization's cut-offs color the log's battery.
            ownerId: byId.get(String(log.binId))?.ownerId ?? null,
        }));

        res.status(201).json({ logs, total })
    } catch (error) {
        res.status(500).json({ message: error?.message || error })
    }
}
