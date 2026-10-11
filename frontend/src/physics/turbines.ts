import type { ProvenanceKind, WindSummary } from '../data/types';

export const RHO_AIR = 1.225; // kg/m3 — standard air density (assumption)

export interface SpecValue {
  value: number;
  unit: string;
  source: string;
  kind: ProvenanceKind;
}

export interface TurbineModel {
  id: string;
  name: string;
  rotorDiameter: SpecValue;
  hubHeight: SpecValue;
  ratedPower: SpecValue;
  cutOut: SpecValue;
  /** Wind-speed grid (m/s) */
  ws: number[];
  /** Electrical power (kW) on the ws grid */
  powerKw: number[];
  /** Thrust coefficient on the ws grid */
  ct: number[];
  curveSource: string;
  curveKind: ProvenanceKind;
  ctSource: string;
}

/**
 * Axial-induction thrust coefficient from a power coefficient using 1-D
 * momentum theory: Cp = 4a(1-a)^2, Ct = 4a(1-a), a in [0, 1/3].
 * The electrical Cp is used, so Ct is a modelling assumption, not a
 * manufacturer thrust curve.
 */
export function ctFromCp(cp: number): number {
  const target = Math.min(Math.max(cp, 0), 16 / 27);
  if (target <= 0) return 0;
  let lo = 0;
  let hi = 1 / 3;
  for (let i = 0; i < 40; i++) {
    const a = (lo + hi) / 2;
    if (4 * a * (1 - a) ** 2 < target) lo = a;
    else hi = a;
  }
  const a = (lo + hi) / 2;
  return 4 * a * (1 - a);
}

function buildCt(ws: number[], powerKw: number[], diameter: number): number[] {
  const area = Math.PI * (diameter / 2) ** 2;
  return ws.map((v, i) => {
    if (v < 1 || powerKw[i] <= 0) return v < 3 ? 0 : 0.05;
    const cp = (powerKw[i] * 1000) / (0.5 * RHO_AIR * area * v ** 3);
    return Math.max(0.05, ctFromCp(Math.min(cp, 0.55)));
  });
}

/**
 * Onshore model for the La Haute Borne turbines. The power curve is the
 * empirical engineering curve derived from the real SCADA records; rotor
 * diameter and hub height come from the public Senvion MM82 specification
 * because the repository contains no turbine datasheet.
 */
export function onshoreModel(summary: WindSummary): TurbineModel {
  const pc = summary.powerCurve;
  const ws = [...pc.ws, 25.0, 25.01, 30];
  const rated = summary.ratedPowerKwObserved;
  const powerKw = [...pc.engineering.map((p) => Math.min(p ?? 0, rated)), rated, 0, 0];
  const D = 82;
  return {
    id: 'mm82-empirical',
    name: 'La Haute Borne turbine (empirical, MM82-class)',
    rotorDiameter: { value: D, unit: 'm', source: 'Public Senvion MM82 specification — not in repository data; verify', kind: 'assumption' },
    hubHeight: { value: 80, unit: 'm', source: 'Public Senvion MM82 specification — not in repository data; verify', kind: 'assumption' },
    ratedPower: { value: rated, unit: 'kW', source: '99.95th percentile of observed P_avg (SCADA)', kind: 'processed' },
    cutOut: { value: 25, unit: 'm/s', source: 'Assumed (no wind > 24.3 m/s observed in SCADA)', kind: 'assumption' },
    ws,
    powerKw,
    ct: buildCt(ws, powerKw, D),
    curveSource: pc.engineeringMethod,
    curveKind: 'processed',
    ctSource: 'Derived from empirical Cp via 1-D momentum theory (assumption)',
  };
}

/**
 * Offshore planning model. No offshore operational data exists in the
 * repository, so this is a parametric approximation of the public NREL 5-MW
 * reference turbine (D=126 m, hub 90 m, 3/11.4/25 m/s). Clearly simulated.
 */
export function offshoreModel(): TurbineModel {
  const D = 126;
  const rated = 5000;
  const area = Math.PI * (D / 2) ** 2;
  const ws: number[] = [];
  const powerKw: number[] = [];
  for (let v = 0; v <= 30.0001; v += 0.5) {
    ws.push(+v.toFixed(2));
    let p = 0;
    if (v >= 3 && v <= 25) {
      const cp = 0.47;
      p = Math.min(rated, (0.5 * RHO_AIR * area * v ** 3 * cp) / 1000);
      if (v < 4) p *= (v - 3); // soft cut-in ramp
    }
    powerKw.push(p);
  }
  return {
    id: 'nrel5mw-parametric',
    name: 'NREL 5-MW reference (parametric approximation)',
    rotorDiameter: { value: D, unit: 'm', source: 'NREL 5-MW reference turbine (public)', kind: 'assumption' },
    hubHeight: { value: 90, unit: 'm', source: 'NREL 5-MW reference turbine (public)', kind: 'assumption' },
    ratedPower: { value: rated, unit: 'kW', source: 'NREL 5-MW reference turbine (public)', kind: 'assumption' },
    cutOut: { value: 25, unit: 'm/s', source: 'NREL 5-MW reference turbine (public)', kind: 'assumption' },
    ws,
    powerKw,
    ct: buildCt(ws, powerKw, D),
    curveSource: 'Parametric: Cp = 0.47 below rated, capped at 5 MW, cut-in 3 m/s, cut-out 25 m/s. Not the official tabulated curve.',
    curveKind: 'simulated',
    ctSource: 'Derived from parametric Cp via 1-D momentum theory (assumption)',
  };
}

export function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  const n = xs.length;
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

export const powerAt = (m: TurbineModel, v: number) => interp(m.ws, m.powerKw, v);
export const ctAt = (m: TurbineModel, v: number) => interp(m.ws, m.ct, v);
