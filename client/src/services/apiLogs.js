import { LOGS_EP } from "@/utils/constants";
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
