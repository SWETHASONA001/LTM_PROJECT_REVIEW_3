import { beforeEach, describe, expect, it } from 'vitest';
import { useScenarioStore } from '../store/appStores';
import { SCADA_TURBINES, useSiteStore } from '../store/siteStore';

const reset = () => {
  localStorage.clear();
  useSiteStore.getState().resetSite('onshore');
  useSiteStore.getState().resetSite('offshore');
};

describe('site store', () => {
  beforeEach(reset);

  it('starts with 16 onshore (4 real SCADA) and 16 offshore proposed positions', () => {
    const { onshore, offshore } = useSiteStore.getState().sites;
    expect(onshore.turbines).toHaveLength(16);
    expect(onshore.turbines.filter((t) => t.status === 'real').map((t) => t.id)).toEqual([...SCADA_TURBINES]);
    expect(offshore.turbines).toHaveLength(16);
    expect(offshore.turbines.every((t) => t.status === 'proposed')).toBe(true);
  });

  it('supports add, move, undo and redo', () => {
    const s = useSiteStore.getState();
    const id = s.addTurbine('onshore', 100, 200);
    expect(useSiteStore.getState().sites.onshore.turbines).toHaveLength(17);
    s.moveTurbine('onshore', id, 300, 400);
    expect(useSiteStore.getState().sites.onshore.turbines.find((t) => t.id === id)).toMatchObject({ x: 300, y: 400 });
    s.undo('onshore');
    expect(useSiteStore.getState().sites.onshore.turbines.find((t) => t.id === id)).toMatchObject({ x: 100, y: 200 });
    s.undo('onshore');
    expect(useSiteStore.getState().sites.onshore.turbines).toHaveLength(16);
    s.redo('onshore');
    expect(useSiteStore.getState().sites.onshore.turbines).toHaveLength(17);
  });

  it('keeps onshore and offshore state independent', () => {
    const s = useSiteStore.getState();
    const before = JSON.stringify(useSiteStore.getState().sites.onshore);
    s.patch('offshore', { windDir: 12, windSpeed: 15 });
    s.addTurbine('offshore', 0, 0);
    expect(JSON.stringify(useSiteStore.getState().sites.onshore)).toBe(before);
    expect(useSiteStore.getState().sites.offshore.turbines).toHaveLength(17);
  });

  it('saves, loads and resets layouts', () => {
    const s = useSiteStore.getState();
    s.saveLayout('onshore', 'A');
    const id = s.addTurbine('onshore', 1, 1);
    s.loadLayout('onshore', useSiteStore.getState().sites.onshore.saved[0].id);
    expect(useSiteStore.getState().sites.onshore.turbines.some((t) => t.id === id)).toBe(false);
    s.addTurbine('onshore', 5, 5);
    s.resetToBaseline('onshore');
    expect(useSiteStore.getState().sites.onshore.turbines).toEqual(useSiteStore.getState().sites.onshore.baseline);
  });
});

describe('scenario store', () => {
  it('adds, duplicates, renames and removes scenarios', () => {
    const st = useScenarioStore.getState();
    st.clear();
    const id = st.add({
      name: 'S1',
      site: 'onshore',
      origin: 'manual',
      turbines: [],
      conditions: { windDir: 0, windSpeed: 8, ti: 0.1, minSpacingD: 3 },
      resourceLabel: 'r',
      wakeModel: 'w',
      metrics: { nTurbines: 0, farmKw: 0, wakeLossInstant: 0, aepMWh: 0, aepNoWakeMWh: 0, wakeLossAnnual: 0, violations: 0, minSpacingM: 0 },
    });
    st.duplicate(id);
    expect(useScenarioStore.getState().scenarios).toHaveLength(2);
    st.rename(id, 'Renamed');
    expect(useScenarioStore.getState().scenarios.find((s) => s.id === id)?.name).toBe('Renamed');
    st.remove(id);
    expect(useScenarioStore.getState().scenarios).toHaveLength(1);
  });
});
