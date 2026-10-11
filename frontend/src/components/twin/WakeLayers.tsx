import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { TurbineModel } from '../../physics/turbines';
import { downstreamVector, gaussianDeficit, velocityField, wakeExpansion, type FarmCase, type FarmResult } from '../../physics/wake';
import { S, toWorld } from './sceneUtils';

/** Map a velocity deficit (0–0.6) to an RGBA colour on a blue sequential ramp. */
function deficitColor(d: number): [number, number, number, number] {
  const t = Math.min(1, Math.max(0, d / 0.45));
  // light (#cde2fb) → dark (#0d366b)
  const r = 205 + (13 - 205) * t;
  const g = 226 + (54 - 226) * t;
  const b = 251 + (107 - 251) * t;
  const a = t < 0.02 ? 0 : Math.min(0.85, 0.18 + t * 0.9);
  return [r, g, b, a * 255];
}

/**
 * Hub-height horizontal slice of the Gaussian-wake velocity deficit,
 * rendered as a translucent textured plane. Physics-derived, not measured.
 */
export function WakeSlice({ farmCase, solved, extentM, heightY }: { farmCase: FarmCase; solved: FarmResult; extentM: number; heightY: number }) {
  const N = 150;
  const texture = useMemo(() => {
    const grid = { xMin: -extentM, xMax: extentM, yMin: -extentM, yMax: extentM, nx: N, ny: N };
    const field = velocityField(farmCase, solved, grid);
    const data = new Uint8Array(N * N * 4);
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const v = field[iy * N + ix];
        const d = farmCase.windSpeed > 0 ? 1 - v / farmCase.windSpeed : 0;
        const [r, g, b, a] = deficitColor(d);
        // texture row 0 = south (yMin) → plane v=0 at bottom after rotation
        const o = (iy * N + ix) * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = a;
      }
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }, [farmCase, solved, extentM]);
  useEffect(() => () => texture.dispose(), [texture]);
  const size = extentM * 2 * S;
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, heightY, 0]} renderOrder={2}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * Wind-flow particles advected along the free-stream direction at the local
 * wake-model speed. Purely a visualization of the model field.
 */
export function WindParticles({
  model,
  turbines,
  solved,
  windDir,
  windSpeed,
  ti,
  extentM,
  hubY,
  playing,
  simSpeed,
  count = 2200,
}: {
  model: TurbineModel;
  turbines: { x: number; y: number }[];
  solved: FarmResult;
  windDir: number;
  windSpeed: number;
  ti: number;
  extentM: number;
  hubY: number;
  playing: boolean;
  simSpeed: number;
  count?: number;
}) {
  const ref = useRef<THREE.Points>(null);
  const D = model.rotorDiameter.value;
  const R = (D / 2) * S;
  const { positions, colors, geom } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return { positions, colors, geom: g };
  }, [count]);
  useEffect(() => () => geom.dispose(), [geom]);

  // Particle state in site metres: s (downstream), l (lateral), h (height offset world units)
  const state = useMemo(() => {
    const s = new Float32Array(count);
    const l = new Float32Array(count);
    const h = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      s[i] = (Math.random() * 2 - 1) * extentM;
      l[i] = (Math.random() * 2 - 1) * extentM;
      h[i] = (Math.random() * 2 - 1) * R * 1.6;
    }
    return { s, l, h };
  }, [count, extentM, R]);

  const geo = useMemo(() => {
    const [ux, uy] = downstreamVector(windDir);
    const ts = turbines.map((t) => t.x * ux + t.y * uy);
    const tl = turbines.map((t) => -t.x * uy + t.y * ux);
    return { ux, uy, ts, tl, k: wakeExpansion(ti) };
  }, [turbines, windDir, ti]);

  const step = (dt: number) => {
    const { ux, uy, ts, tl, k } = geo;
    const visual = 7; // visual speed-up of advection
    for (let i = 0; i < count; i++) {
      let sumSq = 0;
      const zM = state.h[i] / S;
      for (let t = 0; t < ts.length; t++) {
        const d = gaussianDeficit(state.s[i] - ts[t], state.l[i] - tl[t], zM, D, solved.ct[t] ?? 0, k);
        sumSq += d * d;
      }
      const def = Math.min(1, Math.sqrt(sumSq));
      const u = Math.max(0.5, windSpeed * (1 - def));
      state.s[i] += u * dt * visual * simSpeed;
      if (state.s[i] > extentM) {
        state.s[i] = -extentM;
        state.l[i] = (Math.random() * 2 - 1) * extentM;
        state.h[i] = (Math.random() * 2 - 1) * R * 1.6;
      }
      const x = state.s[i] * ux - state.l[i] * uy;
      const y = state.s[i] * uy + state.l[i] * ux;
      const [wx, wz] = toWorld(x, y);
      positions[i * 3] = wx;
      positions[i * 3 + 1] = hubY + state.h[i];
      positions[i * 3 + 2] = wz;
      // white → deep blue with deficit
      const tcol = Math.min(1, def / 0.4);
      colors[i * 3] = 1 - 0.85 * tcol;
      colors[i * 3 + 1] = 1 - 0.7 * tcol;
      colors[i * 3 + 2] = 1 - 0.45 * tcol;
    }
    (geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  };

  useEffect(() => {
    step(0);
    geom.computeBoundingSphere();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, solved]);

  useFrame((_, dt) => {
    if (playing && windSpeed > 0) step(Math.min(dt, 0.05));
  });

  return (
    <points ref={ref} geometry={geom} frustumCulled={false}>
      <pointsMaterial size={0.55} vertexColors transparent opacity={0.85} depthWrite={false} sizeAttenuation />
    </points>
  );
}

/** Large arrow showing the free-stream wind direction. */
export function WindArrow({ windDir, extentM, y }: { windDir: number; extentM: number; y: number }) {
  const [ux, uy] = downstreamVector(windDir);
  const [sx, sz] = toWorld(-ux * extentM * 0.95, -uy * extentM * 0.95);
  const dir = new THREE.Vector3(ux, 0, -uy).normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  return (
    <group position={[sx, y, sz]} quaternion={quat}>
      <mesh position={[0, 0, 4]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.35, 0.35, 8, 10]} />
        <meshStandardMaterial color="#2b63c6" emissive="#2b63c6" emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, 0, 9]} rotation-x={Math.PI / 2}>
        <coneGeometry args={[1.1, 2.6, 16]} />
        <meshStandardMaterial color="#2b63c6" emissive="#2b63c6" emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}
