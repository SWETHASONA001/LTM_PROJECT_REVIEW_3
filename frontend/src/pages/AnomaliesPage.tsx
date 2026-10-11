import clsx from 'clsx';
import { Bot, Download, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { axisProps, ChartTooltip, gridProps, Legend, SERIES, TURBINE_COLORS } from '../components/charts/chartTheme';
import { Segmented, Select } from '../components/ui/controls';
import { KpiCard } from '../components/ui/Kpi';
import { Badge, Button, Callout, Card, CardHeader, PageHeader } from '../components/ui/primitives';
import { ProvenanceBadge } from '../components/ui/Provenance';
import { DataGate, EmptyState } from '../components/ui/states';
import type { AnomalyEvent, AnomalyReport, MlReport, WindHourly } from '../data/types';
import { date, downloadFile, energy, fmt, pct, toCsv } from '../lib/format';
import { buildRows, indexOf } from '../lib/series';
import { useDatasets } from '../services/dataService';
import { useUiStore } from '../store/appStores';

export default function AnomaliesPage() {
  const state = useDatasets(['anomalies', 'wind_hourly', 'ml_models']);
  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="Anomaly detection"
        description="Sustained under-performance events in the historical SCADA record, detected against the empirical power curve. These are historical findings, not live alarms."
        actions={<ProvenanceBadge kind="predicted" detail="Residual-exceedance detector based on the trained fleet power curve." />}
      />
      <DataGate state={state} className="h-[50vh]">
        {(d) => (
          <>
            <Content report={d.anomalies} hourly={d.wind_hourly} />
            {d.ml_models.isolationForest && <IsolationForestSection f={d.ml_models.isolationForest} residual={d.anomalies.events} />}
          </>
        )}
      </DataGate>
    </div>
  );
}

/** First of each month across the SCADA record (Jan 2017 → Feb 2018). */
const MONTH_TICKS = Array.from({ length: 14 }, (_, i) => Date.UTC(2017, i, 1));

const SEV_TONE = { high: 'danger', medium: 'warn', low: 'neutral' } as const;

function Content({ report, hourly }: { report: AnomalyReport; hourly: WindHourly }) {
  const [turbine, setTurbine] = useState('all');
  const [severity, setSeverity] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [sel, setSel] = useState<AnomalyEvent | null>(report.events[0] ?? null);
  const openCopilot = useUiStore((s) => s.openCopilot);
  const events = useMemo(() => report.events.filter((e) => (turbine === 'all' || e.turbine === turbine) && (severity === 'all' || e.severity === severity)), [report, turbine, severity]);
  const turbines = [...new Set(report.events.map((e) => e.turbine))].sort();
  const totalDeficit = events.reduce((a, e) => a + e.deficitMWh, 0);
  const scatter = events.map((e) => ({ t: new Date(e.start).getTime(), deficit: e.deficitMWh, turbine: e.turbine, dur: e.durationH }));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Events detected" value={events.length} provenance="predicted" icon={<TriangleAlert size={15} />} definition="Runs of ≥3 consecutive 10-min records where P_avg is below the 5% training quantile of the fleet power curve and >100 kW below expected, with wind 4–20 m/s." source="anomalies.json (scripts/build_frontend_data.py)" sub={turbine === 'all' ? 'all turbines' : turbine} />
        <KpiCard label="Estimated energy deficit" value={energy(totalDeficit)} provenance="predicted" definition="Σ(expected − observed) energy during flagged records. Expected = fleet empirical power curve at observed wind speed." source="Observed SCADA + trained power-curve model" />
        <KpiCard label="Flagged record share" value={pct(report.flaggedRecordShare, 2)} provenance="predicted" definition="Share of all valid 10-min records that met the residual-exceedance condition (before the 30-minute persistence filter)." source="anomalies.json" />
        <KpiCard label="High-severity events" value={events.filter((e) => e.severity === 'high').length} provenance="predicted" definition="Events lasting ≥6 hours." source="anomalies.json" />
      </div>

      <Callout tone="neutral" title="Method and limits">
        {report.provenance.method} A multivariate Isolation Forest is compared further down. Causes are not labelled in the data: high blade pitch during an event suggests curtailment or a stop, but this is an inference, not a recorded status.
      </Callout>

      <Card>
        <CardHeader
          title="Event timeline"
          subtitle="Each dot is an event; vertical position = estimated energy deficit (MWh)"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={turbine} onChange={setTurbine} options={[{ value: 'all', label: 'All turbines' }, ...turbines.map((t) => ({ value: t, label: t }))]} className="w-36" />
              <Segmented size="sm" value={severity} onChange={setSeverity} options={['all', 'high', 'medium', 'low'].map((v) => ({ value: v as typeof severity, label: v[0].toUpperCase() + v.slice(1) }))} />
            </div>
          }
        />
        <div className="h-56">
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="t" type="number" scale="time" domain={[MONTH_TICKS[0], MONTH_TICKS[MONTH_TICKS.length - 1]]} ticks={MONTH_TICKS} {...axisProps} tickFormatter={(v: number) => new Date(v).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })} />
              <YAxis dataKey="deficit" {...axisProps} width={40} />
              <ZAxis dataKey="dur" range={[30, 220]} />
              <Tooltip content={<ChartTooltip labelFormatter={() => 'Event'} />} />
              {turbines.map((t) => (
                <Scatter key={t} name={t} data={scatter.filter((s) => s.turbine === t)} fill={TURBINE_COLORS[t]} fillOpacity={0.75} isAnimationActive={false} onClick={(p: { t: number }) => setSel(events.find((e) => new Date(e.start).getTime() === p.t && e.turbine === t) ?? null)} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <Legend items={turbines.map((t) => ({ label: t, color: TURBINE_COLORS[t] }))} />
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Card padded={false}>
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <h3 className="text-[15px] font-semibold">Events ({events.length})</h3>
            <Button size="sm" icon={<Download size={13} />} onClick={() => downloadFile('aerohydro_anomaly_events.csv', toCsv(events as unknown as Record<string, unknown>[]), 'text/csv')}>
              CSV
            </Button>
          </div>
          {events.length === 0 ? (
            <EmptyState title="No events match the filters" />
          ) : (
            <div className="max-h-[440px] overflow-auto scroll-thin">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-line text-left text-muted">
                    <th className="px-5 py-1.5 font-medium">Turbine</th>
                    <th className="py-1.5 font-medium">Start (UTC)</th>
                    <th className="py-1.5 text-right font-medium">Dur.</th>
                    <th className="py-1.5 text-right font-medium">Ws</th>
                    <th className="py-1.5 text-right font-medium">Deficit</th>
                    <th className="px-5 py-1.5 text-right font-medium">Sev.</th>
                  </tr>
                </thead>
                <tbody>
                  {events.slice(0, 300).map((e) => (
                    <tr key={e.turbine + e.start} onClick={() => setSel(e)} className={clsx('cursor-pointer border-b border-line/60', sel === e ? 'bg-energy-soft' : 'hover:bg-subtle')}>
                      <td className="px-5 py-1.5 font-medium">{e.turbine}</td>
                      <td className="num py-1.5">{date(e.start, true)}</td>
                      <td className="num py-1.5 text-right">{fmt(e.durationH, 1)} h</td>
                      <td className="num py-1.5 text-right">{fmt(e.meanWs, 1)}</td>
                      <td className="num py-1.5 text-right">{fmt(e.deficitMWh, 2)} MWh</td>
                      <td className="px-5 py-1.5 text-right">
                        <Badge tone={SEV_TONE[e.severity]}>{e.severity}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {sel ? <EventDetail e={sel} hourly={hourly} onAsk={() => openCopilot(`Why did turbine ${sel.turbine} generate less power during ${date(sel.start)}?`)} /> : <Card><EmptyState title="Select an event" /></Card>}
      </div>
    </div>
  );
}

function EventDetail({ e, hourly, onAsk }: { e: AnomalyEvent; hourly: WindHourly; onAsk: () => void }) {
  const s = new Date(e.start);
  const end = new Date(e.end);
  const i0 = indexOf(hourly, new Date(s.getTime() - 24 * 3600_000));
  const i1 = indexOf(hourly, new Date(end.getTime() + 24 * 3600_000));
  const p = buildRows(hourly, [e.turbine], 'P', i0, i1, 1);
  const ws = buildRows(hourly, [e.turbine], 'Ws', i0, i1, 1);
  const ba = buildRows(hourly, [e.turbine], 'Ba', i0, i1, 1);
  const data = p.map((r, i) => ({ t: new Date(r.t as string).getTime(), P: r[e.turbine], Ws: ws[i][e.turbine], Ba: ba[i][e.turbine] }));
  return (
    <Card>
      <CardHeader
        title={`${e.turbine} · ${date(e.start, true)}`}
        subtitle={`${fmt(e.durationH, 1)} h · mean wind ${fmt(e.meanWs, 1)} m/s · observed ${fmt(e.meanPowerKw, 0)} kW vs expected ${fmt(e.expectedPowerKw, 0)} kW`}
        actions={
          <Button size="sm" variant="subtle" icon={<Bot size={13} />} onClick={onAsk}>
            Ask copilot
          </Button>
        }
      />
      <div className="h-44">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} {...axisProps} tickFormatter={(v: number) => new Date(v).toLocaleString('en-GB', { day: '2-digit', hour: '2-digit', timeZone: 'UTC' })} />
            <YAxis {...axisProps} width={44} />
            <ReferenceArea x1={s.getTime()} x2={end.getTime()} fill="#e34948" fillOpacity={0.08} />
            <Tooltip content={<ChartTooltip labelFormatter={(l) => date(new Date(Number(l)), true)} valueFormatter={(v) => `${fmt(v, 0)} kW`} />} />
            <Line dataKey="P" name="Observed P_avg" stroke={SERIES[0]} strokeWidth={1.6} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 text-[11.5px] text-muted">Active power (kW), ±24 h around the event (shaded). Hourly means.</div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <MiniSeries data={data} k="Ws" label="Wind speed (m/s)" color={SERIES[2]} s={s} end={end} />
        <MiniSeries data={data} k="Ba" label="Blade pitch (°)" color={SERIES[1]} s={s} end={end} />
      </div>
      <div className="mt-3 rounded-lg bg-subtle p-3 text-[12px] leading-relaxed text-ink-2">
        <span className="font-semibold">Interpretation (inference): </span>
        {e.meanPitch !== null && e.meanPitch > 20
          ? `Mean pitch ${fmt(e.meanPitch, 1)}° during the event — blades were largely feathered, consistent with a stop, curtailment or fault rather than an aerodynamic loss.`
          : `Mean pitch ${fmt(e.meanPitch, 1)}° — blades were not feathered; possible derating, sensor issue or wake/yaw effect. Requires event logs to confirm.`}
      </div>
    </Card>
  );
}

function MiniSeries({ data, k, label, color, s, end }: { data: Record<string, unknown>[]; k: string; label: string; color: string; s: Date; end: Date }) {
  return (
    <div>
      <div className="h-24">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
            <YAxis {...axisProps} width={30} />
            <ReferenceArea x1={s.getTime()} x2={end.getTime()} fill="#e34948" fillOpacity={0.08} />
            <Tooltip content={<ChartTooltip labelFormatter={(l) => date(new Date(Number(l)), true)} />} />
            <Line dataKey={k} name={label} stroke={color} strokeWidth={1.4} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[11.5px] text-muted">{label}</div>
    </div>
  );
}

const FEATURE_LABEL: Record<string, string> = {
  resid_norm: 'power-curve residual',
  P_norm: 'power level',
  Ba_avg: 'blade pitch',
  Ws_avg: 'wind speed',
  Rs_avg: 'rotor speed',
  gear_dT: 'gearbox temperature rise',
  Ds_avg: 'generator speed',
};

function IsolationForestSection({ f, residual }: { f: NonNullable<MlReport['isolationForest']>; residual: AnomalyEvent[] }) {
  const overlaps = (a: { turbine: string; start: string; end: string }, b: { turbine: string; start: string; end: string }) =>
    a.turbine === b.turbine && new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end);
  const confirmed = f.events.filter((e) => residual.some((r) => overlaps(e, r))).length;
  const [turbine, setTurbine] = useState('all');
  const list = f.events.filter((e) => turbine === 'all' || e.turbine === turbine);
  return (
    <Card className="mt-5" padded={false}>
      <div className="p-5 pb-3">
        <CardHeader
          title={f.name}
          subtitle={`Multivariate detector · trained ${date(f.trainedAt, true)} · ${f.artifact}`}
          actions={
            <>
              <Badge tone="energy">trained</Badge>
              <ProvenanceBadge kind="predicted" detail={f.method} />
            </>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Events (≥30 min)', String(f.eventCount)],
            ['Flagged records (all / test)', `${pct(f.flaggedRecordShare, 2)} / ${pct(f.testFlaggedShare, 2)}`],
            ['Overlap with residual detector', `${pct(confirmed / Math.max(1, f.events.length), 0)} of shown events`],
            ['Features', `${f.features.length} SCADA-derived`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-subtle px-3 py-2.5">
              <div className="text-[11.5px] text-muted">{k}</div>
              <div className="num text-[15px] font-semibold">{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
          <span className="font-semibold">Most anomalous feature per event:</span>
          {Object.entries(f.dominantFeatures).map(([k, v]) => (
            <Badge key={k}>
              {FEATURE_LABEL[k] ?? k}: {v}
            </Badge>
          ))}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Unlike the residual detector, the Isolation Forest also flags unusual operating states with normal power (e.g. pitch or temperature patterns). Events found by both detectors are the strongest candidates for investigation.
        </p>
      </div>
      <div className="flex items-center justify-between border-t border-line px-5 py-2.5">
        <span className="text-[13px] font-semibold">Longest events</span>
        <Select value={turbine} onChange={setTurbine} options={[{ value: 'all', label: 'All turbines' }, ...Object.keys(f.eventsByTurbine).map((t) => ({ value: t, label: `${t} (${f.eventsByTurbine[t]})` }))]} className="w-44" />
      </div>
      <div className="max-h-[380px] overflow-auto scroll-thin">
        <table className="w-full min-w-[720px] text-[12.5px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line text-left text-muted">
              <th className="px-5 py-1.5 font-medium">Turbine</th>
              <th className="py-1.5 font-medium">Start (UTC)</th>
              <th className="py-1.5 text-right font-medium">Dur.</th>
              <th className="py-1.5 text-right font-medium">Ws</th>
              <th className="py-1.5 text-right font-medium">P</th>
              <th className="py-1.5 text-right font-medium">Pitch</th>
              <th className="py-1.5 font-medium pl-4">Driver</th>
              <th className="px-5 py-1.5 text-right font-medium">Residual det.</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 150).map((e) => (
              <tr key={e.turbine + e.start} className="border-b border-line/60">
                <td className="px-5 py-1.5 font-medium">{e.turbine}</td>
                <td className="num py-1.5">{date(e.start, true)}</td>
                <td className="num py-1.5 text-right">{fmt(e.durationH, 1)} h</td>
                <td className="num py-1.5 text-right">{fmt(e.meanWs, 1)}</td>
                <td className="num py-1.5 text-right">{fmt(e.meanPowerKw, 0)} kW</td>
                <td className="num py-1.5 text-right">{fmt(e.meanPitch, 1)}°</td>
                <td className="py-1.5 pl-4">{FEATURE_LABEL[e.dominantFeature] ?? e.dominantFeature}</td>
                <td className="px-5 py-1.5 text-right">{residual.some((r) => overlaps(e, r)) ? <Badge tone="danger">also flagged</Badge> : <span className="text-faint">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
