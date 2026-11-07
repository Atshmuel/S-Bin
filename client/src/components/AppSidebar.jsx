"use client"

import * as React from "react"
import {
  Building2Icon,
  ChartSplineIcon,
  CpuIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  MapIcon,
  RouteIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react"

import { NavGroup } from "@/components/NavGroup"
import { NavAccount } from "@/components/NavAccount"
import { AppLogo } from "@/components/AppLogo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import NewEntitySheet from "./newEntityComponents/NewEntitySheet"
import { useMe } from "@/hooks/users/auth/useMe"
import { useAppSide } from "@/hooks/useAppSide"
import { useTranslation } from "react-i18next"
import { useLocation } from "react-router-dom"

// The bins list, its map and its logs share /bins; each item lights for its own pages.
const isBinsMap = (pathname) => pathname.startsWith("/bins/map")
const isBinsLogs = (pathname) => pathname.startsWith("/bins/logs")
const isBinsList = (pathname) => pathname.startsWith("/bins") && !isBinsMap(pathname) && !isBinsLogs(pathname)

export function AppSidebar({
  ...props
}) {
  const { t } = useTranslation()
  const { state, setOpenMobile } = useSidebar()
  const { pathname } = useLocation()
  const { me, isAdmin, isOwner, isDriver } = useMe()
  const { opSide, isRight } = useAppSide()

  // On a phone the sidebar is a sheet over the page; going anywhere closes it.
  React.useEffect(() => { setOpenMobile(false) }, [pathname, setOpenMobile])

  const isExpanded = state === 'expanded'
  const item = (key, url, icon, isActive) => ({ name: t(`sidebar.items.${key}`), url, icon, isActive })
  const routes = item("routes", "/routes", RouteIcon)

  // Grouped by what the page is for: the fleet at a glance, the work in the
  // field, then running the organization (owners and admins). A driver works
  // only with their routes.
  const groups = isDriver
    ? [{ key: "field", items: [routes] }]
    : [
      {
        key: "overview",
        items: [
          item("dashboard", "/dashboard", LayoutDashboardIcon),
          item("analytics", "/analytics", ChartSplineIcon),
        ],
      },
      {
        key: "field",
        items: [
          item("map", "/bins/map", MapIcon, isBinsMap),
          item("bins", "/bins", Trash2Icon, isBinsList),
          ...(isAdmin ? [routes] : []),
          item("logs", "/bins/logs", FileTextIcon, isBinsLogs),
        ],
      },
      ...(isAdmin ? [{
        key: "management",
        items: [
          item("users", "/users", UsersIcon),
          // Owners manage every organization; an admin gets their own organization's settings.
          item(isOwner ? "organizations" : "organization", "/organizations", Building2Icon),
          item("firmware", "/firmware", CpuIcon),
        ],
      }] : []),
    ]

  return (
    <Sidebar side={opSide} collapsible="icon" {...props}>
      <SidebarHeader>
        <AppLogo />
      </SidebarHeader>
      <SidebarContent>
        {groups.map(group => <NavGroup key={group.key} label={t(`sidebar.groups.${group.key}`)} items={group.items} />)}
      </SidebarContent>
      <SidebarFooter>
        {isAdmin ? <NewEntitySheet isExpanded={isExpanded} /> : null}
        <NavAccount isRight={isRight} account={{ ...me, avater: '/avatars/shadcn.jpg' }} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
