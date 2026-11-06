import mongoose from 'mongoose'
import { sendEmail } from '../../utils/mailService.js'
import {
    binModel, binLogModel, deviceDiagnosticModel, deviceInstructionModel, organizationModel, orgStatModel, routeModel,
    routeReservationModel, templateModel, userModel, userSettingModel,
} from '../models/models.js'
import { BINS_ONLY_FILTER, escapeHtml, scopeToOrganization } from '../../utils/helpers.js'
import { DAY_MS, LOG_RETENTION_DAYS, LOG_TYPES_DAYS, ROLES } from "../../utils/constants.js";
import { removeBinConfig } from '../../mqtt/mqttHandlers.js';
import { deleteDeviceAccounts } from '../../mqtt/brokerAccounts.js';
import { DEFAULT_MESH_AWAKE_WINDOW_SECONDS, DEFAULT_REPORT_INTERVAL_MINUTES, DEFAULT_REPORT_START_HOUR } from '../../utils/constants.js'

//Bins
export async function getBinShared(binId) {
    try {
        if (!binId)
            throw new Error('binId is mandatory')
        const bin = await binModel.findById(binId)
        return bin
    } catch (error) {
        console.error(error)
        return false
    }
}

// The device with this MAC and key. Both must be strings: a key sent as an
// object ({ "$ne": null }) would be a query operator matching any key.
export async function getBinByMacAndKeyShared(macAddress, deviceKey) {
    try {
        if (typeof macAddress !== 'string' || typeof deviceKey !== 'string' || !macAddress || !deviceKey)
            throw new Error('macAddress and deviceKey are mandatory')
        const bin = await binModel.findOne({ deviceKey, macAddress })
        return bin
    } catch (error) {
        console.error(error)
        return null;
    }
}

export async function verifyBinOwner(binId, ownerId) {
    try {
        if (!binId || !ownerId)
            throw new Error('binId and ownerId are mandatory')

        const exists = await binModel.exists({ _id: binId, ownerId })
        return !!exists
    } catch (error) {
        console.error(error)
        return false
    }
}

export async function deleteOrgRefs(orgId) {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        //delete organization users and their settings
        const orgUsrs = await userModel.find({ org: orgId }, '_id', { session })
        orgUsrs?.forEach(async (user) => {
            await deleteUserRefs(user._id);
        });

        //delete organization bins and their logs
        const bins = await binModel.find({ ownerId: orgId }, '_id macAddress', { session })
        await binModel.deleteMany({ ownerId: orgId }, { session });

        //reset bin to pre-registered state
        bins?.forEach((bin) => {
            removeBinConfig(bin.macAddress);
        })

        const org = await organizationModel.findByIdAndDelete(orgId, { session });
        if (!org) throw new Error("Organization not found");

        // Everything its devices left, and its own: routes, reservations, day stats.
        await deleteDeviceData(bins.map(b => b._id), session)
        await routeModel.deleteMany({ orgId }, { session })
        await routeReservationModel.deleteMany({ orgId }, { session })
        await orgStatModel.deleteMany({ orgId }, { session })

        await session.commitTransaction();
        deleteDeviceAccounts(bins.map(bin => bin.macAddress));
        return org;
    }
    catch (error) {
        await session.abortTransaction();
        throw error;
    }
    finally {
        session.endSession();
    }
}

//Refs deletion
export async function deleteUserRefs(userId) {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const user = await userModel.findByIdAndDelete(userId, { session });
        if (!user) throw new Error("User not found");

        const userSetting = await userSettingModel.findOneAndDelete({ userId }, { session });
        if (!userSetting) throw new Error("User settings not found");

        await session.commitTransaction();
        return user;

    } catch (error) {
        await session.abortTransaction();
        throw error;
    }
    finally {
        session.endSession();
    }
}

// Everything deleted devices left: their logs, diagnostics, waiting commands
// and route reservations (routes keep their stops, as history). Returns how
// many logs went.
export async function deleteDeviceData(binIds, session) {
    if (!Array.isArray(binIds) || binIds.length === 0) return 0
    const filter = { binId: { $in: binIds } }
    const deleteResult = await binLogModel.deleteMany(filter, { session })
    await deviceDiagnosticModel.deleteMany(filter, { session })
    await deviceInstructionModel.deleteMany(filter, { session })
    await routeReservationModel.deleteMany(filter, { session })
    return deleteResult.deletedCount;
}

// The organizations' day stats over the days their logs still cover are
// recomputed without deleted devices (marked stale; see statsService). Older
// days keep their numbers: there are no logs left to count them again from.
export async function invalidateOrgStats(orgIds) {
    const from = new Date(Date.now() - LOG_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10)
    await orgStatModel.updateMany({ orgId: { $in: orgIds }, day: { $gte: from } }, { $set: { computedAt: new Date(0) } })
}

//Users
//Emails
// Sends a stored email template to `to`, each {{key}} replaced by values[key].
export async function sendTemplateEmail(templateId, to, values) {
    const template = await templateModel.findOne({ templateId })
    if (!template) throw new Error(`Email template "${templateId}" not found`)
    // In the HTML version a value is text (a name cannot add a link), except
    // one whose name ends in "Html", which its caller built and escaped itself.
    const fill = (text, asHtml) => Object.entries(values).reduce(
        (filled, [key, value]) => filled.replaceAll(`{{${key}}}`, asHtml && !key.endsWith('Html') ? escapeHtml(value) : String(value)), text)
    await sendEmail(template.email, to, template.subject, fill(template.textTemplate, false), fill(template.htmlTemplate, true))
}

//Orgs
export async function organizationExist(org) {
    try {
        if (!org)
            throw new Error('org is mandatory')
        return await organizationModel.exists({ _id: org })
    } catch (error) {
        console.error(error)
        return false;
    }
}

// The organization's device settings, sent to its devices with every schedule.
export async function getOrgDeviceSettingsShared(orgId) {
    try {
        const org = await organizationModel.findById(orgId, { meshAwakeWindowSeconds: 1, reportIntervalMinutes: 1, reportStartHour: 1 })
        return {
            meshAwakeWindowSeconds: org?.meshAwakeWindowSeconds ?? DEFAULT_MESH_AWAKE_WINDOW_SECONDS,
            reportIntervalMinutes: org?.reportIntervalMinutes ?? DEFAULT_REPORT_INTERVAL_MINUTES,
            reportStartHour: org?.reportStartHour ?? DEFAULT_REPORT_START_HOUR,
        }
    } catch (error) {
        console.error(error)
        return {
            meshAwakeWindowSeconds: DEFAULT_MESH_AWAKE_WINDOW_SECONDS,
            reportIntervalMinutes: DEFAULT_REPORT_INTERVAL_MINUTES,
            reportStartHour: DEFAULT_REPORT_START_HOUR,
        };
    }
}

// Report intervals by organization id, for the organizations of these
// devices, fetched once each.
export async function intervalsByOrg(devices) {
    const orgIds = [...new Set(devices.map(device => String(device.ownerId)))];
    const settings = await Promise.all(orgIds.map(orgId => getOrgDeviceSettingsShared(orgId)));
    return new Map(orgIds.map((orgId, i) => [orgId, settings[i].reportIntervalMinutes]));
}

// Users who get emails (email notifications on in their settings), by a
// filter on the user, with their name, email and organization.
async function emailRecipients(match) {
    try {
        return await userModel.aggregate([
            { $match: match },
            {
                $lookup: {
                    from: "usersettings",
                    localField: "settingsId",
                    foreignField: "_id",
                    as: "settingsData"
                }
            },
            { $match: { "settingsData.notifications.email": true } },
            { $project: { _id: 0, name: 1, email: 1, org: 1, language: { $arrayElemAt: ['$settingsData.appLanguage', 0] } } },
        ]);
    } catch (error) {
        console.error(error)
        return [];
    }
}

// The users of these organizations who get emails: any role but drivers (they
// act on their routes, not on the organization's report), as long as email
// notifications are on in their settings.
export async function getNotificationRecipients(orgs) {
    if (!Array.isArray(orgs) || orgs.length === 0) {
        console.error('getNotificationRecipients: orgs must be a non-empty array')
        return [];
    }
    return emailRecipients({ org: { $in: orgs }, role: { $ne: ROLES.DRIVER } });
}

// The owners who get emails; they belong to no organization and hear about
// all of them.
export async function getOwnerRecipients() {
    return emailRecipients({ role: ROLES.OWNER });
}

// Logs carry no kind; log-based stats exclude gateways by their bin IDs.
async function getGatewayIds() {
    return binModel.distinct('_id', { kind: 'gateway' })
}

export async function getBinsStatusOV(req, res) {
    let query = { ...BINS_ONLY_FILTER }
    query = scopeToOrganization(query, req.user)

    try {
        const binsCount = await binModel.aggregate([
            { $match: query },
            {
                $facet: {
                    byStatus: [
                        {
                            $group: {
                                _id: "$status.health",
                                count: { $sum: 1 }
                            },
                        },
                        {
                            $project: {
                                _id: 0,
                                status: "$_id",
                                count: 1,
                            }
                        }
                    ],
                    total: [
                        { $count: 'total' }
                    ]
                }

            },
            {
                $project: {
                    total: { $ifNull: [{ $arrayElemAt: ["$total.total", 0] }, 0] },
                    byStatus: 1
                }
            }
        ])

        return res.status(200).json({ binsCount })
    } catch (error) {
        return res.status(500).json({ message: 'Failed to count bins by status' })
    }
}

export async function getLogTypes(req, res) {
    const since = new Date(Date.now() - LOG_TYPES_DAYS * DAY_MS)
    let query = {
        createdAt: { $gt: since },
        binId: { $nin: await getGatewayIds() }
    }

    // Narrowed to one organization's bins unless an owner looks at all of them.
    if (req.user.role !== ROLES.OWNER || req.user.selectedOrg) {
        const userBins = await binModel.find(scopeToOrganization({ ...BINS_ONLY_FILTER }, req.user)).select('_id');
        query.binId = { $in: userBins.map(bin => bin._id) };
    }

    try {
        const logsByTypes = await binLogModel.aggregate([
            { $match: query },
            {
                $group: {
                    _id: {
                        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
                    },
                    maintenance: {
                        $sum: { $cond: [{ $eq: ['$type', 'maintenance'] }, 1, 0] }
                    },
                    error: {
                        $sum: { $cond: [{ $eq: ['$type', 'error'] }, 1, 0] }
                    },
                    log: {
                        $sum: { $cond: [{ $eq: ['$type', 'log'] }, 1, 0] }
                    }
                },
            },
            {
                $project: {
                    _id: 0,
                    day: "$_id",
                    maintenance: 1,
                    error: 1,
                    log: 1
                }
            },
            {
                $sort: {
                    day: 1
                }
            }
        ])
        return res.status(200).json({ logsByTypes })
    } catch (error) {
        return res.status(500).json({ message: 'Failed to count bins by status' })
    }
}

//logs
export async function updateMaintenance(id, notes, technicianId) {
    try {
        const bin = await binModel.findById(id)
        if (!bin) return false;

        await bin.recordService(notes, technicianId);
        await binLogModel.create({
            binId: bin._id,
            type: 'maintenance',
            message: `${notes} - TechID:${technicianId}`,
            ownerId: bin.ownerId,
            battery: bin.status.battery,
            health: bin.status.health,
            newLevel: bin.status.level,
            oldLevel: bin.status.level,
            source: 'manual',
            severity: 'info'
        })

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}

//For testing purposes only
