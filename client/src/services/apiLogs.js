import { LOGS_EP, SERVER_URL } from "@/utils/constants";
import { request } from "./request";

// `binId` narrows the list to one bin's logs (its page); `org` an owner's organization.
export function getAllLogs(page = 1, limit = 10, search = "", sort = null, binId = null, org = null) {
    const order = sort ? `&sort=${sort.sort}&order=${sort.order}` : "";
    const bin = binId ? `&binId=${binId}` : "";
    return request(`${LOGS_EP}?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}${order}${bin}${org ? `&org=${org}` : ""}`);
}

export function getLog({ id, withBin }) {
    return request(`${LOGS_EP}/${id}?withBin=${withBin}`);
}

// The logs of the list shown (same search, bin and organization, newest first) for
// the last `days`, saved as a CSV file by the browser.
export async function downloadLogs({ days, search = "", binId = null, org = null }) {
    const params = new URLSearchParams({ days, search });
    if (binId) params.set("binId", binId);
    if (org) params.set("org", org);
    const res = await fetch(`${SERVER_URL}/${LOGS_EP}/export?${params}`, { credentials: "include" });
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Request failed.");
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(await res.blob());
    link.download = res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ?? "logs.csv";
    link.click();
    URL.revokeObjectURL(link.href);
}
