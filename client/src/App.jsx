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
import Dashboard from './pages/dashboard/Dashboard';
import Analytics from './pages/reports/Analytics';
import Firmware from './pages/firmware/Firmware';
import BinsList from './pages/bins/BinsList';
import BinMap from './pages/bins/BinMap';
import BinDetails from './pages/bins/BinDetails';
import AllLogs from './pages/binLogs/AllLogs';
import BinLog from './pages/binLogs/BinLog';
import UserProfile from './pages/users/UserProfile';
import AccountProfile from './pages/users/AccountProfile';
import UsersList from './pages/users/UsersList';
import Signup from './pages/auth/Signup';
import ForgotPassword from './pages/auth/ForgotPassword';
import SupportPage from './pages/generals/SupportPage';
import ErrorPage from './pages/generals/ErrorPage';
import { MapProvider } from './contexts/MapProvider';
import AddBin from './pages/bins/AddBin';
import { BreadcrumbProvider } from './contexts/BreadcrumbProvider';
import AccountVerify from './pages/auth/AccountVerify';
import { AppSideProvider } from './contexts/AppSideProvider';
import { OrganizationScopeProvider } from './contexts/OrganizationScopeProvider';
import Organizations from './pages/organizations/Organizations';
import OrganizationSettings from './pages/organizations/OrganizationSettings';
import RoutesList from './pages/routes/RoutesList';
import RouteDetails from './pages/routes/RouteDetails';
import RouteDrive from './pages/routes/RouteDrive';
import HomeRedirect from './components/HomeRedirect';
import { LANDING_HOST } from './utils/constants';

// The landing page is its own host (see LANDING_HOST); its code is not part of the app's.
const Landing = lazy(() => import('./pages/landing/Landing'));

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
          </BreadcrumbProvider>
        </BrowserRouter>
      </DarkModeProvider>
    </AppSideProvider>
    <Toaster richColors duration={3000} position="top-right" />
  </QueryClientProvider >

}

export default App
