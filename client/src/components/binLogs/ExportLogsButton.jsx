import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Download } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import ChoiceGroup from "@/components/map/controls/ChoiceGroup"
import { useAppSide } from "@/hooks/useAppSide"
import { downloadLogs } from "@/services/apiLogs"
import { ANALYTICS_RANGES_DAYS, DEFAULT_ANALYTICS_RANGE_DAYS } from "@/utils/constants"

// Asks for a period, then saves the logs of the list shown (its search, newest
// first) as a CSV file.
function ExportLogsButton({ search, binId, org }) {
    const { t } = useTranslation()
    const { isRight, side } = useAppSide()
    const [open, setOpen] = useState(false)
    const [days, setDays] = useState(DEFAULT_ANALYTICS_RANGE_DAYS)
    const { mutate: exportLogs, isPending } = useMutation({
        mutationFn: () => downloadLogs({ days, search, binId, org }),
        onSuccess: () => setOpen(false),
        onError: (error) => toast.error(error.message || t("components.exportLogs.failed")),
    })
    return (
        <Dialog open={open} onOpenChange={(next) => { if (!isPending) setOpen(next) }}>
            <DialogTrigger asChild>
                <Button variant="outline"><Download />{t("components.exportLogs.button")}</Button>
            </DialogTrigger>
            <DialogContent side={side}>
                <DialogHeader isRight={isRight} className="pt-6">
                    <DialogTitle>{t("components.exportLogs.title")}</DialogTitle>
                    <DialogDescription isRight={!isRight}>{t("components.exportLogs.description")}</DialogDescription>
                </DialogHeader>
                <ChoiceGroup label={t("components.exportLogs.period")} value={String(days)} onChange={(next) => setDays(Number(next))}
                    options={ANALYTICS_RANGES_DAYS.map(count => [String(count), t("pages.binDetails.areaChart.lastDays", { count })])} />
                <DialogFooter className="flex flex-col gap-2 sm:flex-row justify-end">
                    <DialogClose asChild>
                        <Button disabled={isPending} variant="outline">{t("cancel")}</Button>
                    </DialogClose>
                    <Button disabled={isPending} onClick={() => exportLogs()}>
                        {isPending ? <Spinner /> : t("components.exportLogs.confirm")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default ExportLogsButton
