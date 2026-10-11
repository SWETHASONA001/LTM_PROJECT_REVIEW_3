import clsx from 'clsx';
import { Boxes, Copy, FolderOpen, Grid3x3, Layers, MousePointer2, Plus, Redo2, RotateCcw, Save, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ComparisonPanel } from '../components/planner/ComparisonPanel';
import { FlorisCheck } from '../components/planner/FlorisCheck';
import { LayoutCanvas, type EditMode } from '../components/planner/LayoutCanvas';
import { OptimizePanel } from '../components/planner/OptimizePanel';
import { NumberField, Segmented, Slider, Tabs, Toggle } from '../components/ui/controls';
import { Dialog } from '../components/ui/Dialog';
import { Badge, Button, Card, IconButton, KeyValue, PageHeader } from '../components/ui/primitives';
import { ProvenanceBadge } from '../components/ui/Provenance';
import { ErrorState, LoadingState } from '../components/ui/states';
import { useSiteEngineering } from '../lib/engineering';
import { compass, date, fmt, pct, power } from '../lib/format';
import { checkConstraints, nearestDistances } from '../physics/constraints';
import { solveFarm, WAKE_MODEL_LABEL } from '../physics/wake';
import { useSiteStore, type SiteId } from '../store/siteStore';

type PanelTab = 'conditions' | 'turbines' | 'optimize' | 'saved';

export default function PlannerPage() {
  const site = useSiteStore((s) => s.activeSite);
  const setSite = useSiteStore((s) => s.setActiveSite);
  return (
    <div>
      <PageHeader
        eyebrow="Engineering"
        title="Turbine placement planner"
        description="Design layouts, inspect wake interaction and spacing, then search for wake-mitigating placements. Wake results are physics-derived simulations, never SCADA measurements."
        actions={
          <Segmented
            ariaLabel="Planning site"
            value={site}
            onChange={(v) => setSite(v)}
            options={[
              { value: 'onshore', label: 'Onshore' },
              { value: 'offshore', label: 'Offshore' },
            ]}
          />
        }
      />
      <Planner key={site} site={site} />
    </div>
  );
}

function Planner({ site }: { site: SiteId }) {
  const st = useSiteStore((s) => s.sites[site]);
  const actions = useSiteStore();
  const { eng, error } = useSiteEngineering(site);
  const [mode, setMode] = useState<EditMode>('select');
  const [snap, setSnap] = useState(true);
  const [showWake, setShowWake] = useState(true);
  const [tab, setTab] = useState<PanelTab>('conditions');
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  const turbines = st.turbines;
  const D = eng?.model.rotorDiameter.value ?? 100;
  const farmCase = useMemo(
    () => (eng ? { x: turbines.map((t) => t.x), y: turbines.map((t) => t.y), model: eng.model, windDir: st.windDir, windSpeed: st.windSpeed, ti: st.ti } : undefined),
    [eng, turbines, st.windDir, st.windSpeed, st.ti],
  );
  const solved = useMemo(() => (farmCase ? solveFarm(farmCase) : undefined), [farmCase]);
  const violations = useMemo(() => checkConstraints(turbines, { minSpacingD: st.minSpacingD, rotorDiameter: D, boundary: st.boundary }), [turbines, st.minSpacingD, D, st.boundary]);
  const nearest = useMemo(() => nearestDistances(turbines), [turbines]);

  const removeSelected = useCallback(() => {
    const sel = turbines.find((t) => t.id === st.selectedId);
    if (!sel) return;
    if (sel.status === 'real' && st.lockReal) return;
    actions.removeTurbine(site, sel.id);
  }, [turbines, st.selectedId, st.lockReal, actions, site]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) actions.redo(site);
        else actions.undo(site);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        actions.redo(site);
      } else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
      else if (e.key === 'a') setMode('add');
      else if (e.key === 'v' || e.key === 'Escape') setMode('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, site, removeSelected]);

  if (error) return <ErrorState error={error} />;
  if (!eng || !farmCase || !solved) return <LoadingState className="h-[60vh]" label="Loading turbine model and wind resource…" />;

  const sel = turbines.find((t) => t.id === st.selectedId);
  const selIdx = turbines.findIndex((t) => t.id === st.selectedId);
  const selLocked = !!sel && sel.status === 'real' && st.lockReal;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card padded={false} className="overflow-hidden">
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
            <Segmented
              size="sm"
              ariaLabel="Edit mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'select', label: <><MousePointer2 size={13} /> Select / drag</>, title: 'Select and drag (V)' },
                { value: 'add', label: <><Plus size={13} /> Add turbine</>, title: 'Click the map to add (A)' },
              ]}
            />
            <span className="mx-1 h-5 w-px bg-line" />
            <IconButton label="Delete selected (Del)" onClick={removeSelected} disabled={!sel || selLocked}>
              <Trash2 size={15} />
            </IconButton>
            <IconButton label="Undo (Ctrl+Z)" onClick={() => actions.undo(site)} disabled={!st.past.length}>
              <Undo2 size={15} />
            </IconButton>
            <IconButton label="Redo (Ctrl+Y)" onClick={() => actions.redo(site)} disabled={!st.future.length}>
              <Redo2 size={15} />
            </IconButton>
            <span className="mx-1 h-5 w-px bg-line" />
            <IconButton label={`Snap to ${site === 'onshore' ? 10 : 20} m grid`} active={snap} onClick={() => setSnap(!snap)}>
              <Grid3x3 size={15} />
            </IconButton>
            <IconButton label="Toggle wake field" active={showWake} onClick={() => setShowWake(!showWake)}>
              <Layers size={15} />
            </IconButton>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Button size="sm" icon={<RotateCcw size={13} />} onClick={() => actions.resetToBaseline(site)}>
                Reset to baseline
              </Button>
              <Button size="sm" icon={<Save size={13} />} onClick={() => setSaveOpen(true)}>
                Save layout
              </Button>
              <Link to={`/twin/${site}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-2.5 text-[13px] font-medium text-white hover:bg-ink-2">
                <Boxes size={13} /> View in 3D
              </Link>
            </div>
          </div>
          <div className="relative h-[460px] w-full bg-[#fbfaf7] sm:h-[600px]">
            <LayoutCanvas
              turbines={turbines}
              farmCase={farmCase}
              solved={solved}
              boundary={st.boundary}
              minSpacingM={st.minSpacingD * D}
              rotorD={D}
              violations={violations}
              selectedId={st.selectedId}
              mode={mode}
              lockReal={st.lockReal}
              snapM={snap ? (site === 'onshore' ? 10 : 20) : 0}
              showWake={showWake}
              onSelect={(id) => actions.patch(site, { selectedId: id })}
              onAdd={(x, y) => {
                actions.addTurbine(site, x, y);
              }}
              onDragStart={() => actions.beginGesture(site)}
              onDrag={(id, x, y) => actions.setLayoutTransient(site, turbines.map((t) => (t.id === id ? { ...t, x: Math.round(x), y: Math.round(y) } : t)))}
              onDragEnd={() => undefined}
            />
            <div className="pointer-events-none absolute bottom-3 right-3 flex flex-wrap items-center justify-end gap-1.5">
              <ProvenanceBadge kind="physics" detail={WAKE_MODEL_LABEL} />
              {site === 'offshore' || turbines.some((t) => t.status === 'proposed') ? <ProvenanceBadge kind="simulated" detail="Proposed turbine positions" /> : null}
            </div>
            {mode === 'add' && <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-white shadow">Click inside the map to place a proposed turbine · Esc to finish</div>}
          </div>
          <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
            {[
              ['Farm power (modeled)', power(solved.farmKw)],
              ['Wake loss @ condition', pct(solved.wakeLoss, 2)],
              ['Turbines', `${turbines.length} (${turbines.filter((t) => t.status === 'real').length} real)`],
              ['Violations', violations.length ? `${violations.length} ⚠` : 'None'],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface px-4 py-2.5">
                <div className="text-[11.5px] text-muted">{k}</div>
                <div className={clsx('num text-[15px] font-semibold', k === 'Violations' && violations.length ? 'text-danger' : 'text-ink')}>{v}</div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          {sel && selIdx >= 0 && (
            <Card>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold">{sel.label}</span>
                  {sel.status === 'real' ? <Badge tone="dark">Real asset{st.lockReal ? ' · locked' : ''}</Badge> : <Badge tone="energy">Proposed</Badge>}
                </div>
                <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={removeSelected} disabled={selLocked}>
                  Remove
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="x (east)" unit="m" value={sel.x} step={10} onChange={(v) => !selLocked && actions.moveTurbine(site, sel.id, v, sel.y)} />
                <NumberField label="y (north)" unit="m" value={sel.y} step={10} onChange={(v) => !selLocked && actions.moveTurbine(site, sel.id, sel.x, v)} />
              </div>
              <div className="mt-3">
                <KeyValue
                  rows={[
                    ['Nearest turbine', `${fmt(nearest[selIdx], 0)} m (${fmt(nearest[selIdx] / D, 2)}D)`],
                    ['Effective wind speed', `${fmt(solved.effectiveWs[selIdx], 2)} m/s`],
                    ['Velocity deficit', pct(solved.deficit[selIdx], 1)],
                    ['Modeled power', power(solved.powerKw[selIdx])],
                  ]}
                />
              </div>
            </Card>
          )}
          <Card>
            <Tabs<PanelTab>
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'conditions', label: 'Conditions' },
                { value: 'turbines', label: 'Turbines' },
                { value: 'optimize', label: 'Optimize' },
                { value: 'saved', label: 'Saved' },
              ]}
            />
            {tab === 'conditions' && (
              <div className="space-y-4">
                <Slider label="Wind direction (from)" value={st.windDir} min={0} max={359} onChange={(v) => actions.patch(site, { windDir: v })} format={(v) => `${v}° ${compass(v)}`} />
                <Slider label="Wind speed (hub)" value={st.windSpeed} min={0} max={25} step={0.5} unit="m/s" onChange={(v) => actions.patch(site, { windSpeed: v })} />
                <Slider label="Turbulence intensity" value={st.ti} min={0.03} max={0.25} step={0.01} onChange={(v) => actions.patch(site, { ti: v })} format={(v) => pct(v, 0)} />
                <div className="border-t border-line pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[13px] font-semibold">Constraints</span>
                    <ProvenanceBadge kind="assumption" detail="User-configured planning constraints; no site permits or turbine datasheets exist in the repository." />
                  </div>
                  <div className="space-y-4">
                    <Slider label="Minimum spacing" value={st.minSpacingD} min={1.5} max={10} step={0.5} unit="D" onChange={(v) => actions.patch(site, { minSpacingD: v })} hint={`${fmt(st.minSpacingD * D, 0)} m centre-to-centre, rotor D = ${D} m (${eng.model.rotorDiameter.source}).`} />
                    <div className="grid grid-cols-2 gap-3">
                      <NumberField label="Boundary width" unit="m" value={st.boundary.width} min={500} max={20000} step={100} onChange={(v) => actions.patch(site, { boundary: { ...st.boundary, width: v } })} />
                      <NumberField label="Boundary height" unit="m" value={st.boundary.height} min={500} max={20000} step={100} onChange={(v) => actions.patch(site, { boundary: { ...st.boundary, height: v } })} />
                    </div>
                    <Toggle label="Lock real SCADA turbines" checked={st.lockReal} onChange={(v) => actions.patch(site, { lockReal: v })} />
                  </div>
                </div>
                {site === 'offshore' && (
                  <div className="border-t border-line pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[13px] font-semibold">Assumed offshore wind resource</span>
                      <ProvenanceBadge kind="simulated" />
                    </div>
                    <div className="space-y-4">
                      <Slider label="Weibull scale A" value={st.offshoreResource.A} min={5} max={13} step={0.1} unit="m/s" onChange={(v) => actions.patch(site, { offshoreResource: { ...st.offshoreResource, A: v } })} />
                      <Slider label="Weibull shape k" value={st.offshoreResource.k} min={1.4} max={3.2} step={0.1} onChange={(v) => actions.patch(site, { offshoreResource: { ...st.offshoreResource, k: v } })} />
                      <Slider label="Prevailing direction" value={st.offshoreResource.prevailingDir} min={0} max={359} format={(v) => `${v}° ${compass(v)}`} onChange={(v) => actions.patch(site, { offshoreResource: { ...st.offshoreResource, prevailingDir: v } })} />
                      <Slider label="Directionality" value={st.offshoreResource.directionality} min={0} max={1.5} step={0.1} onChange={(v) => actions.patch(site, { offshoreResource: { ...st.offshoreResource, directionality: v } })} hint="0 = uniform over directions." />
                    </div>
                  </div>
                )}
                {violations.length > 0 && (
                  <div className="rounded-lg border border-[#f1c6c1] bg-danger-soft p-3 text-[12px] text-danger">
                    <div className="mb-1 font-semibold">{violations.length} constraint violation(s)</div>
                    <ul className="max-h-28 space-y-0.5 overflow-y-auto scroll-thin">
                      {violations.slice(0, 12).map((v, i) => (
                        <li key={i}>{v.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {tab === 'turbines' && (
              <div className="max-h-[460px] overflow-auto scroll-thin">
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-line text-left text-[11.5px] text-muted">
                      <th className="py-1.5 font-medium">ID</th>
                      <th className="py-1.5 text-right font-medium">x m</th>
                      <th className="py-1.5 text-right font-medium">y m</th>
                      <th className="py-1.5 text-right font-medium">near D</th>
                      <th className="py-1.5 text-right font-medium">kW</th>
                    </tr>
                  </thead>
                  <tbody>
                    {turbines.map((t, i) => (
                      <tr key={t.id} onClick={() => actions.patch(site, { selectedId: t.id })} className={clsx('cursor-pointer border-b border-line/60', t.id === st.selectedId ? 'bg-energy-soft' : 'hover:bg-subtle')}>
                        <td className="py-1.5 font-medium">
                          {t.label} {t.status === 'real' && <span className="text-[10px] text-muted">real</span>}
                        </td>
                        <td className="num py-1.5 text-right">{fmt(t.x, 0)}</td>
                        <td className="num py-1.5 text-right">{fmt(t.y, 0)}</td>
                        <td className={clsx('num py-1.5 text-right', nearest[i] < st.minSpacingD * D && 'font-semibold text-danger')}>{fmt(nearest[i] / D, 1)}</td>
                        <td className="num py-1.5 text-right">{fmt(solved.powerKw[i], 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {tab === 'optimize' && <OptimizePanel site={site} st={st} eng={eng} />}
            {tab === 'saved' && (
              <div className="space-y-2">
                {st.saved.length === 0 && <p className="py-6 text-center text-[13px] text-muted">No saved layouts for this site yet. Use “Save layout”.</p>}
                {st.saved.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{l.name}</div>
                      <div className="text-[11.5px] text-muted">
                        {l.turbines.length} turbines · {date(l.createdAt, true)}
                      </div>
                    </div>
                    <IconButton label="Load layout" onClick={() => actions.loadLayout(site, l.id)}>
                      <FolderOpen size={15} />
                    </IconButton>
                    <IconButton label="Set as baseline" onClick={() => actions.patch(site, { baseline: l.turbines })}>
                      <Copy size={15} />
                    </IconButton>
                    <IconButton label="Delete" onClick={() => actions.deleteSaved(site, l.id)}>
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button size="sm" onClick={() => actions.setBaselineFromCurrent(site)}>
                    Set current as baseline
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => window.confirm(`Reset the ${site} site to its default 16-turbine layout? Saved layouts and the candidate are cleared.`) && actions.resetSite(site)}>
                    Restore default site
                  </Button>
                </div>
              </div>
            )}
          </Card>
          <FlorisCheck site={site} turbines={turbines} eng={eng} st={st} inBrowser={solved} />
        </div>
      </div>

      <ComparisonPanel site={site} st={st} eng={eng} />

      <Dialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save layout"
        footer={
          <>
            <Button onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                actions.saveLayout(site, saveName.trim());
                setSaveName('');
                setSaveOpen(false);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <label className="mb-1 block text-[12.5px] font-medium text-ink-2" htmlFor="layout-name">
          Layout name
        </label>
        <input id="layout-name" value={saveName} autoFocus onChange={(e) => setSaveName(e.target.value)} placeholder={`Layout ${st.saved.length + 1}`} className="h-9 w-full rounded-lg border border-line px-3 text-[13px] outline-none focus:border-energy" />
        <p className="mt-2 text-[12px] text-muted">Saves {turbines.length} turbine positions for the {site} site in this browser.</p>
      </Dialog>
    </div>
  );
}
