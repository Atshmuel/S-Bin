"use client"

import * as React from "react"
import {
  ChartSplineIcon,
  CpuIcon,
  LayoutDashboardIcon,
  RouteIcon,
  Trash2Icon,
  UserCircle2Icon,
} from "lucide-react"

import { NavMain } from "@/components/NavMain"
import { NavGeneral } from "@/components/NavGeneral"
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
import RemoveBin from "./bins/RemoveBin"



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

  const data = {
    listItems: [
      {
        title: t("sidebar.managment.subtitles.bins"),
        url: "/bins",
        icon: Trash2Icon,
        isActive: true,
        items: [
          {
            title: t("sidebar.managment.items.addBin"),
            url: "add",
          },
          {
            title: t("sidebar.managment.items.binList"),
            url: "",
          },
          {
            title: t("sidebar.managment.items.map"),
            url: "map",
          },
          {
            title: t("sidebar.managment.items.logs"),
            url: "logs",
          },
        ],
      },
      {
        title: t("sidebar.managment.subtitles.users"),
        url: "/users",
        icon: UserCircle2Icon,
        isAdminAndAbove: true,
        items: [
          {
            title: t("sidebar.managment.items.userList"),
            url: "",
          },
        ],
      },
      // Owners manage every organization; an admin gets their own organization's settings.
      {
        title: t(isOwner ? "sidebar.managment.subtitles.organizations" : "sidebar.managment.subtitles.organization"),
        url: "/organizations",
        icon: UserCircle2Icon,
        isAdminAndAbove: true,
        items: [
          {
            title: t(isOwner ? "sidebar.managment.items.organizationList" : "sidebar.managment.items.orgSettings"),
            url: "",
          },
        ],
      },
    ],
    general: [
      {
        name: t("sidebar.general.items.dashboard"),
        url: "/dashboard",
        icon: LayoutDashboardIcon,
      },
      {
        name: t("sidebar.general.items.analytics"),
        url: "/analytics",
        icon: ChartSplineIcon,
      },
      // Which firmware the devices run: owners and admins, who run the updates.
      {
        name: t("sidebar.general.items.firmware"),
        url: "/firmware",
        icon: CpuIcon,
        isAdminAndAbove: true,
      },
    ],
  }
  // Routes: owners and admins plan and assign them, drivers drive theirs; a
  // driver sees nothing else.
  const routesGroup = {
    title: t("sidebar.managment.subtitles.routes"),
    url: "/routes",
    icon: RouteIcon,
    isActive: true,
    items: [
      { title: t("sidebar.managment.items.routeList"), url: "" },
    ],
  }
  if (isDriver) {
    data.listItems = [routesGroup]
    data.general = []
  } else if (isAdmin) {
    data.listItems.splice(1, 0, routesGroup)
  }




  return (
    <Sidebar side={opSide} collapsible="icon" {...props}>
      <SidebarHeader>
        <AppLogo />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.listItems} />
        {data.general.length > 0 && <NavGeneral general={data.general} />}
      </SidebarContent>
      <SidebarFooter>
        {isOwner ? <RemoveBin isExpanded={isExpanded} /> : null}
        {isAdmin ? <NewEntitySheet isExpanded={isExpanded} /> : null}
        <NavAccount isRight={isRight} account={{ ...me, avater: '/avatars/shadcn.jpg' }} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
