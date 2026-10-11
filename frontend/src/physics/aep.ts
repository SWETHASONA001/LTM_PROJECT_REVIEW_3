import type { ProvenanceKind, WindResource } from '../data/types';
import { solveFarm } from './wake';
import type { TurbineModel } from './turbines';

/** A discrete set of (direction, speed, probability) conditions. */
export interface ResourceCases {
  dirs: number[];
  speeds: number[];
  probs: number[];
  label: string;
  kind: ProvenanceKind;
  source: string;
}

/**
 * Convert the SCADA-derived joint frequency table into conditions. Speed bins
 * are merged by `speedStride` (e.g. 2 → 2 m/s bins) to make optimisation
 * tractable; probability mass is preserved.
 */
export function casesFromResource(r: WindResource, speedStride = 1, minProb = 1e-5): ResourceCases {
  const dirs: number[] = [];
  const speeds: number[] = [];
  const probs: number[] = [];
  const width = 360 / r.sectors;
  const nBins = r.speedEdges.length - 1;
  for (let s = 0; s < r.sectors; s++) {
    for (let b = 0; b < nBins; b += speedStride) {
      let p = 0;
      let wsum = 0;
      for (let k = b; k < Math.min(b + speedStride, nBins); k++) {
        const pk = r.freq[s][k] ?? 0;
        p += pk;
        wsum += pk * (r.speedEdges[k] + r.speedEdges[k + 1]) / 2;
      }
      if (p < minProb) continue;
      dirs.push(s * width);
      speeds.push(wsum / p);
      probs.push(p);
    }
  }
  const total = probs.reduce((a, b) => a + b, 0);
  return {
    dirs,
    speeds,
    probs: probs.map((p) => p / total),
    label: 'La Haute Borne SCADA wind resource (2017)',
    kind: 'processed',
    source: r.provenance.method ?? '',
  };
}

/**
 * Weibull speed distribution with a von-Mises-like directional weighting.
 * Used for the offshore planner, where no measured offshore wind data exists.
 */
export function weibullCases(opts: {
  k: number;
  A: number;
  prevailingDir: number;
  directionality: number; // 0 = uniform, 1 = strongly directional
  sectors?: number;
  speedStep?: number;
}): ResourceCases {
  const sectors = opts.sectors ?? 12;
  const step = opts.speedStep ?? 1;
  const dirW: number[] = [];
  for (let s = 0; s < sectors; s++) {
    const d = (s * 360) / sectors;
    const diff = ((d - opts.prevailingDir) * Math.PI) / 180;
    dirW.push(Math.exp(opts.directionality * 2 * Math.cos(diff)));
  }
  const dsum = dirW.reduce((a, b) => a + b, 0);
  const cdf = (v: number) => 1 - Math.exp(-((v / opts.A) ** opts.k));
  const dirs: number[] = [];
  const speeds: number[] = [];
  const probs: number[] = [];
  for (let s = 0; s < sectors; s++) {
    for (let v = 0; v < 30; v += step) {
      const p = (cdf(v + step) - cdf(v)) * (dirW[s] / dsum);
      if (p < 1e-6) continue;
      dirs.push((s * 360) / sectors);
      speeds.push(v + step / 2);
      probs.push(p);
    }
  }
  const total = probs.reduce((a, b) => a + b, 0);
  return {
    dirs,
    speeds,
    probs: probs.map((p) => p / total),
    label: `Assumed Weibull k=${opts.k}, A=${opts.A} m/s, prevailing ${opts.prevailingDir}°`,
    kind: 'simulated',
    source: 'User-configured assumption — no offshore wind measurements exist in the repository.',
  };
}

export interface AepResult {
  aepMWh: number;
  aepNoWakeMWh: number;
  wakeLoss: number;
  bySector: { dir: number; prob: number; energyMWh: number; noWakeMWh: number }[];
  perTurbineMWh: number[];
}

const HOURS_PER_YEAR = 8760;

export function annualEnergy(
  x: number[],
  y: number[],
  model: TurbineModel,
  cases: ResourceCases,
  ti: number,
  availability = 1,
): AepResult {
  const n = x.length;
  const perTurbine = new Array<number>(n).fill(0);
  const sectorMap = new Map<number, { prob: number; energyMWh: number; noWakeMWh: number }>();
  let aep = 0;
  let noWake = 0;
  for (let i = 0; i < cases.dirs.length; i++) {
    const r = solveFarm({ x, y, model, windDir: cases.dirs[i], windSpeed: cases.speeds[i], ti });
    const w = (cases.probs[i] * HOURS_PER_YEAR * availability) / 1000; // kW→MWh weight
    aep += r.farmKw * w;
    noWake += r.freeKw * w;
    for (let t = 0; t < n; t++) perTurbine[t] += r.powerKw[t] * w;
    const sec = sectorMap.get(cases.dirs[i]) ?? { prob: 0, energyMWh: 0, noWakeMWh: 0 };
    sec.prob += cases.probs[i];
    sec.energyMWh += r.farmKw * w;
    sec.noWakeMWh += r.freeKw * w;
    sectorMap.set(cases.dirs[i], sec);
  }
  return {
    aepMWh: aep,
    aepNoWakeMWh: noWake,
    wakeLoss: noWake > 0 ? 1 - aep / noWake : 0,
    bySector: [...sectorMap.entries()].sort((a, b) => a[0] - b[0]).map(([dir, v]) => ({ dir, ...v })),
    perTurbineMWh: perTurbine,
  };
}
