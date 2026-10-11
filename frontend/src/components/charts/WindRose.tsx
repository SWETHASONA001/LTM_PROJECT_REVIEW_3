import { useState } from 'react';
import { compass } from '../../lib/format';
import { BLUE_RAMP } from './chartTheme';

/**
 * Polar stacked wind rose. Speed classes are ordered, so they use an ordinal
 * single-hue ramp (light → dark), not categorical colours.
 */
export function WindRose({ percent, speedBins, size = 260, highlightDir }: { percent: number[][]; speedBins: string[]; size?: number; highlightDir?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = percent.length;
  const totals = percent.map((r) => r.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals);
  const c = size / 2;
  const R = size / 2 - 26;
  const colors = [BLUE_RAMP[3], BLUE_RAMP[5], BLUE_RAMP[7], BLUE_RAMP[9], BLUE_RAMP[12]];
  const width = (2 * Math.PI) / n;
  const arc = (r0: number, r1: number, a0: number, a1: number) => {
    const p = (r: number, a: number) => `${c + r * Math.sin(a)},${c - r * Math.cos(a)}`;
    return `M${p(r0, a0)} L${p(r1, a0)} A${r1},${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 0 0 ${p(r0, a0)} Z`;
  };
  const rings = [0.25, 0.5, 0.75, 1];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[320px]" role="img" aria-label="Wind rose: frequency by direction and speed class">
        {rings.map((f) => (
          <circle key={f} cx={c} cy={c} r={R * f} fill="none" stroke="#e3e1da" strokeWidth={1} />
        ))}
        {['N', 'E', 'S', 'W'].map((l, i) => {
          const a = (i * Math.PI) / 2;
          return (
            <text key={l} x={c + (R + 14) * Math.sin(a)} y={c - (R + 14) * Math.cos(a) + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#66727f">
              {l}
            </text>
          );
        })}
        {percent.map((row, s) => {
          const a0 = s * width - width / 2 + 0.02;
          const a1 = s * width + width / 2 - 0.02;
          let acc = 0;
          return (
            <g key={s} onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(null)} opacity={hover === null || hover === s ? 1 : 0.45}>
              <path d={arc(0, R, a0, a1)} fill="transparent" />
              {row.map((v, k) => {
                const r0 = (acc / max) * R;
                acc += v;
                const r1 = (acc / max) * R;
                if (r1 - r0 < 0.3) return null;
                return <path key={k} d={arc(r0 + (k ? 0.6 : 0), r1, a0, a1)} fill={colors[k]} />;
              })}
            </g>
          );
        })}
        {highlightDir !== undefined && (
          <line
            x1={c}
            y1={c}
            x2={c + R * Math.sin((highlightDir * Math.PI) / 180)}
            y2={c - R * Math.cos((highlightDir * Math.PI) / 180)}
            stroke="#0b1f33"
            strokeWidth={2}
            strokeLinecap="round"
          />
        )}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-lg border border-line bg-white/95 px-2.5 py-1.5 text-[11.5px] shadow-[var(--shadow-raised)]">
          <div className="font-semibold text-ink">
            {compass((hover * 360) / n)} · {Math.round((hover * 360) / n)}°
          </div>
          <div className="num text-ink-2">{totals[hover].toFixed(1)}% of records</div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-2">
        {speedBins.map((b, k) => (
          <span key={b} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[k] }} />
            {b} m/s
          </span>
        ))}
      </div>
    </div>
  );
}
