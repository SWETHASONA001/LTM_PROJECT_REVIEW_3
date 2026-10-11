import { describe, expect, it } from 'vitest';
import { annualEnergy, weibullCases } from '../physics/aep';
import { checkConstraints, violationAmount } from '../physics/constraints';
import { availablePowerKw, electricalPowerKw, DEFAULT_HYDRO } from '../physics/hydro';
import { dispatch, stageModules, type StackModel } from '../physics/hydrogen';
import { optimizeLayout } from '../physics/optimizer';
import { ctFromCp, offshoreModel } from '../physics/turbines';
import { gaussianDeficit, solveFarm } from '../physics/wake';

const model = offshoreModel();
const D = model.rotorDiameter.value;

describe('turbine model', () => {
  it('derives Ct from Cp via momentum theory', () => {
    expect(ctFromCp(0)).toBe(0);
    // Betz optimum a=1/3 → Cp=16/27, Ct=8/9
    expect(ctFromCp(16 / 27)).toBeCloseTo(8 / 9, 2);
    expect(ctFromCp(0.4)).toBeGreaterThan(0.4);
  });
});

describe('Gaussian wake', () => {
  it('has no deficit upstream and decays downstream', () => {
    expect(gaussianDeficit(-500, 0, 0, D, 0.8, 0.05)).toBe(0);
    const near = gaussianDeficit(3 * D, 0, 0, D, 0.8, 0.05);
    const far = gaussianDeficit(10 * D, 0, 0, D, 0.8, 0.05);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(gaussianDeficit(5 * D, 3 * D, 0, D, 0.8, 0.05)).toBeLessThan(gaussianDeficit(5 * D, 0, 0, D, 0.8, 0.05));
  });

  it('wakes the downstream turbine only when aligned with the wind', () => {
    // Two turbines on a north–south line, 5D apart.
    const base = { x: [0, 0], y: [0, -5 * D], model, windSpeed: 8, ti: 0.06 };
    const aligned = solveFarm({ ...base, windDir: 0 }); // wind from north → turbine 2 is downstream
    const cross = solveFarm({ ...base, windDir: 90 });
    expect(aligned.powerKw[1]).toBeLessThan(aligned.powerKw[0]);
    expect(aligned.wakeLoss).toBeGreaterThan(0.05);
    expect(cross.wakeLoss).toBeCloseTo(0, 6);
    expect(aligned.farmKw).toBeLessThanOrEqual(aligned.freeKw);
  });
});

describe('AEP and constraints', () => {
  it('computes AEP with wake loss between 0 and 1', () => {
    const cases = weibullCases({ k: 2, A: 9, prevailingDir: 240, directionality: 0.5, sectors: 8, speedStep: 2 });
    const r = annualEnergy([0, 7 * D, 0, 7 * D], [0, 0, 7 * D, 7 * D], model, cases, 0.06);
    expect(r.aepMWh).toBeGreaterThan(0);
    expect(r.wakeLoss).toBeGreaterThan(0);
    expect(r.wakeLoss).toBeLessThan(0.5);
  });

  it('flags spacing and boundary violations', () => {
    const turbines = [
      { id: 'a', label: 'A', x: 0, y: 0, status: 'proposed' as const },
      { id: 'b', label: 'B', x: 2 * D, y: 0, status: 'proposed' as const },
      { id: 'c', label: 'C', x: 5000, y: 0, status: 'proposed' as const },
    ];
    const v = checkConstraints(turbines, { minSpacingD: 4, rotorDiameter: D, boundary: { width: 4000, height: 4000 } });
    expect(v.some((x) => x.kind === 'spacing')).toBe(true);
    expect(v.some((x) => x.kind === 'boundary')).toBe(true);
  });
});

describe('optimiser', () => {
  it('does not decrease AEP, respects constraints and locked turbines', () => {
    const cases = weibullCases({ k: 2, A: 9, prevailingDir: 270, directionality: 1, sectors: 8, speedStep: 3 });
    const x = [0, 4 * D, 8 * D, 0];
    const y = [0, 0, 0, 4 * D];
    const constraints = { minSpacingD: 3, rotorDiameter: D, boundary: { width: 20 * D, height: 20 * D } };
    const out = optimizeLayout({
      x, y, movable: [false, true, true, true], model, cases, ti: 0.06, constraints,
      maxEvaluations: 150, initialStepD: 2, minStepD: 0.25, seed: 1,
    });
    expect(out.bestAep).toBeGreaterThanOrEqual(out.startAep);
    expect(out.x[0]).toBe(0);
    expect(out.y[0]).toBe(0);
    expect(violationAmount(out.x, out.y, constraints)).toBeLessThan(1e-6);
  });
});

describe('hydro', () => {
  it('follows 0.5 rho A v^3 and caps at rated', () => {
    const c = { ...DEFAULT_HYDRO, diameter: 10, ratedKw: 1e9 };
    const A = Math.PI * 25;
    expect(availablePowerKw(2, c)).toBeCloseTo((0.5 * 1025 * A * 8) / 1000, 6);
    expect(electricalPowerKw(0.5, c)).toBe(0); // below cut-in
    expect(electricalPowerKw(-2, c)).toBeCloseTo(availablePowerKw(2, c) * c.cp * c.eta, 6);
    expect(electricalPowerKw(5, { ...c, ratedKw: 100 })).toBe(100);
  });
});

describe('hydrogen dispatch', () => {
  const stack: StackModel = { minKw: 100, maxKw: 1000, kw: [100, 500, 1000], kgPerH: [2.2, 10, 18], source: 'test' };

  it('optimal staging produces at least as much H2 as sequential', () => {
    for (const kw of [150, 900, 1100, 1500, 2600]) {
      const seq = stageModules(stack, kw, 3, 'sequential');
      const opt = stageModules(stack, kw, 3, 'optimal');
      expect(opt.kgH).toBeGreaterThanOrEqual(seq.kgH - 1e-9);
      expect(opt.usedKw).toBeLessThanOrEqual(kw + 1e-9);
    }
  });

  it('closes the energy balance with and without storage', () => {
    const series = [0, 50, 300, 1200, 2500, 800, 90, 0, 1500];
    for (const storageKwh of [0, 2000]) {
      const r = dispatch(series, 1, stack, { modules: 2, staging: 'optimal', storageKwh, storageKw: 500, roundTripEff: 0.85 });
      expect(Math.abs(r.balanceErrorMWh)).toBeLessThan(1e-9);
      expect(r.toElectrolyzerMWh).toBeLessThanOrEqual(r.availableMWh + 1e-9);
      expect(r.h2Kg).toBeGreaterThan(0);
    }
  });
});

describe('installation recommendations', () => {
  it('recommends feasible sites with positive net gain, respecting spacing and boundary', async () => {
    const { recommendSites } = await import('../physics/siting');
    const cases = weibullCases({ k: 2, A: 9, prevailingDir: 270, directionality: 1, sectors: 8, speedStep: 3 });
    const x = [0, 5 * D];
    const y = [0, 0];
    const out = recommendSites({ x, y, model, cases, ti: 0.06, minSpacingM: 4 * D, boundary: { width: 16 * D, height: 16 * D }, gridStepM: 2 * D, count: 2 });
    expect(out.recommendations).toHaveLength(2);
    const all = [...x.map((xi, i) => ({ x: xi, y: y[i] })), ...out.recommendations];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y)).toBeGreaterThanOrEqual(4 * D - 1);
    for (const r of out.recommendations) {
      expect(Math.abs(r.x)).toBeLessThanOrEqual(8 * D + 1);
      expect(r.netGainMWh).toBeGreaterThan(0);
      expect(r.lossToOthersMWh).toBeGreaterThanOrEqual(-1e-6);
      expect(r.ownAepMWh).toBeCloseTo(r.netGainMWh + r.lossToOthersMWh, 6);
    }
    expect(out.finalAepMWh).toBeGreaterThan(out.baseAepMWh);
  });
});
