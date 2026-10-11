import { ctAt, powerAt, type TurbineModel } from './turbines';

/**
 * Analytical Gaussian wake model (Bastankhah & Porté-Agel, 2014) with
 * wake-expansion k* = 0.38·TI + 0.004 (Niayifar & Porté-Agel, 2016),
 * sum-of-squares deficit superposition and 5-point rotor averaging.
 *
 * This is the AeroHydro in-browser physics engine. It is NOT FLORIS; when a
 * FLORIS backend is configured the planner can request FLORIS results via the
 * API instead. Outputs are physics-derived simulations, never measurements.
 */

export const WAKE_MODEL_ID = 'gaussian-bpa2014';
export const WAKE_MODEL_LABEL = 'Gaussian wake (Bastankhah & Porté-Agel 2014), in-browser';

export interface FarmCase {
  x: number[]; // m, east
  y: number[]; // m, north
  model: TurbineModel;
  /** Meteorological wind direction: where the wind comes FROM, deg clockwise from north */
  windDir: number;
  windSpeed: number; // m/s free-stream at hub height
  ti: number; // ambient turbulence intensity (-)
}

export interface FarmResult {
  effectiveWs: number[];
  powerKw: number[];
  ct: number[];
  /** Fractional velocity deficit per turbine (0 = unwaked) */
  deficit: number[];
  farmKw: number;
  freeKw: number; // N × power at free-stream
  wakeLoss: number; // 1 - farm/free (0 when free power is zero)
}

/** Unit vector pointing downstream for a meteorological wind direction. */
export function downstreamVector(windDir: number): [number, number] {
  const th = (windDir * Math.PI) / 180;
  return [-Math.sin(th), -Math.cos(th)];
}

export function wakeExpansion(ti: number): number {
  return 0.38 * ti + 0.004;
}

/**
 * Normalised velocity deficit at a point located (dx downstream, dy lateral,
 * dz vertical) from a rotor of diameter D with thrust coefficient ct.
 */
export function gaussianDeficit(dx: number, dy: number, dz: number, D: number, ct: number, kStar: number): number {
  if (dx <= 0.1 * D || ct <= 0) return 0;
  const sq = Math.sqrt(1 - ct);
  const beta = (0.5 * (1 + sq)) / sq;
  const eps = 0.2 * Math.sqrt(beta);
  const sigD = kStar * (dx / D) + eps; // sigma / D
  const arg = 1 - ct / (8 * sigD * sigD);
  const c = 1 - Math.sqrt(Math.max(arg, 0));
  const sig = sigD * D;
  return c * Math.exp(-(dy * dy + dz * dz) / (2 * sig * sig));
}

// Rotor sample points (fraction of radius): centre + 4 points at r/2.
const ROTOR_PTS: [number, number][] = [
  [0, 0],
  [0.5, 0],
  [-0.5, 0],
  [0, 0.5],
  [0, -0.5],
];

export function solveFarm(c: FarmCase): FarmResult {
  const n = c.x.length;
  const D = c.model.rotorDiameter.value;
  const R = D / 2;
  const kStar = wakeExpansion(c.ti);
  const [ux, uy] = downstreamVector(c.windDir);
  // Downstream coordinate and lateral coordinate for each turbine.
  const s = new Float64Array(n);
  const l = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = c.x[i] * ux + c.y[i] * uy;
    l[i] = -c.x[i] * uy + c.y[i] * ux;
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => s[a] - s[b]);
  const effectiveWs = new Array<number>(n).fill(c.windSpeed);
  const ct = new Array<number>(n).fill(0);
  const deficit = new Array<number>(n).fill(0);
  const powerKw = new Array<number>(n).fill(0);

  for (let oi = 0; oi < n; oi++) {
    const j = order[oi];
    // Rotor-averaged effective speed: cube-root of mean cube over sample points.
    let cubeSum = 0;
    for (const [py, pz] of ROTOR_PTS) {
      let sumSq = 0;
      for (let oj = 0; oj < oi; oj++) {
        const i = order[oj];
        const d = gaussianDeficit(s[j] - s[i], l[j] + py * R - l[i], pz * R, D, ct[i], kStar);
        sumSq += d * d;
      }
      const u = c.windSpeed * Math.max(0, 1 - Math.sqrt(sumSq));
      cubeSum += u * u * u;
    }
    const ueff = Math.cbrt(cubeSum / ROTOR_PTS.length);
    effectiveWs[j] = ueff;
    deficit[j] = c.windSpeed > 0 ? 1 - ueff / c.windSpeed : 0;
    ct[j] = ctAt(c.model, ueff);
    powerKw[j] = powerAt(c.model, ueff);
  }
  const farmKw = powerKw.reduce((a, b) => a + b, 0);
  const freeKw = n * powerAt(c.model, c.windSpeed);
  return {
    effectiveWs,
    powerKw,
    ct,
    deficit,
    farmKw,
    freeKw,
    wakeLoss: freeKw > 0 ? Math.max(0, 1 - farmKw / freeKw) : 0,
  };
}

export interface FieldGrid {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  nx: number;
  ny: number;
}

/**
 * Hub-height horizontal velocity field (m/s), row-major from yMin to yMax.
 * Uses the per-turbine Ct from an already solved farm.
 */
export function velocityField(c: FarmCase, solved: FarmResult, g: FieldGrid): Float32Array {
  const out = new Float32Array(g.nx * g.ny);
  const n = c.x.length;
  const D = c.model.rotorDiameter.value;
  const kStar = wakeExpansion(c.ti);
  const [ux, uy] = downstreamVector(c.windDir);
  const s = c.x.map((x, i) => x * ux + c.y[i] * uy);
  const l = c.x.map((x, i) => -x * uy + c.y[i] * ux);
  for (let iy = 0; iy < g.ny; iy++) {
    const py = g.yMin + ((iy + 0.5) / g.ny) * (g.yMax - g.yMin);
    for (let ix = 0; ix < g.nx; ix++) {
      const px = g.xMin + ((ix + 0.5) / g.nx) * (g.xMax - g.xMin);
      const ps = px * ux + py * uy;
      const pl = -px * uy + py * ux;
      let sumSq = 0;
      for (let i = 0; i < n; i++) {
        const d = gaussianDeficit(ps - s[i], pl - l[i], 0, D, solved.ct[i], kStar);
        sumSq += d * d;
      }
      out[iy * g.nx + ix] = c.windSpeed * Math.max(0, 1 - Math.sqrt(sumSq));
    }
  }
  return out;
}
