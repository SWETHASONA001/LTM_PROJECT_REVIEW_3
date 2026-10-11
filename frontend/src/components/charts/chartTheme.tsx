import type { ReactNode } from 'react';

/**
 * Chart tokens. Categorical slots follow the validated reference order
 * (dataviz skill palette) — assigned by entity, never by rank.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

/** Fixed colour per real SCADA turbine (entity → colour, stable under filters). */
export const TURBINE_COLORS: Record<string, string> = {
  R80711: SERIES[0],
  R80721: SERIES[1],
  R80736: SERIES[2],
  R80790: SERIES[3],
};

/** Sequential blue ramp (light → dark) for magnitude encodings. */
export const BLUE_RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];

export const GRID = '#ebe9e3';
export const AXIS_TEXT = '#66727f';
export const INK = '#0b1f33';

export const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11, fill: AXIS_TEXT },
} as const;

export const gridProps = { stroke: GRID, vertical: false } as const;

interface TooltipRow {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  dataKey?: string | number;
  unit?: string;
  payload?: Record<string, unknown>;
}

/** Shared tooltip: values in ink, colour only on the swatch. */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: string | number;
  labelFormatter?: (l: string | number) => ReactNode;
  valueFormatter?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[160px] rounded-lg border border-line bg-white/95 px-3 py-2 text-[12px] shadow-[var(--shadow-raised)] backdrop-blur">
      {label !== undefined && <div className="mb-1 font-semibold text-ink">{labelFormatter ? labelFormatter(label) : label}</div>}
      <div className="space-y-0.5">
        {payload
          .filter((p) => p.value !== null && p.value !== undefined)
          .map((p, i) => {
            const v = Array.isArray(p.value) ? p.value.map((x) => (typeof x === 'number' ? x.toFixed(1) : x)).join(' – ') : p.value;
            return (
              <div key={i} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-ink-2">
                  <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
                  {p.name}
                </span>
                <span className="num font-semibold text-ink">
                  {typeof v === 'number' && valueFormatter ? valueFormatter(v, String(p.name)) : typeof v === 'number' ? v.toFixed(1) : v}
                  {p.unit ? ` ${p.unit}` : ''}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; band?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.band ? (
            <span className="h-2.5 w-4 rounded-sm" style={{ background: it.color, opacity: 0.25 }} />
          ) : (
            <span className="h-0.5 w-4 rounded" style={{ background: it.dashed ? `repeating-linear-gradient(90deg, ${it.color} 0 4px, transparent 4px 7px)` : it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}
