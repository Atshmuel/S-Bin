import { ChevronDown } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DiagnosticsSections } from "@/components/bins/BinDiagnostics"

// What the device said about itself in one report (owners only: the server sends
// it to no one else; a log without, or past, its diagnostics shows nothing).
function LogDiagnostics({ diagnostics }) {
    const { t } = useTranslation()
    if (!diagnostics) return null
    return (
        <Collapsible className="flex flex-col gap-4">
            <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-fit group">
                    {t("components.logCard.diagnostics")}
                    <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{t("components.logCard.diagnosticsDescription")}</p>
                <DiagnosticsSections d={diagnostics} />
            </CollapsibleContent>
        </Collapsible>
    )
}

export default LogDiagnostics
