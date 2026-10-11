import type { HourlyTurbineSeries, WindHourly } from '../data/types';

export type HourlyField = keyof Omit<HourlyTurbineSeries, 'n'>;

const CIRCULAR: HourlyField[] = ['Wa', 'Ya'];

/** Hour index for a UTC date (clamped). */
export function indexOf(h: WindHourly, d: Date): number {
  const i = Math.round((d.getTime() - new Date(h.start).getTime()) / 3600_000);
  return Math.min(Math.max(0, i), h.length - 1);
}

/**
 * Build chart rows for a field across turbines between two hour indices,
 * aggregated to `bucketHours` (circular mean for direction fields).
 * Buckets with no valid data stay null — gaps are shown, never filled.
 */
export function buildRows(h: WindHourly, turbines: string[], field: HourlyField, i0: number, i1: number, bucketHours: number) {
  const rows: Record<string, number | string | null>[] = [];
  const t0 = new Date(h.start).getTime();
  const circ = CIRCULAR.includes(field);
  for (let b = i0; b <= i1; b += bucketHours) {
    const row: Record<string, number | string | null> = { t: new Date(t0 + b * 3600_000).toISOString() };
    for (const id of turbines) {
      const arr = h.turbines[id]?.[field];
      if (!arr) continue;
      let n = 0;
      let s = 0;
      let sx = 0;
      let sy = 0;
      for (let k = b; k < Math.min(b + bucketHours, i1 + 1); k++) {
        const v = arr[k];
        if (v === null || v === undefined) continue;
        n++;
        if (circ) {
          sx += Math.sin((v * Math.PI) / 180);
          sy += Math.cos((v * Math.PI) / 180);
        } else s += v;
      }
      row[id] = n === 0 ? null : circ ? Math.round((((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360) * 10) / 10 : Math.round((s / n) * 100) / 100;
    }
    rows.push(row);
  }
  return rows;
}

export function coverageShare(h: WindHourly, id: string, i0: number, i1: number): number {
  const n = h.turbines[id]?.n;
  if (!n) return 0;
  let got = 0;
  for (let k = i0; k <= i1; k++) got += n[k] ?? 0;
  return got / ((i1 - i0 + 1) * 6);
}
