import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Download } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useAppSide } from "@/hooks/useAppSide"
import { useAnalyticsRange } from "@/hooks/analytics/useAnalyticsRange"
import { useSelectedOrg } from "@/hooks/organizations/useSelectedOrg"
import { useMe } from "@/hooks/users/auth/useMe"
import { getOverviewSection } from "@/services/apiAnalytics"
import { ANALYTICS_STALE_MS } from "@/utils/constants"
import { saveXlsx } from "@/utils/download"
import { EXPORT_SECTIONS } from "./exportSections"

// Saves the cards marked with the export icon as one Excel file, a sheet for each
// table, for the period picked at the top. The sections come from the cache where a card loaded them
// already, and from the server for the cards not scrolled to yet.
function ExportAnalyticsButton() {
    const { t, i18n } = useTranslation()
    const queryClient = useQueryClient()
    const { isRight } = useAppSide()
    const range = useAnalyticsRange()
    const { selectedOrgId } = useSelectedOrg()
    const { isAdmin } = useMe()
    const { mutate: exportCards, isPending } = useMutation({
        mutationFn: async () => {
            const sections = EXPORT_SECTIONS.filter(({ adminOnly }) => isAdmin || !adminOnly)
            const results = await Promise.all(sections.map(({ section }) => queryClient.fetchQuery({
                queryKey: ["overview-section", section, range, selectedOrgId, null],
                queryFn: () => getOverviewSection({ section, range, orgId: selectedOrgId }),
                staleTime: ANALYTICS_STALE_MS,
            })))
            const ctx = { t, i18n }
            await saveXlsx(`analytics-${range}d-${new Date().toISOString().slice(0, 10)}.xlsx`,
                sections.flatMap(({ tables }, i) => tables(results[i], ctx)), { rtl: !isRight })
        },
        onError: (error) => toast.error(error.message || t("components.exportCsv.failed")),
    })
    return (
        <Button variant="outline" disabled={isPending} onClick={() => exportCards()}>
            {isPending ? <Spinner /> : <Download />}
            {t("components.exportCsv.excel")}
        </Button>
    )
}

export default ExportAnalyticsButton
