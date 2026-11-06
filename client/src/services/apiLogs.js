import { LOGS_EP } from "@/utils/constants";
import { downloadFromServer } from "@/utils/download";
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
export function downloadLogs({ days, search = "", binId = null, org = null }) {
    return downloadFromServer(`${LOGS_EP}/export`, {
        days, search, ...(binId ? { binId } : {}), ...(org ? { org } : {}),
    });
}
