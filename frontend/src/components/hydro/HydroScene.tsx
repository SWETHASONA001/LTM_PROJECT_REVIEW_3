import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

/**
 * Hydrokinetic turbine visualization. Current speed/direction come from the
 * selected observed ADCP sample; rotor speed is MODELED (tip-speed ratio 4).
 * Geometry is illustrative and scaled to the configured rotor diameter.
 */
function Rotor({ speed, radius, playing }: { speed: number; radius: number; playing: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!ref.current || !playing) return;
    const omega = Math.abs(speed) < 0.75 ? 0.05 : (4 * Math.abs(speed)) / radius; // rad/s (TSR = 4)
    ref.current.rotation.z += omega * Math.min(dt, 0.1) * Math.sign(speed || 1);
  });
  const blade = useMemo(() => {
    const g = new THREE.BoxGeometry(radius * 0.18, radius, 0.08, 1, 6, 1);
    g.translate(0, radius / 2, 0);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / radius;
      pos.setX(i, pos.getX(i) * (1 - 0.6 * y));
    }
    g.computeVertexNormals();
    return g;
  }, [radius]);
  useEffect(() => () => blade.dispose(), [blade]);
  return (
    <group ref={ref}>
      {[0, 1, 2].map((k) => (
        <mesh key={k} geometry={blade} rotation-z={(k * 2 * Math.PI) / 3} castShadow>
          <meshStandardMaterial color="#f0c419" roughness={0.45} metalness={0.2} />
        </mesh>
      ))}
      <mesh rotation-x={Math.PI / 2}>
        <coneGeometry args={[radius * 0.14, radius * 0.4, 20]} />
        <meshStandardMaterial color="#e9edf1" roughness={0.3} metalness={0.4} />
      </mesh>
    </group>
  );
}

function Flow({ speed, depth, length, playing }: { speed: number; depth: number; length: number; playing: boolean }) {
  const count = 900;
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * length;
      pos[i * 3 + 1] = Math.random() * depth;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 18;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, [depth, length]);
  useEffect(() => () => geom.dispose(), [geom]);
  useFrame((_, dt) => {
    if (!playing) return;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const h = arr[i * 3 + 1] / depth;
      // Power-law shear: slower near the bed (illustrative 1/7 profile).
      const u = speed * Math.pow(Math.max(h, 0.02), 1 / 7) * 3;
      arr[i * 3] += u * Math.min(dt, 0.05);
      if (arr[i * 3] > length / 2) arr[i * 3] = -length / 2;
      if (arr[i * 3] < -length / 2) arr[i * 3] = length / 2;
    }
    pos.needsUpdate = true;
  });
  return (
    <points geometry={geom} frustumCulled={false}>
      <pointsMaterial size={0.16} color="#e6f6ff" transparent opacity={0.8} depthWrite={false} />
    </points>
  );
}

export function HydroScene({ speed, diameter, depth, playing }: { speed: number; diameter: number; depth: number; playing: boolean }) {
  const R = diameter / 2;
  const sceneDepth = Math.max(depth, diameter + 4);
  const hubY = Math.min(sceneDepth * 0.45, sceneDepth - R - 1);
  const L = Math.max(60, sceneDepth * 3);
  // Rotor faces the incoming current: flood (+) flows +x, ebb (−) flows −x.
  const yaw = speed >= 0 ? -Math.PI / 2 : Math.PI / 2;
  return (
    <Canvas shadows camera={{ position: [sceneDepth * 1.3, sceneDepth * 0.75, sceneDepth * 1.6], fov: 45 }} frameloop={playing ? 'always' : 'demand'} dpr={[1, 1.75]} aria-label="Hydrokinetic turbine 3D visualization">
      <color attach="background" args={['#0f3b52']} />
      <fog attach="fog" args={['#0f3b52', sceneDepth * 2, sceneDepth * 6]} />
      <hemisphereLight args={['#bfe6ff', '#38506a', 0.9]} />
      <directionalLight position={[10, 40, 15]} intensity={1.4} castShadow />
      {/* seabed */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[L * 2, 80, 40, 20]} />
        <meshStandardMaterial color="#b9a77c" roughness={1} />
      </mesh>
      {/* water surface */}
      <mesh rotation-x={-Math.PI / 2} position={[0, sceneDepth, 0]}>
        <planeGeometry args={[L * 2, 80]} />
        <meshPhysicalMaterial color="#5fb3d3" transparent opacity={0.35} side={THREE.DoubleSide} roughness={0.15} />
      </mesh>
      {/* support structure */}
      <mesh position={[0, hubY / 2, 0]} castShadow>
        <cylinderGeometry args={[R * 0.07, R * 0.1, hubY, 16]} />
        <meshStandardMaterial color="#4b5966" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[R * 0.9, 0.8, R * 0.9]} />
        <meshStandardMaterial color="#6b7781" roughness={0.8} />
      </mesh>
      <group position={[0, hubY, 0]} rotation-y={yaw}>
        <mesh rotation-x={Math.PI / 2} position={[0, 0, -R * 0.35]} castShadow>
          <cylinderGeometry args={[R * 0.13, R * 0.13, R * 0.9, 20]} />
          <meshStandardMaterial color="#d7dee4" metalness={0.4} roughness={0.35} />
        </mesh>
        <group position={[0, 0, R * 0.12]}>
          <Rotor speed={speed} radius={R} playing={playing} />
        </group>
      </group>
      <Flow speed={speed} depth={sceneDepth} length={L} playing={playing} />
      <OrbitControls target={[0, hubY, 0]} maxPolarAngle={Math.PI / 1.9} minDistance={R * 2} maxDistance={sceneDepth * 6} enableDamping />
    </Canvas>
  );
}
