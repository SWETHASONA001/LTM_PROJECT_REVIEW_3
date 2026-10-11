import { useMemo } from 'react';
import type { WindHourly } from '../data/types';
import { checkConstraints, pairwiseMin } from '../physics/constraints';
import { solveFarm, type FarmCase } from '../physics/wake';
import { useDataset } from '../services/dataService';
import { useSite, type SiteId } from '../store/siteStore';
import { hourIndexToDate, layoutFor, observedConditions, useSiteEngineering } from './engineering';

export interface Conditions {
  windDir: number;
  windSpeed: number;
  ti: number;
  source: 'observed' | 'manual';
  timestamp?: Date;
  observedFarmKw?: number | null;
  turbinesWithData?: number;
}

/**
 * Everything a site view needs: engineering models, the displayed layout,
 * current conditions (observed SCADA hour or manual), and the solved farm.
 */
export function useSiteSimulation(site: SiteId) {
  const st = useSite(site);
  const { eng, loading, error } = useSiteEngineering(site);
  const hourlyState = useDataset('wind_hourly');
  const hourly: WindHourly | undefined = site === 'onshore' ? hourlyState.data : undefined;
  const layout = layoutFor(st);

  const conditions = useMemo<Conditions>(() => {
    if (site === 'onshore' && st.sim.useObserved && hourly) {
      const idx = Math.min(Math.max(0, st.sim.timeIndex), hourly.length - 1);
      const obs = observedConditions(hourly, idx);
      if (obs) {
        return { windDir: obs.windDir, windSpeed: obs.windSpeed, ti: st.ti, source: 'observed', timestamp: hourIndexToDate(hourly, idx), observedFarmKw: obs.farmObservedKw, turbinesWithData: obs.turbinesWithData };
      }
      return { windDir: st.windDir, windSpeed: 0, ti: st.ti, source: 'observed', timestamp: hourIndexToDate(hourly, idx), observedFarmKw: null, turbinesWithData: 0 };
    }
    return { windDir: st.windDir, windSpeed: st.windSpeed, ti: st.ti, source: 'manual' };
  }, [site, st.sim.useObserved, st.sim.timeIndex, st.windDir, st.windSpeed, st.ti, hourly]);

  const farmCase = useMemo<FarmCase | undefined>(
    () =>
      eng
        ? { x: layout.map((t) => t.x), y: layout.map((t) => t.y), model: eng.model, windDir: conditions.windDir, windSpeed: conditions.windSpeed, ti: conditions.ti }
        : undefined,
    [eng, layout, conditions],
  );
  const solved = useMemo(() => (farmCase ? solveFarm(farmCase) : undefined), [farmCase]);
  const violations = useMemo(
    () => (eng ? checkConstraints(layout, { minSpacingD: st.minSpacingD, rotorDiameter: eng.model.rotorDiameter.value, boundary: st.boundary }) : []),
    [eng, layout, st.minSpacingD, st.boundary],
  );
  const minSpacingM = useMemo(() => pairwiseMin(layout).d, [layout]);

  return { st, eng, loading: loading || (site === 'onshore' && hourlyState.loading), error: error ?? (site === 'onshore' ? hourlyState.error : undefined), hourly, layout, conditions, farmCase, solved, violations, minSpacingM };
}
