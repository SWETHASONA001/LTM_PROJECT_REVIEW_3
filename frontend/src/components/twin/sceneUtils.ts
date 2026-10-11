/** Scene scale: 1 world unit = 10 m. East = +X, North = −Z. */
export const S = 0.1;

export const toWorld = (east: number, north: number): [number, number] => [east * S, -north * S];
export const toSite = (wx: number, wz: number): [number, number] => [wx / S, -wz / S];

/** Yaw (rad, about +Y) that points a rotor's local +Z toward the upwind direction. */
export function yawForWind(windDirFromDeg: number): number {
  const th = (windDirFromDeg * Math.PI) / 180;
  return Math.atan2(Math.sin(th), -Math.cos(th));
}

/** Smooth deterministic terrain height (world units) for the onshore site. */
export function terrainHeight(wx: number, wz: number): number {
  const r = Math.hypot(wx, wz);
  const farm = Math.min(1, Math.max(0, (r - 120) / 220)); // flatter inside the farm
  const base =
    0.9 * Math.sin(wx * 0.021 + 1.3) * Math.cos(wz * 0.017 - 0.4) +
    0.5 * Math.sin(wx * 0.047 - wz * 0.031) +
    0.25 * Math.cos(wx * 0.09 + wz * 0.07);
  const hills = farm * (6 * Math.sin(wx * 0.006 + 0.8) * Math.cos(wz * 0.0075) + 4 * Math.sin(wz * 0.011 + wx * 0.004));
  return base + Math.max(hills, -2);
}

export const SEABED_DEPTH = 3.2; // world units (≈32 m), illustrative
