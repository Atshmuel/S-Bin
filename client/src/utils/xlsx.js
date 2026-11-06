import { strToU8, zipSync } from "fflate"

// A minimal Excel workbook (.xlsx): a zip of a few XML parts, a sheet each with
// a bold header row that stays in view, text and number cells.

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
const SHEET_NAME_MAX = 31
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function escapeXml(text) {
    return String(text)
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// A, B, ... Z, AA, ... for the column at `index` (from 0).
function columnLetters(index) {
    let letters = ""
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + (n - 1) % 26) + letters
    return letters
}

// A sheet's name: Excel allows 31 characters and none of : \ / ? * [ ], and no two alike.
export function sheetNames(names) {
    const used = new Set()
    return names.map((name) => {
        const base = name.replace(/[:\\/?*[\]]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, SHEET_NAME_MAX - 3) || "Sheet"
        let unique = base
        for (let n = 2; used.has(unique.toLowerCase()); n++) unique = `${base} ${n}`
        used.add(unique.toLowerCase())
        return unique
    })
}

function cellXml(value, row, column, bold) {
    if (value === null || value === undefined || value === "") return bold ? `<c r="${columnLetters(column)}${row}" s="1"/>` : ""
    const ref = `${columnLetters(column)}${row}`
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`
    return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ""}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

function sheetXml({ header, rows }, selected, rtl) {
    const columns = header.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 28 : 18}" customWidth="1"/>`).join("")
    const lines = [header, ...rows].map((cells, i) =>
        `<row r="${i + 1}">${cells.map((value, column) => cellXml(value, i + 1, column, i === 0)).join("")}</row>`)
    return `${XML_HEAD}<worksheet xmlns="${MAIN_NS}"><sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ""}${rtl ? ' rightToLeft="1"' : ""}>`
        + `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>`
        + `<cols>${columns}</cols><sheetData>${lines.join("")}</sheetData></worksheet>`
}

// `sheets`: [{ sheet, header, rows }]; `rtl` shows the sheets right to left (Hebrew).
// Returns the file's bytes.
export function buildXlsx(sheets, { rtl = false } = {}) {
    const names = sheetNames(sheets.map(({ sheet }) => sheet))
    const parts = {
        "[Content_Types].xml": `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
            + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            + '<Default Extension="xml" ContentType="application/xml"/>'
            + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
            + "</Types>",
        "_rels/.rels": `${XML_HEAD}<Relationships xmlns="${PACKAGE_REL_NS}">`
            + `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        "xl/workbook.xml": `${XML_HEAD}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>`
            + names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")
            + "</sheets></workbook>",
        "xl/_rels/workbook.xml.rels": `${XML_HEAD}<Relationships xmlns="${PACKAGE_REL_NS}">`
            + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
            + `<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`,
        // Style 0 is the plain cell, style 1 the bold header.
        "xl/styles.xml": `${XML_HEAD}<styleSheet xmlns="${MAIN_NS}">`
            + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
            + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
            + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
            + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    }
    sheets.forEach((sheet, i) => { parts[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheet, i === 0, rtl) })
    return zipSync(Object.fromEntries(Object.entries(parts).map(([path, xml]) => [path, strToU8(xml)])))
}
