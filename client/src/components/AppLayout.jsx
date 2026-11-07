import { Suspense } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import PageLoading from "./PageLoading";
import { PageErrorBoundary } from "./AppErrorBoundary";
import { useMe } from "@/hooks/users/auth/useMe";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Separator } from "@radix-ui/react-dropdown-menu";
import { Breakcrumbs } from "./Breadcrumbs";

// A driver works only with their routes (and their own account).
const DRIVER_PATHS = Object.freeze(["/routes", "/account"]);

function AppLayout() {
    const { isDriver } = useMe();
    const { pathname } = useLocation();
    const isDriverAway = isDriver && !DRIVER_PATHS.some(path => pathname.startsWith(path));

    return (
        <SidebarProvider>
            <AppSidebar />
            {/* min-w-0: a flex item is otherwise as wide as its widest content, so a wide
                table would widen the page instead of scrolling inside its own frame. */}
            <SidebarInset className="min-w-0">
                <header className="bg-background sticky top-0 flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-10 z-[9]">
                    <div className="flex items-center gap-2 px-4">
                        <SidebarTrigger className="-ml-5 mr-2" />
                        <Separator
                            orientation="vertical"
                            className="mr-2 data-[orientation=vertical]:h-4"
                        />
                        <Breakcrumbs />
                    </div>
                </header>
                <div className="flex flex-1 flex-col gap-4 p-4">
                    {/* A page's code loads when it is first opened; the sidebar stays meanwhile. */}
                    {isDriverAway ? <Navigate replace to="/routes" /> : (
                        <PageErrorBoundary>
                            <Suspense fallback={<PageLoading />}><Outlet /></Suspense>
                        </PageErrorBoundary>
                    )}
                </div>
            </SidebarInset>
        </SidebarProvider>
    )
}

export default AppLayout
