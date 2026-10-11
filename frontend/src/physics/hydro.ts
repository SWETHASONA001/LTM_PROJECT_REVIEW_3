/**
 * Hydrokinetic power relations.
 *
 *   P_available  = 0.5 · ρ · A · |v|³             (kinetic power through the rotor area)
 *   P_electrical = 0.5 · ρ · A · |v|³ · Cp · η     (capped at rated, zero below cut-in)
 *
 * v is the observed depth-averaged current speed (ADCP). Cp and η are user
 * assumptions — the repository contains no hydrokinetic generator data, so
 * every electrical result is MODELED, never measured.
 */

export interface HydroTurbineConfig {
  rho: number; // kg/m3
  diameter: number; // m
  cp: number; // -
  eta: number; // drivetrain + conversion efficiency (-)
  ratedKw: number;
  cutInMs: number;
  count: number;
}

export const DEFAULT_HYDRO: HydroTurbineConfig = {
  rho: 1025,
  diameter: 16,
  cp: 0.4,
  eta: 0.9,
  ratedKw: 500,
  cutInMs: 0.75,
  count: 1,
};

export const sweptArea = (d: number) => Math.PI * (d / 2) ** 2;

export function availablePowerKw(v: number, c: HydroTurbineConfig): number {
  return (0.5 * c.rho * sweptArea(c.diameter) * Math.abs(v) ** 3) / 1000;
}

export function electricalPowerKw(v: number, c: HydroTurbineConfig): number {
  const s = Math.abs(v);
  if (s < c.cutInMs) return 0;
  return Math.min(c.ratedKw, availablePowerKw(s, c) * c.cp * c.eta);
}

export interface HydroSeriesResult {
  meanAvailableKw: number;
  meanElectricalKw: number; // per turbine
  capacityFactor: number;
  operatingShare: number;
  ratedShare: number;
}

export function summarizeHydro(u: (number | null)[], c: HydroTurbineConfig): HydroSeriesResult {
  let n = 0;
  let avail = 0;
  let elec = 0;
  let op = 0;
  let rated = 0;
  for (const v of u) {
    if (v === null || !Number.isFinite(v)) continue;
    n++;
    avail += availablePowerKw(v, c);
    const p = electricalPowerKw(v, c);
    elec += p;
    if (p > 0) op++;
    if (p >= c.ratedKw - 1e-9) rated++;
  }
  if (n === 0) return { meanAvailableKw: 0, meanElectricalKw: 0, capacityFactor: 0, operatingShare: 0, ratedShare: 0 };
  return {
    meanAvailableKw: avail / n,
    meanElectricalKw: elec / n,
    capacityFactor: elec / n / c.ratedKw,
    operatingShare: op / n,
    ratedShare: rated / n,
  };
}
