import { BrainCircuit, CircleDot, FlaskConical } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ComposedChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, ChartTooltip, gridProps, Legend, SERIES } from '../components/charts/chartTheme';
import { Badge, Callout, Card, CardHeader, KeyValue, PageHeader } from '../components/ui/primitives';
import { ProvenanceBadge } from '../components/ui/Provenance';
import { CnnPinnSection, PhysicsGnnSection } from '../components/models/MlSections';
import { DataGate } from '../components/ui/states';
import type { MlReport, ModelsReport } from '../data/types';
import { date, fmt, fmtInt, pct } from '../lib/format';
import { WAKE_MODEL_LABEL } from '../physics/wake';
import { useDatasets } from '../services/dataService';

export default function ModelsPage() {
  const state = useDatasets(['models', 'ml_models']);
  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="Model performance"
        description="Every model listed here has code, a saved artifact and an evaluation on the same time-aware held-out period (Oct 2017 → Jan 2018). Results are reported as measured — including where a model does not help."
      />
      <DataGate state={state} className="h-[50vh]">
        {(d) => <Content m={d.models} ml={d.ml_models} />}
      </DataGate>
    </div>
  );
}

function Content({ m, ml }: { m: ModelsReport; ml: MlReport }) {
  const hist = m.residualHistogram.counts.map((c, i) => ({ r: m.residualHistogram.edges[i] + 25, c }));
  const scatter = m.scatter.observed.map((o, i) => ({ obs: o, pred: m.scatter.predicted[i] })).filter((d) => d.obs !== null && d.pred !== null);
  const perTurbine = Object.entries(m.perTurbine).map(([id, v]) => ({ id, fleet: v.fleetCurve.rmse, turbine: v.turbineCurve.rmse, n: v.fleetCurve.n, r2: v.fleetCurve.r2 }));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        {m.models.map((md, i) => (
          <Card key={md.id}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <BrainCircuit size={16} className="text-ink-2" />
                  <h3 className="text-[15px] font-semibold">{md.name}</h3>
                </div>
                <div className="mt-1 text-[12px] text-muted">{md.family}</div>
              </div>
              <ProvenanceBadge kind={md.provenance} />
            </div>
            <div className="mb-3 grid grid-cols-3 gap-2 rounded-lg bg-subtle p-3">
              <Metric label="MAE" value={`${fmt(md.metrics.mae, 1)}`} unit="kW" />
              <Metric label="RMSE" value={`${fmt(md.metrics.rmse, 1)}`} unit="kW" />
              <Metric label="R²" value={fmt(md.metrics.r2, 3)} />
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink-2">{md.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone={md.status === 'trained' ? 'energy' : 'neutral'}>{md.status}</Badge>
              <Badge>n = {fmtInt(md.metrics.n)} test records</Badge>
              <Badge>bias {fmt(md.metrics.bias, 1)} kW</Badge>
              {i === 0 && md.interval && <Badge tone="h2">90% PI coverage {pct(md.interval.testCoverage, 1)}</Badge>}
            </div>
          </Card>
        ))}
      </div>

      {ml.cnnPinn && <CnnPinnSection c={ml.cnnPinn} />}
      {ml.physicsGnn && <PhysicsGnnSection g={ml.physicsGnn} />}

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title="Validation configuration" icon={<FlaskConical size={16} />} />
          <KeyValue
            rows={[
              ['Split method', m.split.method],
              ['Training period', `→ ${date(m.split.trainEnd)} (exclusive)`],
              ['Test period', `${date(m.split.testStart)} → end of record`],
              ['Training rows', fmtInt(m.split.trainRows)],
              ['Test rows', fmtInt(m.split.testRows)],
              ['Target', m.split.target],
              ['Features', m.split.features.join(', ')],
              ['Evaluated', date(m.generatedAt, true)],
              ['Code', 'scripts/build_frontend_data.py → build_models()'],
            ]}
          />
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Time-aware holdout avoids leakage from autocorrelated 10-min records. Test months (Oct–Jan) are windier than the training average, so test metrics reflect a seasonal shift. Prediction interval = per-bin empirical 5–95% quantiles from training (nominal 90%).
          </p>
        </Card>
        <Card>
          <CardHeader title="Observed vs predicted (test sample, fleet curve)" subtitle="1,500 random held-out records, kW" actions={<ProvenanceBadge kind="predicted" />} />
          <div className="h-64">
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#ebe9e3" />
                <XAxis dataKey="pred" type="number" name="Predicted" {...axisProps} domain={[0, 2100]} ticks={[0, 500, 1000, 1500, 2000]} />
                <YAxis dataKey="obs" type="number" name="Observed" {...axisProps} width={44} domain={[-50, 2100]} ticks={[0, 500, 1000, 1500, 2000]} />
                <Tooltip content={<ChartTooltip labelFormatter={() => 'Test record'} valueFormatter={(v) => `${fmt(v, 0)} kW`} />} />
                <Scatter data={scatter} fill={SERIES[0]} fillOpacity={0.35} isAnimationActive={false} name="Record" />
                <Scatter data={[{ pred: 0, obs: 0 }, { pred: 2050, obs: 2050 }]} line={{ stroke: '#0b1f33', strokeWidth: 1 }} shape={() => <g />} isAnimationActive={false} name="1:1" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[11.5px] text-muted">x = predicted, y = observed. The cloud below the 1:1 line at high predicted power is downtime/curtailment, which a wind-speed-only model cannot explain.</div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Residual distribution (test)" subtitle="Observed − predicted, 50 kW bins, clipped at ±1000 kW" actions={<ProvenanceBadge kind="predicted" />} />
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={hist} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={1}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="r" {...axisProps} minTickGap={30} />
                <YAxis {...axisProps} width={48} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => `${Number(l) - 25} to ${Number(l) + 25} kW`} valueFormatter={(v) => fmtInt(v)} />} cursor={{ fill: '#0b1f330a' }} />
                <Bar dataKey="c" name="Records" fill={SERIES[0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader title="Per-turbine RMSE (test)" subtitle="Fleet curve vs turbine-specific curve, kW" actions={<ProvenanceBadge kind="predicted" />} />
          <div className="h-52">
            <ResponsiveContainer>
              <ComposedChart data={perTurbine} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="id" {...axisProps} />
                <YAxis {...axisProps} width={40} />
                <Tooltip content={<ChartTooltip valueFormatter={(v) => `${fmt(v, 1)} kW`} />} cursor={{ fill: '#0b1f330a' }} />
                <Bar dataKey="fleet" name="Fleet curve" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                <Bar dataKey="turbine" name="Turbine curve" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: 'Fleet curve', color: SERIES[0] }, { label: 'Turbine-specific curve', color: SERIES[1] }]} />
        </Card>
      </div>

      <Card>
        <CardHeader title="Model registry" subtitle="Status of every model referenced in the project brief" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {m.models.map((md) => (
            <RegistryRow key={md.id} name={md.name} status={md.status === 'trained' ? 'Trained & evaluated' : 'Reference (no training)'} ok />
          ))}
          <RegistryRow name="Gaussian wake model" status={`Implemented in-browser — ${WAKE_MODEL_LABEL.split('(')[0]}`} ok />
          <RegistryRow name="Layout optimizer" status="Implemented (pattern search, Web Worker)" ok />
          <RegistryRow name="Anomaly detector (power-curve residual)" status="Implemented & applied to full record" ok />
          {ml.cnnPinn && <RegistryRow name="CNN-PINN wind-power model" status={`Trained · R² ${fmt(ml.cnnPinn.pinn.metrics.r2, 3)} · ${ml.cnnPinn.artifact}`} ok />}
          {ml.physicsGnn && <RegistryRow name="Dynamic Physics-GNN" status={`Trained · R² ${fmt(ml.physicsGnn.gnn.metrics.r2, 3)} · no gain over ablation`} ok />}
          {ml.forecaster && <RegistryRow name="Gradient-boosted forecaster" status={`Trained · 1–24 h · CQR intervals · ${ml.forecaster.artifact}`} ok />}
          {ml.isolationForest && <RegistryRow name="Isolation Forest" status={`Trained · ${ml.isolationForest.eventCount} events · ${ml.isolationForest.artifact}`} ok />}
          {m.notImplemented.map((n) => (
            <RegistryRow key={n.id} name={n.name} status={n.reason} />
          ))}
          <RegistryRow name="FLORIS" status="Backend: wake simulation and server-side layout optimisation (FLORIS 4.x, Gauss model)" ok />
        </div>
      </Card>

      <Card>
        <CardHeader title="How physics enters the models" />
        <div className="grid gap-4 text-[12.5px] leading-relaxed text-ink-2 md:grid-cols-3">
          <p>
            <strong>CNN-PINN:</strong> physics residuals (Betz/rated bound with temperature-derived density, monotonic power below rated, zero below cut-in) are terms of the training loss, evaluated on data and on synthetic collocation inputs across 0–25 m/s. This is what makes it physics-informed — not displaying a wake model beside it.
          </p>
          <p>
            <strong>Physics reference:</strong> a pure actuator-disc model (no learning) scores R² {fmt(m.models[2]?.metrics.r2, 3)} on the same test set, quantifying what physics with an assumed C_p alone misses versus learned models (R² ≈ {fmt(ml.cnnPinn?.pinn.metrics.r2 ?? m.models[0]?.metrics.r2, 3)}).
          </p>
          <p>
            <strong>Wake physics:</strong> farm-level wake losses come from the Gaussian wake model (in-browser) and FLORIS (backend), which agree within ~0.5% on farm power. The learned models predict single-turbine power from that turbine’s own measured inflow.
          </p>
        </div>
      </Card>

      <Callout tone="neutral">Baselines are recomputed by <code>scripts/build_frontend_data.py</code>; trained models by <code>ml/train_*.py</code> (artifacts in <code>models/</code>, trained timestamps shown on each card).</Callout>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted">{label}</div>
      <div className="num text-[16px] font-semibold">
        {value}
        {unit && <span className="ml-0.5 text-[11px] font-normal text-muted">{unit}</span>}
      </div>
    </div>
  );
}

function RegistryRow({ name, status, ok }: { name: string; status: string; ok?: boolean }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-line px-3 py-2.5">
      <CircleDot size={15} className={ok ? 'mt-0.5 text-ok' : 'mt-0.5 text-faint'} />
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{name}</div>
        <div className="text-[11.5px] leading-snug text-muted">{status}</div>
      </div>
    </div>
  );
}
