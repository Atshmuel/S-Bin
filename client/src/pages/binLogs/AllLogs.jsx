import DataTable from "@/components/DataTable"
import { Badge } from "@/components/ui/badge";
import HealthBadge from "@/components/bins/HealthBadge";
import Battery from "@/components/bins/Battary";
import { format } from "date-fns";
import { getVariant } from "@/utils/binHelpers";
import { Link, useSearchParams } from "react-router-dom";
import { LinkIcon, RadioTower } from "lucide-react";
import { useLogs } from "@/hooks/bins/binLogs/useBinLogs";
import OrganizationSelect from "@/components/OrganizationSelect";
import { useSelectedOrg } from "@/hooks/organizations/useSelectedOrg";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useState } from "react";

function AllLogs() {
    const { t } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams()
    const { selectedOrgId } = useSelectedOrg()

    const pageFromUrl = parseInt(searchParams.get("page")) || 1;

    const [pagination, setPagination] = useState({ pageIndex: pageFromUrl - 1, pageSize: 10 })
    const [searchTerm, setSearchTerm] = useState("");
    const [sort, setSort] = useState(null);

    // Another organization's list starts again at page 1.
    const [shownOrgId, setShownOrgId] = useState(selectedOrgId);
    if (shownOrgId !== selectedOrgId) {
        setShownOrgId(selectedOrgId);
        setPagination(prev => ({ ...prev, pageIndex: 0 }));
    }

    useEffect(() => {
        const newPage = pagination.pageIndex + 1;
        if (pageFromUrl !== newPage) {
            setSearchParams((prev) => {
                prev.set("page", newPage.toString());
                return prev;
            });
        }
    }, [pagination.pageIndex, pageFromUrl, setSearchParams]);

    const handleSearchChange = useCallback((newSearch) => {
        if (newSearch === searchTerm) return;

        setSearchTerm(newSearch);
        setPagination(prev => ({ ...prev, pageIndex: 0 }));
        setSearchParams(prev => {
            prev.set("page", "1");
            return prev;
        });
    }, [searchTerm, setSearchParams]);

    // The server sorts the whole list; a new order starts again at page 1.
    const handleSortChange = useCallback((newSort) => {
        setSort(newSort);
        setPagination(prev => ({ ...prev, pageIndex: 0 }));
    }, []);

    const { allLogs, totalLogs, isLoadingLogs, logsError } = useLogs(pagination.pageIndex + 1, pagination.pageSize, searchTerm, sort, { org: selectedOrgId ?? undefined })

    const pageCount = useMemo(() => {
        return totalLogs ? Math.ceil(totalLogs / pagination.pageSize) : 0
    }, [totalLogs, pagination.pageSize])

    const columns = [
        {
            header: t('pages.logList.columns.binName'),
            accessorKey: 'binName',
            cell: ({ row }) => (
                <div className="flex gap-2 items-center">
                    <Link className="flex gap-2 items-center"
                        to={`/bins/${row.original.binId}`}>
                        <LinkIcon size={14} /> <span>{row.original.binName}</span>
                    </Link>
                    {row.original.binKind === 'gateway' && <Badge variant="outline"><RadioTower size={12} /> {t('gateway')}</Badge>}
                </div>
            ),
        },
        {
            header: t('pages.logList.columns.createAt'),
            accessorKey: 'Created At',
            meta: { sortKey: 'createdAt' },
            cell: ({ row }) => {
                return format(new Date(row.original.createdAt), 'yyyy-MM-dd HH:mm')
            },
            enableSorting: true,
        },
        {
            header: t('pages.logList.columns.severity'),
            accessorKey: 'Severity',
            meta: { sortKey: 'severity' },
            enableSorting: true,
            cell: ({ row }) => {
                const severity = row.original.severity;
                return (
                    <Badge variant={getVariant(severity)}
                    >
                        {t(`severities.${severity.toLowerCase()}`)}
                    </Badge>
                );
            }
        },
        {
            header: t('pages.logList.columns.fillLevel'),
            id: 'Fill level',
            accessorKey: 'newLevel',
            meta: { sortKey: 'newLevel' },
            enableSorting: true,
            cell: ({ row }) => {
                if (row.original.binKind === 'gateway') return '-';
                return row.original.newLevel == null
                    ? t('sensorUnavailable')
                    : `${row.original.newLevel}%`;
            }
        },
        {
            header: t('components.logCard.weight'),
            id: 'Weight',
            accessorKey: 'weight',
            meta: { sortKey: 'weight' },
            enableSorting: true,
            cell: ({ row }) => {
                return row.original.binKind === 'gateway' ? '-' : row.original.weight ?? '-'
            }
        },
        {
            header: t('pages.logList.columns.batteryLevel'),
            accessorKey: 'Battery',
            meta: { sortKey: 'battery' },
            enableSorting: true,
            cell: ({ row }) => {
                return <Battery level={row.original.battery} ownerId={row.original.ownerId} />
            }
        },
        {
            header: t('pages.logList.columns.healthStatus'),
            id: 'Health',
            accessorKey: 'health',
            meta: { sortKey: 'health' },
            enableSorting: true,
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
            header: t('pages.logList.columns.source'),
            id: 'Source',
            accessorKey: 'source',
            cell: ({ row }) => {
                return t(`pages.logList.${row.original.source.toLowerCase()}`);
            }
        },
        {
            header: t('pages.logList.columns.viewLog'),
            id: 'View log',
            cell: ({ row }) => {
                const id = row.original._id;
                return (
                    <Link className="flex gap-2 items-center "
                        to={`/bins/logs/${id}`}
                    >
                        <LinkIcon size={14} /> <span>{t('pages.logList.columns.viewLog')}</span>
                    </Link>
                );
            },
        }
    ]
    return (
        <div className="flex flex-col gap-4">
            <OrganizationSelect />
            <DataTable columns={columns} data={allLogs ?? []} isLoading={isLoadingLogs} error={logsError} title={t('pages.logList.title')} manualPagination={true} pageCount={pageCount} pagination={pagination} onPaginationChange={setPagination} manualFiltering={true} onSearchChange={handleSearchChange} manualSorting={true} onSortChange={handleSortChange} />
        </div >
    )
}

export default AllLogs
