
import {
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table"
import { useEffect, useState } from "react"

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "./ui/table"

import { Input } from "./ui/input"
import { Button } from "./ui/button"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "./ui/dropdown-menu"
import { IoIosArrowRoundDown, IoIosArrowRoundUp, IoMdArrowDropdown } from "react-icons/io";
import { Skeleton } from "./ui/skeleton"
import EmptyTable from "./EmptyTable"
import { Search, X } from "lucide-react"
import { useAppSide } from "@/hooks/useAppSide"
import { useTranslation } from "react-i18next"

export default function DataTable({ data = [], columns, title, maxLength = 10, isLoading = true, error = null, sortingBy, ActionButton = null, initialSearch = "", manualPagination = false, pageCount, pagination, onPaginationChange, manualFiltering = false, onSearchChange, manualSorting = false, onSortChange, onRowClick = null }) {
    const { t } = useTranslation()

    const { isRight } = useAppSide()
    const [sorting, setSorting] = useState(sortingBy ?? [])
    const [searching, setSearching] = useState(initialSearch)

    useEffect(() => {
        if (onSearchChange) {
            const delayDebounceFn = setTimeout(() => {
                onSearchChange(searching)
            }, 500)

            return () => clearTimeout(delayDebounceFn)
        }
    }, [searching, onSearchChange])

    useEffect(() => {
        if (initialSearch) {
            setSearching(initialSearch)
        }
    }, [initialSearch])

    const handleSortingChange = (updater) => {
        const next = typeof updater === "function" ? updater(sorting) : updater
        setSorting(next)
        if (!manualSorting || !onSortChange) return
        const [first] = next
        const sortKey = first && table.getColumn(first.id)?.columnDef.meta?.sortKey
        onSortChange(sortKey ? { sort: sortKey, order: first.desc ? "desc" : "asc" } : null)
    }

    const table = useReactTable({
        data,
        columns,
        state: {
            sorting,
            globalFilter: searching,
            ...(pagination ? { pagination } : {})
        },
        onSortingChange: handleSortingChange,
        onGlobalFilterChange: setSearching,
        ...(onPaginationChange ? { onPaginationChange } : {}),
        manualPagination: manualPagination,
        manualFiltering: manualFiltering,
        // A server-sorted table sorts the whole list, not the page shown, and
        // only by the columns that name a server sort key (meta.sortKey).
        manualSorting: manualSorting,
        ...(manualSorting ? { enableMultiSort: false, defaultColumn: { enableSorting: false } } : {}),
        pageCount: manualPagination ? pageCount : undefined,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        initialState: { pagination: { pageSize: maxLength } },
    })
    const hasData = table.getRowModel().rows.length

    const iconToShow = searching ? X : Search


    // flex-1 and the pagination's mt-auto: in a card taller than the table, the
    // pagination stays at the bottom, level with the card beside it.
    return (
        <div className="flex flex-1 flex-col gap-4">
            {/* One row only from lg, and the controls wrap: next to the sidebar a narrower
                screen has no room for the title, search and buttons side by side. */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                {title ? <h1 className="text-lg sm:text-2xl capitalize font-bold shrink-0">{title}</h1> : null}
                <div className={`flex flex-wrap items-center w-full min-w-0 gap-3 lg:w-auto ${title ? "lg:justify-end" : "justify-between"} `}>
                    <Input
                        withIcon={true}
                        Icon={iconToShow}
                        type="text"
                        placeholder={t("search") + '...'}
                        value={searching}
                        onChange={(e) => setSearching(e.target.value)}
                        onIconClick={() => {
                            if (!searching.length > 0) return;
                            setSearching("")
                        }}
                        disabled={isLoading || error}
                        className="w-40 sm:w-48 relative"
                    />
                    <div className="flex gap-1.5 ms-auto">
                        {ActionButton ? <ActionButton /> : null}

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button disabled={isLoading || error} variant="outline">
                                    <span>{t("columns")}</span>
                                    <IoMdArrowDropdown />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align={isRight ? "end" : "start"} className="max-h-60 overflow-y-auto">
                                {table
                                    .getAllLeafColumns()
                                    .map(column => (
                                        <DropdownMenuCheckboxItem
                                            isRight={isRight}
                                            key={column.id}
                                            checked={column.getIsVisible()}
                                            onCheckedChange={() => column.toggleVisibility()}
                                        >
                                            {column.id}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </div>
            <div className="relative rounded-md border">
                <Table className="relative">
                    <TableHeader className="bg-muted shadow-md text-sm sm:text-base">
                        {table.getHeaderGroups().map(headerGroup => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <TableHead
                                        key={header.id}
                                        style={{ width: header.getSize() }}
                                        onClick={hasData && header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                                        className={hasData && header.column.getCanSort() ? "cursor-pointer" : ""}
                                    >
                                        <div className="capitalize flex items-center gap-2 text-foreground">
                                            {flexRender(
                                                header.column.columnDef.header,
                                                header.getContext()
                                            )}
                                            {hasData && {
                                                asc: <IoIosArrowRoundUp />,
                                                desc: <IoIosArrowRoundDown />,
                                            }[header.column.getIsSorted()] || null}
                                        </div>
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>


                    <TableBody className="relative">
                        {hasData && !isLoading ? (
                            table.getRowModel().rows.map(row => (

                                <TableRow
                                    key={row.id}
                                    className={onRowClick ? 'h-12 cursor-pointer' : 'h-12'}
                                    onClick={onRowClick ? (event) => {
                                        // A link or button in the row does its own thing; so does a text selection.
                                        if (event.target.closest('a, button, input, select, textarea, [role="button"]')) return
                                        if (window.getSelection()?.toString()) return
                                        onRowClick(row.original)
                                    } : undefined}>
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell
                                            style={{ width: cell.column.getSize() }}
                                            key={cell.id}>
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            Array.from({ length: maxLength }).map((_, i) => (
                                <TableRow key={i} className="h-12">
                                    {columns.map((col, j) => (
                                        <TableCell key={j}>{isLoading ? <Skeleton className="h-4 w-[80%]" /> : null}</TableCell>
                                    ))}
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
                {/* Over the frame, not inside the table: a table wider than the screen
                    scrolls sideways, and the message stays centered in view. */}
                {(!hasData || error) && !isLoading ? <EmptyTable title={t("globalTable.noResults")} description={searching ? t("globalTable.noSearchResults") : t("globalTable.nothingToShow")} /> : null}
            </div>

            <div className="mt-auto flex items-center justify-between">
                <Button
                    variant="outline"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                >
                    {t("globalTable.previous")}
                </Button>
                {table.getPageCount() > 0 ?
                    <div className={`flex gap-1`}>
                        <span>{table.getState().pagination.pageIndex + 1}</span>
                        <span> {t("globalTable.tablePage")} </span>
                        <span>{table.getPageCount()}</span>
                    </div>
                    : null}

                <Button
                    variant="outline"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                >
                    {t("globalTable.next")}
                </Button>
            </div>
        </div >
    )
}
