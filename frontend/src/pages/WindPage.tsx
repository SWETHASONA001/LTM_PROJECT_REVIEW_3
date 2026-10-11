import clsx from 'clsx';
import { Activity, Compass, Database, LineChart as LineIcon, Sigma } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, ChartTooltip, gridProps, Legend, SERIES, TURBINE_COLORS } from '../components/charts/chartTheme';
import { SCADA_PRESETS, TimeRangeSelect } from '../components/charts/TimeRange';
import { WindRose } from '../components/charts/WindRose';
import { Select, Tabs } from '../components/ui/controls';
import { Badge, Callout, Card, CardHeader, PageHeader } from '../components/ui/primitives';
import { ProvenanceBadge } from '../components/ui/Provenance';
import { DataGate } from '../components/ui/states';
import type { ModelsReport, WindHourly, WindSummary } from '../data/types';
import { date, energy, fmt, fmtInt, pct } from '../lib/format';
import { buildRows, coverageShare, indexOf, type HourlyField } from '../lib/series';
import { useDatasets } from '../services/dataService';

type Tab = 'series' | 'curve' | 'quality' | 'prediction';

const FIELDS: { value: HourlyField; label: string; unit: string }[] = [
  { value: 'P', label: 'Active power (P_avg)', unit: 'kW' },
  { value: 'Ws', label: 'Wind speed (Ws_avg)', unit: 'm/s' },
  { value: 'Wa', label: 'Wind direction (Wa_avg)', unit: '°' },
  { value: 'Rs', label: 'Rotor speed (Rs_avg)', unit: 'rpm' },
  { value: 'Ba', label: 'Blade pitch (Ba_avg)', unit: '°' },
  { value: 'Ot', label: 'Outdoor temperature (Ot_avg)', unit: '°C' },
  { value: 'Ya', label: 'Nacelle angle (Ya_avg)', unit: '°' },
];

export default function WindPage() {
  const state = useDatasets(['wind_summary', 'wind_hourly', 'models']);
  return (
    <div>
      <PageHeader
        eyebrow="Engineering · La Haute Borne"
        title="Wind intelligence"
        description="Analysis of the real 10-minute SCADA records for turbines R80711, R80721, R80736 and R80790. Channel meanings follow the ENGIE La Haute Borne data dictionary (not included in the repository)."
        actions={<ProvenanceBadge kind="observed" detail="data/raw/wind/la-haute-borne-data-2017-2020.csv" />}
      />
      <DataGate state={state} className="h-[50vh]">
        {(d) => <WindContent summary={d.wind_summary} hourly={d.wind_hourly} models={d.models} />}
      </DataGate>
    </div>
  );
}

function WindContent({ summary, hourly, models }: { summary: WindSummary; hourly: WindHourly; models: ModelsReport }) {
  const [tab, setTab] = useState<Tab>('series');
  const [selected, setSelected] = useState<string[]>(summary.turbines);
  const [range, setRange] = useState('nov');
  const [field, setField] = useState<HourlyField>('P');

  const preset = SCADA_PRESETS.find((p) => p.value === range)!;
  const i0 = indexOf(hourly, new Date(preset.start + 'T00:00:00Z'));
  const i1 = indexOf(hourly, new Date(new Date(preset.end + 'T00:00:00Z').getTime() - 3600_000));
  const span = i1 - i0 + 1;
  const bucket = span > 24 * 100 ? 24 : span > 24 * 35 ? 6 : 1;
  const rows = useMemo(() => buildRows(hourly, selected, field, i0, i1, bucket), [hourly, selected, field, i0, i1, bucket]);
  const fieldMeta = FIELDS.find((f) => f.value === field)!;

  const totalEnergy = summary.turbineStats.reduce((a, s) => a + s.energyMWh, 0);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? (s.length > 1 ? s.filter((x) => x !== id) : s) : [...s, id].sort()));

  return (
    <div className="space-y-5">
      <Callout tone="warn" title="Record span differs from the file name">
        The file is named “2017-2020”, but the records cover {date(summary.timeRange.start)} → {date(summary.timeRange.end)} ({fmtInt(summary.rawRows)} rows, {summary.columnsInFile} columns). {fmtInt(summary.duplicateKeyRows)} rows belong to duplicate turbine/timestamp keys (first kept). Ten columns are completely empty.
      </Callout>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summary.turbineStats.map((s) => (
          <Card key={s.id} className="!p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[14px] font-semibold">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TURBINE_COLORS[s.id] }} />
                {s.id}
              </span>
              <ProvenanceBadge kind="processed" />
            </div>
            <div className="num mt-2 text-[22px] font-semibold">{energy(s.energyMWh)}</div>
            <div className="text-[12px] text-muted">observed energy over record · CF {pct(s.capacityFactor)}</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
              <div>
                <div className="text-muted">Mean P</div>
                <div className="num font-semibold">{fmt(s.meanPowerKw, 0)} kW</div>
              </div>
              <div>
                <div className="text-muted">Mean Ws</div>
                <div className="num font-semibold">{fmt(s.meanWindSpeed, 2)} m/s</div>
              </div>
              <div>
                <div className="text-muted">P ≤ 0</div>
                <div className="num font-semibold">{pct(s.zeroOrNegativePowerShare)}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'series', label: 'Time series', icon: <LineIcon size={14} /> },
            { value: 'curve', label: 'Power curve', icon: <Activity size={14} /> },
            { value: 'prediction', label: 'Prediction vs observed', icon: <Sigma size={14} /> },
            { value: 'quality', label: 'Data quality', icon: <Database size={14} /> },
          ]}
        />

        {(tab === 'series' || tab === 'quality') && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Turbine filter">
              {summary.turbines.map((id) => (
                <button
                  key={id}
                  onClick={() => toggle(id)}
                  aria-pressed={selected.includes(id)}
                  className={clsx('inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium', selected.includes(id) ? 'border-line-strong bg-surface text-ink' : 'border-line bg-subtle text-faint')}
                >
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: selected.includes(id) ? TURBINE_COLORS[id] : '#cfccc3' }} />
                  {id}
                </button>
              ))}
            </div>
            <TimeRangeSelect value={range} onChange={setRange} />
          </div>
        )}

        {tab === 'series' && (
          <div>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <Select label="Channel" value={field} onChange={setField} options={FIELDS.map((f) => ({ value: f.value, label: f.label }))} className="w-64" />
              <span className="text-[12px] text-muted">
                {bucket === 1 ? 'Hourly means' : `${bucket}-hour means`} of 10-min records · {fmtInt(rows.length)} points · gaps = missing data
              </span>
            </div>
            <div className="h-[340px]">
              <ResponsiveContainer>
                <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="t" {...axisProps} minTickGap={40} tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })} />
                  <YAxis {...axisProps} width={50} domain={field === 'Wa' || field === 'Ya' ? [0, 360] : ['auto', 'auto']} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => date(String(l), true)} valueFormatter={(v) => `${fmt(v, 1)} ${fieldMeta.unit}`} />} />
                  {selected.map((id) => (
                    <Line key={id} dataKey={id} name={id} stroke={TURBINE_COLORS[id]} strokeWidth={field === 'Wa' || field === 'Ya' ? 0 : 1.6} dot={field === 'Wa' || field === 'Ya' ? { r: 1.4, fill: TURBINE_COLORS[id], strokeWidth: 0 } : false} isAnimationActive={false} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex justify-between">
              <Legend items={selected.map((id) => ({ label: id, color: TURBINE_COLORS[id] }))} />
              <span className="text-[11.5px] text-muted">{fieldMeta.unit}</span>
            </div>
          </div>
        )}

        {tab === 'curve' && <PowerCurveView summary={summary} />}
        {tab === 'prediction' && <PredictionView models={models} />}
        {tab === 'quality' && <QualityView summary={summary} hourly={hourly} i0={i0} i1={i1} selected={selected} />}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader title="Wind rose" subtitle="All four turbines, all valid 10-min records" icon={<Compass size={16} />} actions={<ProvenanceBadge kind="processed" />} />
          <WindRose percent={summary.rose.percent} speedBins={summary.rose.speedBins} />
        </Card>
        <Card>
          <CardHeader title="Monthly observed energy" subtitle={`Sum of positive P_avg × 10 min. Total ${energy(totalEnergy)}. Months with low coverage are flagged.`} actions={<ProvenanceBadge kind="processed" />} />
          <MonthlyEnergy summary={summary} />
        </Card>
      </div>
    </div>
  );
}

function MonthlyEnergy({ summary }: { summary: WindSummary }) {
  const months = [...new Set(summary.monthly.map((m) => m.month))].sort();
  const data = months.map((m) => {
    const o: Record<string, number | string> = { month: m };
    summary.monthly.filter((x) => x.month === m).forEach((x) => (o[x.turbine] = x.energyMWh));
    o.coverage = Math.min(...summary.monthly.filter((x) => x.month === m).map((x) => x.coverage));
    return o;
  });
  return (
    <>
      <div className="h-64">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="month" {...axisProps} tickFormatter={(v: string) => new Date(v + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })} />
            <YAxis {...axisProps} width={44} />
            <Tooltip content={<ChartTooltip valueFormatter={(v) => `${fmt(v, 1)} MWh`} />} cursor={{ fill: '#0b1f330a' }} />
            {summary.turbines.map((id) => (
              <Bar key={id} dataKey={id} stackId="e" fill={TURBINE_COLORS[id]} stroke="#fff" strokeWidth={1} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Legend items={summary.turbines.map((id) => ({ label: id, color: TURBINE_COLORS[id] }))} />
        <span className="text-[11.5px] text-muted">
          Partial months: {data.filter((d) => (d.coverage as number) < 0.9).map((d) => d.month).join(', ') || 'none'} (coverage &lt; 90%)
        </span>
      </div>
    </>
  );
}

function PowerCurveView({ summary }: { summary: WindSummary }) {
  const pc = summary.powerCurve;
  const data = pc.ws.map((ws, i) => {
    const o: Record<string, number | null | number[]> = { ws, band: pc.p10[i] !== null && pc.p90[i] !== null ? [pc.p10[i]!, pc.p90[i]!] : null, median: pc.median[i], engineering: pc.engineering[i], count: pc.count[i] };
    for (const id of summary.turbines) {
      const t = pc.perTurbine[id];
      const k = t.ws.indexOf(ws);
      o[id] = k >= 0 ? t.p[k] : null;
    }
    return o;
  });
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div>
        <div className="h-[340px]">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="ws" type="number" domain={[0, 25]} {...axisProps} tickFormatter={(v: number) => `${v}`} />
              <YAxis {...axisProps} width={50} />
              <Tooltip content={<ChartTooltip labelFormatter={(l) => `${l} m/s bin`} valueFormatter={(v) => `${fmt(v, 0)} kW`} />} />
              <Area dataKey="band" name="Fleet p10–p90" fill="#2a78d6" fillOpacity={0.12} stroke="none" isAnimationActive={false} />
              {summary.turbines.map((id) => (
                <Line key={id} dataKey={id} name={id} stroke={TURBINE_COLORS[id]} strokeWidth={1.2} dot={false} strokeOpacity={0.75} isAnimationActive={false} />
              ))}
              <Line dataKey="engineering" name="Engineering curve (wake model)" stroke="#0b1f33" strokeWidth={2.2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2">
          <Legend items={[{ label: 'Fleet p10–p90', color: '#2a78d6', band: true }, ...summary.turbines.map((id) => ({ label: `${id} median`, color: TURBINE_COLORS[id] })), { label: 'Engineering curve', color: '#0b1f33' }]} />
        </div>
      </div>
      <div className="space-y-3 text-[12.5px] leading-relaxed text-ink-2">
        <div className="flex gap-1.5">
          <ProvenanceBadge kind="processed" />
        </div>
        <p>Binned statistics of P_avg against nacelle wind speed (0.5 m/s bins, all valid records, x-axis m/s, y-axis kW).</p>
        <p>
          The <strong>engineering curve</strong> feeds the wake model: {pc.engineeringMethod} Rated power {fmt(summary.ratedPowerKwObserved, 0)} kW is the 99.95th percentile of observed P_avg.
        </p>
        <p className="text-muted">The p10 band widens at mid speeds because downtime, curtailment and pitch regulation are included — records are not filtered for normal operation.</p>
      </div>
    </div>
  );
}

function PredictionView({ models }: { models: ModelsReport }) {
  const w = models.testWeek;
  const data = w.t.map((t, i) => ({ t, observed: w.observed[i], predicted: w.predicted[i], band: w.lo[i] !== null && w.hi[i] !== null ? [w.lo[i], w.hi[i]] : null }));
  const resid = models.residualByWs.ws.map((ws, i) => ({ ws, mean: models.residualByWs.mean[i], n: models.residualByWs.count[i] }));
  const m = models.models[0];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
        <ProvenanceBadge kind="predicted" />
        <span>
          {m.name} on held-out test data ({w.turbine}, 6–12 Nov 2017). Test MAE {fmt(m.metrics.mae, 1)} kW · RMSE {fmt(m.metrics.rmse, 1)} kW · R² {fmt(m.metrics.r2, 3)}. Band = empirical 5–95% interval (test coverage {pct(m.interval?.testCoverage)}).
        </span>
      </div>
      <div className="h-[300px]">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="t" {...axisProps} minTickGap={50} tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })} />
            <YAxis {...axisProps} width={50} domain={[-100, 2200]} ticks={[0, 500, 1000, 1500, 2000]} />
            <Tooltip content={<ChartTooltip labelFormatter={(l) => date(String(l), true)} valueFormatter={(v) => `${fmt(v, 0)} kW`} />} />
            <Area dataKey="band" name="90% interval" fill={SERIES[6]} fillOpacity={0.12} stroke="none" isAnimationActive={false} />
            <Line dataKey="observed" name="Observed P_avg" stroke={SERIES[0]} strokeWidth={1.6} dot={false} isAnimationActive={false} />
            <Line dataKey="predicted" name="Predicted" stroke={SERIES[6]} strokeWidth={1.6} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[{ label: 'Observed P_avg (kW)', color: SERIES[0] }, { label: 'Predicted (kW)', color: SERIES[6] }, { label: '90% interval', color: SERIES[6], band: true }]} />
      <div>
        <div className="mb-2 text-[13px] font-semibold">Mean residual (observed − predicted) by wind-speed bin, test period</div>
        <div className="h-48">
          <ResponsiveContainer>
            <BarChart data={resid} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="ws" {...axisProps} tickFormatter={(v: number) => `${v}`} />
              <YAxis {...axisProps} width={44} />
              <Tooltip content={<ChartTooltip labelFormatter={(l) => `${l}–${Number(l) + 1} m/s`} valueFormatter={(v, n) => (n === 'n' ? fmtInt(v) : `${fmt(v, 1)} kW`)} />} cursor={{ fill: '#0b1f330a' }} />
              <Bar dataKey="mean" name="Mean residual" fill={SERIES[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function QualityView({ summary, hourly, i0, i1, selected }: { summary: WindSummary; hourly: WindHourly; i0: number; i1: number; selected: string[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <div className="mb-2 text-[13px] font-semibold">Missing share by channel (whole record)</div>
        <div className="space-y-1.5">
          {summary.channels.map((c) => (
            <div key={c.key} className="grid grid-cols-[140px_1fr_52px] items-center gap-3 text-[12.5px]">
              <span className="truncate text-ink-2" title={c.label}>
                {c.key}
              </span>
              <span className="h-2 overflow-hidden rounded bg-subtle">
                <span className="block h-full rounded bg-warn" style={{ width: `${Math.max(c.missingShare * 100, 0.5)}%` }} />
              </span>
              <span className="num text-right">{pct(c.missingShare, 2)}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 text-[12.5px] text-ink-2">
          <span className="font-semibold">Empty columns: </span>
          {summary.emptyColumns.map((c) => (
            <Badge key={c} className="mb-1 mr-1">
              {c}
            </Badge>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 text-[13px] font-semibold">Record coverage in selected range</div>
        <div className="space-y-2">
          {selected.map((id) => {
            const c = coverageShare(hourly, id, i0, i1);
            return (
              <div key={id} className="grid grid-cols-[80px_1fr_52px] items-center gap-3 text-[12.5px]">
                <span className="font-medium">{id}</span>
                <span className="h-2 overflow-hidden rounded bg-subtle">
                  <span className="block h-full rounded" style={{ width: `${c * 100}%`, background: TURBINE_COLORS[id] }} />
                </span>
                <span className="num text-right">{pct(c, 1)}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[12px] text-muted">Coverage = 10-min records present ÷ expected (6 per hour). Missing hours stay as gaps in every chart; nothing is interpolated.</p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-1.5 font-medium">Turbine</th>
                <th className="py-1.5 text-right font-medium">Records</th>
                <th className="py-1.5 text-right font-medium">P missing</th>
                <th className="py-1.5 text-right font-medium">Rs missing</th>
                <th className="py-1.5 text-right font-medium">Max P</th>
              </tr>
            </thead>
            <tbody>
              {summary.turbineStats.map((s) => (
                <tr key={s.id} className="border-b border-line/60">
                  <td className="py-1.5 font-medium">{s.id}</td>
                  <td className="num py-1.5 text-right">{fmtInt(s.records)}</td>
                  <td className="num py-1.5 text-right">{pct(s.missing.P_avg, 2)}</td>
                  <td className="num py-1.5 text-right">{pct(s.missing.Rs_avg, 2)}</td>
                  <td className="num py-1.5 text-right">{fmt(s.maxPowerKw, 0)} kW</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
