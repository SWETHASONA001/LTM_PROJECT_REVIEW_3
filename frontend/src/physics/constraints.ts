export interface LayoutTurbine {
  id: string;
  label: string;
  x: number;
  y: number;
  status: 'real' | 'proposed';
}

export interface Boundary {
  /** Rectangular site boundary centred on the origin (m). */
  width: number;
  height: number;
}

export interface ConstraintConfig {
  minSpacingD: number;
  rotorDiameter: number;
  boundary: Boundary;
}

export interface Violation {
  kind: 'spacing' | 'boundary';
  ids: string[];
  message: string;
  /** Magnitude in metres (penetration depth) */
  amount: number;
}

export function pairwiseMin(turbines: { x: number; y: number }[]): { d: number; i: number; j: number } {
  let best = { d: Infinity, i: -1, j: -1 };
  for (let i = 0; i < turbines.length; i++) {
    for (let j = i + 1; j < turbines.length; j++) {
      const d = Math.hypot(turbines[i].x - turbines[j].x, turbines[i].y - turbines[j].y);
      if (d < best.d) best = { d, i, j };
    }
  }
  return best;
}

export function nearestDistances(turbines: { x: number; y: number }[]): number[] {
  return turbines.map((a, i) => {
    let m = Infinity;
    turbines.forEach((b, j) => {
      if (i !== j) m = Math.min(m, Math.hypot(a.x - b.x, a.y - b.y));
    });
    return m;
  });
}

export function checkConstraints(turbines: LayoutTurbine[], cfg: ConstraintConfig): Violation[] {
  const v: Violation[] = [];
  const minM = cfg.minSpacingD * cfg.rotorDiameter;
  const hw = cfg.boundary.width / 2;
  const hh = cfg.boundary.height / 2;
  for (let i = 0; i < turbines.length; i++) {
    const a = turbines[i];
    const out = Math.max(Math.abs(a.x) - hw, Math.abs(a.y) - hh, 0);
    if (out > 0.5) {
      v.push({ kind: 'boundary', ids: [a.id], amount: out, message: `${a.label} is ${out.toFixed(0)} m outside the site boundary` });
    }
    for (let j = i + 1; j < turbines.length; j++) {
      const b = turbines[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < minM - 0.5) {
        v.push({
          kind: 'spacing',
          ids: [a.id, b.id],
          amount: minM - d,
          message: `${a.label} – ${b.label}: ${d.toFixed(0)} m (${(d / cfg.rotorDiameter).toFixed(2)}D) < ${cfg.minSpacingD}D`,
        });
      }
    }
  }
  return v;
}

/** Scalar violation measure (m) used by the optimiser. */
export function violationAmount(xs: number[], ys: number[], cfg: ConstraintConfig): number {
  const minM = cfg.minSpacingD * cfg.rotorDiameter;
  const hw = cfg.boundary.width / 2;
  const hh = cfg.boundary.height / 2;
  let total = 0;
  for (let i = 0; i < xs.length; i++) {
    total += Math.max(Math.abs(xs[i]) - hw, 0) + Math.max(Math.abs(ys[i]) - hh, 0);
    for (let j = i + 1; j < xs.length; j++) {
      const d = Math.hypot(xs[i] - xs[j], ys[i] - ys[j]);
      if (d < minM) total += minM - d;
    }
  }
  return total;
}
