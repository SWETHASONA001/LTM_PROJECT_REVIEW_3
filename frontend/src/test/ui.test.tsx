import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NAV, ROUTES } from '../app/navigation';
import { Sidebar } from '../components/shell/Sidebar';
import { KpiCard } from '../components/ui/Kpi';
import { ProvenanceBadge } from '../components/ui/Provenance';

describe('navigation', () => {
  it('defines all 13 primary sections', () => {
    expect(NAV.map((n) => n.label)).toEqual([
      'Overview',
      'Digital Twin',
      'Turbine Placement Planner',
      'Wind Intelligence',
      'Hydro Intelligence',
      'Hydrogen Optimization',
      'Energy Forecasting',
      'Optimization Scenarios',
      'Anomaly Detection',
      'Model Performance',
      'AI Engineering Copilot',
      'Reports & Exports',
      'Settings & Data Sources',
    ]);
    expect(ROUTES.some((r) => r.path === '/twin/onshore')).toBe(true);
    expect(ROUTES.some((r) => r.path === '/twin/offshore')).toBe(true);
  });

  it('renders a link for every route in the sidebar', () => {
    render(
      <MemoryRouter initialEntries={['/wind']}>
        <Sidebar />
      </MemoryRouter>,
    );
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    for (const r of ROUTES.filter((x) => x.path !== '/twin')) expect(hrefs).toContain(r.path);
  });
});

describe('provenance UI', () => {
  it('labels KPIs with provenance and shows unavailable state instead of a number', () => {
    render(<KpiCard label="Optimized vs baseline" value="+3%" provenance="optimized" definition="d" source="s" unavailable="No candidate yet" />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('+3%')).not.toBeInTheDocument();
    expect(screen.getByText('Optimized')).toBeInTheDocument();
  });

  it('renders each provenance kind label', () => {
    render(<ProvenanceBadge kind="simulated" />);
    expect(screen.getByText('Simulated')).toBeInTheDocument();
  });
});

vi.mock('../services/dataService', () => ({
  loadDataset: async (name: string) => {
    if (name === 'anomalies')
      return {
        provenance: { kind: 'predicted', method: 'm' },
        flaggedRecordShare: 0.01,
        events: [{ turbine: 'R80711', start: '2017-11-02T00:00:00+00:00', end: '2017-11-02T06:00:00+00:00', durationH: 6, meanWs: 9, meanPowerKw: 5, expectedPowerKw: 1100, deficitMWh: 6.5, meanPitch: 88, severity: 'high' }],
      };
    if (name === 'models')
      return {
        models: [{ name: 'Fleet empirical power curve', metrics: { mae: 51, rmse: 123, r2: 0.947, bias: -5, n: 100 }, interval: { testCoverage: 0.94 }, description: 'd' }],
        curve: { ws: [0, 5, 10, 15], mean: [0, 200, 1400, 2000], q05: [0, 100, 1000, 1900], q95: [0, 300, 1700, 2050] },
      };
    if (name === 'ml_models') return {};
    throw new Error(`unexpected dataset ${name}`);
  },
  useDataset: () => ({ loading: true, reload: () => undefined }),
  useDatasets: () => ({ loading: true, reload: () => undefined }),
}));

describe('copilot local tools', () => {
  it('answers from anomaly data and keeps the turbine in context', async () => {
    const { localAnswer } = await import('../lib/copilotEngine');
    const a = await localAnswer('Why did turbine R80711 generate less power in November?', {});
    expect(a.mode).toBe('local-tools');
    expect(a.facts?.[0]).toContain('1 sustained under-performance event');
    expect(a.context?.turbine).toBe('R80711');
  });

  it('drafts an operator instruction that is explicitly not executed', async () => {
    const { localAnswer } = await import('../lib/copilotEngine');
    const a = await localAnswer('Prepare an operator instruction', { turbine: 'R80711' });
    expect(a.instruction?.turbine).toBe('R80711');
    expect(a.content).toMatch(/NOT been sent/);
  });

  it('states when the CNN-PINN artifact is missing instead of claiming its prediction', async () => {
    const { localAnswer } = await import('../lib/copilotEngine');
    const a = await localAnswer('What does the CNN-PINN predict at 10 m/s?', {});
    expect(a.content).toContain('CNN-PINN artifact was not found');
    expect(a.content).toContain('1,400 kW');
  });

  it('refuses to assess measurements for proposed turbines', async () => {
    const { localAnswer } = await import('../lib/copilotEngine');
    const a = await localAnswer('Why did P07 generate less power?', {});
    expect(a.content).toContain('no measurements');
  });
});
