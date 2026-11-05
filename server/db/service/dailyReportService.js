import { binModel, organizationModel, userModel } from '../models/models.js'
import { getNotificationRecipients, getOwnerRecipients, sendTemplateEmail } from './sharedService.js'
import { devicesWithReasons } from '../controllers/dashboardController.js'
import { fullSoon } from '../controllers/analyticsController.js'
import { recentContradictions } from './routeService.js'
import { isValidTimeZone } from '../../utils/analytics.js'
import { describeFaults } from '../../utils/faults.js'
import { reportText } from '../../utils/reportText.js'
import { lastReportAt, upstreamId } from '../../utils/offline.js'
import { DAILY_REPORT_DUE_WITHIN_HOURS, DAY_MS, HOUR_MS, ROLES } from '../../utils/constants.js'

// The daily report: one email per organization to each of its users with
// email notifications on, listing what the dashboard's "Needs attention"
// lists, by name; owners get every organization's in one email. Nothing is
// sent on a day without anything to list.
//
// An outage is reported once: status.offlineAlertSentAt is set when a report
// names the device and cleared once it reports again. A leaf behind a silent
// gateway is no fault of its own; the gateway's entry names it instead.
// Devices that never reported (no connection yet) are not reported offline.

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}

const DATE_PARTS = Object.freeze({ day: 'numeric', month: 'short', year: 'numeric' });
const TIME_PARTS = Object.freeze({ ...DATE_PARTS, hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

// A device's time in its own time zone, e.g. "23 Oct 2026, 08:00 GMT+3".
function formatTime(date, timeZone, parts = TIME_PARTS, locale = 'en-GB') {
    return new Intl.DateTimeFormat(locale, { ...parts, timeZone: isValidTimeZone(timeZone) ? timeZone : 'UTC' })
        .format(new Date(date));
}

function deviceLabel(device, text) {
    return device.kind === 'gateway' ? text.gateway(device.binName) : device.binName;
}

// A device issue (see utils/deviceIssues.js) as a line of the owners' report.
function issueLine(device, issue, text) {
    const what = text.issues[issue.type]?.(issue.value) ?? issue.type;
    return text.issue(deviceLabel(device, text), what, formatTime(issue.since, device.timezone, DATE_PARTS, text.locale));
}

// The owners' extra section: each device's open issues.
export function issueSection(devices, language = 'en') {
    const text = reportText(language);
    return {
        title: text.titles.issues,
        lines: devices.flatMap(device => (device.status?.issues ?? []).map(issue => issueLine(device, issue, text))),
    };
}

function offlineLine(device, devices, text) {
    const parts = [text.lastReport(deviceLabel(device, text), formatTime(lastReportAt(device), device.timezone, TIME_PARTS, text.locale))];
    const leaves = devices.filter(other => String(upstreamId(other)) === String(device._id));
    if (leaves.length === 1) {
        parts.push(text.reportsThrough(leaves[0].binName));
    } else if (leaves.length > 1) {
        parts.push(text.manyReportThrough(leaves.length, leaves.map(leaf => leaf.binName).join(', ')));
    }
    const upstream = devices.find(other => String(other._id) === String(upstreamId(device)));
    if (upstream) parts.push(text.gatewayKept(upstream.binName));
    return parts.join(' ');
}

// A collection a driver marked that the bin's next report contradicted.
function contradictionLine({ binName, claim, verification, truck, timeZone }, drivers, text) {
    const who = drivers.get(String(claim?.by)) ?? text.driver;
    return text.contradiction(binName, who, formatTime(claim?.at, timeZone, TIME_PARTS, text.locale),
        truck ? text.truck(truck.name, truck.unit) : '', Math.round(verification.fullness ?? 0));
}

// The report's sections for one organization, each { title, lines }, empty
// ones left out; and the devices it reports offline for the first time.
// `contradictions` are the day's claims a report contradicted, with the names
// of who made them in `drivers`; the wording is in the user's `language`.
export function reportSections(devices, dueSoon, now = Date.now(), contradictions = [], drivers = new Map(), language = 'en') {
    const text = reportText(language);
    const offline = devices.filter(device => device.offlineCause?.cause === 'self' && device.status?.connection?.via);
    const newlyOffline = offline.filter(device => !device.status.offlineAlertSentAt);
    const stillOffline = offline.length - newlyOffline.length;
    const withReason = reason => devices.filter(device => device.reasons.includes(reason));
    const dueWithin = dueSoon.filter(bin => new Date(bin.collectionDueAt).getTime() <= now + DAILY_REPORT_DUE_WITHIN_HOURS * HOUR_MS);

    const sections = [
        { title: text.titles.stopped, lines: newlyOffline.map(device => offlineLine(device, devices, text)) },
        {
            title: text.titles.collect,
            lines: [
                ...withReason('full').map(bin => text.full(bin.binName, bin.fullness)),
                ...dueWithin.map(bin => text.dueIn(bin.binName, bin.fullness,
                    Math.max(Math.round((new Date(bin.collectionDueAt).getTime() - now) / HOUR_MS), 1))),
            ],
        },
        {
            title: text.titles.contradicted,
            lines: contradictions.map(claim => contradictionLine(claim, drivers, text)),
        },
        {
            title: text.titles.battery,
            lines: withReason('battery').map(device => text.battery(deviceLabel(device, text), device.status.battery)),
        },
        {
            title: text.titles.health,
            lines: withReason('health').map(device => {
                const problem = describeFaults(device.status.faults) || device.status.healthMessage;
                return text.healthLine(deviceLabel(device, text), text.healthName(device.status.health), problem);
            }),
        },
        {
            title: text.titles.maintenance,
            lines: withReason('maintenance').map(device => text.maintenance(deviceLabel(device, text),
                formatTime(device.maintenance.nextServiceAt, device.timezone, DATE_PARTS, text.locale))),
        },
    ].filter(section => section.lines.length > 0);
    // Outages named before only make a footnote in a report sent anyway.
    if (sections.length > 0 && stillOffline > 0) {
        const note = text.stillOffline(stillOffline);
        if (sections[0].title === text.titles.stopped) sections[0].lines.push(note);
        else sections.unshift({ title: text.titles.stopped, lines: [note] });
    }
    return { sections, newlyOffline };
}

function sectionsText(sections) {
    return sections.map(section => `${section.title}\n${section.lines.map(line => `- ${line}`).join('\n')}`).join('\n\n');
}

function sectionsHtml(sections, text) {
    const side = text.rtl ? 'right' : 'left';
    return sections.map(section =>
        `<h3 style='margin:24px 0 8px 0; font-size:16px; color:#333;'>${escapeHtml(section.title)}</h3>` +
        `<ul style='margin:0; padding-${side}:20px; color:#555; line-height:1.6; font-size:15px;'>` +
        section.lines.map(line => `<li style='margin:0 0 6px 0;'>${escapeHtml(line)}</li>`).join('') +
        '</ul>').join('');
}

// Sends the report to each user, one by one, in the language of their app
// settings (`valuesFor(language)` gives the email's values); true when at
// least one email went out.
async function sendToEach(users, valuesFor) {
    let sent = false;
    for (const user of users) {
        try {
            const text = reportText(user.language);
            await sendTemplateEmail(text.templateId, user.email, { ...valuesFor(user.language), name: ` ${user.name}` });
            sent = true;
        } catch (error) {
            console.error(`[Cron] Daily report to ${user.email} failed:`, error);
        }
    }
    return sent;
}

// Builds each organization's report, sends it to its users and, all in one
// email, to the owners; then records which outages were told and forgets
// those that are over.
export async function sendDailyReports(now = Date.now()) {
    const orgIds = await binModel.distinct('ownerId');
    if (orgIds.length === 0) return;
    const [recipients, owners] = await Promise.all([getNotificationRecipients(orgIds), getOwnerRecipients()]);

    const reports = [];
    for (const orgId of orgIds) {
        try {
            const report = await organizationReport(orgId, now);
            if (report) reports.push(report);
        } catch (error) {
            console.error(`[Cron] Daily report for organization ${orgId} failed:`, error);
        }
    }

    for (const report of reports) {
        // A day with only device issues goes to the owners alone.
        const users = report.hasSections ? recipients.filter(user => String(user.org) === String(report.orgId)) : [];
        report.sent = await sendToEach(users, language => {
            const sections = report.sectionsFor(language);
            return {
                orgName: report.orgName ?? reportText(language).yourOrganization,
                sectionsText: sectionsText(sections),
                sectionsHtml: sectionsHtml(sections, reportText(language)),
            };
        });
        report.hasReaders = users.length > 0;
    }
    const ownersSent = reports.length > 0 && await sendToEach(owners, language => {
        const text = reportText(language);
        return {
            orgName: text.allOrganizations,
            sectionsText: reports.map(report => `== ${report.orgName ?? text.yourOrganization} ==\n\n${sectionsText(report.ownerSectionsFor(language))}`).join('\n\n\n'),
            sectionsHtml: reports.map(report =>
                `<h2 style='margin:32px 0 0 0; font-size:18px; color:#0b7a57;'>${escapeHtml(report.orgName ?? text.yourOrganization)}</h2>` +
                sectionsHtml(report.ownerSectionsFor(language), text)).join(''),
        };
    });

    for (const report of reports) {
        // Nobody to tell still counts as told, so a later reader is not sent
        // every old outage at once; a failed send is retried the next day.
        const told = report.sent || ownersSent || (!report.hasReaders && owners.length === 0);
        if (!told || report.newlyOffline.length === 0) continue;
        // Only devices still silent since they were read: one that reported in
        // the meantime keeps no flag.
        await binModel.bulkWrite(report.newlyOffline.map(device => ({
            updateOne: {
                filter: { _id: device._id, 'status.updatedAt': device.status.updatedAt },
                update: { $set: { 'status.offlineAlertSentAt': new Date(now) } },
            },
        })));
    }
}

// One organization's report, or null on a day with nothing to list; clears
// the flags of outages that are over. The sections are built per language
// (`sectionsFor`, and with the device issues `ownerSectionsFor`); the
// organization's name is null when it has none.
async function organizationReport(orgId, now) {
    const scope = { role: ROLES.ADMIN, org: orgId };
    const [devices, { bins: dueSoon }, org, contradictions] = await Promise.all([
        devicesWithReasons(scope),
        fullSoon(scope),
        organizationModel.findById(orgId, { name: 1 }).lean(),
        recentContradictions([orgId], new Date(now - DAY_MS)),
    ]);
    const drivers = new Map((await userModel.find({ _id: { $in: contradictions.map(claim => claim.claim?.by).filter(Boolean) } }, { name: 1 }).lean())
        .map(user => [String(user._id), user.name]));

    const recovered = devices.filter(device => device.status?.offlineAlertSentAt && !device.offlineCause);
    if (recovered.length > 0) {
        await binModel.updateMany({ _id: { $in: recovered.map(device => device._id) } },
            { $set: { 'status.offlineAlertSentAt': null } });
    }

    const sectionsFor = language => reportSections(devices, dueSoon, now, contradictions, drivers, language).sections;
    // Device issues are for the owners only.
    const ownerSectionsFor = language => {
        const issues = issueSection(devices, language);
        const sections = sectionsFor(language);
        return issues.lines.length > 0 ? [...sections, issues] : sections;
    };
    const { sections, newlyOffline } = reportSections(devices, dueSoon, now, contradictions, drivers);
    if (ownerSectionsFor('en').length === 0) return null;
    return { orgId, orgName: org?.name ?? null, hasSections: sections.length > 0, sectionsFor, ownerSectionsFor, newlyOffline };
}
