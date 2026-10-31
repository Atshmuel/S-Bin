import { getAllUserBins, getBinsInUserRadius } from "@/services/apiBins";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { LIST_REFRESH_MS } from "@/utils/constants";
import { useErrorToast } from "@/hooks/useErrorToast";



// `enabled` lets a caller that already has its bins skip the request; `sort`
// is { sort, order } for the server to sort the list by.
export function useBins(page = 1, limit = 10, search = "", { enabled = true, sort = null, org = null } = {}) {
    const [searchParams] = useSearchParams();
    const { t } = useTranslation()

    let { radius, minLevel, maxLevel, health, coordinates } = Object.fromEntries([...searchParams]);

    const { data, isPending: isLoadingBins, error: binsError } = useQuery({
        queryKey: ['all-bins', page, limit, search, sort, org, { radius, minLevel, maxLevel, health, coordinates }],
        queryFn: () => {
            if (coordinates !== undefined && radius !== undefined && minLevel !== undefined && maxLevel !== undefined && health !== undefined) {

                return getBinsInUserRadius({ coordinates: coordinates.split(',').map(Number), radius: +radius, minLevel: +minLevel, maxLevel: +maxLevel, health, org })
            } else {
                return getAllUserBins(page, limit, search, sort, org)
            }
        },
        enabled,
        refetchInterval: LIST_REFRESH_MS,
        // A new search or route changes the URL and so the query; the bins on
        // the map stay until the new ones arrive, instead of a loading blink.
        placeholderData: keepPreviousData,
    })


    // Only when there is nothing to show: a failed refresh keeps the bins.
    useErrorToast(data ? null : binsError, t("toasts.failedLoadBins"), "bins-load")

    const allBins = data?.binsData
    const totalBins = data?.total;
    return { allBins, totalBins, isLoadingBins, binsError }
}