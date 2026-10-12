import { Database, RefreshCw, Server, Trash2 } from 'lucide-react';
import { Badge, Button, Callout, Card, CardHeader, KeyValue, PageHeader } from '../components/ui/primitives';
import { ProvenanceBadge, ProvenanceLegend } from '../components/ui/Provenance';
import { DataGate } from '../components/ui/states';
import type { ProvenanceKind } from '../data/types';
import { bytes, date } from '../lib/format';
import { PROVENANCE } from '../lib/provenance';
import { API_BASE, API_CONFIGURED, useBackendStatus } from '../services/api';
import { useDataset } from '../services/dataService';
import { useCopilotStore, useScenarioStore, useUiStore } from '../store/appStores';
import { useSiteStore } from '../store/siteStore';

export default function SettingsPage() {
  const manifest = useDataset('manifest');
  const [status, recheck] = useBackendStatus();
  const resetSite = useSiteStore((s) => s.resetSite);
  const clearScenarios = useScenarioStore((s) => s.clear);
  const clearNotifications = useUiStore((s) => s.clearNotifications);

  const clearAll = () => {
    if (!window.confirm('Clear all locally stored layouts, scenarios, conversations and notifications in this browser?')) return;
    resetSite('onshore');
    resetSite('offshore');
    clearScenarios();
    clearNotifications();
    useCopilotStore.setState({ conversations: [], activeId: null });
  };

  return (
    <div>
      <PageHeader eyebrow="Assist" title="Settings & data sources" description="Where every number comes from, how the backend is connected, and what is stored locally." />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Repository datasets" subtitle="Read-only source files; the UI uses extracts generated from them" icon={<Database size={16} />} />
          <DataGate state={manifest}>
            {(m) => (
              <>
                <div className="space-y-3">
                  {m.datasets.map((d) => (
                    <div key={d.id} className="rounded-xl border border-line p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[13.5px] font-semibold">{d.name}</span>
                        <div className="flex items-center gap-1.5">
                          <Badge>{d.format}</Badge>
                          <Badge>{bytes(d.bytes)}</Badge>
                          <ProvenanceBadge kind={d.kind} />
                        </div>
                      </div>
                      <code className="mt-1 block break-all text-[11.5px] text-muted">{d.path}</code>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{d.notes}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[12px] text-muted">
                  Extracts generated {date(m.generatedAt, true)} by <code>{m.generator}</code>. Re-run <code>py -3.11 scripts/build_frontend_data.py</code> after changing source data.
                </p>
              </>
            )}
          </DataGate>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Backend connection" icon={<Server size={16} />} actions={<Button size="sm" icon={<RefreshCw size={13} />} onClick={recheck}>Re-check</Button>} />
            <KeyValue
              rows={[
                ['API base URL', API_CONFIGURED ? API_BASE || 'same address as this website' : 'not set (VITE_API_BASE_URL)'],
                ['Status', status.state],
                ['FLORIS', status.state === 'online' ? (status.health.capabilities.floris ? `available ${status.health.capabilities.floris_version ?? ''}` : 'not installed') : '—'],
                ['LLM provider', status.state === 'online' ? (status.health.capabilities.llm ? `configured (${status.health.capabilities.llm_model})` : 'not configured — set ANTHROPIC_API_KEY on the backend') : '—'],
                ['CNN-PINN inference', status.state === 'online' ? (status.health.capabilities.cnn_pinn ? 'available' : 'artifact missing') : '—'],
                ['Forecaster', status.state === 'online' ? (status.health.capabilities.forecaster ? 'available' : 'artifact missing') : '—'],
                ['Backend version', status.state === 'online' ? status.health.version : '—'],
              ]}
            />
            {status.state === 'offline' && <p className="mt-2 text-[12px] text-danger">{status.error}</p>}
            <div className="mt-3">
              <Callout tone="neutral">
                <span>
                  Standalone mode runs fully in the browser: static extracts + Gaussian wake model + optimizer worker + dispatch model. The backend adds FLORIS, server-side data access and the LLM copilot. API keys are only ever configured on the backend.
                </span>
              </Callout>
            </div>
          </Card>

          <Card>
            <CardHeader title="Provenance categories" />
            <ProvenanceLegend />
            <dl className="mt-3 space-y-2 text-[12.5px]">
              {(Object.keys(PROVENANCE) as ProvenanceKind[]).map((k) => (
                <div key={k}>
                  <dt className="font-semibold" style={{ color: PROVENANCE[k].color }}>
                    {PROVENANCE[k].label}
                  </dt>
                  <dd className="text-ink-2">{PROVENANCE[k].description}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Local storage" />
            <p className="text-[12.5px] text-muted">Layouts, saved scenarios, conversations and the sidebar state are stored in this browser’s localStorage only.</p>
            <Button className="mt-3" variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={clearAll}>
              Clear local workspace
            </Button>
          </Card>
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader title="Known gaps" subtitle="Inputs the platform would need for the features marked unavailable" />
        <ul className="grid gap-2 text-[12.5px] text-ink-2 md:grid-cols-2">
          {[
            'La Haute Borne turbine coordinates and datasheet (positions are schematic; D/hub from public spec).',
            'Turbine alarm/status logs to confirm anomaly causes.',
            'Offshore wind measurements — the offshore farm uses an assumed Weibull resource.',
            'Hydrokinetic generator measurements — all hydro power is modeled.',
            'Numerical-weather-prediction inputs for day-ahead forecasting.',
            'LLM provider credentials on the backend (ANTHROPIC_API_KEY) to switch the copilot from local tools to the Claude agent.',
          ].map((g) => (
            <li key={g} className="rounded-lg bg-subtle px-3 py-2">
              {g}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
