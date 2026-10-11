import type { AepResult } from '../physics/aep';
import { checkConstraints, pairwiseMin, type LayoutTurbine } from '../physics/constraints';
import { solveFarm } from '../physics/wake';
import type { ScenarioMetrics } from '../store/appStores';
import type { SiteState } from '../store/siteStore';
import { layoutAep, type SiteEngineering } from './engineering';

export interface LayoutEvaluation {
  metrics: ScenarioMetrics;
  aep: AepResult;
}

export function evaluateLayout(
  turbines: LayoutTurbine[],
  eng: SiteEngineering,
  st: Pick<SiteState, 'windDir' | 'windSpeed' | 'ti' | 'minSpacingD' | 'boundary'>,
  instant?: { windDir: number; windSpeed: number },
): LayoutEvaluation {
  const farm = solveFarm({
    x: turbines.map((t) => t.x),
    y: turbines.map((t) => t.y),
    model: eng.model,
    windDir: instant?.windDir ?? st.windDir,
    windSpeed: instant?.windSpeed ?? st.windSpeed,
    ti: st.ti,
  });
  const aep = layoutAep(turbines, eng, st.ti);
  const violations = checkConstraints(turbines, { minSpacingD: st.minSpacingD, rotorDiameter: eng.model.rotorDiameter.value, boundary: st.boundary });
  return {
    aep,
    metrics: {
      nTurbines: turbines.length,
      farmKw: farm.farmKw,
      wakeLossInstant: farm.wakeLoss,
      aepMWh: aep.aepMWh,
      aepNoWakeMWh: aep.aepNoWakeMWh,
      wakeLossAnnual: aep.wakeLoss,
      violations: violations.length,
      minSpacingM: pairwiseMin(turbines).d,
    },
  };
}

/** Plain-language explanation of why a candidate differs from a reference, from sector-level results. */
export function explainDifference(ref: AepResult, cand: AepResult, refN: number, candN: number): string[] {
  const out: string[] = [];
  const d = cand.aepMWh - ref.aepMWh;
  if (Math.abs(d) < 1e-6) return ['Both layouts produce the same modeled annual energy.'];
  if (refN !== candN) {
    out.push(`Turbine count differs (${refN} → ${candN}); part of the change comes from installed capacity, not only from wake effects.`);
  }
  out.push(
    `Annual wake loss changes from ${(ref.wakeLoss * 100).toFixed(2)}% to ${(cand.wakeLoss * 100).toFixed(2)}% under the same wind-rose weighting.`,
  );
  const sectors = cand.bySector.map((s, i) => ({ dir: s.dir, delta: s.energyMWh - (ref.bySector[i]?.energyMWh ?? 0), prob: s.prob }));
  const top = [...sectors].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
  out.push(
    `Largest sector changes: ${top.map((s) => `${s.dir}° (${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(0)} MWh/yr, ${(s.prob * 100).toFixed(1)}% of hours)`).join('; ')}.`,
  );
  const worse = sectors.filter((s) => s.delta < -0.5);
  if (worse.length && d > 0) {
    out.push(`Trade-off: ${worse.length} sector(s) lose energy (e.g. ${worse[0].dir}°), outweighed by gains elsewhere — the candidate is not better for every wind direction.`);
  }
  return out;
}
