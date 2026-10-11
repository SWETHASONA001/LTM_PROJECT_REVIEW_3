import { annualEnergy, type ResourceCases } from './aep';
import type { TurbineModel } from './turbines';

/**
 * Turbine installation recommendation: greedy sequential siting.
 *
 * For every feasible candidate position (inside the boundary, at least the
 * minimum spacing from all turbines) the wind-rose-weighted AEP of the farm
 * with the candidate added is computed with the Gaussian wake model. The
 * candidate with the largest net gain — its own energy minus the wake losses it
 * imposes on existing turbines — is selected, added, and the search repeats.
 * Greedy placement is a heuristic: it ranks sites well but does not guarantee
 * the jointly optimal set of N positions.
 */

export interface SitingInput {
  x: number[];
  y: number[];
  model: TurbineModel;
  cases: ResourceCases;
  ti: number;
  minSpacingM: number;
  boundary: { width: number; height: number };
  gridStepM: number;
  count: number;
}

export interface SitingRecommendation {
  rank: number;
  x: number;
  y: number;
  netGainMWh: number;
  ownAepMWh: number;
  lossToOthersMWh: number;
  capacityFactor: number;
  nearestM: number;
  candidatesEvaluated: number;
}

export interface SitingProgress {
  round: number;
  rounds: number;
  evaluated: number;
  total: number;
}

export interface SitingOutput {
  baseAepMWh: number;
  finalAepMWh: number;
  recommendations: SitingRecommendation[];
  /** Net gain (MWh/yr) of each grid cell in the first round; null where infeasible. */
  heatmap: { x0: number; y0: number; step: number; nx: number; ny: number; values: (number | null)[] };
  evaluations: number;
}

export function recommendSites(inp: SitingInput, onProgress?: (p: SitingProgress) => void): SitingOutput {
  const hw = inp.boundary.width / 2;
  const hh = inp.boundary.height / 2;
  const step = inp.gridStepM;
  const nx = Math.floor((2 * hw) / step) + 1;
  const ny = Math.floor((2 * hh) / step) + 1;
  const x0 = -((nx - 1) * step) / 2;
  const y0 = -((ny - 1) * step) / 2;
  const xs = [...inp.x];
  const ys = [...inp.y];
  const rated = inp.model.ratedPower.value;
  const aep = (a: number[], b: number[]) => annualEnergy(a, b, inp.model, inp.cases, inp.ti);
  const base = aep(xs, ys).aepMWh;
  let current = base;
  let evaluations = 1;
  const recs: SitingRecommendation[] = [];
  const heat: (number | null)[] = new Array(nx * ny).fill(null);

  for (let round = 0; round < inp.count; round++) {
    const feasible: number[] = [];
    for (let k = 0; k < nx * ny; k++) {
      const cx = x0 + (k % nx) * step;
      const cy = y0 + Math.floor(k / nx) * step;
      let ok = true;
      for (let i = 0; i < xs.length && ok; i++) ok = Math.hypot(cx - xs[i], cy - ys[i]) >= inp.minSpacingM;
      if (ok) feasible.push(k);
    }
    if (!feasible.length) break;
    let best: SitingRecommendation | null = null;
    feasible.forEach((k, idx) => {
      const cx = x0 + (k % nx) * step;
      const cy = y0 + Math.floor(k / nx) * step;
      const r = aep([...xs, cx], [...ys, cy]);
      evaluations++;
      const own = r.perTurbineMWh[r.perTurbineMWh.length - 1];
      const net = r.aepMWh - current;
      if (round === 0) heat[k] = net;
      if (!best || net > best.netGainMWh) {
        let nearest = Infinity;
        for (let i = 0; i < xs.length; i++) nearest = Math.min(nearest, Math.hypot(cx - xs[i], cy - ys[i]));
        best = {
          rank: round + 1,
          x: Math.round(cx),
          y: Math.round(cy),
          netGainMWh: net,
          ownAepMWh: own,
          lossToOthersMWh: own - net,
          capacityFactor: own / ((rated * 8760) / 1000),
          nearestM: nearest,
          candidatesEvaluated: feasible.length,
        };
      }
      if (idx % 25 === 0) onProgress?.({ round: round + 1, rounds: inp.count, evaluated: idx + 1, total: feasible.length });
    });
    if (!best) break;
    const chosen: SitingRecommendation = best;
    recs.push(chosen);
    xs.push(chosen.x);
    ys.push(chosen.y);
    current += chosen.netGainMWh;
  }
  return { baseAepMWh: base, finalAepMWh: current, recommendations: recs, heatmap: { x0, y0, step, nx, ny, values: heat }, evaluations };
}
