import { useTranslation } from "react-i18next"
import { FileText } from "lucide-react"
import { MobileTooltip } from "@/components/ui/mobile-tooltip"

// On a card: its content is in the page's Excel export. The tooltip says so on
// hover, and on a tap on a phone.
function ExportMark() {
    const { t } = useTranslation()
    const text = t("components.exportCsv.included")
    return (
        <MobileTooltip content={text}>
            <span tabIndex={0} role="img" aria-label={text} className="inline-flex cursor-help text-muted-foreground">
                <FileText className="size-4 shrink-0" />
            </span>
        </MobileTooltip>
    )
}

export default ExportMark
