import { loadDataset } from '../services/dataService';
import { offshoreModel, onshoreModel } from '../physics/turbines';
import { useSiteStore } from '../store/siteStore';
import { layoutFor } from './engineering';

/**
 * Engineering context sent with each backend copilot request: what the user
 * is looking at (site, selection, conditions, layout) plus the turbine curve
 * the backend tools need to run FLORIS on that layout. No secrets.
 */
export async function buildCopilotContext(ctx: { turbine?: string; site?: 'onshore' | 'offshore' }) {
  const store = useSiteStore.getState();
  const site = ctx.site ?? store.activeSite;
  const st = store.sites[site];
  const model = site === 'onshore' ? onshoreModel(await loadDataset('wind_summary')) : offshoreModel();
  const layout = layoutFor(st);
  return {
    site,
    selected_turbine: ctx.turbine ?? st.selectedId ?? null,
    wind_direction: st.windDir,
    wind_speed: st.windSpeed,
    turbulence_intensity: st.ti,
    min_spacing_d: st.minSpacingD,
    boundary: st.boundary,
    layout_view: st.view,
    layout: layout.map((t) => ({ id: t.id, label: t.label, x: t.x, y: t.y, status: t.status })),
    candidate: st.candidate ? { aep_mwh: st.candidate.aepMWh, start_aep_mwh: st.candidate.startAepMWh, evaluations: st.candidate.evaluations, method: st.candidate.method } : null,
    turbine_curve: {
      rotor_diameter: model.rotorDiameter.value,
      hub_height: model.hubHeight.value,
      ws: model.ws,
      power_kw: model.powerKw,
      ct: model.ct,
    },
  };
}
