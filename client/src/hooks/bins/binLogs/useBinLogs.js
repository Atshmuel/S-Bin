import { getAllLogs } from "@/services/apiLogs";
import { useQuery } from "@tanstack/react-query";
import { LIST_REFRESH_MS } from "@/utils/constants";



// `sort` is { sort, order } for the server to sort by, or null for newest
// first; `binId` keeps only that bin's logs, `org` an owner's organization.
export function useLogs(page = 1, limit = 10, search = "", sort = null, { binId = null, org = null } = {}) {
    const { data, isPending: isLoadingLogs, error: logsError } = useQuery({
        queryKey: ['all-logs', page, limit, search, sort, binId, org],
        queryFn: () => getAllLogs(page, limit, search, sort, binId, org),
        refetchInterval: LIST_REFRESH_MS,
    })


    const allLogs = data?.logs
    const totalLogs = data?.total

    return { allLogs, totalLogs, isLoadingLogs, logsError }
}