import { BINS_EP, OVERVIEW_EP } from "@/utils/constants";
import { request } from "./request";

// One analytics section per request (see the server's analyticsController).
export function getBinAnalytics({ binId, section, range }) {
    const query = range ? `?range=${range}` : "";
    return request(`${BINS_EP}/${binId}/analytics/${section}${query}`);
}

// The viewer's time zone sets the day boundaries of the page's charts; an
// owner's picked organization narrows the section to it.
export function getOverviewSection({ section, range, orgId, params: extra }) {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const params = new URLSearchParams({
        ...(range ? { range: String(range) } : {}),
        tz: timeZone,
        ...(orgId ? { org: orgId } : {}),
        ...extra,
    });
    return request(`${OVERVIEW_EP}/${section}?${params}`);
}
