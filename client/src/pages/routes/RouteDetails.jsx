import { Link, useNavigate, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ArrowLeft, ArrowRight, CircleCheck, CircleHelp, CircleX, Navigation, Trash2 } from "lucide-react"
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog"
import RouteMap from "@/components/routes/RouteMap"
import { RouteDriverSelect, RouteStatusBadge } from "@/components/routes/RouteParts"
import { loadedKg, routeDuration, routeTitle } from "@/utils/routes"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MobileTooltip } from "@/components/ui/mobile-tooltip"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppSide } from "@/hooks/useAppSide"
import { useDeleteRoute, useRoute, useUpdateRoute } from "@/hooks/routes/useRoutes"
import { useMe } from "@/hooks/users/auth/useMe"
import { getMeshSettings } from "@/services/apiMeshSettings"
import { ROUTE_CLAIM_FAR_METERS, ROUTE_SKIP_REASONS } from "@/utils/constants"
import { truckName } from "@/utils/orgSettings"

const STOP_VARIANTS = Object.freeze({ planned: "outline", done: "active", skipped: "inactive" })
const VERIFICATION_ICONS = Object.freeze({
    confirmed: [CircleCheck, "text-green-600"],
    contradicted: [CircleX, "text-red-600"],
    unverified: [CircleHelp, "text-muted-foreground"],
})

// The route's truck: a picker of the organization's truck types for owners and
// admins while a collection is open (the server checks the load fits).
function RouteTruckSelect({ route }) {
    const { t } = useTranslation()
    const { isRight } = useAppSide()
    const { isAdmin } = useMe()
    const editable = isAdmin && route.type === "collection" && ["planned", "driving"].includes(route.status)
    const settingsQuery = useQuery({ queryKey: ["mesh-settings"], queryFn: getMeshSettings, enabled: editable })
    const fleet = settingsQuery.data?.organizations?.find(org => org._id === route.orgId)?.fleet ?? []
    const mutation = useUpdateRoute()
    if (!editable || fleet.length === 0) return <span>{routeTitle(route, t)}</span>
    return (
        <Select value={route.truck?.truckTypeId ?? ""} disabled={mutation.isPending}
            onValueChange={(value) => mutation.mutate({ id: route._id, truckTypeId: value })}>
            <SelectTrigger isRight={isRight} className="w-72" aria-label={t("mapLegend.route.truck")}><SelectValue /></SelectTrigger>
            <SelectContent className="z-[1000]">
                {fleet.map(truck => (
                    <SelectItem isRight={isRight} key={truck._id} value={truck._id}>
                        {t("mapLegend.route.truckOption", { name: truckName(truck, t), kg: truck.capacityKg.toLocaleString() })}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

// A figure of the route in a tile: its value, an optional line under it, and
// an optional bar for how far along or how full (0 to 1).
function Stat({ label, children, sub, bar }) {
    return (
        <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-muted/30 p-3">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="truncate text-sm font-medium">{children}</span>
            {bar != null && (
                <span className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.round(bar * 100))}%` }} />
                </span>
            )}
            {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
        </div>
    )
}

// What a finished route came to: what was collected and skipped (and why), what
// the bins' next reports said, and, for whoever manages the routes, the time.
function RouteSummary({ route, isAdmin }) {
    const { t } = useTranslation()
    const count = (status) => route.stops.filter(stop => stop.status === status).length
    const done = count("done"), skipped = count("skipped"), untouched = count("planned")
    const verified = (status) => route.stops.filter(stop => stop.verification?.status === status).length
    const reasons = ROUTE_SKIP_REASONS
        .map(reason => [reason, route.stops.filter(stop => stop.status === "skipped" && stop.skipReason === reason).length])
        .filter(([, number]) => number > 0)
    const noReason = skipped - reasons.reduce((sum, [, number]) => sum + number, 0)
    const took = isAdmin && route.startedAt && route.finishedAt
        ? routeDuration(Math.max(0, (new Date(route.finishedAt) - new Date(route.startedAt)) / 1000), t)
        : null
    const planned = routeDuration(route.plannedDurationSeconds ?? route.durationSeconds ?? 0, t)
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{t("pages.routes.summary.title")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Stat label={t("pages.routes.summary.collected")} sub={t("pages.routes.summary.collectedLoad", { kg: loadedKg(route).toLocaleString() })}>
                        {t("pages.routes.progress", { done, count: route.stops.length })}
                    </Stat>
                    <Stat label={t("pages.routes.summary.skipped")}
                        sub={[...reasons.map(([reason, number]) => `${t(`pages.routes.skipReasons.${reason}`)} ${number}`),
                            ...(noReason > 0 ? [t("pages.routes.summary.noReason", { count: noReason })] : [])].join(" · ") || null}>
                        {skipped}
                    </Stat>
                    <Stat label={t("pages.routes.summary.notHandled")}>{untouched}</Stat>
                    {took && (
                        <Stat label={t("pages.routes.details.time")} sub={t("pages.routes.details.timePlanned", { planned })}>{took}</Stat>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">
                    {t("pages.routes.summary.verification", {
                        confirmed: verified("confirmed"), contradicted: verified("contradicted"), unverified: verified("unverified"),
                    })}
                    {route.closedByDay && <> · {t("pages.routes.summary.closedByDay")}</>}
                </p>
            </CardContent>
        </Card>
    )
}

function Field({ label, children }) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{label}</span>
            {children}
        </div>
    )
}

// One route: what it is and who drives it, its map with its own key, and its
// stops in driving order with what the driver marked and what the bins'
// reports said about it. Owners and admins change the driver or the truck, or
// cancel it, while it is open; owners can also delete it (mistakes, test data).
function RouteDetails() {
    const { id } = useParams()
    const { t, i18n } = useTranslation()
    const { isRight } = useAppSide()
    const navigate = useNavigate()
    const { me, isAdmin, isOwner } = useMe()
    const { route, isLoadingRoute, routeError } = useRoute(id)
    const cancel = useUpdateRoute()
    const remove = useDeleteRoute(() => navigate("/routes", { replace: true }))

    if (isLoadingRoute) return <Skeleton className="h-[70vh] w-full" />
    if (routeError || !route) return <p className="p-10 text-muted-foreground">{routeError?.message ?? t("pages.routes.details.notFound")}</p>

    const isOpen = ["planned", "driving"].includes(route.status)
    // Its driver drives it; an admin can too (from the office). Owners manage only.
    const canDrive = isOpen && ((isAdmin && !isOwner) || route.driverId === me?.id)
    const doneCount = route.stops.filter(stop => stop.status === "done").length
    const planned = routeDuration(route.plannedDurationSeconds ?? route.durationSeconds ?? 0, t)
    // How long it took (start to finish, breaks included) or has been under way:
    // for whoever manages the routes, not the driver.
    const elapsed = isAdmin && route.startedAt
        ? routeDuration(Math.max(0, (new Date(route.finishedAt ?? route.cancelledAt ?? Date.now()) - new Date(route.startedAt)) / 1000), t)
        : null
    const BackIcon = isRight ? ArrowLeft : ArrowRight
    return (
        <div className="flex flex-col gap-4 sm:p-6">
            <Link to="/routes" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                <BackIcon size={16} />{t("pages.routes.details.back")}
            </Link>
            <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-3">
                        {routeTitle(route, t)}
                        <RouteStatusBadge status={route.status} />
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                        {canDrive && (
                            <Button asChild>
                                <Link to={`/routes/${route._id}/drive`}>
                                    <Navigation data-icon="inline-start" />{t(route.status === "driving" ? "mapLegend.drive.resume" : "mapLegend.drive.start")}
                                </Link>
                            </Button>
                        )}
                        {isAdmin && isOpen && (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button type="button" variant="outline">{t("pages.routes.details.cancel")}</Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>{t("pages.routes.details.cancelTitle")}</AlertDialogTitle>
                                        <AlertDialogDescription>{t("pages.routes.details.cancelDescription")}</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => cancel.mutate({ id: route._id, status: "cancelled" })}>
                                            {t("pages.routes.details.cancel")}
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}
                        {isOwner && (
                            <ConfirmDeleteDialog
                                trigger={(
                                    <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive"
                                        aria-label={t("pages.routes.details.delete")} title={t("pages.routes.details.delete")}>
                                        <Trash2 />
                                    </Button>
                                )}
                                title={t("pages.routes.details.deleteTitle")}
                                description={t("pages.routes.details.deleteDescription")}
                                inputLabel={t("pages.routes.details.deleteInput")}
                                isDeleting={remove.isPending}
                                onConfirm={() => remove.mutate({ id: route._id })} />
                        )}
                    </div>
                </CardHeader>
                {/* Who and what first (pickers need room), then the route's figures. */}
                <CardContent className="flex flex-col gap-5">
                    <div className="flex flex-wrap gap-x-6 gap-y-4">
                        <Field label={t("mapLegend.route.truck")}><RouteTruckSelect route={route} /></Field>
                        <Field label={t("pages.routes.columns.driver")}><RouteDriverSelect route={route} className="w-64" /></Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                        <Stat label={t("pages.routes.day")}>{route.serviceDay}</Stat>
                        <Stat label={t("pages.routes.columns.progress")} bar={route.stops.length ? doneCount / route.stops.length : 0}>
                            {t("pages.routes.progress", { done: doneCount, count: route.stops.length })}
                        </Stat>
                        <Stat label={t("pages.routes.details.distance")}>
                            {((route.distanceMeters ?? 0) / 1000).toFixed(1)} {t("mapLegend.search.kilometers")}
                        </Stat>
                        <Stat label={t("pages.routes.details.time")}
                            sub={elapsed && t(route.status === "driving" ? "pages.routes.details.timeUnderWay" : "pages.routes.details.timeTook", { actual: elapsed })}>
                            {t("pages.routes.details.timePlanned", { planned })}
                        </Stat>
                        {/* What is in the truck so far (the stops done), of the load planned (the truck's capacity is in its picker). */}
                        <Stat label={t("pages.routes.details.inTruck")} bar={route.loadKg ? loadedKg(route) / route.loadKg : null}>
                            {route.loadKg == null ? "—" : t("pages.routes.load", { load: `≈ ${loadedKg(route).toLocaleString()}`, capacity: route.loadKg.toLocaleString() })}
                        </Stat>
                    </div>
                    {route.leftOut > 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">{t("mapLegend.route.leftOut", { count: route.leftOut })}</p>
                    )}
                </CardContent>
            </Card>
            {route.status === "finished" && <RouteSummary route={route} isAdmin={isAdmin} />}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <div className="h-[60vh] min-h-80"><RouteMap route={route} /></div>
                <Card className="flex max-h-[60vh] min-h-80 flex-col overflow-hidden">
                    <CardHeader>
                        <CardTitle className="text-base">{t("mapLegend.route.stopsTitle")}</CardTitle>
                    </CardHeader>
                    <CardContent className="min-h-0 flex-1 overflow-y-auto">
                        <ol className="flex flex-col divide-y">
                            {route.stops.map(stop => {
                                const [VerificationIcon, verificationColor] = VERIFICATION_ICONS[stop.verification?.status] ?? []
                                return (
                                    <li key={stop.binId} className="flex items-start gap-3 py-2 text-sm">
                                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#2563eb] text-xs font-bold text-white">{stop.order}</span>
                                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <Link to={`/bins/${stop.binId}`} className="truncate font-medium hover:underline" dir="auto">{stop.binName}</Link>
                                            <span className="text-xs text-muted-foreground">
                                                {t("mapLegend.route.stopRow", { percent: Math.round(stop.fullnessAtPlan ?? 0) })}
                                                {stop.loadKg != null && <> · {t("mapLegend.route.stopLoad", { kg: stop.loadKg.toLocaleString() })}</>}
                                            </span>
                                            {stop.status === "skipped" && stop.skipReason && (
                                                <span className="text-xs text-muted-foreground">{t(`pages.routes.skipReasons.${stop.skipReason}`)}</span>
                                            )}
                                            {stop.claim && (
                                                <span className="text-xs text-muted-foreground">
                                                    {t("pages.routes.details.claimed", { time: new Date(stop.claim.at).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }) })}
                                                    {/* How far from the bin it was marked: for whoever checks the claims, not the driver. */}
                                                    {isAdmin && stop.claim.distanceMeters != null && (
                                                        <span className={stop.claim.distanceMeters > ROUTE_CLAIM_FAR_METERS ? "text-amber-600 dark:text-amber-400" : ""}>
                                                            {" · "}{t("pages.routes.details.claimDistance", { meters: Math.round(stop.claim.distanceMeters) })}
                                                        </span>
                                                    )}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            {VerificationIcon && (
                                                <MobileTooltip content={t(`pages.routes.verification.${stop.verification.status}`)}>
                                                    <span><VerificationIcon size={16} className={verificationColor} /></span>
                                                </MobileTooltip>
                                            )}
                                            <Badge variant={STOP_VARIANTS[stop.status] ?? "outline"}>{t(`pages.routes.stopStatuses.${stop.status}`)}</Badge>
                                        </div>
                                    </li>
                                )
                            })}
                        </ol>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

export default RouteDetails
