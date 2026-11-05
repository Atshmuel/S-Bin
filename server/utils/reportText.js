// The daily report's wording, per language: what each section and line says
// (see db/service/dailyReportService.js). Dates are formatted by the caller
// in `locale`; `rtl` flips the lists of the HTML email.

const plural = (count, one, other) => count === 1 ? one : other;

const EN = Object.freeze({
    locale: 'en-GB',
    rtl: false,
    templateId: 'dailyReport',
    allOrganizations: 'all organizations',
    yourOrganization: 'your organization',
    driver: 'the driver',
    titles: Object.freeze({
        stopped: 'Stopped reporting',
        collect: 'Needs collecting',
        contradicted: 'Marked collected, still full',
        battery: 'Low battery',
        health: 'Health problems',
        maintenance: 'Maintenance overdue',
        issues: 'Device issues',
    }),
    gateway: name => `Gateway ${name}`,
    lastReport: (label, time) => `${label}: last report ${time}.`,
    reportsThrough: (leaf) => `${leaf} reports through it and cannot report until it is back.`,
    manyReportThrough: (count, names) => `${count} bins report through it and cannot report until it is back: ${names}.`,
    gatewayKept: (gateway) => `Its gateway ${gateway} kept reporting after it, so the fault is at this bin ` +
        '(battery, radio range or lost sync).',
    stillOffline: count => `${plural(count, '1 device is', `${count} devices are`)} still offline, named in earlier reports.`,
    full: (bin, percent) => `${bin}: ${percent}% full, needs collecting now.`,
    dueIn: (bin, percent, hours) => `${bin}: ${percent}% full, needs collecting in about ${hours} hours.`,
    contradiction: (bin, who, time, truck, percent) => `${bin}: marked collected by ${who} at ${time}${truck}, ` +
        `but its next report read it ${percent}% full.`,
    truck: (name, unit) => ` (${name} #${unit})`,
    battery: (label, percent) => `${label}: battery ${percent}%.`,
    healthLine: (label, health, problem) => `${label}: ${health}` + (problem ? `, ${problem}` : '.'),
    healthName: health => health,
    maintenance: (label, date) => `${label}: service was due ${date}.`,
    issue: (label, what, since) => `${label}: ${what}, since ${since}.`,
    issues: Object.freeze({
        unexpected_restart: value => `restarted unexpectedly (${value})`,
        weak_signal: value => `weak cellular signal (${value} dBm)`,
        overheating: value => `running hot (${value}°C)`,
        noisy_sensor: () => 'fill sensor unsteady',
        slow_cycle: value => `slow to connect (${Math.round(value / 1000)} s)`,
        weak_mesh_link: () => 'weak link to its gateway',
        missed_report: value => `missed ${value} report${plural(value, '', 's')}`,
    }),
});

const HE = Object.freeze({
    locale: 'he-IL',
    rtl: true,
    templateId: 'dailyReportHe',
    allOrganizations: 'כל הארגונים',
    yourOrganization: 'הארגון שלך',
    driver: 'הנהג',
    titles: Object.freeze({
        stopped: 'הפסיקו לדווח',
        collect: 'דורשים איסוף',
        contradicted: 'סומנו כנאספו, עדיין מלאים',
        battery: 'סוללה חלשה',
        health: 'תקלות',
        maintenance: 'תחזוקה באיחור',
        issues: 'בעיות במכשירים',
    }),
    gateway: name => `שער תקשורת ${name}`,
    lastReport: (label, time) => `${label}: דיווח אחרון ${time}.`,
    reportsThrough: (leaf) => `${leaf} מדווח דרכו ולא יוכל לדווח עד שיחזור.`,
    manyReportThrough: (count, names) => `${count} פחים מדווחים דרכו ולא יוכלו לדווח עד שיחזור: ${names}.`,
    gatewayKept: (gateway) => `שער התקשורת ${gateway} המשיך לדווח אחריו, ולכן התקלה בפח עצמו ` +
        '(סוללה, טווח קליטה או אובדן סנכרון).',
    stillOffline: count => `${plural(count, 'מכשיר אחד עדיין לא מחובר, וצוין', `${count} מכשירים עדיין לא מחוברים, וצוינו`)} בדוחות קודמים.`,
    full: (bin, percent) => `${bin}: מלא ב־${percent}%, דורש איסוף עכשיו.`,
    dueIn: (bin, percent, hours) => `${bin}: מלא ב־${percent}%, ידרוש איסוף בעוד כ־${hours} שעות.`,
    contradiction: (bin, who, time, truck, percent) => `${bin}: סומן כנאסף על ידי ${who} ב־${time}${truck}, ` +
        `אך בדיווח הבא שלו היה מלא ב־${percent}%.`,
    truck: (name, unit) => ` (${name} #${unit})`,
    battery: (label, percent) => `${label}: סוללה ${percent}%.`,
    healthLine: (label, health, problem) => `${label}: ${health}` + (problem ? `, ${problem}` : '.'),
    healthName: health => ({ warning: 'אזהרה', critical: 'קריטי' })[health] ?? health,
    maintenance: (label, date) => `${label}: הטיפול היה אמור להתבצע ב־${date}.`,
    issue: (label, what, since) => `${label}: ${what}, מאז ${since}.`,
    issues: Object.freeze({
        unexpected_restart: value => `הופעל מחדש באופן לא צפוי (${value})`,
        weak_signal: value => `קליטה סלולרית חלשה (${value} dBm)`,
        overheating: value => `פועל חם (${value}°C)`,
        noisy_sensor: () => 'חיישן המילוי לא יציב',
        slow_cycle: value => `איטי להתחבר (${Math.round(value / 1000)} שניות)`,
        weak_mesh_link: () => 'קשר חלש לשער התקשורת',
        missed_report: value => plural(value, 'החמיץ דיווח אחד', `החמיץ ${value} דיווחים`),
    }),
});

// The wording for a user's app language (English for any other).
export function reportText(language) {
    return language === 'he' ? HE : EN;
}
