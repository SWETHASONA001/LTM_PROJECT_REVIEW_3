import { Fuel, Gauge, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, ChartTooltip, gridProps, Legend, SERIES } from '../components/charts/chartTheme';
import { EnergyFlow } from '../components/hydrogen/EnergyFlow';
import { NumberField, Segmented, Select, Slider, Toggle } from '../components/ui/controls';
import { KpiCard } from '../components/ui/Kpi';
import { Button, Callout, Card, CardHeader, PageHeader } from '../components/ui/primitives';
import { ProvenanceBadge } from '../components/ui/Provenance';
import { DataGate, LoadingState } from '../components/ui/states';
import type { ElectrolyzerReport, HydroSeries, HydroSites, WindHourly } from '../data/types';
import { useSiteEngineering } from '../lib/engineering';
import { date, energy, fmt, mass, pct, power } from '../lib/format';
import { alignedHydroSeries, decompose, modeledWindSeries, observedWindSeries } from '../lib/hydrogenScenario';
import { DEFAULT_HYDRO } from '../physics/hydro';
import { dispatch, stackModelFromReport, type PlantConfig, type StagingStrategy } from '../physics/hydrogen';
import { useDatasets } from '../services/dataService';
import { backend, useBackendStatus } from '../services/api';
import { useSiteStore } from '../store/siteStore';

type WindSource = 'baseline' | 'current' | 'candidate' | 'observed';

export default function HydrogenPage() {
  const state = useDatasets(['electrolyzer', 'wind_hourly', 'hydro_sites', 'hydro_series']);
  return (
    <div>
      <PageHeader
        eyebrow="Engineering · Power-to-X"
        title="Hydrogen optimization"
        description="Wind (and optionally modeled hydro) power → allocation → PEM electrolyzer → hydrogen. The electrolyzer model is the empirical stack curve measured in the repository’s test-stand experiments; plant scale-out, storage and dispatch are modeled."
      />
      <DataGate state={state} className="h-[50vh]">
        {(d) => <HydrogenContent elec={d.electrolyzer} hourly={d.wind_hourly} hydroSites={d.hydro_sites} hydroSeries={d.hydro_series} />}
      </DataGate>
    </div>
  );
}

function HydrogenContent({ elec, hourly, hydroSites, hydroSeries }: { elec: ElectrolyzerReport; hourly: WindHourly; hydroSites: HydroSites; hydroSeries: HydroSeries }) {
  const { eng } = useSiteEngineering('onshore');
  const st = useSiteStore((s) => s.sites.onshore);
  const stack = useMemo(() => stackModelFromReport(elec), [elec]);
  const [source, setSource] = useState<WindSource>('baseline');
  const [compareTo, setCompareTo] = useState<WindSource>(st.candidate ? 'candidate' : 'current');
  const [modules, setModules] = useState(12);
  const [staging, setStaging] = useState<StagingStrategy>('optimal');
  const [storageKwh, setStorageKwh] = useState(0);
  const [storageKw, setStorageKw] = useState(2000);
  const [rte, setRte] = useState(0.88);
  const [useHydro, setUseHydro] = useState(false);
  const [hydroSite, setHydroSite] = useState('FWS');
  const [hydroCount, setHydroCount] = useState(4);
  const [windowStart, setWindowStart] = useState(7400);

  const layoutFor = (s: WindSource) => (s === 'baseline' ? st.baseline : s === 'candidate' && st.candidate ? st.candidate.turbines : st.turbines);
  const seriesFor = useMemo(() => {
    const cache = new Map<WindSource, number[]>();
    return (s: WindSource) => {
      if (!eng) return [];
      if (!cache.has(s)) cache.set(s, s === 'observed' ? observedWindSeries(hourly).kw : modeledWindSeries(hourly, layoutFor(s), eng.model, st.ti));
      return cache.get(s)!;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eng, hourly, st.baseline, st.turbines, st.candidate, st.ti]);

  const hydroCfg = useMemo(() => ({ ...DEFAULT_HYDRO, count: hydroCount }), [hydroCount]);
  const hydroKw = useMemo(() => (useHydro ? alignedHydroSeries(hydroSeries.series[hydroSite], hourly.length, hydroCfg) : null), [useHydro, hydroSeries, hydroSite, hourly.length, hydroCfg]);
  const plant: PlantConfig = { modules, staging, storageKwh, storageKw, roundTripEff: rte };

  const results = useMemo(() => {
    if (!eng) return null;
    const wind = seriesFor(source);
    const total = hydroKw ? wind.map((v, i) => v + hydroKw[i]) : wind;
    const r = dispatch(total, 1, stack, plant, true);
    const alt = source !== 'observed' && compareTo !== source && compareTo !== 'observed' ? seriesFor(compareTo) : null;
    const dec = source !== 'observed' ? decompose(seriesFor(source), alt, hydroKw, stack, plant) : null;
    const windMWh = wind.reduce((a, b) => a + b, 0) / 1000;
    const hydroMWh = hydroKw ? hydroKw.reduce((a, b) => a + b, 0) / 1000 : 0;
    const sweep = [2, 4, 6, 8, 10, 12, 14, 16, 20, 24].map((m) => {
      const d = dispatch(total, 1, stack, { ...plant, modules: m });
      return { modules: m, capacityMW: (m * stack.maxKw) / 1000, h2t: d.h2Kg / 1000, curtailedShare: d.curtailedMWh / Math.max(d.availableMWh, 1e-9), utilization: d.toElectrolyzerMWh / ((m * stack.maxKw * hourly.length) / 1000) };
    });
    return { r, dec, windMWh, hydroMWh, sweep, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eng, seriesFor, source, compareTo, hydroKw, stack, modules, staging, storageKwh, storageKw, rte, hourly.length]);

  if (!eng || !results) return <LoadingState label="Running modeled wind farm over the SCADA hours…" />;
  const { r, dec } = results;
  const hours = hourly.length;
  const winLen = 24 * 14;
  const ws = Math.min(windowStart, hours - winLen);
  const windowData = r.series.slice(ws, ws + winLen).map((p, i) => ({ t: new Date(new Date(hourly.start).getTime() + (ws + i) * 3600_000).toISOString(), available: Math.round(p.availableKw), electrolyzer: Math.round(p.electrolyzerKw), h2: p.h2KgH }));
  const stackChart = stack.kw.map((k, i) => ({ kw: k, flow: stack.kgPerH[i], sec: k / stack.kgPerH[i] }));
  const srcOptions = [
    { value: 'baseline' as const, label: 'Baseline layout (modeled)' },
    { value: 'current' as const, label: 'Current planner layout (modeled)' },
    ...(st.candidate ? [{ value: 'candidate' as const, label: 'Optimized candidate (modeled)' }] : []),
    { value: 'observed' as const, label: 'Observed 4-turbine SCADA power' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Scenario inputs" icon={<Gauge size={16} />} />
          <div className="space-y-4">
            <Select label="Wind power source" value={source} onChange={setSource} options={srcOptions} />
            {source !== 'observed' && <Select label="Compare layout effect against" value={compareTo} onChange={setCompareTo} options={srcOptions.filter((o) => o.value !== 'observed' && o.value !== source)} />}
            <p className="text-[11.5px] leading-snug text-muted">
              {source === 'observed'
                ? 'Measured P_avg of the four real turbines (hours with any missing turbine count as 0 kW).'
                : `16-position onshore layout run through the Gaussian wake model for each of ${hours.toLocaleString()} SCADA hours (observed wind as free-stream proxy).`}
            </p>
            <div className="border-t border-line pt-4">
              <Toggle label="Add modeled hydrokinetic power" checked={useHydro} onChange={setUseHydro} hint="Simulated: hydro record cycled onto the wind timeline (not concurrent)." />
              {useHydro && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Select label="Hydro site" value={hydroSite} onChange={setHydroSite} options={hydroSites.sites.map((s) => ({ value: s.code, label: `${s.code} · ${s.name.split(',')[0]}` }))} />
                  <NumberField label="Turbines" value={hydroCount} min={1} max={40} onChange={setHydroCount} hint={`D ${DEFAULT_HYDRO.diameter} m, ${DEFAULT_HYDRO.ratedKw} kW`} />
                </div>
              )}
            </div>
            <div className="border-t border-line pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold">Electrolyzer plant</span>
                <ProvenanceBadge kind="processed" detail={stack.source} />
              </div>
              <Slider label="Stacks (modules)" value={modules} min={1} max={30} onChange={setModules} hint={`${fmt((modules * stack.maxKw) / 1000, 1)} MW total · per stack ${fmt(stack.minKw, 0)}–${fmt(stack.maxKw, 0)} kW (observed range). Scale-out is an assumption.`} />
              <div className="mt-3">
                <div className="mb-1 text-[12.5px] font-medium text-ink-2">Stack staging</div>
                <Segmented value={staging} onChange={setStaging} options={[{ value: 'sequential', label: 'Sequential fill' }, { value: 'optimal', label: 'Optimal split' }]} />
              </div>
            </div>
            <div className="border-t border-line pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold">Battery buffer</span>
                <ProvenanceBadge kind="assumption" />
              </div>
              <div className="space-y-3">
                <Slider label="Energy capacity" value={storageKwh} min={0} max={20000} step={500} unit="kWh" onChange={setStorageKwh} />
                <Slider label="Power rating" value={storageKw} min={250} max={10000} step={250} unit="kW" onChange={setStorageKw} disabled={storageKwh === 0} />
                <Slider label="Round-trip efficiency" value={rte} min={0.7} max={0.97} step={0.01} format={(v) => pct(v, 0)} onChange={setRte} disabled={storageKwh === 0} />
              </div>
            </div>
          </div>
        </Card>

        <div className="min-w-0 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Hydrogen produced" value={mass(r.h2Kg)} provenance="simulated" accent="h2" icon={<Fuel size={15} />} definition="Sum over SCADA hours of the empirical stack-curve H₂ rate at the dispatched stack power." source="Modeled from wind/hydro scenario + measured electrolyzer curve" sub={`${hours.toLocaleString()} h record`} />
            <KpiCard label="Specific energy" value={fmt(r.secKwhPerKg, 1)} unit="kWh/kg" provenance="simulated" definition="Electrolyzer input energy ÷ H₂ mass for this scenario. Compare: measured overall test-stand value." source={`Measured overall: ${fmt(elec.overallSecKwhPerKg, 1)} kWh/kg (observed)`} />
            <KpiCard label="Renewable energy available" value={energy(r.availableMWh)} provenance={source === 'observed' ? 'observed' : 'physics'} accent="wind" icon={<Zap size={15} />} definition="Total energy offered to the allocation step (wind + modeled hydro)." source={source === 'observed' ? 'SCADA P_avg (4 real turbines)' : 'Gaussian wake model on observed wind'} sub={useHydro ? `incl. ${energy(results.hydroMWh)} hydro` : undefined} />
            <KpiCard label="Curtailed / unused" value={pct(r.curtailedMWh / Math.max(r.availableMWh, 1e-9), 1)} provenance="simulated" definition="Energy that could not be used by the electrolyzer or stored: below minimum stack load, above plant capacity, or storage full." source="Dispatch model energy balance" sub={energy(r.curtailedMWh)} />
          </div>

          <Card>
            <CardHeader title="Energy flow" subtitle={`Balance check: available − (direct + charged + curtailed) = ${fmt(r.balanceErrorMWh * 1000, 3)} kWh`} actions={<ProvenanceBadge kind="simulated" />} />
            <EnergyFlow windMWh={results.windMWh} hydroMWh={results.hydroMWh} r={r} />
          </Card>

          <ServerCrossCheck total={results.total} stack={stack} plant={plant} browserKg={r.h2Kg} />

          <Card>
            <CardHeader
              title="Two-week dispatch window"
              subtitle="Hourly available power vs electrolyzer input (kW)"
              actions={
                <input type="range" aria-label="Window start" min={0} max={hours - winLen} step={24} value={ws} onChange={(e) => setWindowStart(Number(e.target.value))} className="w-48" />
              }
            />
            <div className="h-56">
              <ResponsiveContainer>
                <ComposedChart data={windowData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="t" {...axisProps} minTickGap={50} tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })} />
                  <YAxis {...axisProps} width={48} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => date(String(l), true)} valueFormatter={(v) => `${fmt(v, 0)} kW`} />} />
                  <Area dataKey="available" name="Available" stroke={SERIES[0]} fill={SERIES[0]} fillOpacity={0.12} strokeWidth={1.4} isAnimationActive={false} />
                  <Line dataKey="electrolyzer" name="To electrolyzer" stroke={SERIES[2]} strokeWidth={1.6} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex justify-between">
              <Legend items={[{ label: 'Available', color: SERIES[0] }, { label: 'To electrolyzer', color: SERIES[2] }]} />
              <span className="text-[11.5px] text-muted">{windowData[0] ? date(windowData[0].t) : ''} – {windowData.at(-1) ? date(windowData.at(-1)!.t) : ''}</span>
            </div>
          </Card>
        </div>
      </div>

      {dec && (
        <Card>
          <CardHeader title="What drives the change in hydrogen?" subtitle="Each factor applied in sequence on the same hours; differences are model results, not measurements." actions={<ProvenanceBadge kind="simulated" />} />
          <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
            <div className="h-60">
              <ResponsiveContainer>
                <BarChart data={dec.steps.map((s, i) => ({ ...s, base: i === 0 ? 0 : Math.min(dec.steps[i - 1].h2Kg, s.h2Kg) / 1000, bar: i === 0 ? s.h2Kg / 1000 : Math.abs(s.delta) / 1000 }))} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="short" {...axisProps} interval={0} />
                  <YAxis {...axisProps} width={44} domain={[(min: number) => Math.max(0, Math.floor(min * 0.95)), 'auto']} />
                  <Tooltip content={<ChartTooltip valueFormatter={(v) => `${fmt(v, 2)} t`} />} cursor={{ fill: '#0b1f330a' }} />
                  <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} name="" />
                  <Bar dataKey="bar" stackId="w" name="H₂ (t)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {dec.steps.map((s, i) => (
                      <Cell key={s.key} fill={i === 0 ? '#0b1f33' : s.delta > 0 ? '#1baf7a' : s.delta < 0 ? '#e34948' : '#cfccc3'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-2 text-[12.5px]">
              {dec.steps.map((s) => (
                <li key={s.key} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{s.label}</span>
                    <span className="num font-semibold">{s.key === 'base' ? mass(s.h2Kg) : `${s.delta >= 0 ? '+' : ''}${mass(s.delta)}`}</span>
                  </div>
                  <div className="text-[11.5px] text-muted">{s.note}</div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sensitivity: plant size" subtitle="H₂ (t) and curtailment vs number of stacks, same scenario" actions={<ProvenanceBadge kind="simulated" />} />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-48">
              <ResponsiveContainer>
                <LineChart data={results.sweep} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="modules" {...axisProps} />
                  <YAxis {...axisProps} width={40} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => `${l} stacks`} valueFormatter={(v) => `${fmt(v, 1)} t`} />} />
                  <Line dataKey="h2t" name="H₂" stroke={SERIES[6]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="text-center text-[11.5px] text-muted">H₂ (t) vs stacks</div>
            </div>
            <div className="h-48">
              <ResponsiveContainer>
                <LineChart data={results.sweep} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="modules" {...axisProps} />
                  <YAxis {...axisProps} width={40} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => `${l} stacks`} valueFormatter={(v) => pct(v, 1)} />} />
                  <Line dataKey="curtailedShare" name="Curtailed" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  <Line dataKey="utilization" name="Stack utilization" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <Legend items={[{ label: 'Curtailed share', color: SERIES[1] }, { label: 'Utilization', color: SERIES[0] }]} />
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Measured electrolyzer stack curve" subtitle="Median H₂ flow (kg/h) per 50 kW stack-power bin, all experiments" actions={<ProvenanceBadge kind="processed" />} />
          <div className="h-48">
            <ResponsiveContainer>
              <ComposedChart data={stackChart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="kw" type="number" {...axisProps} domain={[0, 'dataMax']} />
                <YAxis {...axisProps} width={36} />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => `${fmt(Number(l), 0)} kW`} valueFormatter={(v, n) => (n.includes('SEC') ? `${fmt(v, 1)} kWh/kg` : `${fmt(v, 2)} kg/h`)} />} />
                <Line dataKey="flow" name="H₂ flow" stroke={SERIES[6]} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Scatter dataKey="flow" name="Bin median" fill={SERIES[6]} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            SEC rises from {fmt(stackChart[0].sec, 1)} kWh/kg at {fmt(stackChart[0].kw, 0)} kW to {fmt(stackChart.at(-1)!.sec, 1)} kWh/kg at {fmt(stackChart.at(-1)!.kw, 0)} kW — the stack is more efficient at part load, which is why splitting power across more active stacks can raise H₂. Linear fit R² {fmt(elec.linearFit.metrics.r2, 3)}.
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Electrolyzer experiments in the repository" actions={<ProvenanceBadge kind="observed" />} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-1.5 font-medium">Experiment</th>
                <th className="py-1.5 font-medium">Input profile</th>
                <th className="py-1.5 text-right font-medium">Rows</th>
                <th className="py-1.5 text-right font-medium">Mean stack</th>
                <th className="py-1.5 text-right font-medium">Mean H₂</th>
                <th className="py-1.5 text-right font-medium">SEC</th>
              </tr>
            </thead>
            <tbody>
              {elec.experiments.map((e) => (
                <tr key={e.id} className="border-b border-line/60">
                  <td className="py-1.5 font-medium">{e.id.replace('.csv', '')}</td>
                  <td className="py-1.5">{e.group === 'simulated-tidal' ? <ProvenanceBadge kind="simulated" detail={e.sourceNote} /> : <span className="text-ink-2">{e.group === 'wind-emulation' ? 'IEA 3.4 MW profile' : 'GE 1.5 MW profile'}</span>}</td>
                  <td className="num py-1.5 text-right">{e.rows.toLocaleString()}</td>
                  <td className="num py-1.5 text-right">{power(e.meanStackKw)}</td>
                  <td className="num py-1.5 text-right">{fmt(e.meanFlowKgH, 2)} kg/h</td>
                  <td className="num py-1.5 text-right">{fmt(e.secKwhPerKg, 1)} kWh/kg</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4" />
        <Callout tone="warn" title="Tidal experiments are simulated input">
          <span>The tidal-electrolyzer runs used a simulated 500 kW tidal power profile. Electrolyzer responses were measured, but these rows never represent observed tidal generation. The hydro-electrolyzer README in the repository is a copy of the ADCP README and does not document these runs.</span>
        </Callout>
      </Card>
    </div>
  );
}

function ServerCrossCheck({ total, stack, plant, browserKg }: { total: number[]; stack: ReturnType<typeof stackModelFromReport>; plant: PlantConfig; browserKg: number }) {
  const [status] = useBackendStatus();
  const [res, setRes] = useState<{ kg: number; balance: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (status.state !== 'online') return null;
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await backend.hydrogen({
        available_kw: total,
        stack_curve: { kw: stack.kw, kg_per_h: stack.kgPerH },
        plant: { modules: plant.modules, staging: plant.staging, storage_kwh: plant.storageKwh, storage_kw: plant.storageKw, round_trip_eff: plant.roundTripEff },
      });
      setRes({ kg: r.h2_kg, balance: r.balance_error_mwh });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold">Backend cross-check</div>
          <div className="text-[12px] text-muted">Re-runs this exact scenario through the Python dispatch service (/api/hydrogen/allocate).</div>
        </div>
        <Button size="sm" onClick={run} disabled={busy}>
          {busy ? 'Running…' : 'Run on backend'}
        </Button>
      </div>
      {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
      {res && (
        <p className="num mt-2 text-[12.5px] text-ink-2">
          Backend H₂ {mass(res.kg)} vs browser {mass(browserKg)} — difference {fmt(Math.abs(res.kg - browserKg), 3)} kg; backend energy-balance error {fmt(res.balance * 1000, 4)} kWh.
        </p>
      )}
    </Card>
  );
}
