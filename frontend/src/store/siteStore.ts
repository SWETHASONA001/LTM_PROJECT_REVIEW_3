import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { LayoutTurbine } from '../physics/constraints';

export type SiteId = 'onshore' | 'offshore';

export const SCADA_TURBINES = ['R80711', 'R80721', 'R80736', 'R80790'] as const;

export interface CandidateLayout {
  turbines: LayoutTurbine[];
  createdAt: string;
  method: string;
  startAepMWh: number;
  aepMWh: number;
  evaluations: number;
  terminatedBy: string;
  resourceLabel: string;
  lockReal: boolean;
}

export interface SavedLayout {
  id: string;
  name: string;
  createdAt: string;
  turbines: LayoutTurbine[];
}

export interface OffshoreResource {
  k: number;
  A: number;
  prevailingDir: number;
  directionality: number;
}

export interface SiteState {
  turbines: LayoutTurbine[];
  baseline: LayoutTurbine[];
  candidate: CandidateLayout | null;
  saved: SavedLayout[];
  windDir: number;
  windSpeed: number;
  ti: number;
  minSpacingD: number;
  boundary: { width: number; height: number };
  lockReal: boolean;
  selectedId: string | null;
  /** Which layout the twin/planner currently displays */
  view: 'current' | 'baseline' | 'candidate';
  sim: { playing: boolean; speed: number; timeIndex: number; useObserved: boolean };
  offshoreResource: OffshoreResource;
  past: LayoutTurbine[][];
  future: LayoutTurbine[][];
}

function grid(prefix: string, cols: number, rows: number, dx: number, dy: number, rotateDeg: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const th = (rotateDeg * Math.PI) / 180;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = (c - (cols - 1) / 2) * dx;
      const y0 = ((rows - 1) / 2 - r) * dy;
      out.push({ x: Math.round(x0 * Math.cos(th) - y0 * Math.sin(th)), y: Math.round(x0 * Math.sin(th) + y0 * Math.cos(th)) });
    }
  }
  void prefix;
  return out;
}

/**
 * Default onshore planning layout: 16 positions. The first four carry the
 * real SCADA turbine identifiers. Their positions are SCHEMATIC — the
 * repository contains no turbine coordinates.
 */
export function defaultOnshoreLayout(): LayoutTurbine[] {
  return grid('ON', 4, 4, 5 * 82, 6 * 82, 0).map((p, i) => {
    const real = i < 4;
    return {
      id: real ? SCADA_TURBINES[i] : `ON-P${String(i + 1).padStart(2, '0')}`,
      label: real ? SCADA_TURBINES[i] : `P${String(i + 1).padStart(2, '0')}`,
      status: real ? 'real' : 'proposed',
      ...p,
    };
  });
}

/** Default offshore planning layout: 16 proposed positions (no offshore data exists). */
export function defaultOffshoreLayout(): LayoutTurbine[] {
  return grid('OF', 4, 4, 6 * 126, 6 * 126, 0).map((p, i) => ({
    id: `OF-P${String(i + 1).padStart(2, '0')}`,
    label: `OF${String(i + 1).padStart(2, '0')}`,
    status: 'proposed',
    ...p,
  }));
}

function initialSite(id: SiteId): SiteState {
  const turbines = id === 'onshore' ? defaultOnshoreLayout() : defaultOffshoreLayout();
  return {
    turbines,
    baseline: turbines,
    candidate: null,
    saved: [],
    windDir: id === 'onshore' ? 210 : 240,
    windSpeed: id === 'onshore' ? 8 : 10,
    ti: id === 'onshore' ? 0.12 : 0.06,
    minSpacingD: id === 'onshore' ? 3 : 4,
    boundary: id === 'onshore' ? { width: 2600, height: 3000 } : { width: 5200, height: 5200 },
    lockReal: true,
    selectedId: null,
    view: 'current',
    sim: { playing: true, speed: 1, timeIndex: 7400, useObserved: id === 'onshore' },
    offshoreResource: { k: 2.2, A: 10, prevailingDir: 240, directionality: 0.6 },
    past: [],
    future: [],
  };
}

const HISTORY_LIMIT = 60;

interface SiteStore {
  sites: Record<SiteId, SiteState>;
  activeSite: SiteId;
  setActiveSite: (s: SiteId) => void;
  patch: (s: SiteId, p: Partial<SiteState>) => void;
  patchSim: (s: SiteId, p: Partial<SiteState['sim']>) => void;
  /** Replace layout and push the previous one to the undo stack. */
  commitLayout: (s: SiteId, turbines: LayoutTurbine[]) => void;
  /** Update layout without creating history (e.g. while dragging). */
  setLayoutTransient: (s: SiteId, turbines: LayoutTurbine[]) => void;
  beginGesture: (s: SiteId) => void;
  undo: (s: SiteId) => void;
  redo: (s: SiteId) => void;
  addTurbine: (s: SiteId, x: number, y: number) => string;
  removeTurbine: (s: SiteId, id: string) => void;
  moveTurbine: (s: SiteId, id: string, x: number, y: number) => void;
  resetToBaseline: (s: SiteId) => void;
  setBaselineFromCurrent: (s: SiteId) => void;
  setCandidate: (s: SiteId, c: CandidateLayout | null) => void;
  applyCandidate: (s: SiteId) => void;
  saveLayout: (s: SiteId, name: string) => void;
  loadLayout: (s: SiteId, id: string) => void;
  deleteSaved: (s: SiteId, id: string) => void;
  resetSite: (s: SiteId) => void;
}

export const useSiteStore = create<SiteStore>()(
  persist(
    (set, get) => {
      const update = (s: SiteId, fn: (st: SiteState) => Partial<SiteState>) =>
        set((root) => ({ sites: { ...root.sites, [s]: { ...root.sites[s], ...fn(root.sites[s]) } } }));
      return {
        sites: { onshore: initialSite('onshore'), offshore: initialSite('offshore') },
        activeSite: 'onshore',
        setActiveSite: (s) => set({ activeSite: s }),
        patch: (s, p) => update(s, () => p),
        patchSim: (s, p) => update(s, (st) => ({ sim: { ...st.sim, ...p } })),
        commitLayout: (s, turbines) =>
          update(s, (st) => ({ turbines, past: [...st.past, st.turbines].slice(-HISTORY_LIMIT), future: [] })),
        setLayoutTransient: (s, turbines) => update(s, () => ({ turbines })),
        beginGesture: (s) => update(s, (st) => ({ past: [...st.past, st.turbines].slice(-HISTORY_LIMIT), future: [] })),
        undo: (s) =>
          update(s, (st) => {
            if (!st.past.length) return {};
            const prev = st.past[st.past.length - 1];
            return { turbines: prev, past: st.past.slice(0, -1), future: [st.turbines, ...st.future], view: 'current' };
          }),
        redo: (s) =>
          update(s, (st) => {
            if (!st.future.length) return {};
            const [next, ...rest] = st.future;
            return { turbines: next, past: [...st.past, st.turbines], future: rest, view: 'current' };
          }),
        addTurbine: (s, x, y) => {
          const st = get().sites[s];
          const prefix = s === 'onshore' ? 'ON' : 'OF';
          let k = st.turbines.length + 1;
          const ids = new Set(st.turbines.map((t) => t.id));
          while (ids.has(`${prefix}-P${String(k).padStart(2, '0')}`)) k++;
          const id = `${prefix}-P${String(k).padStart(2, '0')}`;
          const t: LayoutTurbine = { id, label: `${s === 'onshore' ? 'P' : 'OF'}${String(k).padStart(2, '0')}`, x: Math.round(x), y: Math.round(y), status: 'proposed' };
          get().commitLayout(s, [...st.turbines, t]);
          update(s, () => ({ selectedId: id, view: 'current' }));
          return id;
        },
        removeTurbine: (s, id) => {
          const st = get().sites[s];
          get().commitLayout(s, st.turbines.filter((t) => t.id !== id));
          update(s, (cur) => ({ selectedId: cur.selectedId === id ? null : cur.selectedId }));
        },
        moveTurbine: (s, id, x, y) => {
          const st = get().sites[s];
          get().commitLayout(s, st.turbines.map((t) => (t.id === id ? { ...t, x: Math.round(x), y: Math.round(y) } : t)));
        },
        resetToBaseline: (s) => {
          const st = get().sites[s];
          get().commitLayout(s, st.baseline);
          update(s, () => ({ view: 'current' }));
        },
        setBaselineFromCurrent: (s) => update(s, (st) => ({ baseline: st.turbines })),
        setCandidate: (s, c) => update(s, () => ({ candidate: c })),
        applyCandidate: (s) => {
          const st = get().sites[s];
          if (!st.candidate) return;
          get().commitLayout(s, st.candidate.turbines);
          update(s, () => ({ view: 'current' }));
        },
        saveLayout: (s, name) =>
          update(s, (st) => ({
            saved: [
              { id: `${Date.now().toString(36)}`, name: name || `Layout ${st.saved.length + 1}`, createdAt: new Date().toISOString(), turbines: st.turbines },
              ...st.saved,
            ].slice(0, 30),
          })),
        loadLayout: (s, id) => {
          const st = get().sites[s];
          const l = st.saved.find((x) => x.id === id);
          if (l) get().commitLayout(s, l.turbines);
        },
        deleteSaved: (s, id) => update(s, (st) => ({ saved: st.saved.filter((x) => x.id !== id) })),
        resetSite: (s) => set((root) => ({ sites: { ...root.sites, [s]: initialSite(s) } })),
      };
    },
    {
      name: 'aerohydro.sites.v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (st) => ({
        activeSite: st.activeSite,
        sites: Object.fromEntries(
          Object.entries(st.sites).map(([k, v]) => [k, { ...v, past: [], future: [] }]),
        ) as unknown as Record<SiteId, SiteState>,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<SiteStore> | undefined;
        if (!p?.sites) return current;
        const sites = { ...current.sites };
        (Object.keys(sites) as SiteId[]).forEach((k) => {
          if (p.sites?.[k]) sites[k] = { ...current.sites[k], ...p.sites[k], past: [], future: [] };
        });
        return { ...current, activeSite: p.activeSite ?? current.activeSite, sites };
      },
    },
  ),
);

export const useSite = (s: SiteId) => useSiteStore((st) => st.sites[s]);
