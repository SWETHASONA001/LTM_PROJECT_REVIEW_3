import { TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, ChartTooltip, gridProps, Legend, SERIES } from '../components/charts/chartTheme';
import { Segmented } from '../components/ui/controls';
import { Callout, Card, CardHeader, PageHeader } from '../components/ui/primitives';
import { ProvenanceBadge } from '../components/ui/Provenance';
import { DataGate, UnavailableState } from '../components/ui/states';
import type { ForecastReport } from '../data/types';
import { date, fmt, fmtInt } from '../lib/format';
import { useDataset } from '../services/dataService';

export default function ForecastingPage() {
  const state = useDataset('forecast');
  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="Energy forecasting"
        description="Forecast skill on the held-out test period (Oct 2017 → Jan 2018) for the 4-turbine farm’s hourly power. Only naive baselines are implemented; they set the bar any learned forecaster must beat."
        actions={<ProvenanceBadge kind="predicted" />}
      />
      <DataGate state={state} className="h-[50vh]">
        {(f) => <Content f={f} />}
      </DataGate>
    </div>
  );
}

function Content({ f }: { f: ForecastReport }) {
  const [metric, setMetric] = useState<'mae' | 'rmse'>('rmse');
  const rows = f.horizons.map((h) => ({ h: `${h.horizonH} h`, persistence: h.persistence[metric], climatology: h.climatology[metric] }));
  const win = f.window.t.map((t, i) => ({ t, observed: f.window.observed[i], persistence6h: f.window.persistence6h[i], climatology: f.window.climatology[i] }));
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
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
                <Bar dataKey="persistence" name="Persistence" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                <Bar dataKey="climatology" name="Climatology" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: 'Persistence P(t+h)=P(t)', color: SERIES[0] }, { label: 'Hour-of-day climatology', color: SERIES[1] }]} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="py-1.5 font-medium">Horizon</th>
                  <th className="py-1.5 text-right font-medium">Persistence MAE</th>
                  <th className="py-1.5 text-right font-medium">RMSE</th>
                  <th className="py-1.5 text-right font-medium">R²</th>
                  <th className="py-1.5 text-right font-medium">Climatology RMSE</th>
                </tr>
              </thead>
              <tbody>
                {f.horizons.map((h) => (
                  <tr key={h.horizonH} className="border-b border-line/60">
                    <td className="py-1.5">{h.horizonH} h</td>
                    <td className="num py-1.5 text-right">{fmt(h.persistence.mae, 0)}</td>
                    <td className="num py-1.5 text-right">{fmt(h.persistence.rmse, 0)}</td>
                    <td className="num py-1.5 text-right">{fmt(h.persistence.r2, 3)}</td>
                    <td className="num py-1.5 text-right">{fmt(h.climatology.rmse, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader title="Learned forecasting model" />
          <UnavailableState
            title="No trained forecaster in the repository"
            reason="A CNN-PINN or sequence model forecaster has no code, weights or evaluation yet. When added, its metrics will appear beside these baselines on the same split."
            requirement="Integration point: backend POST /api/forecast (returns 501 until a trained model is deployed) — horizon-wise predictions with intervals."
          />
          <Callout tone="neutral">
            <span>
              Persistence is strong at 1 h (R² {fmt(f.horizons[0].persistence.r2, 2)}) and degrades past ~12 h, where climatology becomes competitive. Numerical-weather-prediction inputs are not in the repository, so day-ahead skill beyond climatology is not achievable with the current data.
            </span>
          </Callout>
        </Card>
      </div>
      <Card>
        <CardHeader title="Test window: 1–14 Dec 2017" subtitle="Observed farm power vs 6-hour persistence and climatology (kW)" actions={<ProvenanceBadge kind="predicted" />} />
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={win} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="t" {...axisProps} minTickGap={50} tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })} />
              <YAxis {...axisProps} width={48} />
              <Tooltip content={<ChartTooltip labelFormatter={(l) => date(String(l), true)} valueFormatter={(v) => `${fmt(v, 0)} kW`} />} />
              <Line dataKey="observed" name="Observed" stroke={SERIES[0]} strokeWidth={1.8} dot={false} isAnimationActive={false} />
              <Line dataKey="persistence6h" name="Persistence +6 h" stroke={SERIES[1]} strokeWidth={1.4} dot={false} isAnimationActive={false} />
              <Line dataKey="climatology" name="Climatology" stroke={SERIES[2]} strokeWidth={1.4} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <Legend items={[{ label: 'Observed (SCADA)', color: SERIES[0] }, { label: 'Persistence +6 h', color: SERIES[1] }, { label: 'Climatology', color: SERIES[2] }]} />
      </Card>
    </div>
  );
}
