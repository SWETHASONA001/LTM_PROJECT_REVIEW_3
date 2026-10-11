import { Square, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { energy, fmt, signedPct } from '../../lib/format';
import type { SiteEngineering } from '../../lib/engineering';
import { useOptimizer } from '../../lib/useOptimizer';
import { OPTIMIZER_METHOD } from '../../physics/optimizer';
import { useUiStore } from '../../store/appStores';
import { useSiteStore, type SiteId, type SiteState } from '../../store/siteStore';
import { axisProps, ChartTooltip, gridProps } from '../charts/chartTheme';
import { NumberField, Slider, Toggle } from '../ui/controls';
import { Button, Callout } from '../ui/primitives';
import { ProvenanceBadge } from '../ui/Provenance';

export function OptimizePanel({ site, st, eng }: { site: SiteId; st: SiteState; eng: SiteEngineering }) {
  const { state, run, cancel } = useOptimizer();
  const patch = useSiteStore((s) => s.patch);
  const setCandidate = useSiteStore((s) => s.setCandidate);
  const notify = useUiStore((s) => s.notify);
  const [maxEval, setMaxEval] = useState(900);
  const [stepD, setStepD] = useState(2);
  const [seed, setSeed] = useState(7);
  const D = eng.model.rotorDiameter.value;
  const movable = st.turbines.filter((t) => !(t.status === 'real' && st.lockReal)).length;

  const start = async () => {
    const turbines = st.turbines;
    try {
      const res = await run({
        x: turbines.map((t) => t.x),
        y: turbines.map((t) => t.y),
        movable: turbines.map((t) => !(t.status === 'real' && st.lockReal)),
        model: eng.model,
        cases: eng.optCases,
        ti: st.ti,
        constraints: { minSpacingD: st.minSpacingD, rotorDiameter: D, boundary: st.boundary },
        maxEvaluations: maxEval,
        initialStepD: stepD,
        minStepD: 0.1,
        seed,
      });
      setCandidate(site, {
        turbines: turbines.map((t, i) => ({ ...t, x: Math.round(res.x[i]), y: Math.round(res.y[i]) })),
        createdAt: new Date().toISOString(),
        method: res.method,
        startAepMWh: res.startAep,
        aepMWh: res.bestAep,
        evaluations: res.evaluations,
        terminatedBy: res.terminatedBy,
        resourceLabel: eng.optCases.label,
        lockReal: st.lockReal,
      });
      patch(site, { view: 'current' });
      notify({
        title: `${site === 'onshore' ? 'Onshore' : 'Offshore'} optimization finished`,
        body: `${res.evaluations} evaluations · AEP ${signedPct(res.bestAep / res.startAep - 1)} on the optimisation resource.`,
        tone: 'success',
        href: '/planner',
      });
    } catch {
      /* state already carries the error */
    }
  };

  const running = state.status === 'running';
  const progress = state.status === 'running' || state.status === 'done' ? state.progress : [];
  const lastAep = progress.length ? progress[progress.length - 1].bestAep : undefined;
  const firstAep = state.status === 'done' ? state.result.startAep : undefined;

  return (
    <div className="space-y-4">
      <Callout tone="neutral">
        <div className="mb-1 flex items-center gap-1.5">
          <ProvenanceBadge kind="optimized" /> <span className="font-medium text-ink">Method</span>
        </div>
        {OPTIMIZER_METHOD}. Objective is AEP over the {eng.optCases.kind === 'processed' ? 'SCADA-derived' : 'assumed'} wind rose ({eng.optCases.dirs.length} direction–speed cases, 2 m/s bins). Finds a local optimum from the current layout; not a global guarantee.
      </Callout>
      <Toggle label="Lock real SCADA turbines" hint="Existing assets cannot be relocated; only proposed positions move." checked={st.lockReal} onChange={(v) => patch(site, { lockReal: v })} />
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Max evaluations" value={maxEval} min={50} max={5000} step={50} onChange={setMaxEval} />
        <NumberField label="Random seed" value={seed} min={1} max={9999} onChange={setSeed} />
      </div>
      <Slider label="Initial step" value={stepD} min={0.5} max={5} step={0.5} unit="D" onChange={setStepD} hint={`${fmt(stepD * D, 0)} m; halves when no move improves AEP.`} />
      <div className="flex gap-2">
        {running ? (
          <Button variant="danger" icon={<Square size={14} />} onClick={cancel}>
            Cancel
          </Button>
        ) : (
          <Button variant="primary" icon={<Sparkles size={14} />} onClick={start} disabled={movable === 0}>
            Run optimization
          </Button>
        )}
        <span className="self-center text-[12px] text-muted">{movable} movable turbine{movable === 1 ? '' : 's'}</span>
      </div>
      {state.status === 'error' && <Callout tone="warn">Optimization failed: {state.message}</Callout>}
      {state.status === 'cancelled' && <Callout tone="neutral">Optimization cancelled. No candidate was produced.</Callout>}
      {progress.length > 0 && (
        <div>
          <div className="mb-1 flex items-baseline justify-between text-[12px]">
            <span className="text-muted">Best AEP vs evaluations</span>
            <span className="num font-semibold">
              {lastAep !== undefined ? energy(lastAep) : ''}
              {state.status === 'done' && firstAep ? <span className="ml-1.5 text-energy">{signedPct(state.result.bestAep / firstAep - 1)}</span> : null}
            </span>
          </div>
          <div className="h-32">
            <ResponsiveContainer>
              <AreaChart data={progress} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="evaluations" {...axisProps} />
                <YAxis {...axisProps} width={56} domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`} />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => `${l} evaluations`} valueFormatter={(v) => `${fmt(v, 0)} MWh/yr`} />} />
                <Area type="stepAfter" dataKey="bestAep" name="Best AEP" stroke="#047857" strokeWidth={2} fill="#047857" fillOpacity={0.08} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {state.status === 'done' && (
            <p className="mt-1 text-[12px] text-muted">
              {state.result.evaluations} evaluations · {state.result.acceptedMoves} accepted moves · stopped by {state.result.terminatedBy} · {(state.durationMs / 1000).toFixed(1)} s. Candidate stored — compare below or show it in the twin.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
