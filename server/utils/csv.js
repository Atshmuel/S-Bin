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
