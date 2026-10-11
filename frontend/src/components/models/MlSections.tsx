import { Atom, Network } from 'lucide-react';
import { useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MlReport } from '../../data/types';
import { date, fmt, pct } from '../../lib/format';
import { backend, useBackendStatus, type CnnPredictResponse } from '../../services/api';
import { axisProps, ChartTooltip, gridProps, Legend, SERIES } from '../charts/chartTheme';
import { NumberField, Segmented } from '../ui/controls';
import { Badge, Button, Callout, Card, CardHeader, KeyValue } from '../ui/primitives';
import { ProvenanceBadge } from '../ui/Provenance';
import { UnavailableState } from '../ui/states';

type Cnn = NonNullable<MlReport['cnnPinn']>;
type Gnn = NonNullable<MlReport['physicsGnn']>;

export function CnnPinnSection({ c }: { c: Cnn }) {
  const [view, setView] = useState<'curve' | 'week' | 'training'>('curve');
  const curve = c.pinn.curve.ws.map((ws, i) => ({ ws, pinn: c.pinn.curve.p[i], ablation: c.ablation.curve.p[i], cap: c.pinn.curve.cap[i] }));
  const week = c.pinn.testWeek.t.map((t, i) => ({ t, observed: c.pinn.testWeek.observed[i], pinn: c.pinn.testWeek.predicted[i], band: c.pinn.testWeek.lo[i] !== null ? [c.pinn.testWeek.lo[i], c.pinn.testWeek.hi[i]] : null }));
  const hist = c.pinn.history.map((h, i) => ({ epoch: h.epoch, pinn: h.valMse, ablation: c.ablation.history[i]?.valMse ?? null }));
  const rows: [string, (v: Cnn['pinn']) => string][] = [
    ['Test MAE', (v) => `${fmt(v.metrics.mae, 1)} kW`],
    ['Test RMSE', (v) => `${fmt(v.metrics.rmse, 1)} kW`],
    ['Test R²', (v) => fmt(v.metrics.r2, 4)],
    ['90% interval coverage', (v) => pct(v.interval.testCoverage, 1)],
    ['Test predictions above Betz/rated', (v) => pct(v.testAboveBetzShare, 3)],
    [`Betz/rated violations (sweep of ${c.pinn.physicsAudit.points} pts)`, (v) => String(v.physicsAudit.capViolations)],
    ['Monotonicity violations (3–11 m/s)', (v) => String(v.physicsAudit.monotonicViolations)],
    ['Cut-in violations (< 2 m/s)', (v) => String(v.physicsAudit.cutInViolations)],
    ['Epochs (early stopping)', (v) => String(v.epochs)],
  ];
  return (
    <Card>
      <CardHeader
        title={c.name}
        subtitle={`Trained ${date(c.trainedAt, true)} · ${c.artifact} · ${c.code}`}
        icon={<Atom size={16} />}
        actions={
          <>
            <Badge tone="energy">trained</Badge>
            <ProvenanceBadge kind="predicted" />
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.15fr]">
        <div className="space-y-4">
          <p className="text-[12.5px] leading-relaxed text-ink-2">{c.architecture}.</p>
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Physics residuals in the loss</div>
            <ul className="list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed text-ink-2">
              {c.physics.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <div className="mt-1.5 text-[11.5px] text-muted">
              Weights λ: {Object.entries(c.lambda).map(([k, v]) => `${k} ${v}`).join(' · ')}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="py-1.5 font-medium">Held-out test ({String(c.split.test)})</th>
                  <th className="py-1.5 text-right font-medium">CNN-PINN</th>
                  <th className="py-1.5 text-right font-medium">Same CNN, no physics</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, get]) => (
                  <tr key={label} className="border-b border-line/60">
                    <td className="py-1.5 text-ink-2">{label}</td>
                    <td className="num py-1.5 text-right font-semibold">{get(c.pinn)}</td>
                    <td className="num py-1.5 text-right">{get(c.ablation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Callout tone="neutral" title="What the physics adds">
            Accuracy is essentially the same as the unconstrained CNN, but the CNN-PINN violates the Betz/rated bound {c.ablation.physicsAudit.capViolations > 0 ? `${Math.round(c.ablation.physicsAudit.capViolations / Math.max(1, c.pinn.physicsAudit.capViolations))}× less often` : 'no more often'} in the condition sweep — it stays physically plausible where data are sparse. Interval coverage is below the 90% nominal because the windier test months differ from the September calibration month.
          </Callout>
        </div>
        <div>
          <div className="mb-2 flex justify-end">
            <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'curve', label: 'Power curve vs physics' }, { value: 'week', label: 'Test week' }, { value: 'training', label: 'Training' }]} />
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              {view === 'curve' ? (
                <LineChart data={curve} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="ws" type="number" domain={[0, 25]} ticks={[0, 5, 10, 15, 20, 25]} {...axisProps} />
                  <YAxis {...axisProps} width={46} domain={[-100, 2300]} ticks={[0, 500, 1000, 1500, 2000]} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => `${l} m/s`} valueFormatter={(v) => `${fmt(v, 0)} kW`} />} />
                  <Line dataKey="cap" name="Betz/rated bound" stroke="#95a0aa" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                  <Line dataKey="ablation" name="CNN, no physics" stroke={SERIES[1]} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                  <Line dataKey="pinn" name="CNN-PINN" stroke={SERIES[6]} strokeWidth={2.2} dot={false} isAnimationActive={false} />
                </LineChart>
              ) : view === 'week' ? (
                <ComposedChart data={week} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="t" {...axisProps} minTickGap={50} tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })} />
                  <YAxis {...axisProps} width={46} domain={[-100, 2200]} ticks={[0, 500, 1000, 1500, 2000]} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => date(String(l), true)} valueFormatter={(v) => `${fmt(v, 0)} kW`} />} />
                  <Area dataKey="band" name="90% interval" fill={SERIES[6]} fillOpacity={0.12} stroke="none" isAnimationActive={false} />
                  <Line dataKey="observed" name="Observed" stroke={SERIES[0]} strokeWidth={1.4} dot={false} isAnimationActive={false} />
                  <Line dataKey="pinn" name="CNN-PINN" stroke={SERIES[6]} strokeWidth={1.4} dot={false} isAnimationActive={false} />
                </ComposedChart>
              ) : (
                <LineChart data={hist} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="epoch" {...axisProps} />
                  <YAxis {...axisProps} width={56} tickFormatter={(v: number) => v.toFixed(4)} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => `Epoch ${l}`} valueFormatter={(v) => v.toFixed(5)} />} />
                  <Line dataKey="ablation" name="No physics (val MSE)" stroke={SERIES[1]} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                  <Line dataKey="pinn" name="CNN-PINN (val MSE)" stroke={SERIES[6]} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
          <div className="mt-2">
            {view === 'curve' && <Legend items={[{ label: 'CNN-PINN', color: SERIES[6] }, { label: 'CNN, no physics', color: SERIES[1] }, { label: 'Betz/rated bound (10 °C)', color: '#95a0aa', dashed: true }]} />}
            {view === 'week' && <Legend items={[{ label: 'Observed (R80711)', color: SERIES[0] }, { label: 'CNN-PINN', color: SERIES[6] }, { label: '90% interval', color: SERIES[6], band: true }]} />}
            {view === 'training' && <Legend items={[{ label: 'CNN-PINN', color: SERIES[6] }, { label: 'No physics', color: SERIES[1] }]} />}
            {view === 'curve' && <p className="mt-1.5 text-[11.5px] text-muted">Steady conditions: wind from 180°, 10 °C, Ws_std = 0.1·v. x = wind speed (m/s), y = kW.</p>}
          </div>
          <LivePredict />
        </div>
      </div>
    </Card>
  );
}

function LivePredict() {
  const [status] = useBackendStatus();
  const [ws, setWs] = useState(9);
  const [wa, setWa] = useState(210);
  const [temp, setTemp] = useState(10);
  const [res, setRes] = useState<CnnPredictResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const online = status.state === 'online' && status.health.capabilities.cnn_pinn;
  if (!online) {
    return (
      <UnavailableState
        className="mt-4 py-4"
        title="Live inference needs the backend"
        reason="The trained weights run in PyTorch on the FastAPI backend (/api/models/cnn-pinn/predict). The charts above are precomputed from the same model."
      />
    );
  }
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await backend.cnnPredict({ wind_speed: ws, wind_direction: wa, temperature: temp }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 rounded-xl border border-line p-3">
      <div className="mb-2 text-[13px] font-semibold">Live CNN-PINN inference (backend)</div>
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Wind speed" unit="m/s" value={ws} min={0} max={30} step={0.5} onChange={setWs} />
        <NumberField label="Direction" unit="°" value={wa} min={0} max={359} step={10} onChange={setWa} />
        <NumberField label="Temperature" unit="°C" value={temp} min={-30} max={45} step={1} onChange={setTemp} />
      </div>
      <Button size="sm" variant="primary" className="mt-2" onClick={run} disabled={busy}>
        {busy ? 'Predicting…' : 'Predict'}
      </Button>
      {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
      {res && (
        <div className="mt-2">
          <KeyValue
            rows={[
              ['Predicted power', `${fmt(res.power_kw, 0)} kW`],
              ['90% interval', `${fmt(res.interval_kw[0], 0)} – ${fmt(res.interval_kw[1], 0)} kW`],
              ['Betz/rated bound', `${fmt(res.physics_cap_kw, 0)} kW`],
              ['Air density (from temperature)', `${fmt(res.air_density, 3)} kg/m³`],
            ]}
          />
        </div>
      )}
    </div>
  );
}

export function PhysicsGnnSection({ g }: { g: Gnn }) {
  const [sector, setSector] = useState(7);
  const A = g.gnn.adjacency;
  const W = A.weights[sector];
  return (
    <Card>
      <CardHeader
        title={g.name}
        subtitle={`Trained ${date(g.trainedAt, true)} · ${g.artifact} · ${g.code}`}
        icon={<Network size={16} />}
        actions={
          <>
            <Badge tone="energy">trained</Badge>
            <ProvenanceBadge kind="predicted" />
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-3 text-[12.5px] leading-relaxed text-ink-2">
          <p>{g.graph}. Node features: {g.nodeFeatures.join(', ')}; physics residuals as in the CNN-PINN, applied per turbine.</p>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-1.5 font-medium">Test ({g.split.testSamples} synchronised samples)</th>
                <th className="py-1.5 text-right font-medium">With message passing</th>
                <th className="py-1.5 text-right font-medium">Without</th>
              </tr>
            </thead>
            <tbody>
              {(['mae', 'rmse', 'r2'] as const).map((k) => (
                <tr key={k} className="border-b border-line/60">
                  <td className="py-1.5 uppercase text-ink-2">{k === 'r2' ? 'R²' : k}</td>
                  <td className="num py-1.5 text-right font-semibold">{fmt(g.gnn.metrics[k], k === 'r2' ? 4 : 1)}</td>
                  <td className="num py-1.5 text-right">{fmt(g.ablation.metrics[k], k === 'r2' ? 4 : 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Callout tone="warn" title="Finding: no gain from turbine interaction">
            Message passing does not improve accuracy here (RMSE {fmt(g.gnn.metrics.rmse, 1)} vs {fmt(g.ablation.metrics.rmse, 1)} kW), and the learned adjacency is nearly uniform. Each turbine’s own nacelle anemometer already measures its waked inflow, and without coordinates there is little extra signal to share between four turbines. Wake effects are therefore handled by the physics wake model, not by this GNN.
          </Callout>
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">Learned edge weight a(i ← j), wind from {A.sectors[sector]}°</span>
            <input type="range" aria-label="Wind sector" min={0} max={A.sectors.length - 1} value={sector} onChange={(e) => setSector(Number(e.target.value))} className="w-40" />
          </div>
          <div className="grid gap-1" style={{ gridTemplateColumns: `80px repeat(${A.turbines.length}, 1fr)` }}>
            <div />
            {A.turbines.map((t) => (
              <div key={t} className="text-center text-[11px] font-medium text-muted">
                {t}
              </div>
            ))}
            {A.turbines.map((ti, i) => (
              <div key={ti} className="contents">
                <div className="flex items-center text-[11px] font-medium text-muted">{ti}</div>
                {W[i].map((v, j) => (
                  <div key={j} title={`${ti} ← ${A.turbines[j]}: ${v}`} className="num flex h-12 items-center justify-center rounded-md text-[11.5px] font-semibold" style={{ background: i === j ? '#f1f0eb' : `rgba(43,99,198,${0.08 + v * 0.8})`, color: v > 0.55 && i !== j ? '#fff' : '#2f4256' }}>
                    {i === j ? '—' : v.toFixed(2)}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-muted">Row = receiving turbine, column = sending turbine. Darker = stronger learned influence. Weights are model internals, not measured wake effects.</p>
        </div>
      </div>
    </Card>
  );
}
