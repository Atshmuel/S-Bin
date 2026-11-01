import { useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { formatDistanceToNow } from "date-fns"
import { he } from "date-fns/locale"
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { useAppSide } from "@/hooks/useAppSide"
import { useOverviewSection } from "@/hooks/analytics/useOverviewSection"
import { useInView } from "@/hooks/use-in-view"
import { useSelectedOrg } from "@/hooks/organizations/useSelectedOrg"
import { useMe } from "@/hooks/users/auth/useMe"
import { useThresholds } from "@/hooks/useThresholds"
import { formatDate } from "@/utils/helpers"
import { formatMoney } from "@/utils/money"
import { routeDuration } from "@/utils/routes"
import RangeSelect from "./RangeSelect"
import SectionCard, { Muted } from "./SectionCard"

// The analytics page's sections. Each makes its own request, once it scrolls
// into view, so the page shows its first cards without waiting for the rest.

const CHART_CLASS = "aspect-auto h-[220px] w-full"

function useSection(section, range) {
    const [ref, inView] = useInView()
    return { ref, ...useOverviewSection(section, { range, enabled: inView }) }
}

function useDateFormats() {
    const { isRight } = useAppSide()
    // Days come as YYYY-MM-DD; noon keeps them on the same date in any zone.
    const dayLabel = (day, options = { month: "short", day: "numeric" }) =>
        day ? formatDate(`${day}T12:00:00`, isRight, options) : ""
    return { isRight, dayLabel }
}

function BinLink({ bin }) {
    return (
        <Link to={`/bins/${bin._id}`} className="truncate text-primary underline-offset-4 hover:underline">
            {bin.binName}
        </Link>
    )
}

function BigNumber({ label, value }) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="text-2xl font-semibold tabular-nums">{value}</span>
        </div>
    )
}

// A chart over the days of the range, one bar (or line) per day.
function DailyChart({ data, config, children }) {
    const { isRight, dayLabel } = useDateFormats()
    return (
        <ChartContainer config={config} className={CHART_CLASS}>
            <ComposedChart data={data}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={24} reversed={!isRight}
                    tickFormatter={(day) => dayLabel(day)} />
                <ChartTooltip content={<ChartTooltipContent indicator="dot"
                    labelFormatter={(_, payload) => dayLabel(payload?.[0]?.payload?.day, { dateStyle: "medium" })} />} />
                {children}
                <ChartLegend content={<ChartLegendContent />} />
            </ComposedChart>
        </ChartContainer>
    )
}

// Bins per range of a value (fullness or battery).
function BucketChart({ buckets, label }) {
    const { isRight } = useAppSide()
    const data = (buckets ?? []).map((bucket) => ({ name: `${bucket.from}–${bucket.to}%`, count: bucket.count }))
    return (
        <ChartContainer config={{ count: { label, color: "var(--chart-2)" } }} className={CHART_CLASS}>
            <BarChart data={data}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} reversed={!isRight} />
                <YAxis allowDecimals={false} hide />
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={4} />
            </BarChart>
        </ChartContainer>
    )
}

export function FullSoonCard() {
    const { t, i18n } = useTranslation()
    const { ref, data, isLoading, error } = useSection("full-soon")
    const { thresholds } = useThresholds()
    const locale = i18n.language === "he" ? he : undefined

    return (
        <SectionCard ref={ref} title={t("pages.analytics.sections.fullSoon.title")}
            description={t("pages.analytics.sections.fullSoon.description", { percent: thresholds.fullnessCritical })}
            isLoading={isLoading} error={error}>
            <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                    <BigNumber label={t("pages.analytics.sections.fullSoon.within", { count: 24 })} value={data?.counts?.within24h ?? 0} />
                    <BigNumber label={t("pages.analytics.sections.fullSoon.within", { count: 48 })} value={data?.counts?.within48h ?? 0} />
                </div>
                {data?.bins?.length > 0 ? (
                    <ul className="flex max-h-48 flex-col divide-y overflow-y-auto">
                        {data.bins.map((bin) => (
                            <li key={bin._id} className="flex items-center justify-between gap-3 py-2 text-sm">
                                <BinLink bin={bin} />
                                <span className="shrink-0 text-muted-foreground">
                                    {bin.fullness}% · {formatDistanceToNow(new Date(bin.collectionDueAt), { addSuffix: true, locale })}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <Muted>{t("pages.analytics.sections.fullSoon.none")}</Muted>
                )}
            </div>
        </SectionCard>
    )
}

export function FullnessDistributionCard() {
    const { t } = useTranslation()
    const { ref, data, isLoading, error } = useSection("fullness-distribution")
    return (
        <SectionCard ref={ref} title={t("pages.analytics.sections.fullness.title")}
            description={t("pages.analytics.sections.fullness.description")} isLoading={isLoading} error={error}>
            <BucketChart buckets={data?.buckets} label={t("pages.analytics.sections.bins")} />
            {data?.unknown > 0 && <Muted>{t("pages.analytics.sections.fullness.unknown", { count: data.unknown })}</Muted>}
        </SectionCard>
    )
}

export function CollectionsTrendCard() {
    const { t } = useTranslation()
    const [range, setRange] = useState(30)
    const { ref, data, isLoading, error } = useSection("collections", range)
    const config = {
        count: { label: t("pages.analytics.sections.collections.count"), color: "var(--chart-2)" },
        avgFullnessBefore: { label: t("pages.analytics.sections.collections.fullness"), color: "var(--chart-1)" },
    }
    return (
        <SectionCard ref={ref} title={t("pages.analytics.sections.collections.title")}
            description={data && data.total > 0
                ? t("pages.analytics.sections.collections.summary", { count: data.total, percent: data.avgFullnessBefore ?? "-" })
                : t("pages.analytics.sections.collections.description")}
            action={<RangeSelect value={range} onChange={setRange} className="w-[140px]" />}
            isLoading={isLoading} error={error}>
            <DailyChart data={data?.daily} config={config}>
                <YAxis yAxisId="count" allowDecimals={false} hide />
                <YAxis yAxisId="percent" domain={[0, 100]} hide />
                <Bar yAxisId="count" dataKey="count" fill="var(--color-count)" radius={4} />
                <Line yAxisId="percent" dataKey="avgFullnessBefore" stroke="var(--color-avgFullnessBefore)" strokeWidth={2} connectNulls />
            </DailyChart>
        </SectionCard>
    )
}

export function WasteCard() {
    const { t } = useTranslation()
    const [range, setRange] = useState(30)
    const { ref, data, isLoading, error } = useSection("waste", range)
    return (
        <SectionCard ref={ref} title={t("pages.analytics.sections.waste.title")}
            description={data?.weighedCollections > 0
                ? t("pages.analytics.sections.waste.summary", { kg: data.totalKg })
                : t("pages.analytics.sections.waste.description")}
            action={<RangeSelect value={range} onChange={setRange} className="w-[140px]" />}
            isLoading={isLoading} error={error}>
            <DailyChart data={data?.daily} config={{ kg: { label: t("pages.analytics.sections.waste.kg"), color: "var(--chart-3)" } }}>
                <YAxis allowDecimals={false} hide />
                <Bar dataKey="kg" fill="var(--color-kg)" radius={4} />
            </DailyChart>
        </SectionCard>
    )
}

export function BatteryOutlookCard() {
    const { t } = useTranslation()
    const { ref, data, isLoading, error } = useSection("battery")
    return (
        <SectionCard ref={ref} title={t("pages.analytics.sections.battery.title")}
            description={t("pages.analytics.sections.battery.description")} isLoading={isLoading} error={error}>
            <div className="flex flex-col gap-4">
                <BucketChart buckets={data?.buckets} label={t("pages.analytics.sections.devices")} />
                {data?.soon?.length > 0 ? (
                    <ul className="flex max-h-40 flex-col divide-y overflow-y-auto">
                        {data.soon.map((device) => (
                            <li key={device._id} className="flex items-center justify-between gap-3 py-2 text-sm">
                                <BinLink bin={device} />
                                <span className="shrink-0 text-muted-foreground">
                                    {device.battery}% · {t("pages.analytics.sections.battery.daysLeft", { count: Math.round(device.daysLeft) })}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <Muted>{t("pages.analytics.sections.battery.none", { count: data?.soonDays ?? 30 })}</Muted>
                )}
            </div>
        </SectionCard>
    )
}

export function ConnectivityCard() {
    const { t } = useTranslation()
    const { ref, data, isLoading, error } = useSection("connectivity")
    return (
        <SectionCard ref={ref} title={t("pages.analytics.sections.connectivity.title")}
            description={t("pages.analytics.sections.connectivity.description", { count: data?.reliabilityDays ?? 7 })}
            isLoading={isLoading} error={error}>
            <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-4">
                    <BigNumber label={t("pages.binDetails.tiles.cellular")} value={data?.share?.cellular ?? 0} />
                    <BigNumber label={t("pages.binDetails.tiles.mesh")} value={data?.share?.mesh ?? 0} />
                    <BigNumber label={t("pages.analytics.sections.connectivity.onTime")}
                        value={data?.averageReliability != null ? `${data.averageReliability}%` : "-"} />
                </div>
                {data?.gateways?.length > 0 && (
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-muted-foreground">
                            {t("pages.analytics.sections.connectivity.gateways")} ({data.gatewayCount ?? data.gateways.length})
                        </span>
                        <ul className="flex max-h-40 flex-col divide-y overflow-y-auto">
                            {data.gateways.map((gateway) => (
                                <li key={gateway._id} className="flex items-center justify-between gap-3 py-2 text-sm">
                                    {gateway.binName ? <BinLink bin={gateway} /> : <span>-</span>}
                                    <span className="shrink-0 text-muted-foreground">
                                        {t("pages.analytics.sections.connectivity.leaves", { count: gateway.leaves })}
                                        {gateway.avgRssi != null && <> · <span dir="ltr">{gateway.avgRssi} dBm</span></>}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {data?.leastReliable?.length > 0 && (
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-muted-foreground">{t("pages.analytics.sections.connectivity.leastReliable")}</span>
                        <ul className="flex max-h-40 flex-col divide-y overflow-y-auto">
                            {data.leastReliable.map((device) => (
                                <li key={device._id} className="flex items-center justify-between gap-3 py-2 text-sm">
                                    <BinLink bin={device} />
                                    <span className="shrink-0 text-muted-foreground">
                                        {device.percent}% · {t("pages.binDetails.analytics.reliability.counts", { received: device.received, expected: device.expected })}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </SectionCard>
    )
}

const HEALTH_CAUSES = ["fillSensor", "battery", "scale", "gps", "connectivity"]

export function HealthCausesCard() {
    const { t } = useTranslation()
    const [range, setRange] = useState(30)
    const { ref, data, isLoading, error } = useSection("health-causes", range)
    const config = Object.fromEntries(HEALTH_CAUSES.map((cause, i) => [
        cause, { label: t(`pages.analytics.sections.healthCauses.${cause}`), color: `var(--chart-${i + 1})` },
    ]))
    return (
        <SectionCard ref={ref} title={t("pages.analytics.sections.healthCauses.title")}
            description={t("pages.analytics.sections.healthCauses.description")}
            action={<RangeSelect value={range} onChange={setRange} className="w-[140px]" />}
            isLoading={isLoading} error={error}>
            <DailyChart data={data?.daily} config={config}>
                <YAxis allowDecimals={false} hide />
                {HEALTH_CAUSES.map((cause) => (
                    <Bar key={cause} dataKey={cause} stackId="causes" fill={`var(--color-${cause})`} />
                ))}
            </DailyChart>
        </SectionCard>
    )
}

// How the range's routes went: what was collected and skipped, what the bins'
// reports said about the collections marked, the time a route took against
// the time planned, and (owners and admins) each driver's figures.
export function RoutesCard({ className }) {
    const { t } = useTranslation()
    const [range, setRange] = useState(30)
    const { ref, data, isLoading, error } = useSection("routes", range)
    const config = {
        done: { label: t("pages.analytics.sections.routes.done"), color: "var(--chart-2)" },
        skipped: { label: t("pages.analytics.sections.routes.skipped"), color: "var(--chart-4)" },
    }
    const percent = value => value === null || value === undefined ? "—" : `${value}%`
    return (
        <SectionCard ref={ref} className={className} title={t("pages.analytics.sections.routes.title")}
            description={data && data.routes > 0
                ? t("pages.analytics.sections.routes.summary", { count: data.finished, routes: data.routes })
                : t("pages.analytics.sections.routes.description")}
            action={<RangeSelect value={range} onChange={setRange} className="w-[140px]" />}
            isLoading={isLoading} error={error}>
            {data && (
                <div className="flex flex-col gap-6">
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                        <BigNumber label={t("pages.analytics.sections.routes.collected")} value={data.collected.toLocaleString()} />
                        <BigNumber label={t("pages.analytics.sections.routes.skippedTotal")} value={data.skipped.toLocaleString()} />
                        <BigNumber label={t("pages.analytics.sections.routes.confirmed")} value={percent(data.confirmedPercent)} />
                        <BigNumber label={t("pages.analytics.sections.routes.contradicted")} value={data.contradicted.toLocaleString()} />
                    </div>
                    <DailyChart data={data.daily} config={config}>
                        <YAxis allowDecimals={false} hide />
                        <Bar dataKey="done" stackId="stops" fill="var(--color-done)" radius={[0, 0, 4, 4]} />
                        <Bar dataKey="skipped" stackId="stops" fill="var(--color-skipped)" radius={[4, 4, 0, 0]} />
                    </DailyChart>
                    <Muted>
                        {data.timedRoutes > 0
                            ? t("pages.analytics.sections.routes.time", {
                                actual: routeDuration(data.avgActualMinutes * 60, t), planned: routeDuration(data.avgPlannedMinutes * 60, t), count: data.timedRoutes,
                            })
                            : t("pages.analytics.sections.routes.noTime")}
                    </Muted>
                    {data.drivers && (
                        data.drivers.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-start text-xs text-muted-foreground">
                                        <tr>
                                            {["driver", "routes", "collected", "confirmed", "contradicted", "minutesPerStop"].map(column => (
                                                <th key={column} className="py-2 pe-4 text-start font-medium">{t(`pages.analytics.sections.routes.columns.${column}`)}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {data.drivers.map(driver => (
                                            <tr key={driver._id}>
                                                <td className="py-2 pe-4">{driver.name ?? t("pages.routes.unknownDriver")}</td>
                                                <td className="py-2 pe-4 tabular-nums">{driver.routes}</td>
                                                <td className="py-2 pe-4 tabular-nums">{driver.collected}</td>
                                                <td className="py-2 pe-4 tabular-nums">{percent(driver.confirmedPercent)}</td>
                                                <td className={`py-2 pe-4 tabular-nums ${driver.contradicted ? "text-red-600" : ""}`}>{driver.contradicted}</td>
                                                <td className="py-2 pe-4 tabular-nums">{driver.minutesPerStop ?? "—"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : <Muted>{t("pages.analytics.sections.routes.noDrivers")}</Muted>
                    )}
                </div>
            )}
        </SectionCard>
    )
}

const SPENT_PARTS = ["fuel", "crew", "disposal", "system"]

// The range's money (owners and admins): spent, saved against the old fixed
// schedule, the collections saved and their CO₂, what the spending went on,
// and per day; then what the savings rest on, and where the prices are set.
export function CostsCard({ className }) {
    const { t, i18n } = useTranslation()
    const { me, isOwner } = useMe()
    const { selectedOrgId } = useSelectedOrg()
    const [range, setRange] = useState(30)
    const { ref, data, isLoading, error } = useSection("costs", range)
    const money = value => formatMoney(value, i18n.language)
    const number = (value, digits = 0) => value === null || value === undefined ? "—" : value.toLocaleString(i18n.language, { maximumFractionDigits: digits })
    const config = {
        spent: { label: t("pages.analytics.sections.costs.spent"), color: "var(--chart-1)" },
        saved: { label: t("pages.analytics.sections.costs.saved"), color: "var(--chart-2)" },
    }
    // One organization's prices can be opened: an owner's picked one, or an admin's own.
    const orgId = isOwner ? selectedOrgId : me?.org
    const unit = data?.perCollection
    return (
        <SectionCard ref={ref} className={className} title={t("pages.analytics.sections.costs.title")}
            description={data?.saved?.money != null
                ? t("pages.analytics.sections.costs.summary", { saved: money(data.saved.money), net: money(data.saved.net) })
                : t("pages.analytics.sections.costs.description")}
            action={<RangeSelect value={range} onChange={setRange} className="w-[140px]" />}
            isLoading={isLoading} error={error}>
            {data && (
                <div className="flex flex-col gap-6">
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                        <BigNumber label={t("pages.analytics.sections.costs.spent")} value={money(data.spent.total)} />
                        <BigNumber label={t("pages.analytics.sections.costs.saved")} value={money(data.saved.money)} />
                        <BigNumber label={t("pages.analytics.sections.costs.avoided")} value={number(data.collections.avoided)} />
                        <BigNumber label={t("pages.analytics.sections.costs.co2")}
                            value={data.saved.co2Kg === null ? "—" : t("pages.analytics.sections.costs.co2Value", { value: number(data.saved.co2Kg) })} />
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
                        {SPENT_PARTS.map(part => (
                            <div key={part} className="flex justify-between gap-2 border-b py-1">
                                <dt className="text-muted-foreground">
                                    {part === "system"
                                        ? t("pages.analytics.sections.costs.spentOn.systemDevices", { count: data.spent.devices })
                                        : t(`pages.analytics.sections.costs.spentOn.${part}`)}
                                </dt>
                                <dd className="tabular-nums">{money(data.spent[part])}</dd>
                            </div>
                        ))}
                    </dl>
                    <DailyChart data={data.daily} config={config}>
                        <YAxis hide />
                        <Bar dataKey="spent" fill="var(--color-spent)" radius={4} />
                        <Bar dataKey="saved" fill="var(--color-saved)" radius={4} />
                    </DailyChart>
                    <div className="flex flex-col gap-1">
                        <Muted>
                            {t("pages.analytics.sections.costs.collections", {
                                actual: number(data.collections.actual), baseline: number(data.collections.baseline), bins: number(data.collections.bins),
                            })}
                        </Muted>
                        <Muted>
                            {unit
                                ? t(`pages.analytics.sections.costs.unit.${unit.basis}`, { cost: formatMoney(unit.cost, i18n.language), km: number(unit.km, 2), minutes: number(unit.minutes, 1) })
                                : t("pages.analytics.sections.costs.unit.none")}
                        </Muted>
                        {data.usage.estimatedTonnes > 0 && (
                            <Muted>
                                {t("pages.analytics.sections.costs.estimated", { estimated: number(data.usage.estimatedTonnes, 1), tonnes: number(data.usage.tonnes, 1) })}
                            </Muted>
                        )}
                        {orgId && (
                            <Link to={`/organizations/${orgId}/settings`} className="text-sm text-primary underline-offset-4 hover:underline">
                                {t("pages.analytics.sections.costs.prices")}
                            </Link>
                        )}
                    </div>
                </div>
            )}
        </SectionCard>
    )
}
