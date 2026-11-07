import { useState } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { useBinStatusOV } from "@/hooks/overviews/useBinStatusOV"
import { useLogsTypeOV } from "@/hooks/overviews/useLogsTypeOV"
import AIInsights from "./AIInsights"
import { BatteryOutlookCard, CollectionsTrendCard, ConnectivityCard, CostsCard, FullnessDistributionCard, FullSoonCard, HealthCausesCard, ProblemBinsCard, RoutesCard, WasteCard, WeekdaysCard } from "@/components/analytics/FleetCards"
import { Bar, BarChart, CartesianGrid, Label, Pie, PieChart, XAxis } from "recharts"
import { useAppSide } from "@/hooks/useAppSide"
import { useTranslation } from "react-i18next"
import { formatDate } from "@/utils/helpers"
import OrganizationSelect from "@/components/OrganizationSelect"
import RangeSelect from "@/components/analytics/RangeSelect"
import ExportAnalyticsButton from "@/components/analytics/ExportAnalyticsButton"
import { AnalyticsRangeContext } from "@/hooks/analytics/useAnalyticsRange"
import { DEFAULT_ANALYTICS_RANGE_DAYS } from "@/utils/constants"
import { useMe } from "@/hooks/users/auth/useMe"

function Analytics() {
    const { t } = useTranslation()
    const pieChartConfig = {
        bins: {
            label: t("pages.analytics.pie.bins"),
        },
        good: {
            label: t("pages.analytics.pie.good"),
            color: "var(--color-chart-2)",
        },
        warning: {
            label: t("pages.analytics.pie.warning"),
            color: "var(--color-chart-3)",
        },
        critical: {
            label: t("pages.analytics.pie.critical"),
            color: "var(--color-chart-1)",
        }
    }
    const barChartConfig = {
        maintenance: {
            label: t("pages.analytics.bar.maintenance"),
            color: "var(--color-chart-1)",
        },
        error: {
            label: t("pages.analytics.bar.error"),
            color: "var(--color-chart-2)",
        },
        log: {
            label: t("pages.analytics.bar.log"),
            color: "var(--color-chart-3)",
        },
    }


    const { isRight } = useAppSide()
    const { isOwner, isAdmin } = useMe()
    const [range, setRange] = useState(DEFAULT_ANALYTICS_RANGE_DAYS)

    const { binsCount, isLoadingStatusOV, statusOVError } = useBinStatusOV()
    const { logTypes, isLoadingLogTypeOV, logTypeOVError } = useLogsTypeOV()

    const binsChartData = binsCount?.byStatus?.map((b, i) => {
        return { ...b, fill: `var(--color-chart-${i + 1})` }
    }) || []


    return (
        <AnalyticsRangeContext.Provider value={range}>
        <div className="flex flex-col gap-6">
            {/* One period for every card that covers one; the others show the fleet as it is now. */}
            <div className="grid grid-cols-2 items-center gap-3 sm:flex sm:flex-wrap sm:justify-end">
                <div className="col-span-2 flex items-center justify-between gap-3 sm:contents">
                    <span className="text-sm text-muted-foreground">{t("pages.analytics.rangeHint")}</span>
                    <ExportAnalyticsButton />
                </div>
                <RangeSelect value={range} onChange={setRange} className={isOwner ? "w-full sm:w-[160px]" : "w-full sm:w-[160px] col-span-2"} />
                {isOwner && <OrganizationSelect className="w-full sm:w-56" />}
            </div>
            <AIInsights />
            {/* Each card below makes its own request, once it scrolls into view. */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <FullSoonCard />
                <FullnessDistributionCard />
                <Card className="flex min-w-0 flex-col">
                    <CardHeader className="items-center pb-0">
                        <CardTitle>{t("pages.analytics.fleetHealthOverview.title")}</CardTitle>
                        <CardDescription>{t("pages.analytics.fleetHealthOverview.description")}</CardDescription>
                    </CardHeader>
                    <CardContent className="pb-0">
                        {isLoadingStatusOV && !statusOVError ? <Skeleton className="size-45 mx-auto rounded-full my-10" /> :
                            <ChartContainer
                                config={pieChartConfig}
                                className="mx-auto aspect-auto h-[250px]"
                            >
                                <PieChart>
                                    <ChartTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent hideLabel />}
                                    />
                                    <Pie
                                        data={binsChartData}
                                        dataKey="count"
                                        nameKey="status"
                                        innerRadius={60}
                                        strokeWidth={5}
                                    >
                                        <Label
                                            content={({ viewBox }) => {
                                                if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                                                    // Two texts, the number always left to right: as one
                                                    // right-to-left text in Hebrew, the browser split
                                                    // "5,003" around its comma and put the word between.
                                                    return (
                                                        <g>
                                                            <text
                                                                x={viewBox.cx}
                                                                y={viewBox.cy}
                                                                textAnchor="middle"
                                                                dominantBaseline="middle"
                                                                direction="ltr"
                                                                className="fill-foreground text-2xl font-bold"
                                                            >
                                                                {binsCount.total.toLocaleString()}
                                                            </text>
                                                            <text
                                                                x={viewBox.cx}
                                                                y={(viewBox.cy || 0) + 22}
                                                                textAnchor="middle"
                                                                dominantBaseline="middle"
                                                                className="fill-muted-foreground"
                                                            >
                                                                {t("bins")}
                                                            </text>
                                                        </g>
                                                    )
                                                }
                                            }}
                                        />
                                    </Pie>
                                </PieChart>
                            </ChartContainer>
                        }
                    </CardContent>
                    <CardFooter className="flex-col gap-2 text-sm">
                        <div className="text-muted-foreground leading-none">
                            {t("pages.analytics.fleetHealthOverview.footer", { count: binsCount?.total?.toLocaleString() || 0 })}
                        </div>
                    </CardFooter>
                </Card>
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <CollectionsTrendCard />
                <WasteCard />
                <WeekdaysCard />
                {/* The collection routes: across the row, for the drivers' table. */}
                <RoutesCard className="lg:col-span-2" />
                <ProblemBinsCard className="lg:col-span-2" />
                {/* The money: owners and admins, who set the costs. */}
                {isAdmin && <CostsCard className="lg:col-span-2" />}
                <BatteryOutlookCard />
                <ConnectivityCard />
                <HealthCausesCard />
                <Card>
                    <CardHeader>
                        <CardTitle>{t("pages.analytics.binsEventDistribution.title")}</CardTitle>
                        <CardDescription>{t("pages.analytics.binsEventDistribution.description")}</CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-hidden">
                        {isLoadingLogTypeOV && !logTypeOVError ?
                            <div className="flex h-[250px] w-full items-end justify-between gap-2 px-2 pt-4">
                                {Array.from({ length: 16 }).map((_, i) => (
                                    <Skeleton
                                        key={i}
                                        className="flex-1 min-w-[4px] max-w-[20px]"
                                        style={{
                                            height: `${Math.floor(Math.random() * 80) + 10}%`
                                        }}
                                    />
                                ))}
                            </div> :

                            <ChartContainer className="aspect-auto h-[250px]" config={barChartConfig}>
                                <BarChart accessibilityLayer data={logTypes}>
                                    <CartesianGrid vertical={false} />
                                    <XAxis
                                        dataKey="day"
                                        tickLine={false}
                                        tickMargin={10}
                                        axisLine={false}
                                        reversed={!isRight}
                                        tickFormatter={(value) => formatDate(value, isRight, { day: '2-digit', month: 'short' })}
                                    />
                                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                                    <ChartLegend content={<ChartLegendContent />} />
                                    <Bar
                                        dataKey="log"
                                        stackId="a"
                                        fill="var(--color-chart-1)"
                                        radius={[0, 0, 4, 4]}
                                    />
                                    <Bar
                                        dataKey="maintenance"
                                        stackId="a"
                                        fill="var(--color-chart-2)"
                                        radius={[0, 0, 0, 0]}
                                    />
                                    <Bar
                                        dataKey="error"
                                        stackId="a"
                                        fill="var(--color-chart-3)"
                                        radius={[4, 4, 0, 0]}
                                    />
                                </BarChart>
                            </ChartContainer>
                        }
                    </CardContent>

                </Card>
            </div>
        </div>
        </AnalyticsRangeContext.Provider>
    )
}

export default Analytics
