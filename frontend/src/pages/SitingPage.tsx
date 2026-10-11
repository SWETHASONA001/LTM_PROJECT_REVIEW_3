import clsx from 'clsx';
import { Check, MapPinPlus, PlusCircle, Sparkles, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Segmented, Slider } from '../components/ui/controls';
import { Badge, Button, Callout, Card, CardHeader, PageHeader } from '../components/ui/primitives';
import { ProvenanceBadge } from '../components/ui/Provenance';
import { EmptyState, LoadingState } from '../components/ui/states';
import { useSiteEngineering } from '../lib/engineering';
import { compass, energy, fmt, pct, signedPct } from '../lib/format';
import type { SitingOutput, SitingProgress } from '../physics/siting';
import { WAKE_MODEL_LABEL } from '../physics/wake';
import { useUiStore } from '../store/appStores';
import { useSiteStore, type SiteId } from '../store/siteStore';

/** Emerald sequential ramp (light → dark) for marginal value. */
function gainColor(t: number) {
  const a = [220, 245, 233];
  const b = [4, 120, 87];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}

export default function SitingPage() {
  const site = useSiteStore((s) => s.activeSite);
  const setSite = useSiteStore((s) => s.setActiveSite);
  return (
    <div>
      <PageHeader
        eyebrow="Engineering"
        title="Turbine installation recommendations"
        description="Where should the next turbines go? Every feasible position inside the site boundary is scored by the annual energy it adds, net of the wake losses it causes on existing turbines."
        actions={
          <Segmented
            ariaLabel="Site"
            value={site}
            onChange={setSite}
            options={[
              { value: 'onshore', label: 'Onshore' },
              { value: 'offshore', label: 'Offshore' },
            ]}
          />
        }
      />
      <Siting key={site} site={site} />
    </div>
  );
}

function Siting({ site }: { site: SiteId }) {
  const st = useSiteStore((s) => s.sites[site]);
  const addTurbine = useSiteStore((s) => s.addTurbine);
  const notify = useUiStore((s) => s.notify);
  const { eng } = useSiteEngineering(site);
  const [count, setCount] = useState(3);
  const [resolution, setResolution] = useState<'coarse' | 'fine'>('coarse');
  const [progress, setProgress] = useState<SitingProgress | null>(null);
  const [result, setResult] = useState<SitingOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number[]>([]);
  const worker = useRef<Worker | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  if (!eng) return <LoadingState className="h-[50vh]" label="Loading turbine model and wind resource…" />;
  const D = eng.model.rotorDiameter.value;
  const minSpacingM = st.minSpacingD * D;
  const gridStepM = Math.max(D, Math.min(st.boundary.width, st.boundary.height) / (resolution === 'coarse' ? 18 : 30));

  const run = () => {
    stop();
    setResult(null);
    setError(null);
    setAdded([]);
    const w = new Worker(new URL('../workers/siting.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'progress') setProgress(m.progress);
      else if (m.type === 'done') {
        setResult(m.result);
        setProgress(null);
        stop();
      } else if (m.type === 'error') {
        setError(m.message);
        setProgress(null);
        stop();
      }
    };
    w.postMessage({
      x: st.turbines.map((t) => t.x),
      y: st.turbines.map((t) => t.y),
      model: eng.model,
      cases: eng.optCases,
      ti: st.ti,
      minSpacingM,
      boundary: st.boundary,
      gridStepM,
      count,
    });
  };

  const add = (i: number) => {
    if (!result || added.includes(i)) return;
    const r = result.recommendations[i];
    addTurbine(site, r.x, r.y);
    setAdded((a) => [...a, i]);
    notify({ title: 'Turbine added from recommendation', body: `Proposed turbine at (${r.x}, ${r.y}) m on the ${site} site.`, tone: 'success', href: '/planner' });
  };

  // Map extent
  const pad = Math.max(st.boundary.width, st.boundary.height) * 0.08;
  const W = st.boundary.width + 2 * pad;
  const H = st.boundary.height + 2 * pad;
  const U = Math.min(W, H);
  const feasibleGains = result ? result.heatmap.values.filter((v): v is number => v !== null) : [];
  const maxGain = feasibleGains.length ? Math.max(...feasibleGains) : 1;
  const minGain = feasibleGains.length ? Math.min(...feasibleGains) : 0;
  const running = progress !== null;
  const ratedMW = eng.model.ratedPower.value / 1000;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card padded={false} className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <MapPinPlus size={16} className="text-energy" />
              <span className="text-[14px] font-semibold">Siting map — {site}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ProvenanceBadge kind="physics" detail={WAKE_MODEL_LABEL} />
              {result && <ProvenanceBadge kind="optimized" detail="Greedy sequential placement on wind-rose AEP" />}
            </div>
          </div>
          <div className="relative h-[460px] bg-[#fbfcfa] sm:h-[560px]">
            <svg viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} className="h-full w-full" role="img" aria-label="Siting map with marginal energy heatmap">
              <rect x={-W / 2} y={-H / 2} width={W} height={H} fill="#fbfcfa" />
              {result &&
                result.heatmap.values.map((v, k) => {
                  if (v === null) return null;
                  const cx = result.heatmap.x0 + (k % result.heatmap.nx) * result.heatmap.step;
                  const cy = result.heatmap.y0 + Math.floor(k / result.heatmap.nx) * result.heatmap.step;
                  const s = result.heatmap.step;
                  return <rect key={k} x={cx - s / 2} y={-cy - s / 2} width={s} height={s} fill={gainColor(maxGain > minGain ? (v - minGain) / (maxGain - minGain) : 1)} opacity={0.9} />;
                })}
              <rect x={-st.boundary.width / 2} y={-st.boundary.height / 2} width={st.boundary.width} height={st.boundary.height} fill="none" stroke="#0b1f33" strokeOpacity={0.4} strokeWidth={U / 450} strokeDasharray={`${U / 80} ${U / 140}`} />
              {st.turbines.map((t) => (
                <g key={t.id} transform={`translate(${t.x} ${-t.y})`}>
                  <circle r={minSpacingM / 2} fill="#0b1f33" fillOpacity={0.04} />
                  <circle r={U / 90} fill={t.status === 'real' ? '#0b1f33' : '#ffffff'} stroke={t.status === 'real' ? '#0b1f33' : '#1baf7a'} strokeWidth={U / 380} />
                </g>
              ))}
              {result?.recommendations.map((r, i) => (
                <g key={i} transform={`translate(${r.x} ${-r.y})`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="cursor-pointer" onClick={() => add(i)}>
                  <circle r={U / 42} fill={added.includes(i) ? '#047857' : '#a15c07'} stroke="#fff" strokeWidth={U / 250} opacity={hover === null || hover === i ? 1 : 0.6} />
                  <text textAnchor="middle" dy={U / 120} fontSize={U / 36} fontWeight={700} fill="#fff">
                    {i + 1}
                  </text>
                </g>
              ))}
              <g transform={`translate(${-W / 2 + U * 0.06} ${-H / 2 + U * 0.08})`}>
                <circle r={U * 0.028} fill="white" stroke="#cfccc3" strokeWidth={U / 900} />
                <path d={`M0 ${-U * 0.02} L${U * 0.008} ${U * 0.007} L0 ${U * 0.002} L${-U * 0.008} ${U * 0.007} Z`} fill="#0b1f33" />
              </g>
            </svg>
            {!result && !running && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-xl bg-white/90 px-5 py-4 text-center shadow-sm backdrop-blur">
                  <div className="text-[14px] font-semibold">Run the recommendation engine</div>
                  <div className="mt-1 max-w-sm text-[12.5px] text-muted">The map will show the energy value of every feasible position and the recommended installation sites.</div>
                </div>
              </div>
            )}
            {running && (
              <div className="absolute inset-x-4 bottom-4 rounded-xl bg-white/95 px-4 py-3 shadow-sm">
                <div className="mb-1.5 flex justify-between text-[12.5px]">
                  <span className="font-medium">
                    Placing turbine {progress.round} of {progress.rounds}
                  </span>
                  <span className="num text-muted">
                    {progress.evaluated} / {progress.total} positions
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded bg-subtle">
                  <div className="h-full rounded bg-energy transition-all" style={{ width: `${(((progress.round - 1) + progress.evaluated / Math.max(1, progress.total)) / progress.rounds) * 100}%` }} />
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-4 py-2.5 text-[11.5px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-14 rounded" style={{ background: `linear-gradient(90deg, ${gainColor(0)}, ${gainColor(1)})` }} /> net energy added{result ? ` ${energy(minGain, 1)} → ${energy(maxGain, 1)}/yr` : ''} (first turbine)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#a15c07]" /> recommended site (click to add)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-ink" /> real turbine
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-[#1baf7a]" /> proposed turbine
            </span>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Recommendation settings" icon={<Sparkles size={16} />} />
            <div className="space-y-4">
              <Slider label="Turbines to recommend" value={count} min={1} max={6} onChange={setCount} />
              <div>
                <div className="mb-1 text-[12.5px] font-medium text-ink-2">Search grid</div>
                <Segmented value={resolution} onChange={setResolution} options={[{ value: 'coarse', label: 'Fast' }, { value: 'fine', label: 'Detailed' }]} />
                <p className="mt-1 text-[11.5px] text-muted">Candidate spacing {fmt(gridStepM, 0)} m ({fmt(gridStepM / D, 1)}D).</p>
              </div>
              <div className="rounded-lg bg-subtle p-3 text-[12px] leading-relaxed text-ink-2">
                Constraints from the planner: minimum spacing <strong>{st.minSpacingD}D = {fmt(minSpacingM, 0)} m</strong>, boundary {st.boundary.width / 1000} × {st.boundary.height / 1000} km, existing layout of {st.turbines.length} turbines. Wind resource: {eng.optCases.label}.
              </div>
              {running ? (
                <Button variant="danger" icon={<Square size={14} />} onClick={() => { stop(); setProgress(null); }}>
                  Cancel
                </Button>
              ) : (
                <Button variant="primary" icon={<Sparkles size={14} />} onClick={run}>
                  Find best installation sites
                </Button>
              )}
              {error && <Callout tone="warn">Recommendation failed: {error}</Callout>}
            </div>
          </Card>

          {result && (
            <Card>
              <CardHeader title="Summary" />
              <div className="grid grid-cols-2 gap-3 text-[12.5px]">
                <div className="rounded-lg bg-subtle p-3">
                  <div className="text-muted">Farm AEP now</div>
                  <div className="num text-[16px] font-semibold">{energy(result.baseAepMWh)}</div>
                </div>
                <div className="rounded-lg bg-energy-soft p-3">
                  <div className="text-muted">With all {result.recommendations.length} added</div>
                  <div className="num text-[16px] font-semibold text-energy">{energy(result.finalAepMWh)}</div>
                </div>
              </div>
              <p className="mt-2 text-[11.5px] leading-snug text-muted">
                Sites near the boundary score highest when they sit outside the existing turbines’ prevailing wakes — an enlarged boundary in the planner opens more options.
              </p>
              <p className="mt-2 text-[11.5px] text-muted">
                {signedPct(result.finalAepMWh / result.baseAepMWh - 1)} annual energy for {fmt(result.recommendations.length * ratedMW, 1)} MW of new capacity · {result.evaluations.toLocaleString()} wind-rose AEP evaluations.
              </p>
            </Card>
          )}
        </div>
      </div>

      {result && (
        <Card>
          <CardHeader
            title="Recommended installation sites"
            subtitle="Ranked in placement order. Each site is evaluated with all previously recommended turbines already in place."
            actions={
              <Button size="sm" variant="subtle" icon={<PlusCircle size={14} />} onClick={() => result.recommendations.forEach((_, i) => add(i))} disabled={added.length === result.recommendations.length}>
                Add all to layout
              </Button>
            }
          />
          {result.recommendations.length === 0 ? (
            <EmptyState title="No feasible position" body="Every grid position violates the spacing constraint. Enlarge the boundary or reduce the minimum spacing in the planner." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {result.recommendations.map((r, i) => {
                const wakeShare = r.ownAepMWh > 0 ? r.lossToOthersMWh / r.ownAepMWh : 0;
                const bearing = (Math.atan2(r.x, r.y) * 180) / Math.PI;
                return (
                  <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={clsx('rounded-xl border p-4 transition-shadow', hover === i ? 'border-[#e5c58a] shadow-[var(--shadow-raised)]' : 'border-line')}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#a15c07] text-[13px] font-bold text-white">{i + 1}</span>
                        <span className="num text-[13px] font-semibold">
                          ({r.x}, {r.y}) m
                        </span>
                      </span>
                      {added.includes(i) ? <Badge tone="energy">added</Badge> : <Badge tone="warn">recommended</Badge>}
                    </div>
                    <dl className="space-y-1 text-[12.5px]">
                      <Row k="Net energy added" v={`${energy(r.netGainMWh, 2)}/yr`} strong />
                      <Row k="Own production" v={`${energy(r.ownAepMWh, 2)}/yr · CF ${pct(r.capacityFactor, 1)}`} />
                      <Row k="Wake loss caused on others" v={`${energy(r.lossToOthersMWh, 2)}/yr (${pct(wakeShare, 1)})`} />
                      <Row k="Nearest turbine" v={`${fmt(r.nearestM, 0)} m (${fmt(r.nearestM / D, 1)}D)`} />
                    </dl>
                    <p className="mt-2 text-[11.5px] leading-snug text-muted">
                      {wakeShare < 0.05 ? 'Low interaction with the existing farm' : 'Noticeable interaction with existing turbines'}; located {compass(bearing)} of the farm centre. Chosen from {r.candidatesEvaluated} feasible positions.
                    </p>
                    <Button size="sm" className="mt-3" icon={added.includes(i) ? <Check size={13} /> : <PlusCircle size={13} />} disabled={added.includes(i)} onClick={() => add(i)}>
                      {added.includes(i) ? 'Added to layout' : 'Add to layout'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-3xl text-[11.5px] leading-relaxed text-muted">
              Physics-derived screening: {WAKE_MODEL_LABEL}, identical turbines, 100% availability, flat terrain. It does not include land rights, noise, setback, grid connection, geotechnical or permitting constraints — confirm every site with those studies before installation.
            </p>
            {added.length > 0 && (
              <Link to="/planner" className="inline-flex h-8 items-center rounded-lg bg-ink px-3 text-[13px] font-medium text-white">
                Review in planner →
              </Link>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className={clsx('num text-right', strong ? 'font-semibold text-energy' : 'font-medium text-ink')}>{v}</dd>
    </div>
  );
}
