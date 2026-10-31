import { format } from "date-fns";
import DataTable from "../../components/DataTable"
import { Link, useSearchParams } from "react-router-dom";
import HealthBadge from "@/components/bins/HealthBadge";
import Battery from "../../components/bins/Battary";
import { LinkIcon, MapPin, Trash } from "lucide-react";
import { isGateway } from "@/utils/binHelpers";
import { getDeviceRole } from "@/utils/deviceRoles";
import DeviceRoleBadge from "@/components/bins/DeviceRoleBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { useBins } from "@/hooks/bins/useBins";
import { Checkbox } from "@/components/ui/checkbox";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDeleteBinBatch } from "@/hooks/bins/useDeleteAllBins";
import { useTranslation } from "react-i18next";
import { useMe } from "@/hooks/users/auth/useMe";
import { toLatLng } from "@/utils/geo";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import OrganizationSelect from "@/components/OrganizationSelect";
import { useSelectedOrg } from "@/hooks/organizations/useSelectedOrg";

function BinsList() {
    const { t } = useTranslation();
    const { isAdmin } = useMe();
    const { selectedOrgId } = useSelectedOrg();
    const [searchParams, setSearchParams] = useSearchParams();

    const pageFromUrl = parseInt(searchParams.get("page")) || 1;
    const [pagination, setPagination] = useState({ pageIndex: pageFromUrl - 1, pageSize: 10 });
    const [searchTerm, setSearchTerm] = useState("");
    const [sort, setSort] = useState(null);

    // Another organization's list starts again at page 1.
    const [shownOrgId, setShownOrgId] = useState(selectedOrgId);
    if (shownOrgId !== selectedOrgId) {
        setShownOrgId(selectedOrgId);
        setPagination(prev => ({ ...prev, pageIndex: 0 }));
    }

    const { allBins, totalBins, isLoadingBins, binsError } = useBins(pagination.pageIndex + 1,
        pagination.pageSize,
        searchTerm, { sort, org: selectedOrgId ?? undefined });

    const { deleteBins, isDeleting } = useDeleteBinBatch()
    const [binIds, setBinIds] = useState([]);

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

    const pageCount = useMemo(() => {
        return totalBins ? Math.ceil(totalBins / pagination.pageSize) : 0;
    }, [totalBins, pagination.pageSize]);

    const toggleOne = (id, checked) => {
        setBinIds(prev =>
            checked ? [...prev, id] : prev.filter(x => x !== id)
        );
    };

    const toggleAll = (rows, checked) => {
        if (checked) {
            setBinIds(rows.map(r => r._id));
        } else {
            setBinIds([]);
        }
    };


    const columns = [
        {
            header: t('pages.binsList.columns.binName'),
            accessorKey: 'binName',
            id: 'Bin name',
            cell: ({ row }) => {
                const id = row.original._id;

                return (
                    <div className="flex gap-2 items-center">
                        <Link className="flex gap-2 items-center"
                            to={`/bins/${id}`}>
                            <LinkIcon size={14} /> <span>{row.original.binName}</span>
                        </Link>
                    </div>
                );
            },
        },
        {
            header: t('pages.binsList.columns.type'),
            id: 'type',
            accessorFn: (bin) => t(`deviceRoles.${getDeviceRole(bin)}`),
            cell: ({ row }) => <DeviceRoleBadge bin={row.original} />,
        },
        {
            header: t('pages.binsList.columns.location'),
            accessorKey: 'Location',
            cell: ({ row }) => {
                const coords = row.original.location.coordinates;
                const id = row.original._id;
                return (
                    <Link
                        to={`/bins/map?binId=${id}&zoom=18`}
                    >
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex flex-row gap-2 text-primary">
                                    <MapPin size={18} />
                                    <span>{toLatLng(coords).join(", ")}</span>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                {t('pages.binsList.locateBin')}
                            </TooltipContent>
                        </Tooltip>
                    </Link>
                )
            }
        },
        {
            header: t('pages.binsList.columns.fillLevel'),
            id: 'Fill level',
            accessorKey: 'status.level',
            meta: { sortKey: 'level' },
            enableSorting: true,
            cell: ({ row }) => {
                if (isGateway(row.original)) return '-';
                return row.original.status.levelValid === false
                    ? t('sensorUnavailable')
                    : `${row.original.status.level}%`;
            }
        },
        {
            header: t('components.logCard.weight'),
            accessorKey: 'Weight',
            meta: { sortKey: 'weight' },
            enableSorting: true,
            cell: ({ row }) => {
                const weight = row.original.status?.weight;
                return !isGateway(row.original) && typeof weight === 'number' ? `${weight}` : '-';
            },
        },
        {
            header: t('pages.binsList.columns.healthStatus'),
            accessorKey: 'Health',
            meta: { sortKey: 'health' },
            enableSorting: true,
            cell: ({ row }) => {
                return (
                    <HealthBadge
                        health={row.original.status.health}
                        faults={row.original.status.faults}
                        message={row.original.status.healthMessage}
                    />
                );
            },
        },
        {
            header: t('pages.binsList.columns.batteryLevel'),
            accessorKey: 'Battery',
            meta: { sortKey: 'battery' },
            enableSorting: true,
            cell: ({ row }) => {
                return <Battery level={row.original.status.battery} ownerId={row.original.ownerId} />
            }
        },
        {
            header: t('pages.binsList.columns.lastMaintenance'),
            accessorKey: 'Last maintenance',
            cell: ({ row }) => {
                return format(new Date(row.original.maintenance.lastServiceAt), 'yyyy-MM-dd HH:mm')
            },
        },
    ]

    if (isAdmin) {
        columns.unshift({
            header: ({ table }) => {
                const rows = table.options.data;
                const allIds = rows.map(r => r._id);
                const allChecked = binIds.length === allIds.length && allIds.length > 0;
                const someChecked = binIds.length > 0 && binIds.length < allIds.length;

                return (
                    <Checkbox
                        checked={allChecked}
                        indeterminate={someChecked ? true : undefined}
                        onCheckedChange={(checked) => toggleAll(rows, !!checked)}
                    />
                );
            },
            size: 20,
            id: "Checkboxs",
            enableSorting: false,
            cell: ({ row }) => {
                const id = row.original._id;
                const isChecked = binIds.includes(id);

                return (
                    <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) => toggleOne(id, !!checked)}
                    />
                );
            }
        })
    }

    function ActionButton() {
        return <ConfirmDeleteDialog
            trigger={
                <Button variant='destructive' className={'cursor-pointer'}>
                    <Trash />
                    <div className="flex gap-1">
                        <span className="hidden sm:block">{t("delete")}</span>
                        <span>{binIds.length}</span>
                        <span className="hidden sm:block">{t("bins")}</span>
                    </div>
                </Button>
            }
            title={t("pages.binsList.deletion.confirmationTitle")}
            description={t("pages.binsList.deletion.confirmationDescription")}
            inputLabel={t("pages.binsList.deletion.typeDelete")}
            isDeleting={isDeleting}
            onConfirm={() => deleteBins({ binIds }, { onSuccess: () => setBinIds([]) })}
        />
    }


    return (
        <div className="flex flex-col gap-4 sm:p-10">
            <OrganizationSelect />
            <DataTable columns={columns} data={allBins ?? []} isLoading={isLoadingBins} error={binsError} title={t('pages.binsList.title')} manualPagination={true} manualFiltering={true} pageCount={pageCount} pagination={pagination} onPaginationChange={setPagination}
                onSearchChange={handleSearchChange} manualSorting={true} onSortChange={handleSortChange} ActionButton={allBins?.length && binIds?.length ? ActionButton : null} />
        </div>
    )
}

export default BinsList
