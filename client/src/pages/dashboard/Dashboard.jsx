import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { CircleAlert, Clock, InfoIcon, LinkIcon, PiggyBank, WifiOff, X } from "lucide-react"
import { useRef, useState } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { format } from "date-fns"
import { useTranslation } from "react-i18next"
import BinMap from "../bins/BinMap"
import DataTable from "@/components/DataTable"
import Battery from "@/components/bins/Battary"
import { getVariant, isGateway } from "@/utils/binHelpers"
import { useOverviewSection } from "@/hooks/analytics/useOverviewSection"
import { DASHBOARD_REFRESH_MS } from "@/utils/constants"
import OrganizationSelect from "@/components/OrganizationSelect"
import { useSelectedOrg } from "@/hooks/organizations/useSelectedOrg"
import { useMe } from "@/hooks/users/auth/useMe"
import { formatMoney } from "@/utils/money"

const DATE_TIME_FORMAT = "yyyy-MM-dd HH:mm"
// Reasons that call for a visit; the map shows only these bins.
// A bin marked collected that its next report still read full needs the truck back too.
const VISIT_REASONS = ["full", "contradicted", "maintenance", "offline"]
const REASON_VARIANTS = { full: "inactive", contradicted: "inactive", maintenance: "suspended", offline: "destructive", battery: "outline", health: "outline", device: "pending" }

// A count tile; each loads with its own request and waits on its own. A tile
// opens its list: `onSelect` filters the table below, `to` links elsewhere.
function Tile({ title, value, footer, icon, badgeVariant, isLoading, error, onSelect, to, selected }) {
    const Icon = icon
    const card = (
        <Card className={`h-full transition-colors hover:bg-muted/50 ${selected ? "ring-2 ring-primary" : ""}`}>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div className="flex flex-col gap-1.5">
                    <CardDescription>{title}</CardDescription>
                    <CardTitle className="text-2xl font-semibold tabular-nums">
                        {isLoading ? <Skeleton className="h-8 w-16" /> : error ? "-" : value}
                    </CardTitle>
                </div>
                <Badge variant={badgeVariant} className="p-1">
                    <Icon size={16} />
                </Badge>
            </CardHeader>
            <CardFooter className="text-sm">
                <span className="line-clamp-1 font-medium">{error ? error.message : footer}</span>
            </CardFooter>
        </Card>
    )
    return to ? (
        <Link to={to} className="min-w-72 flex-1 text-start">{card}</Link>
    ) : (
        <button type="button" onClick={onSelect} aria-pressed={selected} className="min-w-72 flex-1 cursor-pointer text-start">
            {card}
        </button>
    )
}

function TableCard({ ref, title, description, children }) {
    return (
        <Card ref={ref} className="flex min-w-0 flex-1 flex-col">
            <CardHeader>
                <CardTitle className="text-2xl font-semibold">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">{children}</CardContent>
        </Card>
    )
}

function BinLink({ id, name }) {
    return <Link className="whitespace-nowrap text-primary underline-offset-4 hover:underline" to={`/bins/${id}`}>{name ?? "-"}</Link>
}

// A reason's badge; a leaf offline because its gateway (or the leaf that relays for it) is
// names that device and links to it, the one to check first.
function ReasonBadge({ reason, offlineCause }) {
    const { t } = useTranslation()
    if (reason === "offline" && offlineCause?.cause === "gateway") {
        return (
            <Link to={`/bins/${offlineCause.gatewayId}`}>
                <Badge variant={REASON_VARIANTS.offline}>
                    {t("pages.dashboard.reasons.offlineByGateway", { name: offlineCause.gatewayName ?? "-" })}
                </Badge>
            </Link>
        )
    }
    if (reason === "offline" && offlineCause?.cause === "relay") {
        return (
            <Link to={`/bins/${offlineCause.relayId}`}>
                <Badge variant={REASON_VARIANTS.offline}>
                    {t("pages.dashboard.reasons.offlineByRelay", { name: offlineCause.relayName ?? "-" })}
                </Badge>
            </Link>
        )
    }
    return <Badge variant={REASON_VARIANTS[reason]}>{t(`pages.dashboard.reasons.${reason}`)}</Badge>
}

// An owner's view of every organization at once, one row each, those needing
// the most attention first; a name opens the dashboard of that organization.
function OrganizationsCard({ refresh }) {
    const { t } = useTranslation()
    const { setSelectedOrgId } = useSelectedOrg()
    const { data, isLoading, error } = useOverviewSection("organizations", refresh)
    const count = (key) => ({
        header: t(`pages.dashboard.tables.organizations.columns.${key}`),
        accessorKey: key,
        cell: ({ row }) => <span className="tabular-nums">{row.original[key]}</span>,
    })
    const columns = [
        {
            header: t("pages.dashboard.tables.organizations.columns.name"),
            accessorKey: "name",
            cell: ({ row }) => (
                <button type="button" className="cursor-pointer text-primary underline-offset-4 hover:underline"
                    onClick={() => setSelectedOrgId(row.original._id)}>
                    {row.original.name}
                </button>
            ),
        },
        count("bins"),
        count("gateways"),
        count("needsAttention"),
        count("offline"),
        count("almostFull"),
        {
            header: t("pages.dashboard.tables.organizations.columns.averageFullness"),
            accessorKey: "averageFullness",
            cell: ({ row }) => row.original.averageFullness === null ? "-" : `${row.original.averageFullness}%`,
        },
    ]
    return (
        <TableCard title={t("pages.dashboard.tables.organizations.title")}
            description={t("pages.dashboard.tables.organizations.description")}>
            <DataTable data={data?.organizations ?? []} columns={columns} maxLength={5} error={error} isLoading={isLoading} />
        </TableCard>
    )
}

function Dashboard() {
    const { t, i18n } = useTranslation()
    const { selectedOrgId, isOwner } = useSelectedOrg()
    const { isAdmin } = useMe()
    // The tiles, the map and the tables each make their own request, so the
    // page fills in as they arrive and a failure stays in its own card.
    const refresh = { refreshMs: DASHBOARD_REFRESH_MS }
    const summary = useOverviewSection("summary", refresh)
    const offline = useOverviewSection("offline", refresh)
    const fullSoon = useOverviewSection("full-soon", refresh)
    const attention = useOverviewSection("attention", refresh)
    const recentLogs = useOverviewSection("recent-logs", refresh)
    // The money is for owners and admins, who set the costs.
    const costs = useOverviewSection("costs", { ...refresh, range: 30, enabled: isAdmin })

    // A tile's reason filters the "Needs attention" table; again clears it.
    const [reasonFilter, setReasonFilter] = useState(null)
    const attentionRef = useRef(null)
    const selectReason = (reason) => {
        const next = reasonFilter === reason ? null : reason
        setReasonFilter(next)
        if (next) attentionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }

    const attentionDevices = attention.data?.devices ?? []
    const shownDevices = reasonFilter
        ? attentionDevices.filter((device) => device.reasons.includes(reasonFilter))
        : attentionDevices
    const mapBins = attentionDevices.filter((device) => device.reasons.some((reason) => VISIT_REASONS.includes(reason)))

    const attentionColumns = [
        {
            header: t("pages.dashboard.tables.attention.columns.bin"),
            accessorKey: "binName",
            cell: ({ row }) => <BinLink id={row.original._id} name={row.original.binName} />,
        },
        {
            header: t("pages.dashboard.tables.attention.columns.reasons"),
            id: "reasons",
            cell: ({ row }) => (
                <div className="flex gap-1 whitespace-nowrap">
                    {row.original.reasons.map((reason) => (
                        <ReasonBadge key={reason} reason={reason} offlineCause={row.original.offlineCause} />
                    ))}
                </div>
            ),
        },
        {
            header: t("pages.dashboard.tables.attention.columns.fullness"),
            accessorKey: "fullness",
            cell: ({ row }) => isGateway(row.original) || row.original.fullness === null ? "-" : `${row.original.fullness}%`,
        },
        {
            header: t("pages.dashboard.tables.attention.columns.battery"),
            id: "battery",
            cell: ({ row }) => <Battery level={row.original.status?.battery} ownerId={row.original.ownerId} />,
        },
        {
            header: t("pages.dashboard.tables.attention.columns.lastReport"),
            id: "lastReport",
            cell: ({ row }) => row.original.status?.updatedAt
                ? <span dir="ltr" className="whitespace-nowrap">{format(new Date(row.original.status.updatedAt), DATE_TIME_FORMAT)}</span>
                : "-",
        },
    ]

    const recentLogColumns = [
        {
            header: t("pages.dashboard.tables.recentLogs.columns.time"),
            accessorKey: "createdAt",
            cell: ({ row }) => <span dir="ltr" className="whitespace-nowrap">{format(new Date(row.original.createdAt), DATE_TIME_FORMAT)}</span>,
        },
        {
            header: t("pages.dashboard.tables.recentLogs.columns.bin"),
            accessorKey: "binName",
            cell: ({ row }) => <BinLink id={row.original.binId} name={row.original.binName} />,
        },
        {
            header: t("pages.dashboard.tables.recentLogs.columns.fullness"),
            accessorKey: "fullness",
            cell: ({ row }) => row.original.fullness == null ? "-" : `${row.original.fullness}%`,
        },
        {
            header: t("pages.dashboard.tables.recentLogs.columns.severity"),
            accessorKey: "severity",
            cell: ({ row }) => <Badge variant={getVariant(row.original.severity)}>{t(`severities.${row.original.severity}`)}</Badge>,
        },
        {
            header: t("pages.dashboard.tables.recentLogs.columns.type"),
            accessorKey: "type",
            cell: ({ row }) => t(`types.${row.original.type}`),
        },
        {
            header: t("pages.dashboard.tables.recentLogs.columns.viewLog"),
            accessorKey: "_id",
            cell: ({ row }) => (
                <Link className="flex items-center gap-2" to={`/bins/logs/${row.original._id}`}>
                    <LinkIcon size={14} /> <span>{t("pages.dashboard.tables.recentLogs.columns.viewLog")}</span>
                </Link>
            ),
        },
    ]

    const tiles = [
        {
            title: t("pages.dashboard.cards.offline.title"),
            value: offline.data?.count,
            footer: t("pages.dashboard.cards.offline.description", { count: offline.data?.missedReports ?? 2 }),
            icon: WifiOff,
            badgeVariant: "destructive",
            onSelect: () => selectReason("offline"),
            selected: reasonFilter === "offline",
            isLoading: offline.isLoading,
            error: offline.error,
        },
        {
            title: t("pages.dashboard.cards.fullSoon.title"),
            value: fullSoon.data?.counts?.within24h,
            footer: t("pages.dashboard.cards.fullSoon.description", { count: fullSoon.data?.counts?.within48h ?? 0 }),
            icon: Clock,
            badgeVariant: "pending",
            to: "/analytics",
            isLoading: fullSoon.isLoading,
            error: fullSoon.error,
        },
        {
            title: t("pages.dashboard.cards.almostFull.title"),
            value: summary.data?.almostFull,
            footer: summary.data?.averageFullness != null
                ? t("pages.dashboard.cards.almostFull.average", { percent: summary.data.averageFullness })
                : t("pages.dashboard.cards.almostFull.description"),
            icon: InfoIcon,
            badgeVariant: "inactive",
            onSelect: () => selectReason("full"),
            selected: reasonFilter === "full",
            isLoading: summary.isLoading,
            error: summary.error,
        },
        {
            title: t("pages.dashboard.cards.requiredMaintenance.title"),
            value: summary.data?.requiringMaintenance,
            footer: t("pages.dashboard.cards.requiredMaintenance.description"),
            icon: CircleAlert,
            badgeVariant: "suspended",
            onSelect: () => selectReason("maintenance"),
            selected: reasonFilter === "maintenance",
            isLoading: summary.isLoading,
            error: summary.error,
        },
        ...(isAdmin ? [{
            title: t("pages.dashboard.cards.saved.title"),
            value: formatMoney(costs.data?.saved?.money, i18n.language),
            footer: costs.data?.saved?.money != null
                ? t("pages.dashboard.cards.saved.net", {
                    net: formatMoney(costs.data.saved.net, i18n.language), count: costs.data.collections.avoided.toLocaleString(i18n.language),
                })
                : t("pages.dashboard.cards.saved.none"),
            icon: PiggyBank,
            badgeVariant: "active",
            to: "/analytics",
            isLoading: costs.isLoading,
            error: costs.error,
        }] : []),
    ]

    return (
        <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 className="text-xl md:text-2xl">{t("pages.dashboard.titles.quickOverview.title")}</h3>
                        <p className="text-sm text-muted-foreground">{t("pages.dashboard.titles.quickOverview.description")}</p>
                    </div>
                    <OrganizationSelect />
                </div>
                <div className="flex flex-col gap-4 lg:flex-row">
                    <div className="flex flex-wrap gap-4 lg:w-1/2">
                        {tiles.map((tile) => <Tile key={tile.title} {...tile} />)}
                    </div>
                    <div className="h-[250px] lg:h-auto lg:w-1/2">
                        {attention.isLoading
                            ? <Skeleton className="size-full min-h-[250px]" />
                            : <BinMap binsToUse={mapBins} zoom={13} legend={true} legendForm={false} />}
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-4">
                <div>
                    <h3 className="text-xl md:text-2xl">{t("pages.dashboard.titles.binOverview.title")}</h3>
                    <p className="text-sm text-muted-foreground">{t("pages.dashboard.titles.binOverview.description")}</p>
                </div>
                {isOwner && !selectedOrgId && <OrganizationsCard refresh={refresh} />}
                <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap">
                    <TableCard ref={attentionRef} title={t("pages.dashboard.tables.attention.title")}
                        description={t("pages.dashboard.tables.attention.description")}>
                        {reasonFilter && (
                            <div className="mb-3 flex items-center gap-2 text-sm">
                                <span>{t("pages.dashboard.tables.attention.filtered")}</span>
                                <Badge variant={REASON_VARIANTS[reasonFilter]}>{t(`pages.dashboard.reasons.${reasonFilter}`)}</Badge>
                                <Button type="button" variant="ghost" size="sm" onClick={() => setReasonFilter(null)}>
                                    <X data-icon="inline-start" />
                                    {t("pages.dashboard.tables.attention.showAll")}
                                </Button>
                            </div>
                        )}
                        <DataTable data={shownDevices} columns={attentionColumns} maxLength={5}
                            error={attention.error} isLoading={attention.isLoading} />
                    </TableCard>
                    <TableCard title={t("pages.dashboard.tables.recentLogs.title")} description={t("pages.dashboard.tables.recentLogs.description")}>
                        <DataTable data={recentLogs.data?.logs ?? []} columns={recentLogColumns} maxLength={5}
                            error={recentLogs.error} isLoading={recentLogs.isLoading} />
                    </TableCard>
                </div>
            </div>
        </div>
    )
}

export default Dashboard
