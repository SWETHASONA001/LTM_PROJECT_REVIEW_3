import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../components/shell/AppShell';
import { RequireAuth } from '../components/shell/RequireAuth';
import { RouteError } from '../pages/RouteError';

const Overview = lazy(() => import('../pages/OverviewPage'));
const DigitalTwin = lazy(() => import('../pages/DigitalTwinPage'));
const Planner = lazy(() => import('../pages/PlannerPage'));
const Siting = lazy(() => import('../pages/SitingPage'));
const Wind = lazy(() => import('../pages/WindPage'));
const Hydro = lazy(() => import('../pages/HydroPage'));
const Hydrogen = lazy(() => import('../pages/HydrogenPage'));
const Forecasting = lazy(() => import('../pages/ForecastingPage'));
const Scenarios = lazy(() => import('../pages/ScenariosPage'));
const Anomalies = lazy(() => import('../pages/AnomaliesPage'));
const Models = lazy(() => import('../pages/ModelsPage'));
const Copilot = lazy(() => import('../pages/CopilotPage'));
const Reports = lazy(() => import('../pages/ReportsPage'));
const Settings = lazy(() => import('../pages/SettingsPage'));
const NotFound = lazy(() => import('../pages/NotFoundPage'));
const Login = lazy(() => import('../pages/LoginPage'));
const ForgotPassword = lazy(() => import('../pages/ForgotPasswordPage'));
const ResetPassword = lazy(() => import('../pages/ResetPasswordPage'));

export const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <Suspense fallback={null}>
        <Login />
      </Suspense>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/forgot-password',
    element: (
      <Suspense fallback={null}>
        <ForgotPassword />
      </Suspense>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/reset-password',
    element: (
      <Suspense fallback={null}>
        <ResetPassword />
      </Suspense>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'twin', element: <Navigate to="/twin/onshore" replace /> },
      { path: 'twin/:site', element: <DigitalTwin /> },
      { path: 'planner', element: <Planner /> },
      { path: 'siting', element: <Siting /> },
      { path: 'wind', element: <Wind /> },
      { path: 'hydro', element: <Hydro /> },
      { path: 'hydrogen', element: <Hydrogen /> },
      { path: 'forecasting', element: <Forecasting /> },
      { path: 'scenarios', element: <Scenarios /> },
      { path: 'anomalies', element: <Anomalies /> },
      { path: 'models', element: <Models /> },
      { path: 'copilot', element: <Copilot /> },
      { path: 'reports', element: <Reports /> },
      { path: 'settings', element: <Settings /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
