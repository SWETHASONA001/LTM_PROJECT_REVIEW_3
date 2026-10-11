import clsx from 'clsx';
import { Pause, Play, Waves } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, ChartTooltip, gridProps, Legend, SERIES } from '../components/charts/chartTheme';
import { HydroScene } from '../components/hydro/HydroScene';
import { Slider } from '../components/ui/controls';
import { KpiCard } from '../components/ui/Kpi';
import { Callout, Card, CardHeader, IconButton, PageHeader } from '../components/ui/primitives';
import { ProvenanceBadge } from '../components/ui/Provenance';
import { DataGate } from '../components/ui/states';
import type { HydroSeries, HydroSites } from '../data/types';
import { date, fmt, pct, power } from '../lib/format';
import { availablePowerKw, DEFAULT_HYDRO, electricalPowerKw, summarizeHydro, sweptArea, type HydroTurbineConfig } from '../physics/hydro';
import { useDatasets } from '../services/dataService';

export default function HydroPage() {
  const state = useDatasets(['hydro_sites', 'hydro_series']);
  return (
    <div>
      <PageHeader
        eyebrow="Engineering · Tidal currents"
        title="Hydro intelligence"
        description="Observed ADCP current profiles from 14 tidal sites (MHKDR submission 648, Jang et al.). The repository contains no hydrokinetic generator measurements: every turbine and power output on this page is modeled."
        actions={<ProvenanceBadge kind="observed" detail="data/raw/hydro/*.nc — principal-axis current profiles" />}
      />
      <DataGate state={state} className="h-[50vh]">
        {(d) => <HydroContent sites={d.hydro_sites} series={d.hydro_series} />}
      </DataGate>
    </div>
  );
}

function HydroContent({ sites, series }: { sites: HydroSites; series: HydroSeries }) {
  const [params, setParams] = useSearchParams();
  const code = sites.sites.some((s) => s.code === params.get('site')) ? params.get('site')! : 'FWS';
  const site = sites.sites.find((s) => s.code === code)!;
  const ser = series.series[code];
  const [cfg, setCfg] = useState<HydroTurbineConfig>({ ...DEFAULT_HYDRO, cutInMs: sites.cutInMs, rho: sites.rhoSea });
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const set = (p: Partial<HydroTurbineConfig>) => setCfg((c) => ({ ...c, ...p }));

  useEffect(() => setIdx(Math.floor(ser.u.length / 3)), [code, ser.u.length]);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % ser.u.length), 450);
    return () => window.clearInterval(id);
  }, [playing, ser.u.length]);

  const t0 = new Date(ser.t0).getTime();
  // Move the chart marker in coarse steps so playback does not re-render the charts every tick.
  const markerIdx = playing ? idx - (idx % 12) : idx;
  const u = ser.u[idx] ?? 0;
  const summary = useMemo(() => summarizeHydro(ser.u, cfg), [ser.u, cfg]);
  const chart = useMemo(
    () => ser.u.map((v, i) => ({ t: t0 + ser.dtS[i] * 1000, u: v, p: v === null ? null : electricalPowerKw(v, cfg) * cfg.count })),
    [ser, cfg, t0],
  );
  const hist = site.speedHist.counts.map((c, i) => ({ v: site.speedHist.edges[i], share: c / site.records }));
  const profile = site.binHeightsM.map((h, i) => ({ h, flood: site.meanProfileFlood[i], ebb: site.meanProfileEbb[i] !== null ? Math.abs(site.meanProfileEbb[i]!) : null }));
  const labels = site.labelCounts.map((c, i) => ({ label: sites.labels[i], share: c / site.records }));

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card padded={false}>
          <div className="px-4 pb-2 pt-4 text-[14px] font-semibold">Sites ({sites.sites.length})</div>
          <ul className="max-h-[560px] overflow-y-auto px-2 pb-2 scroll-thin" aria-label="Hydro sites">
            {sites.sites.map((s) => (
              <li key={s.code}>
                <button
                  onClick={() => setParams({ site: s.code })}
                  className={clsx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left', s.code === code ? 'bg-water-soft' : 'hover:bg-subtle')}
                >
                  <span className={clsx('w-10 text-[12px] font-bold', s.code === code ? 'text-water' : 'text-ink-2')}>{s.code}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{s.name}</span>
                    <span className="num block text-[11px] text-muted">
                      mean {fmt(s.speed.mean, 2)} m/s · {fmt(s.meanPowerDensityWm2 / 1000, 2)} kW/m²
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <div className="min-w-0 space-y-5">
          <div className="card relative h-[420px] overflow-hidden !rounded-2xl">
            <HydroScene speed={u} diameter={cfg.diameter} depth={site.meanDepthM} playing={playing} />
            <div className="glass absolute left-3 top-3 max-w-[60%] rounded-xl px-3 py-2 text-[11.5px] text-ink-2">
              <div className="mb-1 flex flex-wrap gap-1.5">
                <ProvenanceBadge kind="observed" detail="Depth-averaged principal-axis velocity at this sample." />
                <ProvenanceBadge kind="simulated" detail="Turbine, rotor motion and power are modeled — no generator data exists." />
              </div>
              {site.name} · depth {fmt(site.meanDepthM, 1)} m. Rotor geometry and rotation are illustrative (TSR 4).
            </div>
            <div className="glass absolute right-3 top-3 rounded-xl px-3 py-2 text-right">
              <div className="num text-[18px] font-semibold text-ink">{fmt(Math.abs(u), 2)} m/s</div>
              <div className="text-[11.5px] text-muted">{u >= 0 ? 'Flood (+)' : 'Ebb (−)'} · observed</div>
              <div className="num mt-1 text-[12px] text-ink-2">P_el {power(electricalPowerKw(u, cfg))} <span className="text-faint">modeled</span></div>
            </div>
            <div className="glass absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-xl px-2.5 py-2">
              <IconButton label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)} className="bg-ink text-white hover:bg-ink-2 hover:text-white">
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </IconButton>
              <input type="range" aria-label="ADCP sample" min={0} max={ser.u.length - 1} value={idx} onChange={(e) => setIdx(Number(e.target.value))} className="flex-1" />
              <span className="num w-[150px] text-right text-[11.5px] font-medium text-ink-2">{date(new Date(t0 + ser.dtS[idx] * 1000), true)}</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Mean current speed" value={fmt(site.speed.mean, 2)} unit="m/s" provenance="observed" accent="water" icon={<Waves size={15} />} definition="Time-mean of |depth-averaged principal-axis velocity| over the full ADCP record." source={`${site.code}.nc · ${site.records.toLocaleString()} profiles · ${date(site.start)} – ${date(site.end)}`} sub={`p90 ${fmt(site.speed.p90, 2)} m/s`} />
            <KpiCard label="Time above cut-in" value={pct(site.aboveCutInShare, 0)} provenance="processed" definition={`Share of profiles with |u| ≥ ${sites.cutInMs} m/s (minimum operation speed defined in README_648).`} source="ADCP profiles, README_648.txt" />
            <KpiCard label="Mean kinetic power density" value={fmt(site.meanPowerDensityWm2 / 1000, 2)} unit="kW/m²" provenance="physics" definition="Mean of 0.5·ρ·|u|³ per square metre of flow area. Theoretical resource, not generation." source={`ρ = ${sites.rhoSea} kg/m³ (assumed seawater density)`} />
            <KpiCard label="Modeled capacity factor" value={pct(summary.capacityFactor, 1)} provenance="simulated" definition="Mean modeled electrical output ÷ rated power for the configured turbine." source="User-configured D, Cp, η, rated power; observed currents" sub={`${power(summary.meanElectricalKw * cfg.count)} mean`} />
          </div>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Current velocity and modeled output" subtitle={`Depth-averaged velocity (m/s, + flood / − ebb), decimated ×${ser.stride}`} actions={<ProvenanceBadge kind="observed" />} />
          <VelocityCharts chart={chart} markerT={chart[markerIdx]?.t} cutIn={sites.cutInMs} count={cfg.count} />
          <p className="mt-1 text-[11.5px] text-muted">Grey lines in the velocity chart mark the ±{sites.cutInMs} m/s cut-in. The black line marks the sample shown in the 3D view.</p>
        </Card>

        <Card>
          <CardHeader title="Hydrokinetic turbine model" subtitle="Assumptions — adjust to explore" actions={<ProvenanceBadge kind="assumption" />} />
          <div className="space-y-4">
            <Slider label="Rotor diameter D" value={cfg.diameter} min={4} max={30} step={0.5} unit="m" onChange={(v) => set({ diameter: v })} hint={`Swept area A = ${fmt(sweptArea(cfg.diameter), 0)} m² · site depth ${fmt(site.meanDepthM, 1)} m`} />
            <Slider label="Power coefficient Cp" value={cfg.cp} min={0.1} max={0.55} step={0.01} onChange={(v) => set({ cp: v })} hint="Betz limit 0.593; practical tidal rotors ≈ 0.35–0.45." />
            <Slider label="Drivetrain & conversion η" value={cfg.eta} min={0.6} max={0.98} step={0.01} onChange={(v) => set({ eta: v })} />
            <Slider label="Rated power" value={cfg.ratedKw} min={50} max={2000} step={50} unit="kW" onChange={(v) => set({ ratedKw: v })} />
            <Slider label="Number of turbines" value={cfg.count} min={1} max={20} onChange={(v) => set({ count: v })} hint="No array/wake interaction is modeled between hydro turbines." />
          </div>
          <div className="mt-5 rounded-xl bg-subtle p-3.5 font-mono text-[12px] leading-relaxed text-ink-2">
            <div>P_available = ½ · ρ · A · v³</div>
            <div>P_electrical = min(P_rated, ½ · ρ · A · v³ · Cp · η)</div>
            <div className="text-muted">P_electrical = 0 when |v| &lt; {sites.cutInMs} m/s</div>
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-4 text-[11.5px] leading-snug text-muted">
            <li>v = depth-averaged velocity over measured bins (not hub-height velocity).</li>
            <li>ρ = {sites.rhoSea} kg/m³ (assumed). Units: ρ kg/m³, A m², v m/s → W.</li>
            <li>Cp and η constant with speed; no yaw/misalignment, blockage or array effects.</li>
            <li>At v = {fmt(Math.abs(u), 2)} m/s: P_available {power(availablePowerKw(u, cfg))}, P_electrical {power(electricalPowerKw(u, cfg))}.</li>
          </ul>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Speed distribution" subtitle="Share of profiles per 0.1 m/s bin" actions={<ProvenanceBadge kind="processed" />} />
          <div className="h-48">
            <ResponsiveContainer>
              <BarChart data={hist} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={1}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="v" {...axisProps} tickFormatter={(v: number) => v.toFixed(1)} minTickGap={20} />
                <YAxis {...axisProps} width={36} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => `${Number(l).toFixed(1)}–${(Number(l) + 0.1).toFixed(1)} m/s`} valueFormatter={(v) => pct(v, 1)} />} cursor={{ fill: '#0b1f330a' }} />
                <Bar dataKey="share" name="Share" fill={SERIES[0]} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader title="Mean velocity profile" subtitle="|u| (m/s) vs height above bed (m)" actions={<ProvenanceBadge kind="processed" />} />
          <div className="h-48">
            <ResponsiveContainer>
              <LineChart data={profile} layout="vertical" margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#ebe9e3" horizontal={false} />
                <XAxis type="number" {...axisProps} domain={[0, 'auto']} />
                <YAxis type="number" dataKey="h" {...axisProps} width={32} domain={[0, 'auto']} reversed />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => `${l} m above bed`} valueFormatter={(v) => `${fmt(v, 2)} m/s`} />} />
                <Line dataKey="flood" name="Flood" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
                <Line dataKey="ebb" name="Ebb (abs)" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: 'Flood', color: SERIES[0] }, { label: 'Ebb (|u|)', color: SERIES[1] }]} />
        </Card>
        <Card>
          <CardHeader title="Profile shape classes" subtitle="Classification label from the dataset" actions={<ProvenanceBadge kind="observed" />} />
          <div className="space-y-2">
            {labels.map((l) => (
              <div key={l.label} className="grid grid-cols-[1fr_90px_44px] items-center gap-2 text-[12px]">
                <span className="truncate text-ink-2" title={l.label}>
                  {l.label}
                </span>
                <span className="h-2 overflow-hidden rounded bg-subtle">
                  <span className="block h-full rounded bg-water" style={{ width: `${l.share * 100}%` }} />
                </span>
                <span className="num text-right">{pct(l.share, 0)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] text-muted">Median power-law exponent α = {fmt(site.meanAlpha, 2)}. Source: {site.source.split(',')[0]} et al.</p>
        </Card>
      </div>

      <Callout tone="info" title="Hydro → hydrogen">
        Modeled hydro output can be added to the hydrogen allocation on the Hydrogen Optimization page. Hydro records (2005–2016, various sites) and wind SCADA (2017) are not concurrent, so any combination is a labeled simulation, not a joint resource assessment.
      </Callout>
    </div>
  );
}

/** Memoized so tidal playback only re-renders the charts when the marker moves. */
const VelocityCharts = memo(function VelocityCharts({ chart, markerT, cutIn, count }: { chart: { t: number; u: number | null; p: number | null }[]; markerT?: number; cutIn: number; count: number }) {
  return (
    <>
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} {...axisProps} tickFormatter={(v: number) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })} />
                <YAxis {...axisProps} width={40} />
                <ReferenceLine y={cutIn} stroke="#95a0aa" />
                <ReferenceLine y={-cutIn} stroke="#95a0aa" />
                <ReferenceLine x={markerT} stroke="#0b1f33" />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => date(new Date(Number(l)), true)} valueFormatter={(v) => `${fmt(v, 2)} m/s`} />} />
                <Line dataKey="u" name="Velocity" stroke={SERIES[0]} strokeWidth={1.2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 mb-1 flex items-center justify-between">
            <span className="text-[13px] font-semibold">Modeled electrical power (kW, {count} turbine{count > 1 ? 's' : ''})</span>
            <ProvenanceBadge kind="simulated" />
          </div>
          <div className="h-40">
            <ResponsiveContainer>
              <AreaChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} {...axisProps} tickFormatter={(v: number) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })} />
                <YAxis {...axisProps} width={40} />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => date(new Date(Number(l)), true)} valueFormatter={(v) => `${fmt(v, 0)} kW`} />} />
                <Area dataKey="p" name="Modeled power" stroke={SERIES[2]} fill={SERIES[2]} fillOpacity={0.15} strokeWidth={1.2} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
    </>
  );
});
