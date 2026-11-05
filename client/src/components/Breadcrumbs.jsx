
import { NavLink } from "react-router-dom";
import { Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "./ui/breadcrumb";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import React from "react";
import { useBreadcrumbs } from "@/hooks/useBreadcrumbs";
import { useAppSide } from "@/hooks/useAppSide";

export function Breakcrumbs() {
    const { crumbs } = useBreadcrumbs();
    const { isRight } = useAppSide()

    if (crumbs.length > 4) {
        const firstCrumb = crumbs[0];
        const lastCrumb = crumbs[crumbs.length - 1];
        const penultimateCrumb = crumbs[crumbs.length - 2];
        const middleCrumbs = crumbs.slice(1, crumbs.length - 2);

        return <Breadcrumb>
            <BreadcrumbList>
                <BreadcrumbItem key={0} className={"hidden md:block"}>
                    <BreadcrumbLink asChild={true}>
                        <NavLink className={'capitalize'} to={firstCrumb.path || ''}>{firstCrumb.label}</NavLink>
                    </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator isRight={isRight} className="hidden md:block" />
                <BreadcrumbItem className={"hidden md:flex"}>
                    <DropdownMenu>
                        <DropdownMenuTrigger className="flex items-center gap-1">
                            <BreadcrumbEllipsis className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            {
                                middleCrumbs.map((crumb, index) => (
                                    <NavLink key={index} className={'capitalize'} to={crumb.path || ''}>
                                        <DropdownMenuItem >
                                            {crumb.label}
                                        </DropdownMenuItem>
                                    </NavLink>
                                ))
                            }
                        </DropdownMenuContent>
                    </DropdownMenu>
                </BreadcrumbItem>
                <BreadcrumbSeparator isRight={isRight} className="hidden md:block" />
                <BreadcrumbItem key={crumbs.length - 1}>
                    <BreadcrumbLink asChild={true}>
                        <NavLink className={'capitalize'} to={penultimateCrumb.path || ''}>{penultimateCrumb.label}</NavLink>
                    </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator isRight={isRight} />
                <BreadcrumbItem key={crumbs.length} className={"flex"}>
                    <BreadcrumbPage >
                        <NavLink className={'capitalize'} to={lastCrumb.path || ''}>{lastCrumb.label}</NavLink>
                    </BreadcrumbPage>
                </BreadcrumbItem>
            </BreadcrumbList>
        </Breadcrumb>
    }



    return <Breadcrumb>
        <BreadcrumbList>
            {
                crumbs.map((crumb, index) => (
                    <React.Fragment key={index}>
                        <BreadcrumbItem className={index >= crumbs.length - 2 ? "flex" : "hidden md:flex"}>
                            <BreadcrumbLink asChild={true}>
                                {index === crumbs.length - 1 ?
                                    <BreadcrumbPage className={'capitalize'}>{crumb.label}</BreadcrumbPage> :
                                    <NavLink className={'capitalize'} to={crumb.path || ''}>{crumb.label}</NavLink>
                                }
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        {index < crumbs.length - 1 && <BreadcrumbSeparator isRight={isRight} className={index >= crumbs.length - 2 ? "" : "hidden md:block"} />}
                    </React.Fragment>
                ))
            }

        </BreadcrumbList>
    </Breadcrumb>

}