import { Html } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LayoutTurbine } from '../../physics/constraints';
import { S, SEABED_DEPTH, toWorld } from './sceneUtils';

export interface TurbineVisual {
  turbine: LayoutTurbine;
  baseY: number;
  yaw: number;
  rpm: number;
  powerKw: number;
  deficit: number;
}

const COLORS = {
  real: new THREE.Color('#f4f6f8'),
  proposed: new THREE.Color('#d7ebe3'),
  hover: new THREE.Color('#bcd9f7'),
  selected: new THREE.Color('#6fd3a8'),
};

function bladeGeometry(R: number, chord: number) {
  const g = new THREE.BoxGeometry(chord, R, chord * 0.22, 1, 8, 1);
  g.translate(0, R / 2, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / R;
    const taper = y < 0.18 ? 0.55 + (y / 0.18) * 0.45 : 1 - 0.78 * ((y - 0.18) / 0.82);
    pos.setX(i, pos.getX(i) * taper + (y > 0.18 ? chord * 0.12 * (1 - y) : 0));
    pos.setZ(i, pos.getZ(i) * (1 - 0.6 * y));
  }
  g.computeVertexNormals();
  return g;
}

export function TurbineField({
  items,
  hubHeightM,
  rotorDiameterM,
  playing,
  simSpeed,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  offshore,
  showLabels,
}: {
  items: TurbineVisual[];
  hubHeightM: number;
  rotorDiameterM: number;
  playing: boolean;
  simSpeed: number;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  offshore: boolean;
  showLabels: boolean;
}) {
  const n = items.length;
  const H = hubHeightM * S;
  const R = (rotorDiameterM / 2) * S;
  const k = rotorDiameterM / 82; // size factor for nacelle etc.
  const towerRef = useRef<THREE.InstancedMesh>(null);
  const nacelleRef = useRef<THREE.InstancedMesh>(null);
  const hubRef = useRef<THREE.InstancedMesh>(null);
  const bladeRef = useRef<THREE.InstancedMesh>(null);
  const foundRef = useRef<THREE.InstancedMesh>(null);
  const tpRef = useRef<THREE.InstancedMesh>(null);
  const angles = useRef<Float32Array>(new Float32Array(0));

  const bladeGeom = useMemo(() => bladeGeometry(R * 0.97, 0.32 * k), [R, k]);
  useEffect(() => () => bladeGeom.dispose(), [bladeGeom]);

  if (angles.current.length !== n) {
    angles.current = Float32Array.from({ length: n }, (_, i) => (i * 1.7) % (Math.PI * 2));
  }

  // Static parts (tower, nacelle, hub, foundations).
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    items.forEach((it, i) => {
      const [wx, wz] = toWorld(it.turbine.x, it.turbine.y);
      const base = offshore ? 1.6 : it.baseY;
      const towerH = H - (offshore ? 1.6 : 0);
      m.compose(new THREE.Vector3(wx, base + towerH / 2, wz), q, new THREE.Vector3(1, towerH, 1));
      towerRef.current?.setMatrixAt(i, m);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw);
      const off = new THREE.Vector3(0, 0, -0.35 * k).applyQuaternion(q);
      m.compose(new THREE.Vector3(wx + off.x, H + it.baseY * (offshore ? 0 : 1), wz + off.z), q, one);
      nacelleRef.current?.setMatrixAt(i, m);
      const hubOff = new THREE.Vector3(0, 0, 0.55 * k).applyQuaternion(q);
      m.compose(new THREE.Vector3(wx + hubOff.x, H + (offshore ? 0 : it.baseY), wz + hubOff.z), q, one);
      hubRef.current?.setMatrixAt(i, m);
      q.identity();
      if (offshore) {
        m.compose(new THREE.Vector3(wx, (-SEABED_DEPTH + 0.6) / 2, wz), q, new THREE.Vector3(1, SEABED_DEPTH + 0.6, 1));
        foundRef.current?.setMatrixAt(i, m);
        m.compose(new THREE.Vector3(wx, 1.1, wz), q, one);
        tpRef.current?.setMatrixAt(i, m);
      }
      const col = it.turbine.id === selectedId ? COLORS.selected : it.turbine.id === hoveredId ? COLORS.hover : it.turbine.status === 'real' ? COLORS.real : COLORS.proposed;
      towerRef.current?.setColorAt(i, col);
      nacelleRef.current?.setColorAt(i, col);
    });
    for (const r of [towerRef, nacelleRef, hubRef, foundRef, tpRef]) {
      if (!r.current) continue;
      r.current.instanceMatrix.needsUpdate = true;
      if (r.current.instanceColor) r.current.instanceColor.needsUpdate = true;
      r.current.computeBoundingSphere();
    }
  }, [items, H, k, offshore, selectedId, hoveredId]);

  // Blades: rotate every frame.
  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), qs: new THREE.Quaternion(), p: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1), z: new THREE.Vector3(0, 0, 1), y: new THREE.Vector3(0, 1, 0) }),
    [],
  );
  const writeBlades = (dt: number) => {
    const mesh = bladeRef.current;
    if (!mesh) return;
    items.forEach((it, i) => {
      angles.current[i] = (angles.current[i] + (it.rpm / 60) * Math.PI * 2 * dt * simSpeed) % (Math.PI * 2);
      const [wx, wz] = toWorld(it.turbine.x, it.turbine.y);
      tmp.q.setFromAxisAngle(tmp.y, it.yaw);
      const front = new THREE.Vector3(0, 0, 0.62 * k).applyQuaternion(tmp.q);
      tmp.p.set(wx + front.x, H + (offshore ? 0 : it.baseY), wz + front.z);
      for (let b = 0; b < 3; b++) {
        tmp.qs.setFromAxisAngle(tmp.z, angles.current[i] + (b * 2 * Math.PI) / 3);
        const q = tmp.q.clone().multiply(tmp.qs);
        tmp.m.compose(tmp.p, q, tmp.one);
        mesh.setMatrixAt(i * 3 + b, tmp.m);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(() => {
    writeBlades(0);
    bladeRef.current?.computeBoundingSphere();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, H, k, offshore]);
  useFrame((_, dt) => {
    if (playing) writeBlades(Math.min(dt, 0.1));
  });

  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId !== undefined ? items[e.instanceId]?.turbine.id : undefined);
  const handlers = {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const id = pick(e);
      if (id && id !== hoveredId) onHover(id);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      onHover(null);
      document.body.style.cursor = '';
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const id = pick(e);
      if (id) onSelect(id === selectedId ? null : id);
    },
  };
  useEffect(() => () => void (document.body.style.cursor = ''), []);

  return (
    <group>
      <instancedMesh key={`t${n}`} ref={towerRef} args={[undefined, undefined, n]} castShadow {...handlers}>
        <cylinderGeometry args={[0.13 * k, 0.21 * k, 1, 14]} />
        <meshStandardMaterial roughness={0.45} metalness={0.15} />
      </instancedMesh>
      <instancedMesh key={`n${n}`} ref={nacelleRef} args={[undefined, undefined, n]} castShadow {...handlers}>
        <boxGeometry args={[0.36 * k, 0.38 * k, 1.15 * k]} />
        <meshStandardMaterial roughness={0.4} metalness={0.2} />
      </instancedMesh>
      <instancedMesh key={`h${n}`} ref={hubRef} args={[undefined, undefined, n]} castShadow>
        <sphereGeometry args={[0.2 * k, 16, 12]} />
        <meshStandardMaterial color="#e9edf1" roughness={0.35} metalness={0.25} />
      </instancedMesh>
      <instancedMesh key={`b${n}`} ref={bladeRef} args={[bladeGeom, undefined, n * 3]} castShadow>
        <meshStandardMaterial color="#f7f8fa" roughness={0.38} metalness={0.05} />
      </instancedMesh>
      {offshore && (
        <>
          <instancedMesh key={`f${n}`} ref={foundRef} args={[undefined, undefined, n]}>
            <cylinderGeometry args={[0.36, 0.42, 1, 16]} />
            <meshStandardMaterial color="#5b6670" roughness={0.7} metalness={0.4} />
          </instancedMesh>
          <instancedMesh key={`tp${n}`} ref={tpRef} args={[undefined, undefined, n]}>
            <cylinderGeometry args={[0.3, 0.36, 1.1, 16]} />
            <meshStandardMaterial color="#e5b622" roughness={0.5} metalness={0.2} />
          </instancedMesh>
        </>
      )}
      {items.map((it) => {
        const [wx, wz] = toWorld(it.turbine.x, it.turbine.y);
        const y = offshore ? 0.25 : it.baseY + 0.08;
        const real = it.turbine.status === 'real';
        const active = it.turbine.id === selectedId || it.turbine.id === hoveredId;
        return (
          <group key={it.turbine.id} position={[wx, y, wz]}>
            <mesh rotation-x={-Math.PI / 2}>
              <ringGeometry args={[R * 0.3, R * 0.3 + (active ? 0.35 : 0.18), 40]} />
              <meshBasicMaterial color={active ? '#0f8a6a' : real ? '#0b1f33' : '#1baf7a'} transparent opacity={real || active ? 0.9 : 0.65} />
            </mesh>
            {(showLabels || active) && (
              <Html position={[0, H + R + 1.2 - y, 0]} center distanceFactor={140} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
                <div className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold shadow ${real ? 'bg-ink text-white' : 'bg-white/95 text-ink ring-1 ring-line'}`}>
                  {it.turbine.label}
                  <span className="ml-1 font-normal opacity-70">{Math.round(it.powerKw)} kW</span>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}
