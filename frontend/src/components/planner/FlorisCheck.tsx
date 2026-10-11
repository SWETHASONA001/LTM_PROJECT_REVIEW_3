import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import type { SiteEngineering } from '../../lib/engineering';
import { fmt, power, signedPct } from '../../lib/format';
import type { LayoutTurbine } from '../../physics/constraints';
import type { FarmResult } from '../../physics/wake';
import { backend, useBackendStatus, type FlorisResponse } from '../../services/api';
import type { SiteId, SiteState } from '../../store/siteStore';
import { Button, Card, CardHeader } from '../ui/primitives';
import { ProvenanceBadge } from '../ui/Provenance';
import { UnavailableState } from '../ui/states';

/** Cross-check the in-browser wake model against FLORIS on the backend. */
export function FlorisCheck({ site, turbines, eng, st, inBrowser }: { site: SiteId; turbines: LayoutTurbine[]; eng: SiteEngineering; st: SiteState; inBrowser: FarmResult }) {
  const [status] = useBackendStatus();
  const [res, setRes] = useState<FlorisResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const floris = status.state === 'online' && status.health.capabilities.floris;

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await backend.floris({
        site,
        x: turbines.map((t) => t.x),
        y: turbines.map((t) => t.y),
        wind_direction: st.windDir,
        wind_speed: st.windSpeed,
        turbulence_intensity: st.ti,
        turbine: { rotor_diameter: eng.model.rotorDiameter.value, hub_height: eng.model.hubHeight.value, ws: eng.model.ws, power_kw: eng.model.powerKw, ct: eng.model.ct },
      });
      setRes(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="FLORIS cross-check" icon={<FlaskConical size={16} />} actions={<ProvenanceBadge kind="physics" />} />
      {!floris ? (
        <UnavailableState
          className="py-5"
          title={status.state === 'standalone' ? 'No backend configured' : status.state === 'online' ? 'FLORIS not installed on backend' : status.state === 'checking' ? 'Checking backend…' : 'Backend unreachable'}
          reason="Planner results come from the in-browser Gaussian wake model. FLORIS runs only on the Python backend; it cannot run in the browser."
          requirement={<>Start <code className="rounded bg-sunken px-1">backend/</code> with FLORIS installed and set <code className="rounded bg-sunken px-1">VITE_API_BASE_URL</code>.</>}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-[12.5px] text-muted">Runs FLORIS ({status.state === 'online' ? status.health.capabilities.floris_version : ''}) for the current layout and condition with the same power/Ct curve.</p>
          <Button size="sm" variant="primary" onClick={run} disabled={busy}>
            {busy ? 'Running FLORIS…' : 'Run FLORIS for current layout'}
          </Button>
          {err && <p className="text-[12px] text-danger">{err}</p>}
          {res && (
            <div className="rounded-lg bg-subtle p-3 text-[12.5px]">
              <div className="flex justify-between">
                <span className="text-muted">FLORIS farm power ({res.engine})</span>
                <span className="num font-semibold">{power(res.farm_power_kw)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">In-browser Gaussian model</span>
                <span className="num font-semibold">{power(inBrowser.farmKw)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Difference</span>
                <span className="num font-semibold">{res.farm_power_kw ? signedPct(inBrowser.farmKw / res.farm_power_kw - 1) : '—'}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted">Max per-turbine abs. difference: {fmt(Math.max(...res.turbine_power_kw.map((p, i) => Math.abs(p - (inBrowser.powerKw[i] ?? 0)))), 0)} kW</div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
