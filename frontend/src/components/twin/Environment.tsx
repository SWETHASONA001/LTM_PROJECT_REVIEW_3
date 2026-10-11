import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SEABED_DEPTH, terrainHeight } from './sceneUtils';

/** Onshore terrain: gently rolling farmland with vertex colouring and instanced trees. */
export function Terrain({ size }: { size: number }) {
  const geom = useMemo(() => {
    const seg = 160;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const a = new THREE.Color('#a9bf86');
    const b = new THREE.Color('#c9d3a1');
    const c = new THREE.Color('#8fa874');
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      // field patchwork
      const field = (Math.floor(x / 38) * 7 + Math.floor(z / 31) * 13) % 5;
      tmp.copy(a).lerp(field === 0 ? b : field === 1 ? c : a, 0.55).lerp(new THREE.Color('#7f9a69'), Math.min(1, Math.max(0, h / 10)));
      colors.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [size]);
  useEffect(() => () => geom.dispose(), [geom]);

  const trees = useMemo(() => {
    const list: [number, number, number, number][] = [];
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 420; i++) {
      const x = (rnd() - 0.5) * size * 0.95;
      const z = (rnd() - 0.5) * size * 0.95;
      if (Math.hypot(x, z) < 170) continue;
      list.push([x, terrainHeight(x, z), z, 0.7 + rnd() * 0.9]);
    }
    return list;
  }, [size]);

  const treeRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = new THREE.Matrix4();
    trees.forEach(([x, y, z, s], i) => {
      m.compose(new THREE.Vector3(x, y + 1.2 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      treeRef.current?.setMatrixAt(i, m);
    });
    if (treeRef.current) treeRef.current.instanceMatrix.needsUpdate = true;
  }, [trees]);

  return (
    <group>
      <mesh geometry={geom} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
      </mesh>
      <instancedMesh ref={treeRef} args={[undefined, undefined, trees.length]} castShadow>
        <coneGeometry args={[1.1, 3.2, 7]} />
        <meshStandardMaterial color="#5f7d52" roughness={1} />
      </instancedMesh>
    </group>
  );
}

/** Offshore: animated ocean surface over a visible seabed. */
export function Ocean({ size, playing }: { size: number; playing: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(size, size, 110, 110);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [size]);
  const base = useMemo(() => Float32Array.from(geom.attributes.position.array as Float32Array), [geom]);
  useEffect(() => () => geom.dispose(), [geom]);
  const t = useRef(0);
  useFrame((_, dt) => {
    if (!playing) return;
    t.current += dt;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const z = base[i * 3 + 2];
      pos.setY(i, 0.18 * Math.sin(x * 0.08 + t.current * 1.1) + 0.12 * Math.sin(z * 0.11 - t.current * 0.8) + 0.06 * Math.sin((x + z) * 0.23 + t.current * 1.7));
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
  });
  const seabed = useMemo(() => {
    const g = new THREE.PlaneGeometry(size, size, 80, 80);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, -SEABED_DEPTH + 0.35 * Math.sin(pos.getX(i) * 0.05) * Math.cos(pos.getZ(i) * 0.04));
    }
    g.computeVertexNormals();
    return g;
  }, [size]);
  useEffect(() => () => seabed.dispose(), [seabed]);
  return (
    <group>
      <mesh geometry={seabed} receiveShadow>
        <meshStandardMaterial color="#c8b98f" roughness={1} />
      </mesh>
      <mesh ref={ref} geometry={geom} receiveShadow>
        <meshPhysicalMaterial color="#2c7da0" transparent opacity={0.78} roughness={0.25} metalness={0.05} clearcoat={0.6} clearcoatRoughness={0.3} />
      </mesh>
    </group>
  );
}
