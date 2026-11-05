import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CartesianGrid, LineChart, Area, AreaChart, ReferenceLine, XAxis, YAxis, Line } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Spinner } from "@/components/ui/spinner"
import { useAppSide } from "@/hooks/useAppSide"
import { useBinAnalytics } from "@/hooks/analytics/useBinAnalytics"
import { isGateway } from "@/utils/binHelpers"
import { formatDate } from "@/utils/helpers"
import { WEIGHT_REFERENCE_KG } from "@/utils/constants"
import RangeSelect from "@/components/analytics/RangeSelect"

// The fill chart's tooltip: the fill by the distance sensor and the weight
// (with its share of the reference), so the user sees what each said.
function FillTooltip({ active, payload, isRight }) {
    const { t } = useTranslation()
    const point = active ? payload?.[0]?.payload : null
    if (!point) return null
    const hasWeight = Number.isFinite(point.weight)
    return (
        <div className="grid min-w-40 gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
            <div className="font-medium">
                {formatDate(point.at, isRight, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t("pages.binDetails.areaChart.byDistance")}</span>
                <span className="font-mono font-medium" dir="ltr">{Number.isFinite(point.level) ? `${point.level}%` : "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t("pages.binDetails.areaChart.byWeight")}</span>
                <span className="font-mono font-medium" dir="ltr">
                    {hasWeight ? t("pages.binDetails.areaChart.weightShare", {
                        kg: point.weight, reference: WEIGHT_REFERENCE_KG,
                        percent: Math.round(Math.min(point.weight / WEIGHT_REFERENCE_KG * 100, 100)),
                    }) : "—"}
                </span>
            </div>
        </div>
    )
}

// One chart of the card: a title, then one value per report on its own axis,
// with a dashed line where the bin was emptied.
function HistoryChart({ tooltip, title, dataKey, label, color, unit, domain, area, points, collections, isRight }) {
    const config = { [dataKey]: { label, color } }
    const Chart = area ? AreaChart : LineChart
    return (
        <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{title}</p>
            <ChartContainer config={config} className="aspect-auto h-[200px] w-full">
                <Chart data={points}>
                    <defs>
                        <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.6} />
                            <stop offset="95%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.05} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} />
                    <XAxis
                        dataKey="at"
                        type="number"
                        scale="time"
                        domain={["dataMin", "dataMax"]}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={32}
                        reversed={!isRight}
                        tickFormatter={(value) => formatDate(value, isRight, { month: "short", day: "numeric" })}
                    />
                    <YAxis domain={domain} unit={unit} width={56} tickLine={false} axisLine={false}
                        orientation={isRight ? "left" : "right"} />
                    <ChartTooltip cursor={false} content={tooltip ?? <ChartTooltipContent indicator="dot" labelFormatter={(_, payload) =>
                        formatDate(payload?.[0]?.payload?.at, isRight, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} />} />
                    {collections.map((at) => (
                        <ReferenceLine key={at} x={at} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                    ))}
                    {area
                        ? <Area dataKey={dataKey} type="monotone" fill={`url(#fill-${dataKey})`} stroke={`var(--color-${dataKey})`} connectNulls />
                        : <Line dataKey={dataKey} type="monotone" stroke={`var(--color-${dataKey})`} strokeWidth={2} dot={false} connectNulls />}
                </Chart>
            </ChartContainer>
        </div>
    )
}

// The fill level and the weight per report, each on its own chart; a
// gateway has neither, and its battery is on the battery card.
function BinHistoryChart({ bin, enabled = true, className }) {
    const { t } = useTranslation()
    const { isRight } = useAppSide()
    const [range, setRange] = useState(30)
    const gateway = isGateway(bin)
    const { data, isLoading, error } = useBinAnalytics(bin._id, "history", { range, enabled: enabled && !gateway })
    if (gateway) return null

    const points = (data?.points ?? []).map((point) => ({ ...point, at: new Date(point.at).getTime() }))
    const showLevel = points.some((point) => point.level !== null)
    const showWeight = points.some((point) => point.weight !== null)
    const collections = (data?.collections ?? []).map((at) => new Date(at).getTime())
    const shared = { points, collections, isRight }

    return (
        <Card className={className}>
            <CardHeader className="flex flex-row items-start gap-2 space-y-0">
                <div className="grid flex-1 gap-1">
                    <CardTitle>{t("pages.binDetails.areaChart.title")}</CardTitle>
                    <CardDescription>{t("pages.binDetails.areaChart.description")}</CardDescription>
                </div>
                <RangeSelect value={range} onChange={setRange} className="w-[140px]" />
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
                {isLoading ? (
                    <div className="flex h-[220px] items-center justify-center"><Spinner className="size-8" /></div>
                ) : error ? (
                    <p role="alert" className="flex h-[220px] items-center justify-center text-sm text-destructive">{error.message}</p>
                ) : points.length === 0 ? (
                    <p className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                        {t("pages.binDetails.analytics.noReports")}
                    </p>
                ) : (
                    !showLevel && !showWeight ? (
                        <p className="flex h-[120px] items-center justify-center text-sm text-muted-foreground">
                            {t("pages.binDetails.areaChart.noFillData")}
                        </p>
                    ) : <>
                        {showLevel && (
                            <HistoryChart {...shared} area tooltip={<FillTooltip isRight={isRight} />} dataKey="level" title={t("pages.binDetails.areaChart.level")}
                                label={t("pages.binDetails.areaChart.level")} color="var(--chart-1)" unit="%" domain={[0, 100]} />
                        )}
                        {showWeight && (
                            <HistoryChart {...shared} dataKey="weight" title={t("pages.binDetails.areaChart.weight")}
                                label={t("pages.binDetails.areaChart.weight")} color="var(--chart-3)" unit=" kg" domain={[0, "auto"]} />
                        )}
                    </>
                )}
                {collections.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                        {t("pages.binDetails.areaChart.collectionsNote", { count: collections.length })}
                    </p>
                )}
            </CardContent>
        </Card>
    )
}

export default BinHistoryChart
