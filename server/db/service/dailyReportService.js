import { binModel, organizationModel, userModel } from '../models/models.js'
import { getNotificationRecipients, getOwnerRecipients, sendTemplateEmail } from './sharedService.js'
import { devicesWithReasons } from '../controllers/dashboardController.js'
import { fullSoon } from '../controllers/analyticsController.js'
import { recentContradictions } from './routeService.js'
import { isValidTimeZone } from '../../utils/analytics.js'
import { describeFaults } from '../../utils/faults.js'
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
function formatTime(date, timeZone, parts = TIME_PARTS) {
    return new Intl.DateTimeFormat('en-GB', { ...parts, timeZone: isValidTimeZone(timeZone) ? timeZone : 'UTC' })
        .format(new Date(date));
}

function deviceLabel(device) {
    return device.kind === 'gateway' ? `Gateway ${device.binName}` : device.binName;
}

// A device issue (see utils/deviceIssues.js) as a line of the owners' report.
function issueLine(device, issue) {
    const what = {
        unexpected_restart: `restarted unexpectedly (${issue.value})`,
        weak_signal: `weak cellular signal (${issue.value} dBm)`,
        overheating: `running hot (${issue.value}°C)`,
        noisy_sensor: `fill sensor unsteady`,
        slow_cycle: `slow to connect (${Math.round(issue.value / 1000)} s)`,
        weak_mesh_link: `weak link to its gateway`,
        missed_report: `missed ${issue.value} report${issue.value === 1 ? '' : 's'}`,
    }[issue.type] ?? issue.type;
    return `${deviceLabel(device)}: ${what}, since ${formatTime(issue.since, device.timezone, DATE_PARTS)}.`;
}

// The owners' extra section: each device's open issues.
export function issueSection(devices) {
    return {
        title: 'Device issues',
        lines: devices.flatMap(device => (device.status?.issues ?? []).map(issue => issueLine(device, issue))),
    };
}

function offlineLine(device, devices) {
    const parts = [`${deviceLabel(device)}: last report ${formatTime(lastReportAt(device), device.timezone)}.`];
    const leaves = devices.filter(other => String(upstreamId(other)) === String(device._id));
    if (leaves.length === 1) {
        parts.push(`${leaves[0].binName} reports through it and cannot report until it is back.`);
    } else if (leaves.length > 1) {
        parts.push(`${leaves.length} bins report through it and cannot report until it is back: ` +
            `${leaves.map(leaf => leaf.binName).join(', ')}.`);
    }
    const upstream = devices.find(other => String(other._id) === String(upstreamId(device)));
    if (upstream) {
        parts.push(`Its gateway ${upstream.binName} kept reporting after it, so the fault is at this bin ` +
            '(battery, radio range or lost sync).');
    }
    return parts.join(' ');
}

// A collection a driver marked that the bin's next report contradicted.
function contradictionLine({ binName, claim, verification, truck, timeZone }, drivers) {
    const who = drivers.get(String(claim?.by)) ?? 'the driver';
    const on = truck ? ` (${truck.name} #${truck.unit})` : '';
    return `${binName}: marked collected by ${who} at ${formatTime(claim?.at, timeZone)}${on}, ` +
        `but its next report read it ${Math.round(verification.fullness ?? 0)}% full.`;
}

// The report's sections for one organization, each { title, lines }, empty
// ones left out; and the devices it reports offline for the first time.
// `contradictions` are the day's claims a report contradicted, with the names
// of who made them in `drivers`.
export function reportSections(devices, dueSoon, now = Date.now(), contradictions = [], drivers = new Map()) {
    const offline = devices.filter(device => device.offlineCause?.cause === 'self' && device.status?.connection?.via);
    const newlyOffline = offline.filter(device => !device.status.offlineAlertSentAt);
    const stillOffline = offline.length - newlyOffline.length;
    const withReason = reason => devices.filter(device => device.reasons.includes(reason));
    const dueWithin = dueSoon.filter(bin => new Date(bin.collectionDueAt).getTime() <= now + DAILY_REPORT_DUE_WITHIN_HOURS * HOUR_MS);

    const sections = [
        { title: 'Stopped reporting', lines: newlyOffline.map(device => offlineLine(device, devices)) },
        {
            title: 'Needs collecting',
            lines: [
                ...withReason('full').map(bin => `${bin.binName}: ${bin.fullness}% full, needs collecting now.`),
                ...dueWithin.map(bin => `${bin.binName}: ${bin.fullness}% full, needs collecting in about ` +
                    `${Math.max(Math.round((new Date(bin.collectionDueAt).getTime() - now) / HOUR_MS), 1)} hours.`),
            ],
        },
        {
            title: 'Marked collected, still full',
            lines: contradictions.map(claim => contradictionLine(claim, drivers)),
        },
        {
            title: 'Low battery',
            lines: withReason('battery').map(device => `${deviceLabel(device)}: battery ${device.status.battery}%.`),
        },
        {
            title: 'Health problems',
            lines: withReason('health').map(device => {
                const problem = describeFaults(device.status.faults) || device.status.healthMessage;
                return `${deviceLabel(device)}: ${device.status.health}` + (problem ? `, ${problem}` : '.');
            }),
        },
        {
            title: 'Maintenance overdue',
            lines: withReason('maintenance').map(device => `${deviceLabel(device)}: service was due ` +
                `${formatTime(device.maintenance.nextServiceAt, device.timezone, DATE_PARTS)}.`),
        },
    ].filter(section => section.lines.length > 0);
    // Outages named before only make a footnote in a report sent anyway.
    if (sections.length > 0 && stillOffline > 0) {
        const note = `${stillOffline === 1 ? '1 device is' : `${stillOffline} devices are`} still offline, named in earlier reports.`;
        if (sections[0].title === 'Stopped reporting') sections[0].lines.push(note);
        else sections.unshift({ title: 'Stopped reporting', lines: [note] });
    }
    return { sections, newlyOffline };
}

function sectionsText(sections) {
    return sections.map(section => `${section.title}\n${section.lines.map(line => `- ${line}`).join('\n')}`).join('\n\n');
}

function sectionsHtml(sections) {
    return sections.map(section =>
        `<h3 style='margin:24px 0 8px 0; font-size:16px; color:#333;'>${escapeHtml(section.title)}</h3>` +
        `<ul style='margin:0; padding-left:20px; color:#555; line-height:1.6; font-size:15px;'>` +
        section.lines.map(line => `<li style='margin:0 0 6px 0;'>${escapeHtml(line)}</li>`).join('') +
        '</ul>').join('');
}

// Sends the report to each user, one by one; true when at least one email
// went out.
async function sendToEach(users, values) {
    let sent = false;
    for (const user of users) {
        try {
            await sendTemplateEmail('dailyReport', user.email, { ...values, name: ` ${user.name}` });
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
        const users = report.sections.length > 0 ? recipients.filter(user => String(user.org) === String(report.orgId)) : [];
        report.sent = await sendToEach(users, {
            orgName: report.orgName,
            sectionsText: sectionsText(report.sections),
            sectionsHtml: sectionsHtml(report.sections),
        });
        report.hasReaders = users.length > 0;
    }
    const ownersSent = reports.length > 0 && await sendToEach(owners, {
        orgName: 'all organizations',
        sectionsText: reports.map(report => `== ${report.orgName} ==\n\n${sectionsText(report.ownerSections)}`).join('\n\n\n'),
        sectionsHtml: reports.map(report =>
            `<h2 style='margin:32px 0 0 0; font-size:18px; color:#0b7a57;'>${escapeHtml(report.orgName)}</h2>` +
            sectionsHtml(report.ownerSections)).join(''),
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
// the flags of outages that are over.
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

    const { sections, newlyOffline } = reportSections(devices, dueSoon, now, contradictions, drivers);
    // Device issues are for the owners only.
    const issues = issueSection(devices);
    const ownerSections = issues.lines.length > 0 ? [...sections, issues] : sections;
    if (ownerSections.length === 0) return null;
    return { orgId, orgName: org?.name ?? 'your organization', sections, ownerSections, newlyOffline };
}
