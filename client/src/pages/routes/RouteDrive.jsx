import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { DriverPosition, DrivingBar } from "@/components/map/RouteDriving"
import RouteMap from "@/components/routes/RouteMap"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppSide } from "@/hooks/useAppSide"
import { useDriveRoute, useRoute } from "@/hooks/routes/useRoutes"
import { NAV_START_POSITION_WAIT_MS, ROUTE_SKIP_REASONS } from "@/utils/constants"

const OPEN = ["planned", "driving"]

// Driving a route, full screen for a phone: the route on its map with the
// phone's live position, and the driving bar. Each visit starts (or resumes)
// the route once: from the first GPS fix, so the stops still to do are ordered
// from where the driver is, or after NAV_START_POSITION_WAIT_MS with the
// planned order. Done, Previous (undoes the last Done or Skip), Skip, Re-order
// and Finish are saved at once.
function RouteDrive() {
    const { id } = useParams()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { isRight } = useAppSide()
    const { route, isLoadingRoute, routeError } = useRoute(id)
    const drive = useDriveRoute()
    const [position, setPosition] = useState(null)
    const [following, setFollowing] = useState(true)
    const [skipping, setSkipping] = useState(null)
    const [skipReason, setSkipReason] = useState("")
    const stopFollowing = useCallback(() => setFollowing(false), [])
    const isOpen = OPEN.includes(route?.status)

    // One start per visit (two at once could overwrite each other's save).
    // `mutate` is stable across renders; the mutation object is not.
    const { mutate } = drive
    const started = useRef(false)
    const startOnce = useCallback((lngLat) => {
        if (started.current) return
        started.current = true
        mutate({ action: "start", id, position: lngLat })
    }, [mutate, id])
    useEffect(() => {
        if (!isOpen) return
        if (position) return startOnce([position.lng, position.lat])
        const timer = setTimeout(() => startOnce(null), NAV_START_POSITION_WAIT_MS)
        return () => clearTimeout(timer)
    }, [isOpen, position, startOnce])

    const here = position ? [position.lng, position.lat] : undefined
    if (isLoadingRoute) return <Skeleton className="h-[calc(100dvh-6rem)] w-full" />
    if (routeError || !route) return <p className="p-10 text-muted-foreground">{routeError?.message ?? t("pages.routes.details.notFound")}</p>
    if (!isOpen) {
        return (
            <div className="flex flex-col gap-2 p-10">
                <p>{t("pages.routes.drive.closed", { status: t(`pages.routes.statuses.${route.status}`) })}</p>
                <Link className="underline" to={`/routes/${id}`}>{t("pages.routes.drive.toRoute")}</Link>
            </div>
        )
    }

    return (
        <div className="relative h-[calc(100dvh-6rem)] w-full">
            <RouteMap route={route} withKey={false}>
                <DriverPosition following={following} onStopFollowing={stopFollowing} onPosition={setPosition} />
            </RouteMap>
            <DrivingBar route={route} position={position} following={following} busy={drive.isPending}
                onFollow={() => setFollowing(true)}
                onDone={(stop) => drive.mutate({ action: "done", id, binId: stop.binId, position: here, accuracyMeters: position?.accuracy })}
                onUndo={(stop) => drive.mutate({ action: stop.status === "done" ? "undo" : "unskip", id, binId: stop.binId })}
                onSkip={(stop) => { setSkipReason(""); setSkipping(stop) }}
                onReorder={() => drive.mutate({ action: "start", id, position: here }, { onSuccess: () => toast.success(t("pages.routes.drive.reordered")) })}
                onStop={() => navigate(`/routes/${id}`)}
                onFinish={() => drive.mutate({ action: "finish", id }, { onSuccess: () => navigate(`/routes/${id}`) })} />
            <AlertDialog open={Boolean(skipping)} onOpenChange={(open) => !open && setSkipping(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("pages.routes.drive.skipTitle", { name: skipping?.binName })}</AlertDialogTitle>
                        <AlertDialogDescription>{t("pages.routes.drive.skipDescription")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    {/* Above the dialog (z-1003): the picker opens in its own layer. */}
                    <Select value={skipReason} onValueChange={setSkipReason}>
                        <SelectTrigger isRight={isRight} aria-label={t("pages.routes.drive.skipReason")}>
                            <SelectValue placeholder={t("pages.routes.drive.skipReason")} />
                        </SelectTrigger>
                        <SelectContent className="z-[1100]">
                            {ROUTE_SKIP_REASONS.map(reason => (
                                <SelectItem isRight={isRight} key={reason} value={reason}>{t(`pages.routes.skipReasons.${reason}`)}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                        <AlertDialogAction disabled={!skipReason} onClick={() => drive.mutate({ action: "skip", id, binId: skipping.binId, reason: skipReason })}>
                            {t("mapLegend.drive.skip")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

export default RouteDrive
