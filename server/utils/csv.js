// One CSV field. A text that a spreadsheet would run as a formula (it starts
// with = + - @ or a tab or return) gets a quote in front, so it shows as text.
export function csvField(value) {
    if (value === null || value === undefined) return '';
    let text = value instanceof Date ? value.toISOString() : String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvRow(values) {
    return `${values.map(csvField).join(',')}\r\n`;
}

// Starts a CSV download on the response: its headers, the file name and the first
// row. The byte order mark makes Excel read the names as UTF-8 (Hebrew).
export function startCsv(res, name, headers) {
    res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
    res.write('\uFEFF' + csvRow(headers));
}
