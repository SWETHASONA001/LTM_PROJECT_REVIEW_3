import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../components/shell/AppShell';
import { RouteError } from '../pages/RouteError';

const Overview = lazy(() => import('../pages/OverviewPage'));
const DigitalTwin = lazy(() => import('../pages/DigitalTwinPage'));
const Planner = lazy(() => import('../pages/PlannerPage'));
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

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'twin', element: <Navigate to="/twin/onshore" replace /> },
      { path: 'twin/:site', element: <DigitalTwin /> },
      { path: 'planner', element: <Planner /> },
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
