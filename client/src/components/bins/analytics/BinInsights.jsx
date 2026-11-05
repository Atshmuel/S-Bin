import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { useAppSide } from "@/hooks/useAppSide"
import { useBinAnalytics } from "@/hooks/analytics/useBinAnalytics"
import { useMe } from "@/hooks/users/auth/useMe"
import { isGateway } from "@/utils/binHelpers"
import { formatDate } from "@/utils/helpers"
import BinHistoryChart from "./BinHistoryChart"
import RangeSelect from "@/components/analytics/RangeSelect"
import SectionCard, { Muted } from "@/components/analytics/SectionCard"

function CollectionsCard({ bin, enabled }) {
    const { t } = useTranslation()
    const { isRight } = useAppSide()
    const [range, setRange] = useState(90)
    const { data, isLoading, error } = useBinAnalytics(bin._id, "collections", { range, enabled })
    const collections = data?.collections ?? []

    return (
        <SectionCard
            title={t("pages.binDetails.analytics.collections.title")}
            description={t("pages.binDetails.analytics.collections.description")}
            action={<RangeSelect value={range} onChange={setRange} className="w-[140px]" />}
            isLoading={isLoading}
            error={error}
        >
            {collections.length === 0 ? (
                <Muted>{t("pages.binDetails.analytics.collections.none")}</Muted>
            ) : (
                <ul className="flex max-h-64 flex-col divide-y overflow-y-auto">
                    {collections.map((collection) => (
                        <li key={collection.at} className="flex items-center justify-between gap-3 py-2 text-sm">
                            <span dir="ltr">{formatDate(collection.at, isRight, { dateStyle: "medium", timeStyle: "short" })}</span>
                            <span className="text-muted-foreground">
                                {collection.fullnessBefore !== null &&
                                    t("pages.binDetails.analytics.collections.fullnessBefore", { percent: collection.fullnessBefore })}
                                {collection.kgRemoved !== null &&
                                    <> · {t("pages.binDetails.analytics.collections.kgRemoved", { kg: collection.kgRemoved.toFixed(1) })}</>}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </SectionCard>
    )
}

function BatteryCard({ bin, enabled }) {
    const { t } = useTranslation()
    const { isRight } = useAppSide()
    const [range, setRange] = useState(30)
    const { data, isLoading, error } = useBinAnalytics(bin._id, "battery", { range, enabled })
    const daily = data?.daily ?? []
    const chartConfig = {
        battery: { label: t("pages.binDetails.areaChart.battery"), color: "var(--chart-2)" },
        awakeSeconds: { label: t("pages.binDetails.analytics.battery.awake"), color: "var(--chart-4)" },
    }

    let outlook = t("pages.binDetails.analytics.battery.notEnoughData")
    if (data?.daysLeft != null) {
        const date = formatDate(Date.now() + data.daysLeft * 86400000, isRight, { month: "short", day: "numeric" })
        outlook = t("pages.binDetails.analytics.battery.daysLeft", {
            count: Math.round(data.daysLeft), percent: data.criticalPercent, date,
        }) + " " + t("pages.binDetails.analytics.battery.rate", { rate: Math.abs(data.ratePerDay).toFixed(1) })
    } else if (data?.ratePerDay != null) {
        outlook = t("pages.binDetails.analytics.battery.notDraining")
    }

    return (
        <SectionCard
            title={t("pages.binDetails.analytics.battery.title")}
            description={outlook}
            action={<RangeSelect value={range} onChange={setRange} className="w-[140px]" />}
            isLoading={isLoading}
            error={error}
        >
            {daily.length === 0 ? (
                <Muted>{t("pages.binDetails.analytics.noReports")}</Muted>
            ) : (
                <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
                    <LineChart data={daily}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                            dataKey="day"
                            tickLine={false}
                            axisLine={false}
                            minTickGap={24}
                            reversed={!isRight}
                            tickFormatter={(day) => formatDate(`${day}T12:00:00`, isRight, { month: "short", day: "numeric" })}
                        />
                        <YAxis yAxisId="percent" domain={[0, 100]} hide />
                        <YAxis yAxisId="seconds" hide />
                        <ChartTooltip content={<ChartTooltipContent indicator="dot" labelFormatter={(_, payload) =>
                            formatDate(`${payload?.[0]?.payload?.day}T12:00:00`, isRight, { dateStyle: "medium" })} />}
                        />
                        <Line yAxisId="percent" dataKey="battery" type="monotone" stroke="var(--color-battery)" strokeWidth={2} dot={false} />
                        <Line yAxisId="seconds" dataKey="awakeSeconds" type="monotone" stroke="var(--color-awakeSeconds)" strokeDasharray="4 4" dot={false} connectNulls />
                    </LineChart>
                </ChartContainer>
            )}
        </SectionCard>
    )
}

function ReliabilityCard({ bin, enabled }) {
    const { t } = useTranslation()
    const { data, isLoading, error } = useBinAnalytics(bin._id, "reliability", { enabled })

    return (
        <SectionCard
            title={t("pages.binDetails.analytics.reliability.title")}
            description={t("pages.binDetails.analytics.reliability.description")}
            isLoading={isLoading}
            error={error}
        >
            <div className="grid grid-cols-2 gap-4">
                {[7, 30].map((days) => {
                    const period = data?.[`days${days}`]
                    return (
                        <div key={days} className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">{t("pages.binDetails.areaChart.lastDays", { count: days })}</span>
                            <span className="text-2xl font-semibold tabular-nums">
                                {period?.percent != null ? `${period.percent}%` : "-"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                {period?.percent != null
                                    ? t("pages.binDetails.analytics.reliability.counts", { received: period.received, expected: period.expected })
                                    : t("pages.binDetails.analytics.reliability.notEnoughData")}
                            </span>
                        </div>
                    )
                })}
            </div>
        </SectionCard>
    )
}

function ConnectionCard({ bin, enabled }) {
    const { t } = useTranslation()
    const { isRight } = useAppSide()
    const [range, setRange] = useState(30)
    const { data, isLoading, error } = useBinAnalytics(bin._id, "connection", { range, enabled })
    const points = (data?.points ?? [])
        .filter((point) => point.rssi !== null)
        .map((point) => ({ ...point, at: new Date(point.at).getTime() }))
    const chartConfig = {
        rssi: { label: t("pages.binDetails.connectedTable.signal"), color: "var(--chart-1)" },
        hops: { label: t("components.binCard.hops"), color: "var(--chart-3)" },
    }

    return (
        <SectionCard
            title={t("pages.binDetails.analytics.connection.title")}
            description={t("pages.binDetails.analytics.connection.description")}
            action={<RangeSelect value={range} onChange={setRange} className="w-[140px]" />}
            isLoading={isLoading}
            error={error}
        >
            {points.length === 0 ? (
                <Muted>{t("pages.binDetails.analytics.noReports")}</Muted>
            ) : (
                <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
                    <LineChart data={points}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                            dataKey="at"
                            type="number"
                            scale="time"
                            domain={["dataMin", "dataMax"]}
                            tickLine={false}
                            axisLine={false}
                            minTickGap={24}
                            reversed={!isRight}
                            tickFormatter={(value) => formatDate(value, isRight, { month: "short", day: "numeric" })}
                        />
                        <YAxis yAxisId="rssi" domain={[-100, -20]} unit=" dBm" width={64} tickLine={false} axisLine={false}
                            orientation={isRight ? "left" : "right"} />
                        <YAxis yAxisId="hops" hide domain={[0, 8]} />
                        <ChartTooltip content={<ChartTooltipContent indicator="dot" labelFormatter={(_, payload) =>
                            formatDate(payload?.[0]?.payload?.at, isRight, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} />}
                        />
                        <Line yAxisId="rssi" dataKey="rssi" type="monotone" stroke="var(--color-rssi)" strokeWidth={2} dot={false} />
                        <Line yAxisId="hops" dataKey="hops" type="stepAfter" stroke="var(--color-hops)" strokeDasharray="4 4" dot={false} />
                    </LineChart>
                </ChartContainer>
            )}
        </SectionCard>
    )
}

// The time axis and tooltip the timing charts share.
function TimeAxis({ isRight }) {
    return (
        <XAxis
            dataKey="at"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            reversed={!isRight}
            tickFormatter={(value) => formatDate(value, isRight, { month: "short", day: "numeric" })}
        />
    )
}

function timeTooltip(isRight) {
    return <ChartTooltipContent indicator="dot" labelFormatter={(_, payload) =>
        formatDate(payload?.[0]?.payload?.at, isRight, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} />
}

// One chart of the timing cards: a title, then the line(s) on one axis.
function TimingChart({ title, unit, points, lines, isRight, marks = [] }) {
    const config = Object.fromEntries(lines.map(({ key, label, color }) => [key, { label, color }]))
    return (
        <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{title}</p>
            <ChartContainer config={config} className="aspect-auto h-[200px] w-full">
                <LineChart data={points}>
                    <CartesianGrid vertical={false} />
                    <TimeAxis isRight={isRight} />
                    <YAxis unit={unit} width={64} tickLine={false} axisLine={false} orientation={isRight ? "left" : "right"} />
                    <ChartTooltip content={timeTooltip(isRight)} />
                    {marks.map((at) => <ReferenceLine key={at} x={at} stroke="var(--destructive)" strokeDasharray="3 3" />)}
                    {lines.map(({ key, dashed }) => (
                        <Line key={key} dataKey={key} type="monotone" stroke={`var(--color-${key})`} strokeWidth={2}
                            strokeDasharray={dashed ? "4 4" : undefined} dot={false} connectNulls />
                    ))}
                </LineChart>
            </ChartContainer>
        </div>
    )
}

// How long each report waited before it reached the server (a leaf's reading
// waits for its gateway's slot) and, for owners, the leaf's wake guard and
// clock uncertainty, one chart each, with a mark where it missed a beacon.
function TimingCard({ bin, enabled }) {
    const { t } = useTranslation()
    const { isRight } = useAppSide()
    const [range, setRange] = useState(30)
    const { data, isLoading, error } = useBinAnalytics(bin._id, "timing", { range, enabled })
    const points = (data?.points ?? []).map((point) => ({ ...point, at: new Date(point.at).getTime(), lagMinutes: Math.round(point.lagSeconds / 6) / 10 }))
    const withGuard = points.filter((point) => point.guardSeconds !== undefined)
    const missed = withGuard.filter((point) => point.missedCycles > 0).map((point) => point.at)
    const text = (name) => t(`pages.binDetails.analytics.timing.${name}`)

    return (
        <SectionCard
            title={text("title")}
            description={text("description")}
            action={<RangeSelect value={range} onChange={setRange} className="w-[140px]" />}
            isLoading={isLoading}
            error={error}
            className="lg:col-span-2"
        >
            {points.length === 0 ? (
                <Muted>{t("pages.binDetails.analytics.noReports")}</Muted>
            ) : (
                <div className="grid gap-6 lg:grid-cols-2">
                    <TimingChart title={text("lag")} unit=" min" points={points} isRight={isRight}
                        lines={[{ key: "lagMinutes", label: text("lag"), color: "var(--chart-1)" }]} />
                    {withGuard.length > 0 && (
                        <TimingChart title={text("guard")} unit=" s" points={withGuard} isRight={isRight} marks={missed}
                            lines={[{ key: "guardSeconds", label: text("guard"), color: "var(--chart-2)" }]} />
                    )}
                    {withGuard.length > 0 && (
                        <TimingChart title={text("residual")} unit=" ppm" points={withGuard} isRight={isRight}
                            lines={[{ key: "residualPpm", label: text("residual"), color: "var(--chart-4)" }]} />
                    )}
                </div>
            )}
        </SectionCard>
    )
}

// A gateway's cycle, per report (owners only): the seconds the modem, the
// network and the server connection took, and apart from them how long it
// waited for its slot (a wait of minutes would hide the seconds).
function GatewayCycleCard({ bin, enabled }) {
    const { t } = useTranslation()
    const { isRight } = useAppSide()
    const [range, setRange] = useState(30)
    const { data, isLoading, error } = useBinAnalytics(bin._id, "timing", { range, enabled })
    const seconds = (ms) => ms === undefined ? undefined : ms / 1000
    const points = (data?.points ?? [])
        .filter((point) => point.modemMs !== undefined || point.networkMs !== undefined || point.mqttMs !== undefined)
        .map((point) => ({
            at: new Date(point.at).getTime(),
            modem: seconds(point.modemMs),
            network: seconds(point.networkMs),
            mqtt: seconds(point.mqttMs),
            slotWait: seconds(point.slotWaitMs),
        }))
    const field = (name) => t(`pages.binDetails.diagnostics.fields.${name}`)
    const text = (name) => t(`pages.binDetails.analytics.cycle.${name}`)

    return (
        <SectionCard
            title={text("title")}
            description={text("description")}
            action={<RangeSelect value={range} onChange={setRange} className="w-[140px]" />}
            isLoading={isLoading}
            error={error}
            className="lg:col-span-2"
        >
            {points.length === 0 ? (
                <Muted>{text("none")}</Muted>
            ) : (
                <div className="grid gap-6 lg:grid-cols-2">
                    <TimingChart title={text("sync")} unit=" s" points={points} isRight={isRight}
                        lines={[
                            { key: "modem", label: field("modemMs"), color: "var(--chart-1)" },
                            { key: "network", label: field("networkMs"), color: "var(--chart-2)" },
                            { key: "mqtt", label: field("mqttMs"), color: "var(--chart-3)" },
                        ]} />
                    {points.some((point) => point.slotWait !== undefined) && (
                        <TimingChart title={text("wait")} unit=" s" points={points} isRight={isRight}
                            lines={[{ key: "slotWait", label: field("slotWaitMs"), color: "var(--chart-4)" }]} />
                    )}
                </div>
            )}
        </SectionCard>
    )
}

// The bin page's analytics tab. Each card makes its own request, and only
// once the tab is opened (`active`), so the page itself stays light.
function BinInsights({ bin, active }) {
    const { isOwner } = useMe()
    const gateway = isGateway(bin)
    const viaMesh = bin.status?.connection?.via === "mesh"
    return (
        <div className="grid gap-4 lg:grid-cols-2">
            {/* The two charts side by side, then the emptyings and the reports. */}
            <BinHistoryChart bin={bin} enabled={active} />
            <BatteryCard bin={bin} enabled={active} />
            {!gateway && <CollectionsCard bin={bin} enabled={active} />}
            <ReliabilityCard bin={bin} enabled={active} />
            {viaMesh && <ConnectionCard bin={bin} enabled={active} />}
            {viaMesh && !gateway && <TimingCard bin={bin} enabled={active} />}
            {gateway && isOwner && <GatewayCycleCard bin={bin} enabled={active} />}
        </div>
    )
}

export default BinInsights
