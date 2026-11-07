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
import { LANDING_HOST } from './utils/constants';

// The landing page is its own host (see LANDING_HOST); its code is not part of the app's.
const Landing = lazy(() => import('./pages/landing/Landing'));

// Each page's code loads when it is first opened (the map, the charts and the
// route planner are most of the app), so the login page and the first page
// come up without the rest. AppLayout shows a spinner in the page's place.
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'));
const Analytics = lazy(() => import('./pages/reports/Analytics'));
const Firmware = lazy(() => import('./pages/firmware/Firmware'));
const BinsList = lazy(() => import('./pages/bins/BinsList'));
const BinMap = lazy(() => import('./pages/bins/BinMap'));
const BinDetails = lazy(() => import('./pages/bins/BinDetails'));
const AllLogs = lazy(() => import('./pages/binLogs/AllLogs'));
const BinLog = lazy(() => import('./pages/binLogs/BinLog'));
const UserProfile = lazy(() => import('./pages/users/UserProfile'));
const AccountProfile = lazy(() => import('./pages/users/AccountProfile'));
const UsersList = lazy(() => import('./pages/users/UsersList'));
const Signup = lazy(() => import('./pages/auth/Signup'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const SupportPage = lazy(() => import('./pages/generals/SupportPage'));
const AddBin = lazy(() => import('./pages/bins/AddBin'));
const AccountVerify = lazy(() => import('./pages/auth/AccountVerify'));
const Organizations = lazy(() => import('./pages/organizations/Organizations'));
const OrganizationSettings = lazy(() => import('./pages/organizations/OrganizationSettings'));
const RoutesList = lazy(() => import('./pages/routes/RoutesList'));
const RouteDetails = lazy(() => import('./pages/routes/RouteDetails'));
const RouteDrive = lazy(() => import('./pages/routes/RouteDrive'));

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
          </BreadcrumbProvider>
        </BrowserRouter>
      </DarkModeProvider>
    </AppSideProvider>
    <Toaster richColors duration={3000} position="top-right" />
  </QueryClientProvider >

}

export default App
