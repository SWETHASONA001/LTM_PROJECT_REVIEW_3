import clsx from 'clsx';
import { Camera, Copy, Download, FolderOpen, GitCompareArrows, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LayoutThumb } from '../components/planner/LayoutCanvas';
import { Segmented } from '../components/ui/controls';
import { Badge, Button, Callout, Card, CardHeader, IconButton, PageHeader } from '../components/ui/primitives';
import { ProvenanceBadge } from '../components/ui/Provenance';
import { EmptyState } from '../components/ui/states';
import { useSiteEngineering } from '../lib/engineering';
import { date, downloadFile, energy, fmt, pct, power, signedPct } from '../lib/format';
import { evaluateLayout } from '../lib/scenarioMetrics';
import { WAKE_MODEL_LABEL } from '../physics/wake';
import { useScenarioStore, useUiStore, type Scenario } from '../store/appStores';
import { useSiteStore, type SiteId } from '../store/siteStore';

export default function ScenariosPage() {
  const scenarios = useScenarioStore((s) => s.scenarios);
  const { duplicate, rename, remove, add } = useScenarioStore();
  const sites = useSiteStore((s) => s.sites);
  const commitLayout = useSiteStore((s) => s.commitLayout);
  const setActive = useSiteStore((s) => s.setActiveSite);
  const notify = useUiStore((s) => s.notify);
  const nav = useNavigate();
  const onshore = useSiteEngineering('onshore');
  const offshore = useSiteEngineering('offshore');
  const [filter, setFilter] = useState<'all' | SiteId>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const list = scenarios.filter((s) => filter === 'all' || s.site === filter);
  const a = scenarios.find((s) => s.id === picked[0]);
  const b = scenarios.find((s) => s.id === picked[1]);

  const snapshot = (site: SiteId) => {
    const eng = site === 'onshore' ? onshore.eng : offshore.eng;
    if (!eng) return;
    const st = sites[site];
    const ev = evaluateLayout(st.turbines, eng, st);
    add({
      name: `${site === 'onshore' ? 'Onshore' : 'Offshore'} snapshot · ${new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}`,
      site,
      origin: 'manual',
      turbines: st.turbines,
      conditions: { windDir: st.windDir, windSpeed: st.windSpeed, ti: st.ti, minSpacingD: st.minSpacingD },
      resourceLabel: eng.cases.label,
      wakeModel: WAKE_MODEL_LABEL,
      metrics: ev.metrics,
    });
    notify({ title: 'Scenario saved', body: `Snapshot of the current ${site} layout.`, tone: 'success', href: '/scenarios' });
  };

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));

  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="Optimization scenarios"
        description="Saved layouts with their computed metrics. Select two scenarios to compare. Metrics were computed by the in-browser wake model when the scenario was saved."
        actions={
          <>
            <Button icon={<Camera size={14} />} onClick={() => snapshot('onshore')} disabled={!onshore.eng}>
              Snapshot onshore
            </Button>
            <Button icon={<Camera size={14} />} onClick={() => snapshot('offshore')}>
              Snapshot offshore
            </Button>
          </>
        }
      />

      {scenarios.length === 0 ? (
        <Card>
          <EmptyState
            icon={<GitCompareArrows size={18} />}
            title="No scenarios yet"
            body="Save layouts from the planner’s comparison panel (baseline, current edit or optimized candidate), or snapshot the current layouts above."
            action={
              <Link to="/planner" className="inline-flex h-9 items-center rounded-lg bg-ink px-3 text-sm font-medium text-white">
                Open planner
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: `All (${scenarios.length})` }, { value: 'onshore', label: 'Onshore' }, { value: 'offshore', label: 'Offshore' }]} />
            <div className="flex items-center gap-2 text-[12.5px] text-muted">
              Selected for comparison: {picked.length}/2
              <Button size="sm" icon={<Download size={13} />} onClick={() => downloadFile('aerohydro_scenarios.json', JSON.stringify(scenarios, null, 2))}>
                Export JSON
              </Button>
            </div>
          </div>

          {a && b && <CompareTwo a={a} b={b} />}
          {picked.length === 1 && <Callout tone="neutral">Select one more scenario to compare.</Callout>}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((s) => (
              <ScenarioCard
                key={s.id}
                s={s}
                picked={picked.includes(s.id)}
                onPick={() => toggle(s.id)}
                onRename={(n) => rename(s.id, n)}
                onDuplicate={() => duplicate(s.id)}
                onDelete={() => {
                  remove(s.id);
                  setPicked((p) => p.filter((x) => x !== s.id));
                }}
                onOpen={() => {
                  commitLayout(s.site, s.turbines);
                  setActive(s.site);
                  nav('/planner');
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScenarioCard({ s, picked, onPick, onRename, onDuplicate, onDelete, onOpen }: { s: Scenario; picked: boolean; onPick: () => void; onRename: (n: string) => void; onDuplicate: () => void; onDelete: () => void; onOpen: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const boundary = { width: Math.max(...s.turbines.map((t) => Math.abs(t.x))) * 2.3 || 1000, height: Math.max(...s.turbines.map((t) => Math.abs(t.y))) * 2.3 || 1000 };
  return (
    <div className={clsx('card flex flex-col p-4 transition-shadow', picked && 'ring-2 ring-energy')}>
      <div className="mb-2 flex items-start gap-2">
        <input type="checkbox" checked={picked} onChange={onPick} aria-label={`Select ${s.name} for comparison`} className="mt-1 h-4 w-4 accent-[var(--color-energy)]" />
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                onRename(name.trim() || s.name);
                setEditing(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="w-full rounded border border-line px-1.5 py-0.5 text-[13.5px] font-semibold outline-none focus:border-energy"
            />
          ) : (
            <div className="truncate text-[13.5px] font-semibold" title={s.name}>
              {s.name}
            </div>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
            <Badge tone={s.site === 'onshore' ? 'energy' : 'water'}>{s.site}</Badge>
            <ProvenanceBadge kind={s.origin === 'optimized' ? 'optimized' : 'simulated'} />
            {date(s.createdAt, true)}
          </div>
        </div>
      </div>
      <div className="mb-3 h-36 rounded-lg bg-subtle p-1">
        <LayoutThumb turbines={s.turbines} boundary={boundary} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <div className="text-muted">AEP</div>
          <div className="num font-semibold">{energy(s.metrics.aepMWh, 1)}</div>
        </div>
        <div>
          <div className="text-muted">Wake loss</div>
          <div className="num font-semibold">{pct(s.metrics.wakeLossAnnual, 1)}</div>
        </div>
        <div>
          <div className="text-muted">Turbines</div>
          <div className="num font-semibold">{s.metrics.nTurbines}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-0.5 border-t border-line pt-2">
        <Button size="sm" variant="ghost" icon={<FolderOpen size={13} />} onClick={onOpen}>
          Open in planner
        </Button>
        <div className="ml-auto flex">
          <IconButton label="Rename" onClick={() => setEditing(true)}>
            <Pencil size={14} />
          </IconButton>
          <IconButton label="Duplicate" onClick={onDuplicate}>
            <Copy size={14} />
          </IconButton>
          <IconButton label="Delete" onClick={onDelete}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function CompareTwo({ a, b }: { a: Scenario; b: Scenario }) {
  const rows: [string, (s: Scenario) => number, (v: number) => string][] = [
    ['Turbines', (s) => s.metrics.nTurbines, (v) => String(v)],
    ['Annual energy (AEP)', (s) => s.metrics.aepMWh, (v) => energy(v, 2)],
    ['AEP without wakes', (s) => s.metrics.aepNoWakeMWh, (v) => energy(v, 2)],
    ['Annual wake loss', (s) => s.metrics.wakeLossAnnual, (v) => pct(v, 2)],
    ['Farm power @ saved condition', (s) => s.metrics.farmKw, (v) => power(v)],
    ['Minimum spacing', (s) => s.metrics.minSpacingM, (v) => `${fmt(v, 0)} m`],
    ['Constraint violations', (s) => s.metrics.violations, (v) => String(v)],
  ];
  const sameSite = a.site === b.site;
  return (
    <Card>
      <CardHeader title="Scenario comparison" subtitle={sameSite ? `Both ${a.site}.` : 'Different sites — resources differ, so energy values are not directly comparable.'} />
      {!sameSite && <Callout tone="warn">Onshore uses the SCADA-derived wind rose; offshore uses an assumed Weibull resource and a different turbine model.</Callout>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-muted">
              <th className="py-2 font-medium">Metric</th>
              <th className="py-2 text-right font-medium">{a.name}</th>
              <th className="py-2 text-right font-medium">{b.name}</th>
              <th className="py-2 text-right font-medium">Δ (B − A)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, get, f]) => {
              const va = get(a);
              const vb = get(b);
              return (
                <tr key={label} className="border-b border-line/60">
                  <td className="py-2 text-ink-2">{label}</td>
                  <td className="num py-2 text-right">{f(va)}</td>
                  <td className="num py-2 text-right">{f(vb)}</td>
                  <td className="num py-2 text-right text-ink-2">{va === vb ? '—' : va ? signedPct(vb / va - 1) : f(vb - va)}</td>
                </tr>
              );
            })}
            <tr>
              <td className="py-2 text-ink-2">Resource / model</td>
              <td className="py-2 text-right text-[11.5px] text-muted">{a.resourceLabel}</td>
              <td className="py-2 text-right text-[11.5px] text-muted">{b.resourceLabel}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
