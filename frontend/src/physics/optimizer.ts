import { annualEnergy, type ResourceCases } from './aep';
import { violationAmount, type ConstraintConfig } from './constraints';
import type { TurbineModel } from './turbines';

/**
 * Turbine-placement optimiser: randomised coordinate pattern search with
 * adaptive step size (a derivative-free local search).
 *
 *  - Objective: maximise wind-rose-weighted AEP from the Gaussian wake model.
 *  - Constraints: minimum spacing and rectangular boundary, handled
 *    lexicographically (a move is accepted if it reduces the violation, or
 *    keeps the layout feasible and increases AEP).
 *  - Locked turbines (e.g. existing real assets) are never moved.
 *
 * It finds a local optimum from the given start layout. It does not guarantee
 * the global optimum; the method and evaluation count are reported with every
 * result.
 */

export interface OptimizeInput {
  x: number[];
  y: number[];
  movable: boolean[];
  model: TurbineModel;
  cases: ResourceCases;
  ti: number;
  constraints: ConstraintConfig;
  maxEvaluations: number;
  initialStepD: number;
  minStepD: number;
  seed: number;
}

export interface OptimizeProgress {
  evaluations: number;
  bestAep: number;
  stepM: number;
  violation: number;
}

export interface OptimizeOutput {
  x: number[];
  y: number[];
  startAep: number;
  bestAep: number;
  startViolation: number;
  violation: number;
  evaluations: number;
  acceptedMoves: number;
  history: { evaluations: number; aep: number }[];
  terminatedBy: 'max-evaluations' | 'min-step';
  method: string;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const OPTIMIZER_METHOD =
  'Randomised coordinate pattern search (8 directions, adaptive step) on wind-rose-weighted AEP; spacing & boundary as hard lexicographic constraints';

export function optimizeLayout(input: OptimizeInput, onProgress?: (p: OptimizeProgress) => void): OptimizeOutput {
  const rand = mulberry32(input.seed);
  const x = [...input.x];
  const y = [...input.y];
  const D = input.model.rotorDiameter.value;
  const evalAep = (xs: number[], ys: number[]) => annualEnergy(xs, ys, input.model, input.cases, input.ti).aepMWh;

  let evaluations = 0;
  let accepted = 0;
  let best = evalAep(x, y);
  evaluations++;
  let viol = violationAmount(x, y, input.constraints);
  const startAep = best;
  const startViolation = viol;
  const history = [{ evaluations, aep: best }];
  let step = input.initialStepD * D;
  const minStep = input.minStepD * D;
  const movable = input.movable.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
  const dirs = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);
  let terminatedBy: OptimizeOutput['terminatedBy'] = 'max-evaluations';

  if (movable.length === 0) {
    return {
      x, y, startAep, bestAep: best, startViolation, violation: viol, evaluations, acceptedMoves: 0,
      history, terminatedBy: 'min-step', method: OPTIMIZER_METHOD,
    };
  }

  while (evaluations < input.maxEvaluations) {
    let improvedThisSweep = false;
    const order = [...movable].sort(() => rand() - 0.5);
    for (const i of order) {
      if (evaluations >= input.maxEvaluations) break;
      const rot = rand() * Math.PI * 2;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      for (const [dx0, dy0] of dirs) {
        if (evaluations >= input.maxEvaluations) break;
        const dx = (dx0 * c - dy0 * s) * step;
        const dy = (dx0 * s + dy0 * c) * step;
        const ox = x[i];
        const oy = y[i];
        x[i] = ox + dx;
        y[i] = oy + dy;
        const v = violationAmount(x, y, input.constraints);
        let accept = false;
        let aep = best;
        if (v < viol - 1e-6) {
          aep = evalAep(x, y);
          evaluations++;
          accept = true;
        } else if (v <= 1e-6 && viol <= 1e-6) {
          aep = evalAep(x, y);
          evaluations++;
          accept = aep > best + 1e-6;
        }
        if (accept) {
          best = aep;
          viol = v;
          accepted++;
          improvedThisSweep = true;
          history.push({ evaluations, aep: best });
          break; // move on to next turbine with the improved layout
        }
        x[i] = ox;
        y[i] = oy;
      }
    }
    onProgress?.({ evaluations, bestAep: best, stepM: step, violation: viol });
    if (!improvedThisSweep) {
      step *= 0.5;
      if (step < minStep) {
        terminatedBy = 'min-step';
        break;
      }
    }
  }
  history.push({ evaluations, aep: best });
  return {
    x, y, startAep, bestAep: best, startViolation, violation: viol, evaluations, acceptedMoves: accepted,
    history, terminatedBy, method: OPTIMIZER_METHOD,
  };
}
