import { lazy, Suspense } from 'react';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import 'leaflet/dist/leaflet.css';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom";
import AppLayout from './components/AppLayout'
import ProtectedRoute from './components/ProtectedRoute'
import { DarkModeProvider } from './contexts/DarkModeProvider';
import { Toaster } from './components/ui/sonner';
import Login from '../src/pages/auth/Login'
import ErrorPage from './pages/generals/ErrorPage';
import { MapProvider } from './contexts/MapProvider';
import { BreadcrumbProvider } from './contexts/BreadcrumbProvider';
import { AppSideProvider } from './contexts/AppSideProvider';
import { OrganizationScopeProvider } from './contexts/OrganizationScopeProvider';
import HomeRedirect from './components/HomeRedirect';
import PageLoading from './components/PageLoading';
import { PageErrorBoundary } from './components/AppErrorBoundary';
import { reloadForNewVersion } from './utils/newVersion';
import { LANDING_HOST } from './utils/constants';

// A page's code, loaded when it is first opened. A tab from before a deploy
// asks for the old file, which is gone: it reloads into the new version (and
// waits meanwhile, so the spinner stays) instead of failing.
function lazyPage(load) {
  return lazy(() => load().catch(error => {
    if (reloadForNewVersion()) return new Promise(() => { });
    throw error;
  }));
}

// The landing page is its own host (see LANDING_HOST); its code is not part of the app's.
const Landing = lazyPage(() => import('./pages/landing/Landing'));

// Each page's code loads when it is first opened (the map, the charts and the
// route planner are most of the app), so the login page and the first page
// come up without the rest. AppLayout shows a spinner in the page's place.
const Dashboard = lazyPage(() => import('./pages/dashboard/Dashboard'));
const Analytics = lazyPage(() => import('./pages/reports/Analytics'));
const Firmware = lazyPage(() => import('./pages/firmware/Firmware'));
const BinsList = lazyPage(() => import('./pages/bins/BinsList'));
const BinMap = lazyPage(() => import('./pages/bins/BinMap'));
const BinDetails = lazyPage(() => import('./pages/bins/BinDetails'));
const AllLogs = lazyPage(() => import('./pages/binLogs/AllLogs'));
const BinLog = lazyPage(() => import('./pages/binLogs/BinLog'));
const UserProfile = lazyPage(() => import('./pages/users/UserProfile'));
const AccountProfile = lazyPage(() => import('./pages/users/AccountProfile'));
const UsersList = lazyPage(() => import('./pages/users/UsersList'));
const Signup = lazyPage(() => import('./pages/auth/Signup'));
const ForgotPassword = lazyPage(() => import('./pages/auth/ForgotPassword'));
const SupportPage = lazyPage(() => import('./pages/generals/SupportPage'));
const AddBin = lazyPage(() => import('./pages/bins/AddBin'));
const AccountVerify = lazyPage(() => import('./pages/auth/AccountVerify'));
const Organizations = lazyPage(() => import('./pages/organizations/Organizations'));
const OrganizationSettings = lazyPage(() => import('./pages/organizations/OrganizationSettings'));
const RoutesList = lazyPage(() => import('./pages/routes/RoutesList'));
const RouteDetails = lazyPage(() => import('./pages/routes/RouteDetails'));
const RouteDrive = lazyPage(() => import('./pages/routes/RouteDrive'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 0 } },
});

function LandingSite() {
  return <AppSideProvider>
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="*" element={<Landing />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </AppSideProvider>
}

function App() {
  if (window.location.hostname === LANDING_HOST) return <LandingSite />

  return <QueryClientProvider client={queryClient}>
    <AppSideProvider>
      <ReactQueryDevtools buttonPosition='bottom-left' initialIsOpen={false} />
      <DarkModeProvider>
        <BrowserRouter>
          <BreadcrumbProvider>
            <PageErrorBoundary>
            <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route
                element={
                  <ProtectedRoute>
                    <MapProvider>
                      <OrganizationScopeProvider>
                        <AppLayout />
                      </OrganizationScopeProvider>
                    </MapProvider>
                  </ProtectedRoute>
                }
              >
                <Route index element={<HomeRedirect />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="firmware" element={<ProtectedRoute roles={['admin', 'owner']}><Firmware /></ProtectedRoute>} />

                <Route path='bins'>
                  <Route path="" element={<BinsList />} />
                  <Route path="map" element={<BinMap />} />
                  <Route path="add" element={<AddBin />} />
                  <Route path=":id" element={<BinDetails />} />
                  <Route path='logs'>
                    <Route path="" element={<AllLogs />} />
                    <Route path=":id" element={<BinLog />} />
                  </Route>
                </Route>


                <Route path='users' element={
                  <ProtectedRoute roles={['admin', 'owner']}>
                    <Outlet />
                  </ProtectedRoute>
                }>
                  <Route path='' element={<UsersList />} />
                  <Route path=':id' element={<UserProfile />} />
                </Route>
                <Route path="account">
                  <Route path="" element={<AccountProfile />} />
                </Route>
                <Route path="routes" element={<ProtectedRoute roles={['admin', 'owner', 'driver']}>
                  <Outlet />
                </ProtectedRoute>}>
                  <Route path='' element={<RoutesList />} />
                  <Route path=':id' element={<RouteDetails />} />
                  <Route path=':id/drive' element={<RouteDrive />} />
                </Route>
                <Route path="organizations" element={<ProtectedRoute roles={['admin', 'owner']}>
                  <Outlet />
                </ProtectedRoute>}>
                  <Route path='' element={<Organizations />} />
                  <Route path=':id/settings' element={<OrganizationSettings />} />
                </Route>


              </Route>
              <Route path="login" element={<Login />} />
              <Route path="signup" element={<Signup />} />
              <Route path="forgot-password" element={<ForgotPassword />} />
              <Route path="/user">
                <Route path="verify" element={<AccountVerify />} />
              </Route>
              <Route path="support" element={<SupportPage />} />
              <Route path="*" element={<ErrorPage />} />
            </Routes>
            </Suspense>
            </PageErrorBoundary>
          </BreadcrumbProvider>
        </BrowserRouter>
      </DarkModeProvider>
    </AppSideProvider>
    <Toaster richColors duration={3000} position="top-right" />
  </QueryClientProvider >

}

export default App
