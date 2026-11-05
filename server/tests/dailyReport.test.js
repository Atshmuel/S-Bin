import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { issueSection, reportSections } from '../db/service/dailyReportService.js';
import { reportText } from '../utils/reportText.js';

const NOW = Date.UTC(2026, 10, 5, 6, 0);
const bin = (binName, reasons, status = {}, extra = {}) => ({
    _id: binName, binName, kind: 'bin', reasons, timezone: 'Asia/Jerusalem', status: { battery: 12, ...status }, ...extra,
});
const gateway = (binName, reasons, status = {}) => bin(binName, reasons, status, { kind: 'gateway' });

describe('reportSections', () => {
    const devices = [
        gateway('GW1', ['battery']),
        bin('B1', ['full'], { health: 'warning' }),
        bin('B2', ['health'], { health: 'critical', healthMessage: 'Scale fault' }),
    ];
    const dueSoon = [{ binName: 'B3', fullness: 70, collectionDueAt: new Date(NOW + 5 * 3600 * 1000) }];
    devices[1].fullness = 95;
    devices[0].status.battery = 9;

    test('English is the default', () => {
        const { sections } = reportSections(devices, dueSoon, NOW);
        assert.deepEqual(sections.map(section => section.title), ['Needs collecting', 'Low battery', 'Health problems']);
        assert.deepEqual(sections[0].lines, ['B1: 95% full, needs collecting now.', 'B3: 70% full, needs collecting in about 5 hours.']);
        assert.deepEqual(sections[1].lines, ['Gateway GW1: battery 9%.']);
        assert.equal(sections[2].lines[0], 'B2: critical, Scale fault');
    });

    test('Hebrew has its own titles and lines', () => {
        const { sections } = reportSections(devices, dueSoon, NOW, [], new Map(), 'he');
        assert.deepEqual(sections.map(section => section.title), ['דורשים איסוף', 'סוללה חלשה', 'תקלות']);
        assert.deepEqual(sections[0].lines, ['B1: מלא ב־95%, דורש איסוף עכשיו.', 'B3: מלא ב־70%, ידרוש איסוף בעוד כ־5 שעות.']);
        assert.deepEqual(sections[1].lines, ['שער תקשורת GW1: סוללה 9%.']);
        assert.equal(sections[2].lines[0], 'B2: קריטי, Scale fault');
    });

    test('a driver without a name, a truck and the answer to a contradicted collection', () => {
        const claim = { binName: 'B1', claim: { at: new Date(NOW - 3600 * 1000) }, verification: { fullness: 80.4 }, truck: { name: 'Iveco', unit: 4 }, timeZone: 'Asia/Jerusalem' };
        const en = reportSections([], [], NOW, [claim]).sections[0].lines[0];
        assert.match(en, /^B1: marked collected by the driver at .* \(Iveco #4\), but its next report read it 80% full\.$/);
        const he = reportSections([], [], NOW, [claim], new Map(), 'he').sections[0].lines[0];
        assert.match(he, /^B1: סומן כנאסף על ידי הנהג ב־.* \(Iveco #4\), אך בדיווח הבא שלו היה מלא ב־80%\.$/);
    });
});

describe('issueSection', () => {
    const since = new Date(Date.UTC(2026, 10, 3, 9, 0));
    const devices = [
        gateway('GW1', [], { issues: [{ type: 'weak_signal', value: -108, since }] }),
        bin('B1', [], { issues: [{ type: 'missed_report', value: 1, since }, { type: 'missed_report', value: 3, since }] }),
    ];
    test('in English', () => {
        const { title, lines } = issueSection(devices);
        assert.equal(title, 'Device issues');
        assert.match(lines[0], /^Gateway GW1: weak cellular signal \(-108 dBm\), since .*2026\.$/);
        assert.match(lines[1], /^B1: missed 1 report, since /);
        assert.match(lines[2], /^B1: missed 3 reports, since /);
    });
    test('in Hebrew, singular and plural', () => {
        const { title, lines } = issueSection(devices, 'he');
        assert.equal(title, 'בעיות במכשירים');
        assert.match(lines[0], /^שער תקשורת GW1: קליטה סלולרית חלשה \(-108 dBm\), מאז .*2026\.$/);
        assert.match(lines[1], /^B1: החמיץ דיווח אחד, מאז /);
        assert.match(lines[2], /^B1: החמיץ 3 דיווחים, מאז /);
    });
});

describe('reportText', () => {
    test('a language other than Hebrew gets English', () => {
        assert.equal(reportText('he').templateId, 'dailyReportHe');
        assert.equal(reportText('en').templateId, 'dailyReport');
        assert.equal(reportText(undefined).templateId, 'dailyReport');
    });
});
