import { TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, ChartTooltip, gridProps, Legend, SERIES } from '../components/charts/chartTheme';
import { Segmented } from '../components/ui/controls';
import { Badge, Button, Callout, Card, CardHeader, PageHeader } from '../components/ui/primitives';
import { ProvenanceBadge } from '../components/ui/Provenance';
import { DataGate, UnavailableState } from '../components/ui/states';
import type { ForecastReport, MlReport } from '../data/types';
import { date, fmt, fmtInt, pct, signedPct } from '../lib/format';
import { backend, useBackendStatus, type ForecastResponse } from '../services/api';
import { useDatasets } from '../services/dataService';

export default function ForecastingPage() {
  const state = useDatasets(['forecast', 'ml_models']);
  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="Energy forecasting"
        description="Hourly 4-turbine farm power forecasts 1–24 h ahead on the held-out test period (Oct 2017 → Jan 2018), compared with persistence and climatology baselines on identical hours."
        actions={<ProvenanceBadge kind="predicted" />}
      />
      <DataGate state={state} className="h-[50vh]">
        {(d) => <Content f={d.forecast} ml={d.ml_models} />}
      </DataGate>
    </div>
  );
}

function Content({ f, ml }: { f: ForecastReport; ml: MlReport }) {
  const [metric, setMetric] = useState<'mae' | 'rmse'>('rmse');
  const fc = ml.forecaster;
  const rows = f.horizons.map((h) => {
    const m = fc?.horizons.find((x) => x.horizonH === h.horizonH);
    return { h: `${h.horizonH} h`, model: m ? m.model[metric] : null, persistence: h.persistence[metric], climatology: h.climatology[metric] };
  });
  const win = fc?.window6h.t.map((t, i) => ({ t, observed: fc.window6h.observed[i], forecast: fc.window6h.forecast[i], persistence: fc.window6h.persistence[i], band: fc.window6h.lo[i] !== null ? [fc.window6h.lo[i], fc.window6h.hi[i]] : null }));

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader
            title="Error by forecast horizon"
            subtitle={`Farm hourly power (kW), ${fmtInt(f.split.testHours)} test hours`}
            icon={<TrendingUp size={16} />}
            actions={<Segmented size="sm" value={metric} onChange={setMetric} options={[{ value: 'rmse', label: 'RMSE' }, { value: 'mae', label: 'MAE' }]} />}
          />
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="h" {...axisProps} />
                <YAxis {...axisProps} width={48} />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => `Horizon ${l}`} valueFormatter={(v) => `${fmt(v, 0)} kW`} />} cursor={{ fill: '#0b1f330a' }} />
                {fc && <Bar dataKey="model" name="GBM forecaster" fill={SERIES[6]} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />}
                <Bar dataKey="persistence" name="Persistence" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                <Bar dataKey="climatology" name="Climatology" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[...(fc ? [{ label: 'Gradient-boosted forecaster', color: SERIES[6] }] : []), { label: 'Persistence P(t+h)=P(t)', color: SERIES[0] }, { label: 'Hour-of-day climatology', color: SERIES[1] }]} />
        </Card>
        {fc ? (
          <Card>
            <CardHeader title={fc.name} subtitle={`Trained ${date(fc.trainedAt, true)} · ${fc.artifact}`} actions={<Badge tone="energy">trained</Badge>} />
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th className="py-1.5 font-medium">h</th>
                    <th className="py-1.5 text-right font-medium">RMSE</th>
                    <th className="py-1.5 text-right font-medium">vs persistence</th>
                    <th className="py-1.5 text-right font-medium">90% PI coverage</th>
                    <th className="py-1.5 text-right font-medium">raw quantiles</th>
                  </tr>
                </thead>
                <tbody>
                  {fc.horizons.map((h) => (
                    <tr key={h.horizonH} className="border-b border-line/60">
                      <td className="py-1.5">{h.horizonH} h</td>
                      <td className="num py-1.5 text-right">{fmt(h.model.rmse, 0)} kW</td>
                      <td className={`num py-1.5 text-right font-semibold ${h.skillVsPersistence > 0 ? 'text-ok' : 'text-danger'}`}>{signedPct(-h.skillVsPersistence, 1)}</td>
                      <td className="num py-1.5 text-right">{pct(h.intervalCoverage, 1)}</td>
                      <td className="num py-1.5 text-right text-muted">{pct(h.rawQuantileCoverage, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              {fc.method}. “vs persistence” = change in RMSE (negative is better). Persistence is hard to beat at 1 h; the model helps from 3 h on. Coverage stays below 90% because winter test hours are more volatile than the September calibration month.
            </p>
          </Card>
        ) : (
          <Card>
            <UnavailableState title="Forecaster not trained" reason="Run ml/train_forecaster.py to train and evaluate the learned forecaster." />
          </Card>
        )}
      </div>

      {win && (
        <Card>
          <CardHeader title="6-hour-ahead forecast: 1–14 Dec 2017" subtitle="Observed farm power vs forecast with conformal 90% interval and 6 h persistence (kW)" actions={<ProvenanceBadge kind="predicted" />} />
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={win} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="t" {...axisProps} minTickGap={50} tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })} />
                <YAxis {...axisProps} width={48} />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => date(String(l), true)} valueFormatter={(v) => `${fmt(v, 0)} kW`} />} />
                <Area dataKey="band" name="90% interval" fill={SERIES[6]} fillOpacity={0.12} stroke="none" isAnimationActive={false} />
                <Line dataKey="observed" name="Observed" stroke={SERIES[0]} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                <Line dataKey="persistence" name="Persistence" stroke={SERIES[1]} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                <Line dataKey="forecast" name="Forecast" stroke={SERIES[6]} strokeWidth={1.8} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: 'Observed (SCADA)', color: SERIES[0] }, { label: 'GBM forecast +6 h', color: SERIES[6] }, { label: '90% interval', color: SERIES[6], band: true }, { label: 'Persistence +6 h', color: SERIES[1] }]} />
        </Card>
      )}

      <LiveForecast />

      <Callout tone="neutral">
        Inputs are lagged SCADA power and wind plus calendar terms. Numerical-weather-prediction inputs are not in the repository, which caps day-ahead skill; adding NWP wind forecasts is the main lever for longer horizons.
      </Callout>
    </div>
  );
}

function LiveForecast() {
  const [status] = useBackendStatus();
  const [issue, setIssue] = useState('2017-12-03T06:00');
  const [res, setRes] = useState<ForecastResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const online = status.state === 'online' && status.health.capabilities.forecaster;
  return (
    <Card>
      <CardHeader title="Issue a forecast" subtitle="Run the trained model on the backend from any hour in the record and compare with what happened." />
      {!online ? (
        <UnavailableState className="py-5" title="Backend required" reason="Live forecasting runs the saved model on the FastAPI backend (/api/forecast)." />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[12.5px] font-medium text-ink-2">
              Issue time (UTC)
              <input type="datetime-local" value={issue} min="2017-01-02T00:00" max="2018-01-11T00:00" onChange={(e) => setIssue(e.target.value)} className="mt-1 block h-8 rounded-lg border border-line px-2 text-[13px]" />
            </label>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  setRes(await backend.forecast(`${issue}:00Z`));
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Forecasting…' : 'Forecast'}
            </Button>
          </div>
          {err && <p className="text-[12px] text-danger">{err}</p>}
          {res && (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="py-1.5 font-medium">Target (UTC)</th>
                  <th className="py-1.5 text-right font-medium">Forecast</th>
                  <th className="py-1.5 text-right font-medium">90% interval</th>
                  <th className="py-1.5 text-right font-medium">Observed</th>
                </tr>
              </thead>
              <tbody>
                {res.forecasts.map((r) => (
                  <tr key={r.horizon_h} className="border-b border-line/60">
                    <td className="py-1.5">
                      +{r.horizon_h} h · {date(r.target_time, true)}
                    </td>
                    <td className="num py-1.5 text-right font-semibold">{fmt(r.forecast_kw, 0)} kW</td>
                    <td className="num py-1.5 text-right">
                      {fmt(r.interval_kw[0], 0)} – {fmt(r.interval_kw[1], 0)}
                    </td>
                    <td className="num py-1.5 text-right">{r.observed_kw === null ? '—' : `${fmt(r.observed_kw, 0)} kW`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}
