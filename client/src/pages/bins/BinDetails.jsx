import DataTable from "@/components/DataTable"
import ExportLogsButton from "@/components/binLogs/ExportLogsButton"
import EmptyCard from "@/components/EmptyCard"
import BinDeviceDetails from "@/components/bins/BinDeviceDetails"
import BinMaintenanceDetails from "@/components/bins/BinMaintenanceDetails"
import BinActions from "@/components/bins/details/BinActions"
import BinHeader from "@/components/bins/details/BinHeader"
import BinStatTiles from "@/components/bins/details/BinStatTiles"
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import Battery from "../../components/bins/Battary"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import HealthBadge from "@/components/bins/HealthBadge"
import { format } from "date-fns"
import { getVariant, isGateway } from "@/utils/binHelpers"
import { useBin } from "@/hooks/bins/useBin"
import { useLogs } from "@/hooks/bins/binLogs/useBinLogs"
import { BIN_LOGS_PAGE_SIZE } from "@/utils/constants"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { LinkIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import BinInsights from "@/components/bins/analytics/BinInsights"
import { useAppSide } from "@/hooks/useAppSide"
import { useTranslation } from "react-i18next"
import DeviceInstructions from "@/components/bins/DeviceInstructions"
import BinDiagnostics from "@/components/bins/BinDiagnostics"
import LinkQuality from "@/components/bins/LinkQuality"
import { useMe } from "@/hooks/users/auth/useMe"
import { useIsMobile } from "@/hooks/use-mobile"
import { useRemainingHeight } from "@/hooks/useRemainingHeight"

function BinDetails() {
    const { isRight } = useAppSide()
    const { t } = useTranslation()
    const { id } = useParams()
    const navigate = useNavigate()

    const { bin, isLoadingBins, binsError } = useBin(id)
    // The bin's logs, a page at a time, sorted and searched (by fill level)
    // on the server; a new order or search starts again at page 1.
    const [logsPagination, setLogsPagination] = useState({ pageIndex: 0, pageSize: BIN_LOGS_PAGE_SIZE })
    const [logsSort, setLogsSort] = useState(null)
    const [logsSearch, setLogsSearch] = useState("")
    const handleLogsSort = useCallback((sort) => {
        setLogsSort(sort)
        setLogsPagination(prev => ({ ...prev, pageIndex: 0 }))
    }, [])
    const handleLogsSearch = useCallback((search) => {
        setLogsSearch(search)
        setLogsPagination(prev => ({ ...prev, pageIndex: 0 }))
    }, [])
    const { allLogs, totalLogs, isLoadingLogs, logsError } = useLogs(logsPagination.pageIndex + 1, logsPagination.pageSize,
        logsSearch, logsSort, { binId: id })
    const logsPageCount = totalLogs ? Math.ceil(totalLogs / logsPagination.pageSize) : 0
    const { me, isAdmin, isOwner } = useMe()
    const isUser = me?.role === 'user'
    const isMobile = useIsMobile()
    const gateway = isGateway(bin)

    const logsColumns = [
        {
            header: t("pages.binDetails.logsTable.columns.createdAt"),
            accessorKey: 'createdAt',
            meta: { sortKey: 'createdAt' },
            cell: ({ row }) => (
                <Link className="flex gap-2 items-center whitespace-nowrap" to={`/bins/logs/${row.original._id}`}>
                    <LinkIcon size={14} /> <span>{format(new Date(row.original.createdAt), 'yyyy-MM-dd HH:mm')}</span>
                </Link>
            ),
        },
        {
            header: t("pages.binDetails.logsTable.columns.severity"),
            accessorKey: 'severity',
            meta: { sortKey: 'severity' },
            cell: ({ row }) => {
                const severity = row.original.severity;
                return (
                    <Badge variant={getVariant(severity)}>
                        {t(`severities.${severity}`)}
                    </Badge>
                );
            }
        },
        {
            header: t("pages.binDetails.logsTable.columns.type"),
            accessorKey: 'type',
            cell: ({ row }) => {
                const type = row.original.type;
                return (
                    t(`types.${type}`)
                );
            }
        },

        {
            header: t("pages.binDetails.logsTable.columns.fillLevel"),
            accessorKey: 'newLevel',
            meta: { sortKey: 'newLevel' },
            cell: ({ row }) => row.original.newLevel == null
                ? t("sensorUnavailable")
                : `${row.original.newLevel}%`,
        },
        {
            header: t("components.logCard.weight"),
            accessorKey: 'weight',
            meta: { sortKey: 'weight' },
            cell: ({ row }) => {
                return row.original.weight ?? '-'
            }
        },
        {
            header: t("pages.binDetails.logsTable.columns.healthStatus"),
            accessorKey: 'health',
            meta: { sortKey: 'health' },
            cell: ({ row }) => {
                return (
                    <HealthBadge
                        health={row.original.health}
                        faults={row.original.faults}
                        message={row.original.message}
                    />
                );
            },
        },

        {
            header: t("pages.binDetails.logsTable.columns.batteryLevel"),
            accessorKey: 'battery',
            meta: { sortKey: 'battery' },
            cell: ({ row }) => {
                return <Battery level={row.original.battery} ownerId={bin?.ownerId} />
            }
        },
        {
            header: t("pages.binDetails.logsTable.columns.source"),
            accessorKey: 'source',
            cell: ({ row }) => {
                const source = row.original.source;
                return (
                    t(`sources.${source}`)
                );
            }
        }

    ].filter(column => !gateway || !['newLevel', 'weight'].includes(column.accessorKey))

    // The bins whose last report this device relayed over the mesh.
    const connectedColumns = [
        {
            header: t("pages.binDetails.connectedTable.name"),
            accessorKey: 'binName',
            cell: ({ row }) => (
                <Link className="text-primary underline-offset-4 hover:underline" to={`/bins/${row.original._id}`}>
                    {row.original.binName}
                </Link>
            ),
        },
        {
            header: t("pages.binDetails.tiles.lastReport"),
            id: 'lastReport',
            accessorFn: (leaf) => leaf.status?.updatedAt ?? '',
            cell: ({ row }) => row.original.status?.updatedAt
                ? <span dir="ltr" className="whitespace-nowrap">{format(new Date(row.original.status.updatedAt), 'yyyy-MM-dd HH:mm:ss')}</span>
                : '-',
        },
        {
            header: t("pages.binDetails.connectedTable.signal"),
            id: 'rssi',
            accessorFn: (leaf) => leaf.status?.connection?.rssi ?? null,
            cell: ({ row }) => row.original.status?.connection?.rssi != null
                ? <span className="flex items-center gap-2"><span dir="ltr">{row.original.status.connection.rssi} dBm</span> <LinkQuality rssi={row.original.status.connection.rssi} /></span>
                : '-',
        },
        {
            header: t("components.binCard.hops"),
            id: 'hops',
            accessorFn: (leaf) => leaf.status?.connection?.hops ?? null,
            cell: ({ row }) => row.original.status?.connection?.hops ?? '-',
        },
        {
            header: t("pages.binDetails.connectedTable.relay"),
            id: 'relay',
            accessorFn: (leaf) => leaf.relay?.binName ?? '',
            cell: ({ row }) => row.original.relay && row.original.relay._id !== bin?._id
                ? (
                    <Link className="text-primary underline-offset-4 hover:underline" to={`/bins/${row.original.relay._id}`}>
                        {row.original.relay.binName}
                    </Link>
                )
                : '-',
        },
    ]

    // The tab lives in the URL (?tab=…), so a refresh or a shared link opens the
    // same section; replace keeps tab changes out of the back history.
    const [searchParams, setSearchParams] = useSearchParams()
    const tab = searchParams.get("tab") ?? "logs"
    const setTab = useCallback((value) => {
        setSearchParams((params) => {
            const next = new URLSearchParams(params)
            if (value === "logs") next.delete("tab")
            else next.set("tab", value)
            return next
        }, { replace: true })
    }, [setSearchParams])
    const connectedCount = bin?.connectedLeaves?.length ?? 0
    // What the device reports first, then what can be done to it. Connected
    // bins are for gateways and bins that relay; remote commands for admins;
    // managing for everyone but regular users.
    const tabs = useMemo(() => [
        "logs",
        "insights",
        "details",
        // The device's own diagnostics: owners only (admins get conclusions later, in 2k).
        ...(isOwner ? ["diagnostics"] : []),
        ...(gateway || connectedCount > 0 ? ["connected"] : []),
        ...(isAdmin ? ["instructions"] : []),
        ...(isUser ? [] : ["actions"]),
    ], [isAdmin, isOwner, isUser, gateway, connectedCount])
    // Opening another device from its links keeps this page mounted; fall back
    // to the logs if the chosen tab does not exist for it.
    const activeTab = tabs.includes(tab) ? tab : "logs"

    // The tabs and the carousel of sections follow each other: choosing a tab
    // slides to its section, and swiping (on phones) chooses the tab.
    const [carouselApi, setCarouselApi] = useState(null)
    useEffect(() => {
        if (!carouselApi) return
        const onSelect = () => setTab(tabs[carouselApi.selectedScrollSnap()])
        carouselApi.on("select", onSelect)
        return () => {
            carouselApi.off("select", onSelect)
        }
    }, [carouselApi, tabs, setTab])
    // The sections fill what is left of the screen and scroll inside it, so the
    // page itself does not scroll (nor stretch to the tallest section).
    const [panelRef, panelHeight] = useRemainingHeight({ minViewportRatio: isMobile ? 0.85 : 0 })
    // The first move (the tab from the URL after a refresh) jumps without sliding.
    const hasPositionedRef = useRef(false)
    useEffect(() => {
        const index = tabs.indexOf(activeTab)
        if (carouselApi && carouselApi.selectedScrollSnap() !== index) {
            carouselApi.scrollTo(index, !hasPositionedRef.current)
        }
        if (carouselApi) hasPositionedRef.current = true
    }, [carouselApi, tabs, activeTab])

    return (
        // A one-column grid (minmax(0, 1fr)): the wide logs table and the tab row
        // scroll inside the page instead of widening it.
        <div className="grid grid-cols-1 gap-4">
            {isLoadingBins ? (
                <Card>
                    <CardContent className="flex justify-center py-10">
                        <Spinner className="size-12" />
                    </CardContent>
                </Card>
            ) : !bin ? (
                <Card>
                    <EmptyCard title={t("components.binCard.emptyCard")} description={binsError?.message || t("components.binCard.emptyDescription")} />
                </Card>
            ) : (
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                    <BinHeader bin={bin} className="col-span-2 lg:col-span-1" />
                    <BinStatTiles bin={bin} />
                </div>
            )}
            {bin && (
                <div className="flex flex-col gap-4">
                    <div className="overflow-x-auto">
                        {/* The page's direction already orders the tabs; isRight only keeps the
                            component from reversing them, and dir sets the arrow keys. */}
                        <ToggleGroup
                            type="single"
                            isRight
                            dir={isRight ? "ltr" : "rtl"}
                            value={activeTab}
                            onValueChange={(value) => value && setTab(value)}
                            className="w-fit justify-start rounded-lg border p-1"
                            aria-label={t("pages.binDetails.tabs.label")}
                        >
                            {tabs.map((name) => (
                                <ToggleGroupItem key={name} value={name} className="px-3">
                                    {t(`pages.binDetails.tabs.${name}`)}
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    </div>

                    {/* Swiping only on phones, so dragging never fights text selection on a
                        desktop. The carousel's own arrow keys are off: they would also catch
                        the arrows in the search box and inputs inside the sections. isRight
                        keeps the content from being reversed; the direction comes from dir.
                        The default gutter between slides stays: without it the next section
                        shows in the carousel's 4px edge. */}
                    <Carousel
                        ref={panelRef}
                        setApi={setCarouselApi}
                        allowDrag={isMobile}
                        opts={{ direction: isRight ? "ltr" : "rtl" }}
                        dir={isRight ? "ltr" : "rtl"}
                        onKeyDownCapture={() => { }}
                    >
                        <CarouselContent isRight className="items-start">
                            {tabs.map((name) => (
                                <CarouselItem key={name} inert={name !== activeTab}
                                    // Only the shown section scrolls: a neighbour's scrollbar would peek into the gutter.
                                    className={name === activeTab ? "overflow-y-auto overscroll-contain" : "overflow-hidden"}
                                    style={panelHeight ? { height: panelHeight } : undefined}>
                                    {name === "logs" && (
                                        <Card>
                                            <CardHeader>
                                                <CardTitle>{t("pages.binDetails.logsTable.title")}</CardTitle>
                                                <CardDescription>{t("pages.binDetails.logsTable.description")}</CardDescription>
                                            </CardHeader>
                                            <CardContent>
                                                <div className="mb-3 flex justify-end">
                                                    <ExportLogsButton search={logsSearch} binId={id} />
                                                </div>
                                                <DataTable columns={logsColumns} isLoading={isLoadingLogs} data={allLogs ?? []} maxLength={BIN_LOGS_PAGE_SIZE} error={logsError}
                                                    manualPagination pageCount={logsPageCount} pagination={logsPagination} onPaginationChange={setLogsPagination}
                                                    manualFiltering onSearchChange={handleLogsSearch} manualSorting onSortChange={handleLogsSort} onRowClick={(log) => navigate(`/bins/logs/${log._id}`)} />
                                            </CardContent>
                                        </Card>
                                    )}
                                    {name === "insights" && <BinInsights key={bin._id} bin={bin} active={activeTab === "insights"} />}
                                    {name === "instructions" && <DeviceInstructions key={bin._id} bin={bin} />}
                                    {name === "details" && (
                                        <div className="grid gap-4 lg:grid-cols-2">
                                            <Card>
                                                <CardHeader>
                                                    <CardTitle>{t("pages.binDetails.deviceTitle")}</CardTitle>
                                                </CardHeader>
                                                <CardContent className="flex flex-col gap-3 text-sm">
                                                    <BinDeviceDetails bin={bin} />
                                                </CardContent>
                                            </Card>
                                            <Card>
                                                <CardHeader>
                                                    <CardTitle>{t("components.binCard.maintenance.title")}</CardTitle>
                                                </CardHeader>
                                                <CardContent className="flex flex-col gap-2.5 text-sm">
                                                    {bin.maintenance
                                                        ? <BinMaintenanceDetails maintenance={bin.maintenance} />
                                                        : <p className="text-muted-foreground">{t("components.binCard.maintenance.notServedYet")}</p>}
                                                </CardContent>
                                            </Card>
                                        </div>
                                    )}
                                    {name === "connected" && (
                                        <Card>
                                            <CardHeader>
                                                <CardTitle>{t("components.binCard.connectedLeaves")}</CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                {connectedCount > 0
                                                    ? <DataTable columns={connectedColumns} isLoading={false} data={bin.connectedLeaves} maxLength={6} sortingBy={[{ id: 'lastReport', desc: true }]} />
                                                    : <p className="text-sm text-muted-foreground">{t("components.binCard.noConnectedLeaves")}</p>}
                                            </CardContent>
                                        </Card>
                                    )}
                                    {name === "diagnostics" && <BinDiagnostics bin={bin} />}
                                    {name === "actions" && <BinActions key={bin._id} bin={bin} />}
                                </CarouselItem>
                            ))}
                        </CarouselContent>
                    </Carousel>
                </div>
            )}
        </div>

    )
}

export default BinDetails
