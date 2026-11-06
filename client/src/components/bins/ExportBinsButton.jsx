import { useMutation } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Download } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { downloadBins } from "@/services/apiBins"

// Saves the bins of the list shown (its search, the picked organization) as a CSV file.
function ExportBinsButton({ search, org }) {
    const { t } = useTranslation()
    const { mutate: exportBins, isPending } = useMutation({
        mutationFn: () => downloadBins({ search, org }),
        onError: (error) => toast.error(error.message || t("components.exportCsv.failed")),
    })
    return (
        <Button variant="outline" disabled={isPending} onClick={() => exportBins()}>
            {isPending ? <Spinner /> : <Download />}
            {t("components.exportCsv.button")}
        </Button>
    )
}

export default ExportBinsButton
