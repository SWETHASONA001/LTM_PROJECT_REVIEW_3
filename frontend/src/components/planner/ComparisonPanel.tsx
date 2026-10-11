import clsx from 'clsx';
import { Check, Save } from 'lucide-react';
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { energy, fmt, pct, power, signed, signedPct } from '../../lib/format';
import type { SiteEngineering } from '../../lib/engineering';
import { evaluateLayout, explainDifference, type LayoutEvaluation } from '../../lib/scenarioMetrics';
import { WAKE_MODEL_LABEL } from '../../physics/wake';
import { useScenarioStore, useUiStore } from '../../store/appStores';
import { useSiteStore, type SiteId, type SiteState } from '../../store/siteStore';
import { axisProps, ChartTooltip, gridProps, Legend, SERIES } from '../charts/chartTheme';
import { Button, Card, CardHeader } from '../ui/primitives';
import { ProvenanceBadge } from '../ui/Provenance';
import { LayoutThumb } from './LayoutCanvas';

interface Column {
  key: 'baseline' | 'current' | 'candidate';
  label: string;
  ev: LayoutEvaluation;
  color: string;
}

export function ComparisonPanel({ site, st, eng }: { site: SiteId; st: SiteState; eng: SiteEngineering }) {
  const applyCandidate = useSiteStore((s) => s.applyCandidate);
  const addScenario = useScenarioStore((s) => s.add);
  const notify = useUiStore((s) => s.notify);
  const cols = useMemo<Column[]>(() => {
    const c: Column[] = [
      { key: 'baseline', label: 'Baseline', ev: evaluateLayout(st.baseline, eng, st), color: SERIES[0] },
      { key: 'current', label: 'Current edit', ev: evaluateLayout(st.turbines, eng, st), color: SERIES[1] },
    ];
    if (st.candidate) c.push({ key: 'candidate', label: 'Optimized candidate', ev: evaluateLayout(st.candidate.turbines, eng, st), color: SERIES[2] });
    return c;
  }, [st, eng]);

  const base = cols[0].ev;
  const rel = (d: number, a: number) => (a ? ` (${signedPct(d / a)})` : '');
  const D = eng.model.rotorDiameter.value;
  const rows: { label: string; get: (e: LayoutEvaluation) => number; fmt: (v: number) => string; delta: (d: number, a: number) => string; higherBetter?: boolean }[] = [
    { label: 'Turbines', get: (e) => e.metrics.nTurbines, fmt: String, delta: (d) => signed(d, 0) },
    { label: `Farm power @ ${Math.round(st.windDir)}°, ${st.windSpeed} m/s`, get: (e) => e.metrics.farmKw, fmt: (v) => power(v), delta: (d, a) => `${signed(d / 1000, 2)} MW${rel(d, a)}`, higherBetter: true },
    { label: 'Wake loss @ selected condition', get: (e) => e.metrics.wakeLossInstant, fmt: (v) => pct(v, 2), delta: (d) => `${signed(d * 100, 2)} pp`, higherBetter: false },
    { label: 'Annual energy (wind-rose AEP)', get: (e) => e.metrics.aepMWh, fmt: (v) => energy(v, 2), delta: (d, a) => `${signed(d, 0)} MWh${rel(d, a)}`, higherBetter: true },
    { label: 'AEP without wakes', get: (e) => e.metrics.aepNoWakeMWh, fmt: (v) => energy(v, 2), delta: (d, a) => `${signed(d, 0)} MWh${rel(d, a)}` },
    { label: 'Annual wake loss', get: (e) => e.metrics.wakeLossAnnual, fmt: (v) => pct(v, 2), delta: (d) => `${signed(d * 100, 2)} pp`, higherBetter: false },
    { label: 'Minimum spacing', get: (e) => e.metrics.minSpacingM, fmt: (v) => `${fmt(v, 0)} m (${fmt(v / D, 1)}D)`, delta: (d) => `${signed(d, 0)} m` },
    { label: 'Constraint violations', get: (e) => e.metrics.violations, fmt: String, delta: (d) => signed(d, 0), higherBetter: false },
  ];

  const sectorData = cols[0].ev.aep.bySector.map((s, i) => {
    const o: Record<string, number> = { dir: s.dir };
    cols.forEach((c) => (o[c.label] = Math.round(c.ev.aep.bySector[i]?.energyMWh ?? 0)));
    return o;
  });
  const cand = cols.find((c) => c.key === 'candidate') ?? cols[1];
  const explanation = explainDifference(base.aep, cand.ev.aep, base.metrics.nTurbines, cand.ev.metrics.nTurbines);

  const save = (c: Column) => {
    const turbines = c.key === 'baseline' ? st.baseline : c.key === 'current' ? st.turbines : st.candidate!.turbines;
    addScenario({
      name: `${site === 'onshore' ? 'Onshore' : 'Offshore'} · ${c.label} · ${new Date().toLocaleDateString('en-GB')}`,
      site,
      origin: c.key === 'candidate' ? 'optimized' : c.key === 'baseline' ? 'baseline' : 'manual',
      turbines,
      conditions: { windDir: st.windDir, windSpeed: st.windSpeed, ti: st.ti, minSpacingD: st.minSpacingD },
      resourceLabel: eng.cases.label,
      wakeModel: WAKE_MODEL_LABEL,
      metrics: c.ev.metrics,
    });
    notify({ title: 'Scenario saved', body: `${c.label} (${site}) added to Optimization Scenarios.`, tone: 'success', href: '/scenarios' });
  };

  return (
    <Card>
      <CardHeader
        title="Baseline vs candidate comparison"
        subtitle={<>All values computed now from the in-browser Gaussian wake model. AEP uses: {eng.cases.label}.</>}
        actions={<ProvenanceBadge kind="physics" detail={WAKE_MODEL_LABEL} />}
      />
      <div className={clsx('mb-5 grid gap-3', cols.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {cols.map((c) => (
          <div key={c.key} className="rounded-xl border border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
                {c.label}
              </span>
              {c.key === 'candidate' && <ProvenanceBadge kind="optimized" detail={st.candidate?.method} />}
            </div>
            <div className="aspect-square max-h-48 w-full">
              <LayoutThumb turbines={c.key === 'baseline' ? st.baseline : c.key === 'current' ? st.turbines : st.candidate!.turbines} boundary={st.boundary} highlight={c.key === 'baseline' ? undefined : st.baseline} />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" icon={<Save size={13} />} onClick={() => save(c)}>
                Save as scenario
              </Button>
              {c.key === 'candidate' && (
                <Button size="sm" variant="subtle" icon={<Check size={13} />} onClick={() => applyCandidate(site)}>
                  Apply to current
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-muted">
              <th className="py-2 pr-3 font-medium">Metric</th>
              {cols.map((c) => (
                <th key={c.key} className="py-2 pr-3 text-right font-medium">
                  {c.label}
                </th>
              ))}
              {cols.slice(1).map((c) => (
                <th key={`d${c.key}`} className="py-2 pr-1 text-right font-medium">
                  Δ {c.key === 'candidate' ? 'candidate' : 'current'} vs baseline
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-line/70 last:border-0">
                <td className="py-2 pr-3 text-ink-2">{r.label}</td>
                {cols.map((c) => (
                  <td key={c.key} className="num py-2 pr-3 text-right font-medium">
                    {r.fmt(r.get(c.ev))}
                  </td>
                ))}
                {cols.slice(1).map((c) => {
                  const a = r.get(base);
                  const b = r.get(c.ev);
                  const d = b - a;
                  const good = r.higherBetter === undefined ? null : r.higherBetter ? d > 1e-9 : d < -1e-9;
                  const bad = r.higherBetter === undefined ? null : r.higherBetter ? d < -1e-9 : d > 1e-9;
                  return (
                    <td key={`d${c.key}`} className={clsx('num py-2 pr-1 text-right text-[12.5px]', good && 'text-ok', bad && 'text-danger', !good && !bad && 'text-muted')}>
                      {Math.abs(d) < 1e-9 ? '—' : r.delta(d, a)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">Annual energy by wind-direction sector</span>
            <Legend items={cols.map((c) => ({ label: c.label, color: c.color }))} />
          </div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={sectorData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="dir" {...axisProps} tickFormatter={(v: number) => `${v}°`} />
                <YAxis {...axisProps} width={52} tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`} />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => `Sector ${l}°`} valueFormatter={(v) => `${fmt(v, 0)} MWh/yr`} />} cursor={{ fill: '#0b1f330a' }} />
                {cols.map((c) => (
                  <Bar key={c.key} dataKey={c.label} fill={c.color} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl bg-subtle p-4">
          <div className="mb-2 text-[13px] font-semibold">Why {cand.label.toLowerCase()} differs from baseline</div>
          <ul className="list-disc space-y-1.5 pl-4 text-[12.5px] leading-relaxed text-ink-2">
            {explanation.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] leading-snug text-muted">
            Simulation outputs, not SCADA measurements. Assumes 100% availability, identical turbines, a single ambient TI ({pct(st.ti, 0)}) and no terrain/stability effects. No uncertainty band is computed for AEP.
          </p>
        </div>
      </div>
    </Card>
  );
}
