import { Activity, ArrowRight, BrainCircuit, CalendarClock, Fuel, Gauge, Mountain, Ship, Sparkles, TriangleAlert, Waves, Wind } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, ChartTooltip, gridProps, Legend, SERIES, TURBINE_COLORS } from '../components/charts/chartTheme';
import { SCADA_PRESETS, TimeRangeSelect } from '../components/charts/TimeRange';
import { WindRose } from '../components/charts/WindRose';
import { LayoutThumb } from '../components/planner/LayoutCanvas';
import { KpiCard } from '../components/ui/Kpi';
import { Card, CardHeader } from '../components/ui/primitives';
import { ProvenanceBadge } from '../components/ui/Provenance';
import { DataGate, Skeleton } from '../components/ui/states';
import type { AnomalyReport, ElectrolyzerReport, HydroSites, ModelsReport, WindHourly, WindSummary } from '../data/types';
import { useSiteEngineering } from '../lib/engineering';
import { date, energy, fmt, pct, signedPct } from '../lib/format';
import { evaluateLayout } from '../lib/scenarioMetrics';
import { indexOf } from '../lib/series';
import { useDatasets } from '../services/dataService';
import { useSiteStore } from '../store/siteStore';

export default function OverviewPage() {
  const state = useDatasets(['wind_summary', 'wind_hourly', 'models', 'anomalies', 'hydro_sites', 'electrolyzer']);
  return (
    <div className="space-y-6">
      <Hero />
      <DataGate state={state} className="h-[40vh]" loadingLabel="Loading project datasets…">
        {(d) => <Body summary={d.wind_summary} hourly={d.wind_hourly} models={d.models} anomalies={d.anomalies} hydro={d.hydro_sites} elec={d.electrolyzer} />}
      </DataGate>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-ink text-white shadow-[var(--shadow-raised)]">
      <HeroArt />
      <div className="relative flex flex-wrap items-end justify-between gap-5 px-6 py-6 sm:px-8">
        <div className="max-w-2xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7dd3b0]">Wake-aware renewable intelligence</div>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-tight sm:text-[28px]">Operations overview</h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/75">
            Observed SCADA, tidal-current and electrolyzer data combined with a physics wake model, layout optimizer and hydrogen dispatch — every figure labeled by provenance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/twin/onshore" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3.5 text-[13px] font-semibold text-ink hover:bg-white/90">
            Open digital twin <ArrowRight size={14} />
          </Link>
          <Link to="/planner" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/25 px-3.5 text-[13px] font-semibold text-white hover:bg-white/10">
            Plan layouts
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Decorative turbine skyline (pure SVG, no external images). */
function HeroArt() {
  const turbines = [
    [0.7, 0.95, 0.9],
    [0.77, 0.74, 0.7],
    [0.83, 0.86, 0.8],
    [0.89, 0.68, 0.6],
    [0.95, 0.8, 0.75],
  ];
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 180" preserveAspectRatio="xMaxYMax slice" aria-hidden>
      <defs>
        <linearGradient id="hg" x1="0" x2="1">
          <stop offset="0" stopColor="#0b1f33" />
          <stop offset="1" stopColor="#12395a" />
        </linearGradient>
      </defs>
      <rect width="1000" height="180" fill="url(#hg)" />
      <path d="M520 180 C600 150 700 160 780 140 C860 120 940 150 1000 135 L1000 180 Z" fill="#14476b" opacity="0.7" />
      <path d="M560 180 C640 165 760 172 840 158 C900 148 960 165 1000 160 L1000 180 Z" fill="#0f8a6a" opacity="0.35" />
      {turbines.map(([x, h, s], i) => {
        const cx = x * 1000;
        const top = 180 - h * 150;
        return (
          <g key={i} opacity={0.25 + s * 0.45}>
            <line x1={cx} y1={180} x2={cx} y2={top} stroke="#e6f0f7" strokeWidth={2.2 * s} />
            <g transform={`translate(${cx} ${top})`}>
              <g className="origin-center animate-[spin_9s_linear_infinite] motion-reduce:animate-none" style={{ transformBox: 'fill-box', animationDuration: `${7 + i}s` }}>
                {[0, 120, 240].map((a) => (
                  <path key={a} d={`M0 0 L${2.5 * s} ${-34 * s} L0 ${-38 * s} Z`} fill="#e6f0f7" transform={`rotate(${a})`} />
                ))}
              </g>
              <circle r={2.4 * s} fill="#fff" />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

function Body({ summary, hourly, models, anomalies, hydro, elec }: { summary: WindSummary; hourly: WindHourly; models: ModelsReport; anomalies: AnomalyReport; hydro: HydroSites; elec: ElectrolyzerReport }) {
  const sites = useSiteStore((s) => s.sites);
  const on = useSiteEngineering('onshore');
  const off = useSiteEngineering('offshore');
  const [range, setRange] = useState('all');

  const onEval = useMemo(() => (on.eng ? evaluateLayout(sites.onshore.turbines, on.eng, sites.onshore) : null), [on.eng, sites.onshore]);
  const onBase = useMemo(() => (on.eng ? evaluateLayout(sites.onshore.baseline, on.eng, sites.onshore) : null), [on.eng, sites.onshore]);
  const onCand = useMemo(() => (on.eng && sites.onshore.candidate ? evaluateLayout(sites.onshore.candidate.turbines, on.eng, sites.onshore) : null), [on.eng, sites.onshore]);

  const totalEnergy = summary.turbineStats.reduce((a, s) => a + s.energyMWh, 0);
  const fleetCf = summary.turbineStats.reduce((a, s) => a + s.capacityFactor, 0) / summary.turbineStats.length;
  const fleetModel = models.models[0];
  const bestHydro = [...hydro.sites].sort((a, b) => b.meanPowerDensityWm2 - a.meanPowerDensityWm2)[0];

  const preset = SCADA_PRESETS.find((p) => p.value === range)!;
  const i0 = indexOf(hourly, new Date(preset.start + 'T00:00:00Z'));
  const i1 = indexOf(hourly, new Date(new Date(preset.end + 'T00:00:00Z').getTime() - 3600_000));
  const daily = useMemo(() => {
    const rows: Record<string, number | string | null>[] = [];
    const bucket = i1 - i0 > 24 * 40 ? 24 : i1 - i0 > 24 * 8 ? 6 : 1;
    for (let b = i0; b <= i1; b += bucket) {
      const row: Record<string, number | string | null> = { t: new Date(new Date(hourly.start).getTime() + b * 3600_000).toISOString() };
      let wsum = 0;
      let wn = 0;
      for (const id of summary.turbines) {
        let e = 0;
        let n = 0;
        for (let k = b; k < Math.min(b + bucket, i1 + 1); k++) {
          const p = hourly.turbines[id].P[k];
          const w = hourly.turbines[id].Ws[k];
          if (p !== null) {
            e += Math.max(0, p);
            n++;
          }
          if (w !== null) {
            wsum += w;
            wn++;
          }
        }
        row[id] = n ? Math.round(e / 10) / 100 : null; // MWh in bucket (hourly kW means × 1 h)
      }
      row.ws = wn ? Math.round((wsum / wn) * 100) / 100 : null;
      rows.push(row);
    }
    return { rows, bucket };
  }, [hourly, summary.turbines, i0, i1]);

  const week = models.testWeek.t.map((t, i) => ({ t, observed: models.testWeek.observed[i], predicted: models.testWeek.predicted[i], band: models.testWeek.lo[i] !== null ? [models.testWeek.lo[i], models.testWeek.hi[i]] : null }));

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Observed wind energy" value={energy(totalEnergy)} provenance="observed" accent="wind" icon={<Wind size={15} />} definition="Sum of positive P_avg × 10 min over all records of the four La Haute Borne turbines (MWh/GWh)." source={`SCADA, ${date(summary.timeRange.start)} – ${date(summary.timeRange.end)}`} sub={`fleet CF ${pct(fleetCf)}`} />
        <KpiCard label="Predicted power — model skill" value={fmt(fleetModel.metrics.r2, 3)} unit="R²" provenance="predicted" accent="h2" icon={<BrainCircuit size={15} />} definition={`Coefficient of determination of the ${fleetModel.name} on held-out records after ${date(models.split.testStart)}. RMSE ${fmt(fleetModel.metrics.rmse, 0)} kW per turbine.`} source="models.json — time-aware holdout" sub={`90% PI coverage ${pct(fleetModel.interval?.testCoverage, 0)}`} />
        <KpiCard
          label="Modeled annual wake loss"
          value={onEval ? pct(onEval.metrics.wakeLossAnnual, 1) : '…'}
          provenance="physics"
          accent="energy"
          icon={<Gauge size={15} />}
          definition="1 − AEP(with wakes) / AEP(no wakes) for the current 16-position onshore layout, weighted by the SCADA wind rose."
          source="In-browser Gaussian wake model; turbine curve from SCADA"
          sub={onEval ? `AEP ${energy(onEval.metrics.aepMWh)}` : undefined}
        />
        <KpiCard
          label="Optimized vs baseline"
          value={onCand && onBase ? signedPct(onCand.metrics.aepMWh / onBase.metrics.aepMWh - 1) : ''}
          unit="AEP"
          provenance="optimized"
          accent="energy"
          icon={<Sparkles size={15} />}
          definition="Change in modeled annual energy of the optimizer’s onshore candidate relative to the baseline layout, same resource and wake model."
          source="Layout optimizer (pattern search) + Gaussian wake model"
          unavailable={onCand ? undefined : 'No optimized candidate yet — run the optimizer in the planner.'}
        />
        <KpiCard label="Best tidal resource" value={fmt(bestHydro.meanPowerDensityWm2 / 1000, 2)} unit="kW/m²" provenance="physics" accent="water" icon={<Waves size={15} />} definition="Highest site-mean kinetic power density 0.5·ρ·|u|³ from observed currents. Theoretical resource, not generation." source={`${bestHydro.code} — ${bestHydro.name}`} sub={`mean ${fmt(bestHydro.speed.mean, 2)} m/s`} />
        <KpiCard label="Electrolyzer specific energy" value={fmt(elec.overallSecKwhPerKg, 1)} unit="kWh/kg" provenance="observed" accent="h2" icon={<Fuel size={15} />} definition="Total stack energy ÷ total H₂ mass across all test-stand experiments (measured)." source={`${elec.experiments.length} experiments, electrolyzer CSVs`} sub={`stack ${fmt(elec.observedRangeKw.min, 0)}–${fmt(elec.observedRangeKw.max, 0)} kW`} />
        <KpiCard label="Under-performance events" value={anomalies.events.length} provenance="predicted" icon={<TriangleAlert size={15} />} definition="Historical sustained (≥30 min) power-curve residual exceedances. Not live alarms; turbine status codes are not in the dataset." source="Anomaly detector on SCADA" sub={`${energy(anomalies.events.reduce((a, e) => a + e.deficitMWh, 0))} est. deficit`} />
        <KpiCard label="Data freshness" value={date(summary.timeRange.end)} provenance="processed" icon={<CalendarClock size={15} />} definition="Timestamp of the latest SCADA record. All data is historical; there is no live telemetry connection." source="data/raw/wind/la-haute-borne-data-2017-2020.csv" sub="historical record" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title="Observed generation"
            subtitle={`Energy per ${daily.bucket === 24 ? 'day' : daily.bucket === 6 ? '6 h' : 'hour'} by turbine (MWh), stacked`}
            icon={<Activity size={16} />}
            actions={<ProvenanceBadge kind="observed" />}
          />
          <div className="mb-3">
            <TimeRangeSelect value={range} onChange={setRange} />
          </div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={daily.rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={0}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="t" {...axisProps} minTickGap={40} tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })} />
                <YAxis {...axisProps} width={40} />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => date(String(l), daily.bucket < 24)} valueFormatter={(v) => `${fmt(v, 2)} MWh`} />} cursor={{ fill: '#0b1f330a' }} />
                {summary.turbines.map((id) => (
                  <Bar key={id} dataKey={id} stackId="g" fill={TURBINE_COLORS[id]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 h-20">
            <ResponsiveContainer>
              <AreaChart data={daily.rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="t" hide />
                <YAxis {...axisProps} width={40} />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => date(String(l), daily.bucket < 24)} valueFormatter={(v) => `${fmt(v, 2)} m/s`} />} />
                <Area dataKey="ws" name="Mean wind speed" stroke={SERIES[0]} fill={SERIES[0]} fillOpacity={0.1} strokeWidth={1.4} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Legend items={summary.turbines.map((id) => ({ label: id, color: TURBINE_COLORS[id] }))} />
            <span className="text-[11.5px] text-muted">Lower panel: mean nacelle wind speed (m/s)</span>
          </div>
        </Card>
        <Card>
          <CardHeader title="Wind resource" subtitle="Direction × speed frequency, all turbines" actions={<ProvenanceBadge kind="processed" />} />
          <div className="flex justify-center">
            <WindRose percent={summary.rose.percent} speedBins={summary.rose.speedBins} size={250} />
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Predicted vs observed power" subtitle={`${models.testWeek.turbine}, held-out week 6–12 Nov 2017 (kW), with 90% prediction interval`} actions={<ProvenanceBadge kind="predicted" />} />
          <div className="h-56">
            <ResponsiveContainer>
              <ComposedChart data={week} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="t" {...axisProps} minTickGap={50} tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })} />
                <YAxis {...axisProps} width={44} domain={[-100, 2200]} ticks={[0, 500, 1000, 1500, 2000]} />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => date(String(l), true)} valueFormatter={(v) => `${fmt(v, 0)} kW`} />} />
                <Area dataKey="band" name="90% interval" fill={SERIES[6]} fillOpacity={0.12} stroke="none" isAnimationActive={false} />
                <Line dataKey="observed" name="Observed" stroke={SERIES[0]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line dataKey="predicted" name="Predicted" stroke={SERIES[6]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: 'Observed (SCADA)', color: SERIES[0] }, { label: 'Predicted (power-curve model)', color: SERIES[6] }, { label: '90% interval', color: SERIES[6], band: true }]} />
        </Card>
        <Card>
          <CardHeader title="Layout scenarios" subtitle="Onshore, SCADA wind rose" actions={<ProvenanceBadge kind="physics" />} />
          {onBase && onEval ? (
            <div className="space-y-2.5 text-[13px]">
              {[
                ['Baseline', onBase],
                ['Current edit', onEval],
                ...(onCand ? ([['Optimized candidate', onCand]] as const) : []),
              ].map(([label, ev]) => (
                <div key={label as string} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                  <span className="font-medium">{label as string}</span>
                  <span className="num text-right">
                    <span className="font-semibold">{energy((ev as typeof onBase).metrics.aepMWh, 2)}</span>
                    <span className="ml-2 text-[12px] text-muted">wake {pct((ev as typeof onBase).metrics.wakeLossAnnual, 1)}</span>
                  </span>
                </div>
              ))}
              <Link to="/planner" className="inline-flex items-center gap-1 pt-1 text-[12.5px] font-semibold text-energy hover:underline">
                Compare in planner <ArrowRight size={13} />
              </Link>
            </div>
          ) : (
            <Skeleton className="h-40" />
          )}
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {(['onshore', 'offshore'] as const).map((s) => {
          const st = sites[s];
          const eng = s === 'onshore' ? on.eng : off.eng;
          const real = st.turbines.filter((t) => t.status === 'real').length;
          return (
            <Link key={s} to={`/twin/${s}`} className="card group flex gap-4 p-4 transition-shadow hover:shadow-[var(--shadow-raised)]">
              <div className="h-28 w-28 shrink-0 rounded-xl bg-subtle p-1.5">
                <LayoutThumb turbines={st.turbines} boundary={st.boundary} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[14.5px] font-semibold">
                  {s === 'onshore' ? <Mountain size={16} /> : <Ship size={16} />}
                  {s === 'onshore' ? 'Onshore digital twin' : 'Offshore digital twin'}
                  <ArrowRight size={14} className="ml-auto text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                </div>
                <p className="mt-1 text-[12.5px] leading-snug text-muted">
                  {st.turbines.length} positions · {real} real SCADA turbine{real === 1 ? '' : 's'} · {st.turbines.length - real} proposed. {eng?.model.name}.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {real > 0 && <ProvenanceBadge kind="observed" />}
                  <ProvenanceBadge kind="simulated" />
                  <ProvenanceBadge kind="physics" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
