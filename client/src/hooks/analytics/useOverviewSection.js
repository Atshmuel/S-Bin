import { getOverviewSection } from "@/services/apiAnalytics";
import { useQuery } from "@tanstack/react-query";
import { ANALYTICS_STALE_MS } from "@/utils/constants";
import { useSelectedOrg } from "@/hooks/organizations/useSelectedOrg";


// One overview section; `enabled` lets it load only once it is shown, and
// `refreshMs` reloads it on that interval (a dashboard left open). It follows
// the organization an owner picked; `params` are the section's own query.
export function useOverviewSection(section, { range, enabled = true, refreshMs, params } = {}) {
    const { selectedOrgId } = useSelectedOrg();
    const { data, isPending, error } = useQuery({
        queryKey: ["overview-section", section, range ?? null, selectedOrgId, params ?? null],
        queryFn: () => getOverviewSection({ section, range, orgId: selectedOrgId, params }),
        enabled,
        // Refreshed sections are also reloaded on returning to the tab.
        staleTime: refreshMs ? Math.min(refreshMs, ANALYTICS_STALE_MS) : ANALYTICS_STALE_MS,
        refetchInterval: refreshMs ?? false,
    });
    return { data, isLoading: isPending, error };
}
