import { SERVER_URL } from "@/utils/constants";

// Has the browser save a file.
export function saveFile(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

// A file the server builds (a CSV export): `path` with its query `params`,
// saved under the name the server gives it.
export async function downloadFromServer(path, params) {
    const res = await fetch(`${SERVER_URL}/${path}?${new URLSearchParams(params)}`, { credentials: "include" });
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Request failed.");
    }
    saveFile(await res.blob(), res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ?? "export.csv");
}

// An Excel file with a sheet for each table ({ sheet, header, rows }); `rtl` shows
// the sheets right to left. The builder loads only when used.
export async function saveXlsx(filename, tables, { rtl = false } = {}) {
    const { buildXlsx } = await import("@/utils/xlsx")
    saveFile(new Blob([buildXlsx(tables, { rtl })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename)
}
