import type { HydroSeries, WindHourly } from '../data/types';
import { electricalPowerKw, type HydroTurbineConfig } from '../physics/hydro';
import { dispatch, type DispatchResult, type PlantConfig, type StackModel } from '../physics/hydrogen';
import type { LayoutTurbine } from '../physics/constraints';
import type { TurbineModel } from '../physics/turbines';
import { solveFarm } from '../physics/wake';
import { observedConditions } from './engineering';

/**
 * Modeled onshore farm power for every SCADA hour: observed free-stream proxy
 * (mean nacelle wind of the real turbines) → Gaussian wake model → farm kW.
 * Hours without observed wind are counted as zero available power.
 */
export function modeledWindSeries(h: WindHourly, layout: LayoutTurbine[], model: TurbineModel, ti: number): number[] {
  const x = layout.map((t) => t.x);
  const y = layout.map((t) => t.y);
  const out = new Array<number>(h.length);
  for (let i = 0; i < h.length; i++) {
    const c = observedConditions(h, i);
    out[i] = c && c.windSpeed > 0 ? solveFarm({ x, y, model, windDir: c.windDir, windSpeed: c.windSpeed, ti }).farmKw : 0;
  }
  return out;
}

/** Observed 4-turbine farm power (kW) per hour; null hours → 0 (reported separately). */
export function observedWindSeries(h: WindHourly): { kw: number[]; missingHours: number } {
  const ids = Object.keys(h.turbines);
  let missing = 0;
  const kw = Array.from({ length: h.length }, (_, i) => {
    let s = 0;
    for (const id of ids) {
      const v = h.turbines[id].P[i];
      if (v === null || v === undefined) {
        missing++;
        return 0;
      }
      s += Math.max(0, v);
    }
    return s;
  });
  return { kw, missingHours: missing };
}

/**
 * Hydro modeled power aligned cyclically onto the wind timeline by elapsed
 * time (SIMULATED alignment — the records are not concurrent).
 */
export function alignedHydroSeries(hs: HydroSeries['series'][string], length: number, cfg: HydroTurbineConfig): number[] {
  const durH = hs.dtS[hs.dtS.length - 1] / 3600;
  const out = new Array<number>(length);
  let j = 0;
  for (let i = 0; i < length; i++) {
    const tH = i % Math.max(1, Math.floor(durH));
    while (j < hs.dtS.length - 1 && hs.dtS[j + 1] / 3600 <= tH) j++;
    if (hs.dtS[j] / 3600 > tH) j = 0;
    const v = hs.u[j];
    out[i] = v === null ? 0 : electricalPowerKw(v, cfg) * cfg.count;
  }
  return out;
}

export interface WaterfallStep {
  key: string;
  label: string;
  short: string;
  h2Kg: number;
  delta: number;
  note: string;
}

export function decompose(
  baselineKw: number[],
  candidateKw: number[] | null,
  hydroKw: number[] | null,
  stack: StackModel,
  plant: PlantConfig,
): { steps: WaterfallStep[]; final: DispatchResult } {
  const add = (a: number[]) => (hydroKw ? a.map((v, i) => v + hydroKw[i]) : a);
  const base: PlantConfig = { ...plant, staging: 'sequential', storageKwh: 0, storageKw: 0 };
  const r0 = dispatch(add(baselineKw), 1, stack, base);
  const layoutKw = add(candidateKw ?? baselineKw);
  const r1 = dispatch(layoutKw, 1, stack, base);
  const r2 = dispatch(layoutKw, 1, stack, { ...base, staging: plant.staging });
  const r3 = dispatch(layoutKw, 1, stack, plant);
  const steps: WaterfallStep[] = [
    { key: 'base', label: 'Baseline', short: 'Baseline', h2Kg: r0.h2Kg, delta: r0.h2Kg, note: 'Baseline layout, sequential stack filling, no storage' },
    { key: 'layout', label: 'Turbine placement', short: 'Placement', h2Kg: r1.h2Kg, delta: r1.h2Kg - r0.h2Kg, note: candidateKw ? 'Selected layout instead of baseline' : 'No alternative layout selected' },
    { key: 'settings', label: 'Turbine operating settings', short: 'Op. settings', h2Kg: r1.h2Kg, delta: 0, note: 'Not modeled — requires a controller/derating model (e.g. FLORIS yaw/derate on the backend)' },
    { key: 'electrolyzer', label: 'Electrolyzer operation', short: 'Electrolyzer', h2Kg: r2.h2Kg, delta: r2.h2Kg - r1.h2Kg, note: plant.staging === 'optimal' ? 'Optimal stack staging (equal split across active stacks) on the empirical curve' : 'Sequential staging selected — no change' },
    { key: 'allocation', label: 'Energy allocation (storage)', short: 'Storage', h2Kg: r3.h2Kg, delta: r3.h2Kg - r2.h2Kg, note: plant.storageKwh > 0 ? 'Battery buffering to hold minimum load / fill spare capacity' : 'Storage disabled (0 kWh)' },
  ];
  return { steps, final: r3 };
}
