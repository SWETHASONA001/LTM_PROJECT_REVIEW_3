import clsx from 'clsx';
import { Eye, Gauge, Layers, Mountain, Pause, Play, RotateCcw, Ship, SkipBack, SkipForward, Tag, Wind } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { TurbineDetail } from '../components/twin/TurbineDetail';
import { TwinScene, type TwinSceneHandle } from '../components/twin/TwinScene';
import { Segmented, Slider, Toggle } from '../components/ui/controls';
import { Badge, Button, Card, CardHeader, IconButton, KeyValue, PageHeader } from '../components/ui/primitives';
import { ProvenanceBadge } from '../components/ui/Provenance';
import { ErrorState, LoadingState } from '../components/ui/states';
import { compass, date, fmt, pct, power } from '../lib/format';
import { useSiteSimulation } from '../lib/useSiteSimulation';
import { nearestDistances } from '../physics/constraints';
import { WAKE_MODEL_LABEL } from '../physics/wake';
import { useSiteStore, type SiteId } from '../store/siteStore';

export default function DigitalTwinPage() {
  const { site } = useParams();
  if (site !== 'onshore' && site !== 'offshore') return <Navigate to="/twin/onshore" replace />;
  return <Twin key={site} site={site} />;
}

function SiteTabs() {
  const cls = ({ isActive }: { isActive: boolean }) =>
    clsx('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium', isActive ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink');
  return (
    <div className="inline-flex rounded-lg border border-line bg-subtle p-0.5" role="tablist" aria-label="Digital twin environment">
      <NavLink to="/twin/onshore" className={cls}>
        <Mountain size={14} /> Onshore
      </NavLink>
      <NavLink to="/twin/offshore" className={cls}>
        <Ship size={14} /> Offshore
      </NavLink>
    </div>
  );
}

function Twin({ site }: { site: SiteId }) {
  const sim = useSiteSimulation(site);
  const { st, eng, solved, farmCase, conditions, hourly, layout } = sim;
  const patch = useSiteStore((s) => s.patch);
  const patchSim = useSiteStore((s) => s.patchSim);
  const [hovered, setHovered] = useState<string | null>(null);
  const [showWake, setShowWake] = useState(true);
  const [showParticles, setShowParticles] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [visible, setVisible] = useState(true);
  const sceneRef = useRef<TwinSceneHandle>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const observedMode = site === 'onshore' && st.sim.useObserved;

  // Pause rendering when the scene is scrolled out of view or the tab is hidden.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    const vis = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', vis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
    };
  }, [eng]);

  // Timeline playback through observed SCADA hours.
  useEffect(() => {
    if (!observedMode || !st.sim.playing || !hourly) return;
    const id = window.setInterval(() => {
      const cur = useSiteStore.getState().sites[site].sim.timeIndex;
      patchSim(site, { timeIndex: (cur + 1) % hourly.length });
    }, 1000 / st.sim.speed);
    return () => window.clearInterval(id);
  }, [observedMode, st.sim.playing, st.sim.speed, hourly, site, patchSim]);

  const observedRpm = useMemo(() => {
    if (!observedMode || !hourly) return undefined;
    const out: Record<string, number | null> = {};
    for (const [id, s] of Object.entries(hourly.turbines)) out[id] = s.Rs[st.sim.timeIndex] ?? null;
    return out;
  }, [observedMode, hourly, st.sim.timeIndex]);
  const observedYaw = useMemo(() => {
    if (!observedMode || !hourly) return undefined;
    const out: Record<string, number | null> = {};
    for (const [id, s] of Object.entries(hourly.turbines)) out[id] = s.Ya[st.sim.timeIndex] ?? null;
    return out;
  }, [observedMode, hourly, st.sim.timeIndex]);

  const nearest = useMemo(() => nearestDistances(layout), [layout]);
  const extentM = Math.max(st.boundary.width, st.boundary.height) / 2 + (site === 'onshore' ? 350 : 700);

  if (sim.error) return <ErrorState error={sim.error} className="h-[60vh]" />;
  if (!eng || !solved || !farmCase) return <LoadingState className="h-[60vh]" label="Preparing digital twin…" />;

  const selIdx = layout.findIndex((t) => t.id === st.selectedId);
  const selected = selIdx >= 0 ? layout[selIdx] : null;
  const realCount = layout.filter((t) => t.status === 'real').length;

  return (
    <div>
      <PageHeader
        eyebrow="Digital Twin"
        title={site === 'onshore' ? 'Onshore wind farm' : 'Offshore wind farm'}
        description={
          site === 'onshore'
            ? `${layout.length} positions · ${realCount} real La Haute Borne SCADA turbines (schematic positions) · ${layout.length - realCount} proposed planning assets.`
            : `${layout.length} proposed offshore positions · ${eng.model.name}. No offshore operational data exists in the repository — every value is simulated.`
        }
        actions={<SiteTabs />}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div ref={wrapRef} className="card relative h-[min(68vh,640px)] min-h-[420px] overflow-hidden !rounded-2xl">
            <TwinScene
              ref={sceneRef}
              site={site}
              turbines={layout}
              model={eng.model}
              farmCase={farmCase}
              solved={solved}
              extentM={extentM}
              playing={st.sim.playing && visible}
              simSpeed={st.sim.speed}
              selectedId={st.selectedId}
              hoveredId={hovered}
              onSelect={(id) => patch(site, { selectedId: id })}
              onHover={setHovered}
              showWake={showWake}
              showParticles={showParticles}
              showLabels={showLabels}
              observedRpm={observedRpm}
              observedYaw={observedYaw}
            />
            {/* HUD: provenance */}
            <div className="pointer-events-none absolute left-3 top-3 flex max-w-[70%] flex-col gap-1.5">
              <div className="glass pointer-events-auto rounded-xl px-3 py-2 text-[11.5px] leading-snug text-ink-2 shadow-sm">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  {conditions.source === 'observed' ? <ProvenanceBadge kind="observed" detail="Free-stream proxy = mean nacelle wind speed/direction of the real turbines at this hour." /> : <ProvenanceBadge kind="simulated" detail="Wind conditions set manually." />}
                  <ProvenanceBadge kind="physics" detail={WAKE_MODEL_LABEL} />
                </div>
                Animation is a visualization. Blade motion and particles are driven by {conditions.source === 'observed' ? 'historical SCADA hours' : 'manual conditions'} and the wake model — not live telemetry.
              </div>
            </div>
            {/* HUD: compass */}
            <div className="glass absolute right-3 top-3 flex items-center gap-3 rounded-xl px-3 py-2 shadow-sm">
              <svg width="44" height="44" viewBox="-22 -22 44 44" aria-label={`Wind from ${Math.round(conditions.windDir)} degrees`}>
                <circle r="20" fill="white" stroke="#e3e1da" />
                <text y="-12" textAnchor="middle" fontSize="8" fontWeight="700" fill="#0b1f33">N</text>
                <g transform={`rotate(${conditions.windDir + 180})`}>
                  <path d="M0 -14 L4 2 L0 -1 L-4 2 Z" fill="#2b63c6" />
                  <line x1="0" y1="-1" x2="0" y2="13" stroke="#2b63c6" strokeWidth="2" />
                </g>
              </svg>
              <div className="num text-[12px] leading-tight">
                <div className="font-semibold text-ink">
                  {fmt(conditions.windSpeed, 1)} m/s
                </div>
                <div className="text-muted">
                  from {Math.round(conditions.windDir)}° {compass(conditions.windDir)}
                </div>
                <div className="text-muted">TI {pct(conditions.ti, 0)}</div>
              </div>
            </div>
            {/* HUD: playback */}
            <div className="glass absolute inset-x-3 bottom-3 flex flex-wrap items-center gap-2 rounded-xl px-2.5 py-2 shadow-sm">
              <IconButton label={st.sim.playing ? 'Pause' : 'Play'} onClick={() => patchSim(site, { playing: !st.sim.playing })} className="bg-ink text-white hover:bg-ink-2 hover:text-white">
                {st.sim.playing ? <Pause size={15} /> : <Play size={15} />}
              </IconButton>
              <IconButton label="Reset camera" onClick={() => sceneRef.current?.resetCamera()}>
                <RotateCcw size={15} />
              </IconButton>
              <Segmented
                size="sm"
                ariaLabel="Simulation speed"
                value={String(st.sim.speed)}
                onChange={(v) => patchSim(site, { speed: Number(v) })}
                options={['0.5', '1', '2', '4'].map((v) => ({ value: v, label: `${v}×` }))}
              />
              {observedMode && hourly ? (
                <div className="flex min-w-[220px] flex-1 items-center gap-2">
                  <IconButton label="Previous hour" onClick={() => patchSim(site, { timeIndex: Math.max(0, st.sim.timeIndex - 1) })}>
                    <SkipBack size={14} />
                  </IconButton>
                  <input
                    type="range"
                    aria-label="SCADA timeline"
                    min={0}
                    max={hourly.length - 1}
                    value={st.sim.timeIndex}
                    onChange={(e) => patchSim(site, { timeIndex: Number(e.target.value) })}
                    className="flex-1"
                  />
                  <IconButton label="Next hour" onClick={() => patchSim(site, { timeIndex: Math.min(hourly.length - 1, st.sim.timeIndex + 1) })}>
                    <SkipForward size={14} />
                  </IconButton>
                  <span className="num w-[150px] text-right text-[11.5px] font-medium text-ink-2">{conditions.timestamp ? date(conditions.timestamp, true) : ''}</span>
                </div>
              ) : (
                <span className="ml-1 text-[11.5px] text-muted">
                  {site === 'offshore' ? 'No offshore timeline — no offshore measurements in the repository.' : 'Manual conditions · enable observed SCADA to scrub the timeline.'}
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Modeled farm power" value={power(solved.farmKw)} kind="physics" sub={`${layout.length} turbines · Gaussian wake`} />
            <MetricCard label="Modeled wake loss" value={pct(solved.wakeLoss)} kind="physics" sub={`vs. ${power(solved.freeKw)} unwaked`} />
            {site === 'onshore' ? (
              <MetricCard
                label="Observed power — 4 real turbines"
                value={conditions.source === 'observed' && conditions.observedFarmKw != null ? power(conditions.observedFarmKw) : '—'}
                kind="observed"
                sub={conditions.source === 'observed' ? (conditions.observedFarmKw == null ? 'incomplete records this hour' : 'hourly mean P_avg, SCADA') : 'switch to observed SCADA conditions'}
              />
            ) : (
              <MetricCard label="Observed power" value="Not available" kind="simulated" sub="No offshore assets with measurements" />
            )}
          </div>
        </div>

        <aside className="space-y-4">
          {selected && (
            <TurbineDetail
              turbine={selected}
              index={selIdx}
              solved={solved}
              hourly={hourly}
              timeIndex={st.sim.timeIndex}
              observedMode={observedMode}
              nearestM={nearest[selIdx]}
              rotorD={eng.model.rotorDiameter.value}
              onClose={() => patch(site, { selectedId: null })}
              onFocus={() => sceneRef.current?.focus(selected.id)}
            />
          )}

          <Card>
            <CardHeader title="Conditions" icon={<Wind size={16} />} />
            {site === 'onshore' && (
              <div className="mb-4">
                <Segmented
                  ariaLabel="Condition source"
                  value={st.sim.useObserved ? 'observed' : 'manual'}
                  onChange={(v) => patchSim(site, { useObserved: v === 'observed' })}
                  options={[
                    { value: 'observed', label: 'Observed SCADA' },
                    { value: 'manual', label: 'Manual' },
                  ]}
                />
              </div>
            )}
            <div className="space-y-4">
              <Slider label="Wind direction (from)" value={Math.round(observedMode ? conditions.windDir : st.windDir)} min={0} max={359} onChange={(v) => patch(site, { windDir: v })} disabled={observedMode} format={(v) => `${v}° ${compass(v)}`} />
              <Slider label="Wind speed (hub)" value={observedMode ? Math.round(conditions.windSpeed * 10) / 10 : st.windSpeed} min={0} max={25} step={0.1} unit="m/s" onChange={(v) => patch(site, { windSpeed: v })} disabled={observedMode} />
              <Slider
                label="Turbulence intensity"
                value={st.ti}
                min={0.03}
                max={0.25}
                step={0.01}
                onChange={(v) => patch(site, { ti: v })}
                format={(v) => pct(v, 0)}
                hint={site === 'onshore' ? 'SCADA median Ws_std/Ws_avg ≈ 12% (nacelle anemometer; indicative only).' : 'Assumed offshore ambient TI.'}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Display" icon={<Eye size={16} />} />
            <div className="mb-4">
              <div className="mb-1.5 text-[12.5px] font-medium text-ink-2">Layout shown</div>
              <Segmented
                ariaLabel="Layout shown"
                value={st.view}
                onChange={(v) => patch(site, { view: v })}
                options={[
                  { value: 'current', label: 'Current' },
                  { value: 'baseline', label: 'Baseline' },
                  ...(st.candidate ? [{ value: 'candidate' as const, label: 'Optimized' }] : []),
                ]}
              />
              {!st.candidate && <p className="mt-1.5 text-[11px] text-muted">Run the optimizer in the planner to create an optimized candidate.</p>}
            </div>
            <div className="space-y-3">
              <Toggle label={<span className="inline-flex items-center gap-1.5"><Layers size={13} /> Wake deficit slice (hub height)</span>} checked={showWake} onChange={setShowWake} />
              <Toggle label={<span className="inline-flex items-center gap-1.5"><Gauge size={13} /> Wind-flow particles</span>} checked={showParticles} onChange={setShowParticles} />
              <Toggle label={<span className="inline-flex items-center gap-1.5"><Tag size={13} /> All turbine labels</span>} checked={showLabels} onChange={setShowLabels} />
            </div>
            <div className="mt-4 flex items-center gap-2 text-[11px] text-muted">
              <span className="h-2 w-16 rounded" style={{ background: 'linear-gradient(90deg,#cde2fb,#0d366b)' }} />
              velocity deficit 0 → 45%+
            </div>
          </Card>

          <Card padded={false}>
            <div className="flex items-center justify-between px-4 pb-2 pt-4">
              <h3 className="text-[15px] font-semibold">Turbine inventory</h3>
              <span className="text-[12px] text-muted">{layout.length} positions</span>
            </div>
            <ul className="max-h-[320px] overflow-y-auto px-2 pb-2 scroll-thin">
              {layout.map((t, i) => (
                <li key={t.id}>
                  <button
                    onClick={() => patch(site, { selectedId: t.id === st.selectedId ? null : t.id })}
                    onMouseEnter={() => setHovered(t.id)}
                    onMouseLeave={() => setHovered(null)}
                    className={clsx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left', t.id === st.selectedId ? 'bg-energy-soft' : 'hover:bg-subtle')}
                  >
                    <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', t.status === 'real' ? 'bg-ink' : 'border-2 border-[#1baf7a]')} />
                    <span className="w-16 text-[13px] font-medium">{t.label}</span>
                    <span className="flex-1">
                      <span className="block h-1.5 overflow-hidden rounded bg-subtle">
                        <span className="block h-full rounded bg-wind" style={{ width: `${Math.min(100, (solved.powerKw[i] / eng.model.ratedPower.value) * 100)}%` }} />
                      </span>
                    </span>
                    <span className="num w-16 text-right text-[12px] text-ink-2">{fmt(solved.powerKw[i], 0)} kW</span>
                    {solved.deficit[i] > 0.05 && <Badge tone="water">−{Math.round(solved.deficit[i] * 100)}%</Badge>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-[11.5px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-ink" /> Real asset
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full border-2 border-[#1baf7a]" /> Proposed
              </span>
              <span className="ml-auto">bar = modeled power</span>
            </div>
          </Card>

          <Card>
            <CardHeader title="Model provenance" />
            <KeyValue
              rows={[
                ['Turbine model', eng.model.name],
                ['Rotor / hub', `${eng.model.rotorDiameter.value} m / ${eng.model.hubHeight.value} m`],
                ['Rated power', power(eng.model.ratedPower.value)],
                ['Wake model', 'Gaussian (BPA 2014)'],
                ['Spacing constraint', `${st.minSpacingD}D (user-configured)`],
              ]}
            />
            <div className="mt-3">
              <Button size="sm" onClick={() => sceneRef.current?.resetCamera()} icon={<RotateCcw size={14} />}>
                Reset camera
              </Button>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function MetricCard({ label, value, kind, sub }: { label: string; value: string; kind: 'physics' | 'observed' | 'simulated'; sub: string }) {
  return (
    <div className="card flex flex-col p-4">
      <span className="text-[12.5px] font-medium text-ink-2">{label}</span>
      <div className="num mt-1.5 text-[22px] font-semibold tracking-tight">{value}</div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <ProvenanceBadge kind={kind} />
        <span className="text-[11.5px] text-muted">{sub}</span>
      </div>
    </div>
  );
}
