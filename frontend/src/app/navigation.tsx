import {
  Activity,
  Bot,
  BrainCircuit,
  Database,
  FileText,
  Fuel,
  GitCompareArrows,
  LayoutDashboard,
  Map,
  Mountain,
  Ship,
  TrendingUp,
  TriangleAlert,
  Waves,
  Wind,
  Boxes,
} from 'lucide-react';
import type { ReactNode } from 'react';

export interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
  group: string;
  description: string;
  children?: { path: string; label: string; icon: ReactNode; description: string }[];
}

const I = 17;

export const NAV: NavItem[] = [
  { path: '/', label: 'Overview', icon: <LayoutDashboard size={I} />, group: 'Operations', description: 'Executive view of observed, predicted and modeled results' },
  {
    path: '/twin',
    label: 'Digital Twin',
    icon: <Boxes size={I} />,
    group: 'Operations',
    description: 'Interactive 3D onshore and offshore wind farms',
    children: [
      { path: '/twin/onshore', label: 'Onshore farm', icon: <Mountain size={15} />, description: '16 positions incl. 4 real SCADA turbines' },
      { path: '/twin/offshore', label: 'Offshore farm', icon: <Ship size={15} />, description: '16 proposed offshore positions' },
    ],
  },
  { path: '/planner', label: 'Turbine Placement Planner', icon: <Map size={I} />, group: 'Engineering', description: 'Edit layouts, compute wakes, optimize placement' },
  { path: '/wind', label: 'Wind Intelligence', icon: <Wind size={I} />, group: 'Engineering', description: 'La Haute Borne SCADA analytics' },
  { path: '/hydro', label: 'Hydro Intelligence', icon: <Waves size={I} />, group: 'Engineering', description: 'Tidal-current resource and hydrokinetic model' },
  { path: '/hydrogen', label: 'Hydrogen Optimization', icon: <Fuel size={I} />, group: 'Engineering', description: 'Renewable-to-H2 allocation with an empirical PEM model' },
  { path: '/forecasting', label: 'Energy Forecasting', icon: <TrendingUp size={I} />, group: 'Analytics', description: 'Forecast baselines and model slots' },
  { path: '/scenarios', label: 'Optimization Scenarios', icon: <GitCompareArrows size={I} />, group: 'Analytics', description: 'Saved layouts and scenario comparison' },
  { path: '/anomalies', label: 'Anomaly Detection', icon: <TriangleAlert size={I} />, group: 'Analytics', description: 'Sustained under-performance events' },
  { path: '/models', label: 'Model Performance', icon: <BrainCircuit size={I} />, group: 'Analytics', description: 'Metrics, residuals and model registry' },
  { path: '/copilot', label: 'AI Engineering Copilot', icon: <Bot size={I} />, group: 'Assist', description: 'Tool-grounded engineering assistant' },
  { path: '/reports', label: 'Reports & Exports', icon: <FileText size={I} />, group: 'Assist', description: 'Download data, layouts and reports' },
  { path: '/settings', label: 'Settings & Data Sources', icon: <Database size={I} />, group: 'Assist', description: 'Datasets, provenance, backend connection' },
];

export const ACTIVITY_ICON = <Activity size={I} />;

/** Flat list of routable pages for search and breadcrumbs. */
export const ROUTES: { path: string; label: string; parent?: string; description: string }[] = NAV.flatMap((n) =>
  n.children
    ? [{ path: n.path, label: n.label, description: n.description }, ...n.children.map((c) => ({ path: c.path, label: c.label, parent: n.label, description: c.description }))]
    : [{ path: n.path, label: n.label, description: n.description }],
);
