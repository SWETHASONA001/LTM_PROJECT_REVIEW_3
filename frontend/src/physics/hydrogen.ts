import type { ElectrolyzerReport } from '../data/types';
import { interp } from './turbines';

/**
 * PEM electrolyzer + optional battery dispatch model.
 *
 * The stack curve (stack power → H2 mass flow) is the empirical median curve
 * measured on the electrolyzer test stand in the repository experiments. A
 * plant of `modules` identical stacks is assumed (scale-out is an assumption).
 *
 * Energy balance per step (no double counting):
 *   available = toElectrolyzerDirect + toStorage + curtailed
 *   toElectrolyzer = toElectrolyzerDirect + fromStorage
 */

export interface StackModel {
  minKw: number;
  maxKw: number;
  kw: number[];
  kgPerH: number[];
  source: string;
}

export function stackModelFromReport(r: ElectrolyzerReport): StackModel {
  return {
    minKw: Math.max(r.stackCurve.stackKw[0], r.observedRangeKw.min),
    maxKw: r.stackCurve.stackKw[r.stackCurve.stackKw.length - 1],
    kw: r.stackCurve.stackKw,
    kgPerH: r.stackCurve.flowKgH,
    source: 'Empirical median curve from measured electrolyzer test-stand experiments (FM011 flow vs PSU power)',
  };
}

export function stackRate(m: StackModel, kw: number): number {
  if (kw < m.minKw - 1e-9) return 0;
  return interp(m.kw, m.kgPerH, Math.min(kw, m.maxKw));
}

export type StagingStrategy = 'sequential' | 'optimal';

export interface PlantConfig {
  modules: number;
  staging: StagingStrategy;
  storageKwh: number;
  storageKw: number;
  roundTripEff: number;
}

/** Distribute `kw` across up to `modules` stacks and return H2 rate and power used. */
export function stageModules(m: StackModel, kw: number, modules: number, strategy: StagingStrategy): { kgH: number; usedKw: number; active: number } {
  if (kw < m.minKw || modules <= 0) return { kgH: 0, usedKw: 0, active: 0 };
  if (strategy === 'sequential') {
    // Fill stack 1 to max, then stack 2, ... The last stack runs only if its share ≥ min load.
    let remaining = Math.min(kw, modules * m.maxKw);
    let kgH = 0;
    let used = 0;
    let active = 0;
    while (remaining > 1e-9 && active < modules) {
      const share = Math.min(remaining, m.maxKw);
      if (share < m.minKw) break;
      kgH += stackRate(m, share);
      used += share;
      remaining -= share;
      active++;
    }
    return { kgH, usedKw: used, active };
  }
  // Optimal: for a concave stack curve equal splitting is optimal for a fixed
  // number of active stacks; enumerate the number of active stacks.
  let best = { kgH: 0, usedKw: 0, active: 0 };
  for (let k = 1; k <= modules; k++) {
    const share = Math.min(kw / k, m.maxKw);
    if (share < m.minKw) break;
    const kgH = k * stackRate(m, share);
    if (kgH > best.kgH) best = { kgH, usedKw: share * k, active: k };
  }
  return best;
}

export interface DispatchResult {
  availableMWh: number;
  toElectrolyzerMWh: number;
  directMWh: number;
  chargedMWh: number;
  dischargedMWh: number;
  curtailedMWh: number;
  storageLossMWh: number;
  finalSocMWh: number;
  h2Kg: number;
  secKwhPerKg: number;
  operatingHours: number;
  steps: number;
  balanceErrorMWh: number;
  series: { availableKw: number; electrolyzerKw: number; h2KgH: number; socKwh: number }[];
}

export function dispatch(availableKw: number[], dtH: number, m: StackModel, cfg: PlantConfig, keepSeries = false): DispatchResult {
  let soc = 0;
  const effIn = Math.sqrt(cfg.roundTripEff);
  const effOut = Math.sqrt(cfg.roundTripEff);
  const r: DispatchResult = {
    availableMWh: 0, toElectrolyzerMWh: 0, directMWh: 0, chargedMWh: 0, dischargedMWh: 0,
    curtailedMWh: 0, storageLossMWh: 0, finalSocMWh: 0, h2Kg: 0, secKwhPerKg: 0, operatingHours: 0, steps: 0,
    balanceErrorMWh: 0, series: [],
  };
  const capKw = cfg.modules * m.maxKw;
  for (const raw of availableKw) {
    const P = Math.max(0, Number.isFinite(raw) ? raw : 0);
    r.steps++;
    // 1) direct allocation
    let direct = Math.min(P, capKw);
    let fromStore = 0;
    // If below minimum load, try to lift with storage; else hold the energy for storage.
    if (direct < m.minKw) {
      const need = m.minKw - direct;
      const canKw = Math.min(cfg.storageKw, (soc * effOut) / dtH);
      if (cfg.storageKwh > 0 && canKw >= need) {
        fromStore = need;
      } else {
        direct = 0; // electrolyzer idle; energy goes to storage or curtailment
      }
    } else if (direct < capKw && cfg.storageKwh > 0) {
      // Top up toward capacity from storage when there is spare stack capacity.
      fromStore = Math.min(capKw - direct, cfg.storageKw, (soc * effOut) / dtH);
    }
    const stage = stageModules(m, direct + fromStore, cfg.modules, cfg.staging);
    // Power not used by staging (e.g. fragment below min load) returns to the pool.
    const used = stage.usedKw;
    const usedFromStore = Math.min(fromStore, used);
    const usedDirect = used - usedFromStore;
    soc -= (usedFromStore * dtH) / effOut;
    // 2) surplus → storage → curtailment
    let surplus = P - usedDirect;
    const chargeKw = Math.min(surplus, cfg.storageKw, Math.max(0, (cfg.storageKwh - soc) / (effIn * dtH)));
    const charge = cfg.storageKwh > 0 ? Math.max(0, chargeKw) : 0;
    soc += charge * dtH * effIn;
    surplus -= charge;

    r.availableMWh += (P * dtH) / 1000;
    r.directMWh += (usedDirect * dtH) / 1000;
    r.dischargedMWh += (usedFromStore * dtH) / 1000;
    r.chargedMWh += (charge * dtH) / 1000;
    r.curtailedMWh += (surplus * dtH) / 1000;
    r.toElectrolyzerMWh += (used * dtH) / 1000;
    r.h2Kg += stage.kgH * dtH;
    if (stage.active > 0) r.operatingHours += dtH;
    if (keepSeries) r.series.push({ availableKw: P, electrolyzerKw: used, h2KgH: stage.kgH, socKwh: soc });
  }
  // Round-trip losses = charged − discharged − energy still stored at the end.
  r.finalSocMWh = soc / 1000;
  r.storageLossMWh = Math.max(0, r.chargedMWh - r.dischargedMWh - r.finalSocMWh);
  r.balanceErrorMWh = r.availableMWh - (r.directMWh + r.chargedMWh + r.curtailedMWh);
  r.secKwhPerKg = r.h2Kg > 0 ? (r.toElectrolyzerMWh * 1000) / r.h2Kg : 0;
  return r;
}
