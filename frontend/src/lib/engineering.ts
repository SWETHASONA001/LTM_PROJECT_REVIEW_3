import { useMemo } from 'react';
import type { WindHourly, WindSummary } from '../data/types';
import { annualEnergy, casesFromResource, weibullCases, type AepResult, type ResourceCases } from '../physics/aep';
import { checkConstraints, pairwiseMin, type LayoutTurbine, type Violation } from '../physics/constraints';
import { offshoreModel, onshoreModel, type TurbineModel } from '../physics/turbines';
import { solveFarm, type FarmResult } from '../physics/wake';
import { useDataset } from '../services/dataService';
import { useSite, type SiteId, type SiteState } from '../store/siteStore';

const offshore = offshoreModel();

export interface SiteEngineering {
  model: TurbineModel;
  /** Full-resolution resource for reporting */
  cases: ResourceCases;
  /** Coarser resource for optimisation */
  optCases: ResourceCases;
  summary?: WindSummary;
}

/** Turbine model + wind resource for a site. Onshore depends on SCADA data. */
export function useSiteEngineering(site: SiteId): { eng?: SiteEngineering; loading: boolean; error?: Error } {
  const { data: summary, loading, error } = useDataset('wind_summary');
  const st = useSite(site);
  const res = st.offshoreResource;
  const eng = useMemo<SiteEngineering | undefined>(() => {
    if (site === 'offshore') {
      return {
        model: offshore,
        cases: weibullCases({ ...res, sectors: 12, speedStep: 1 }),
        optCases: weibullCases({ ...res, sectors: 12, speedStep: 2 }),
      };
    }
    if (!summary) return undefined;
    return {
      model: onshoreModel(summary),
      cases: casesFromResource(summary.resource, 1),
      optCases: casesFromResource(summary.resource, 2),
      summary,
    };
  }, [site, summary, res]);
  return { eng, loading: site === 'onshore' ? loading : false, error: site === 'onshore' ? error : undefined };
}

export function layoutFor(st: SiteState): LayoutTurbine[] {
  if (st.view === 'baseline') return st.baseline;
  if (st.view === 'candidate' && st.candidate) return st.candidate.turbines;
  return st.turbines;
}

export interface LayoutAnalysis {
  farm: FarmResult;
  violations: Violation[];
  minSpacingM: number;
}

export function analyzeLayout(turbines: LayoutTurbine[], model: TurbineModel, st: Pick<SiteState, 'windDir' | 'windSpeed' | 'ti' | 'minSpacingD' | 'boundary'>, windDir = st.windDir, windSpeed = st.windSpeed): LayoutAnalysis {
  const farm = solveFarm({ x: turbines.map((t) => t.x), y: turbines.map((t) => t.y), model, windDir, windSpeed, ti: st.ti });
  const violations = checkConstraints(turbines, { minSpacingD: st.minSpacingD, rotorDiameter: model.rotorDiameter.value, boundary: st.boundary });
  return { farm, violations, minSpacingM: pairwiseMin(turbines).d };
}

export function layoutAep(turbines: LayoutTurbine[], eng: SiteEngineering, ti: number): AepResult {
  return annualEnergy(turbines.map((t) => t.x), turbines.map((t) => t.y), eng.model, eng.cases, ti);
}

/** Observed conditions at an hourly index, averaged over the real turbines with data. */
export function observedConditions(h: WindHourly, idx: number) {
  let n = 0;
  let ws = 0;
  let sx = 0;
  let sy = 0;
  let p = 0;
  let np = 0;
  for (const id of Object.keys(h.turbines)) {
    const s = h.turbines[id];
    const v = s.Ws[idx];
    const d = s.Wa[idx];
    if (v !== null && d !== null && v !== undefined && d !== undefined) {
      n++;
      ws += v;
      sx += Math.sin((d * Math.PI) / 180);
      sy += Math.cos((d * Math.PI) / 180);
    }
    const pw = s.P[idx];
    if (pw !== null && pw !== undefined) {
      p += pw;
      np++;
    }
  }
  if (n === 0) return null;
  return {
    windSpeed: ws / n,
    windDir: ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360,
    farmObservedKw: np === 4 ? p : null,
    turbinesWithData: n,
  };
}

export function hourIndexToDate(h: WindHourly, idx: number): Date {
  return new Date(new Date(h.start).getTime() + idx * 3600_000);
}
