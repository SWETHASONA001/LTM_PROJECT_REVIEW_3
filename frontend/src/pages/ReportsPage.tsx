import { Download, FileJson, FileSpreadsheet, Printer } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, CardHeader, PageHeader } from '../components/ui/primitives';
import { ProvenanceBadge } from '../components/ui/Provenance';
import type { ProvenanceKind } from '../data/types';
import { useSiteEngineering } from '../lib/engineering';
import { date, downloadFile, energy, fmt, pct, toCsv } from '../lib/format';
import { evaluateLayout } from '../lib/scenarioMetrics';
import { solveFarm, WAKE_MODEL_LABEL } from '../physics/wake';
import { loadDataset } from '../services/dataService';
import { useScenarioStore, useUiStore } from '../store/appStores';
import { useSiteStore, type SiteId } from '../store/siteStore';

interface ExportItem {
  id: string;
  title: string;
  description: string;
  kind: ProvenanceKind;
  format: 'CSV' | 'JSON';
  run: () => Promise<void> | void;
}

export default function ReportsPage() {
  const sites = useSiteStore((s) => s.sites);
  const scenarios = useScenarioStore((s) => s.scenarios);
  const notify = useUiStore((s) => s.notify);
  const on = useSiteEngineering('onshore');
  const off = useSiteEngineering('offshore');
  const [busy, setBusy] = useState<string | null>(null);

  const layoutCsv = (site: SiteId) => {
    const st = sites[site];
    const eng = site === 'onshore' ? on.eng : off.eng;
    if (!eng) return;
    const r = solveFarm({ x: st.turbines.map((t) => t.x), y: st.turbines.map((t) => t.y), model: eng.model, windDir: st.windDir, windSpeed: st.windSpeed, ti: st.ti });
    const rows = st.turbines.map((t, i) => ({
      id: t.id,
      label: t.label,
      status: t.status,
      x_east_m: t.x,
      y_north_m: t.y,
      wind_dir_deg: st.windDir,
      wind_speed_ms: st.windSpeed,
      effective_ws_ms: r.effectiveWs[i].toFixed(3),
      modeled_power_kw: r.powerKw[i].toFixed(1),
      velocity_deficit: r.deficit[i].toFixed(4),
      provenance: 'physics-derived (' + WAKE_MODEL_LABEL + ')',
    }));
    downloadFile(`aerohydro_${site}_layout.csv`, toCsv(rows), 'text/csv');
  };

  const items: ExportItem[] = [
    { id: 'on-layout', title: 'Onshore layout + modeled turbine power', description: 'Current onshore positions with wake-model results at the planner condition.', kind: 'physics', format: 'CSV', run: () => layoutCsv('onshore') },
    { id: 'off-layout', title: 'Offshore layout + modeled turbine power', description: 'Current offshore positions (proposed assets) with wake-model results.', kind: 'simulated', format: 'CSV', run: () => layoutCsv('offshore') },
    { id: 'scenarios', title: 'Saved scenarios', description: `${scenarios.length} scenario(s) with metrics, conditions and layouts.`, kind: 'optimized', format: 'JSON', run: () => downloadFile('aerohydro_scenarios.json', JSON.stringify(scenarios, null, 2)) },
    {
      id: 'anomalies',
      title: 'Anomaly events',
      description: 'Sustained under-performance events with estimated deficits.',
      kind: 'predicted',
      format: 'CSV',
      run: async () => downloadFile('aerohydro_anomaly_events.csv', toCsv((await loadDataset('anomalies')).events as unknown as Record<string, unknown>[]), 'text/csv'),
    },
    {
      id: 'models',
      title: 'Model evaluation report',
      description: 'Split, metrics, intervals and registry status for all models.',
      kind: 'predicted',
      format: 'JSON',
      run: async () => {
        const m = await loadDataset('models');
        downloadFile('aerohydro_model_report.json', JSON.stringify({ generatedAt: m.generatedAt, split: m.split, models: m.models, notImplemented: m.notImplemented, perTurbine: m.perTurbine }, null, 2));
      },
    },
    {
      id: 'monthly',
      title: 'Monthly observed energy',
      description: 'Per-turbine monthly energy and record coverage from SCADA.',
      kind: 'processed',
      format: 'CSV',
      run: async () => downloadFile('aerohydro_monthly_energy.csv', toCsv((await loadDataset('wind_summary')).monthly as unknown as Record<string, unknown>[]), 'text/csv'),
    },
    {
      id: 'hydro',
      title: 'Hydro site summary',
      description: 'Observed current statistics and kinetic power density for 14 sites.',
      kind: 'observed',
      format: 'CSV',
      run: async () => {
        const h = await loadDataset('hydro_sites');
        downloadFile('aerohydro_hydro_sites.csv', toCsv(h.sites.map((s) => ({ code: s.code, name: s.name, lat: s.lat, lon: s.lon, start: s.start, end: s.end, records: s.records, mean_depth_m: s.meanDepthM, mean_speed_ms: s.speed.mean, p90_speed_ms: s.speed.p90, above_cut_in_share: s.aboveCutInShare, mean_power_density_wm2: s.meanPowerDensityWm2 }))), 'text/csv');
      },
    },
  ];

  const run = async (it: ExportItem) => {
    setBusy(it.id);
    try {
      await it.run();
      notify({ title: 'Export ready', body: `${it.title} (${it.format})`, tone: 'success', href: '/reports' });
    } finally {
      setBusy(null);
    }
  };

  const onEv = on.eng ? evaluateLayout(sites.onshore.turbines, on.eng, sites.onshore) : null;
  const offEv = off.eng ? evaluateLayout(sites.offshore.turbines, off.eng, sites.offshore) : null;

  return (
    <div>
      <PageHeader
        eyebrow="Assist"
        title="Reports & exports"
        description="Download the data behind every view. Each export carries its provenance; nothing is exported as measured unless it is."
        actions={
          <Button variant="primary" icon={<Printer size={14} />} onClick={() => window.print()}>
            Print summary
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((it) => (
          <Card key={it.id} className="flex flex-col">
            <div className="mb-2 flex items-start justify-between gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-subtle text-ink-2">{it.format === 'CSV' ? <FileSpreadsheet size={17} /> : <FileJson size={17} />}</span>
              <ProvenanceBadge kind={it.kind} />
            </div>
            <h3 className="text-[14px] font-semibold">{it.title}</h3>
            <p className="mt-1 flex-1 text-[12.5px] text-muted">{it.description}</p>
            <Button className="no-print mt-3 self-start" size="sm" icon={<Download size={13} />} onClick={() => run(it)} disabled={busy === it.id || (it.id === 'scenarios' && !scenarios.length)}>
              {busy === it.id ? 'Preparing…' : `Download ${it.format}`}
            </Button>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader title="Planning summary" subtitle={`Generated ${date(new Date(), true)} · printable`} />
        <div className="grid gap-6 md:grid-cols-2">
          {([['Onshore', onEv, sites.onshore], ['Offshore', offEv, sites.offshore]] as const).map(([name, ev, st]) => (
            <div key={name}>
              <div className="mb-2 text-[13.5px] font-semibold">{name} — current layout</div>
              {ev ? (
                <dl className="space-y-1 text-[12.5px]">
                  <Row k="Turbines" v={`${ev.metrics.nTurbines} (${st.turbines.filter((t) => t.status === 'real').length} real)`} />
                  <Row k="Modeled AEP" v={energy(ev.metrics.aepMWh, 2)} />
                  <Row k="Annual wake loss" v={pct(ev.metrics.wakeLossAnnual, 2)} />
                  <Row k="Minimum spacing" v={`${fmt(ev.metrics.minSpacingM, 0)} m`} />
                  <Row k="Constraint violations" v={String(ev.metrics.violations)} />
                  <Row k="Optimized candidate" v={st.candidate ? `${energy(st.candidate.aepMWh, 2)} (opt. resource)` : 'none'} />
                </dl>
              ) : (
                <p className="text-[12.5px] text-muted">Loading…</p>
              )}
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11.5px] text-muted">All energy values are physics-derived simulations ({WAKE_MODEL_LABEL}) and not measurements. Onshore resource: La Haute Borne SCADA 2017. Offshore resource: assumed Weibull.</p>
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line/60 py-1">
      <dt className="text-muted">{k}</dt>
      <dd className="num font-medium">{v}</dd>
    </div>
  );
}
