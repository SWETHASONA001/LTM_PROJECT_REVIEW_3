import { OrbitControls, Sky } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { LayoutTurbine } from '../../physics/constraints';
import type { TurbineModel } from '../../physics/turbines';
import type { FarmCase, FarmResult } from '../../physics/wake';
import { Ocean, Terrain } from './Environment';
import { S, terrainHeight, toWorld, yawForWind } from './sceneUtils';
import { TurbineField, type TurbineVisual } from './TurbineField';
import { WakeSlice, WindArrow, WindParticles } from './WakeLayers';

export interface TwinSceneHandle {
  resetCamera: () => void;
  focus: (id: string) => void;
}

export interface TwinSceneProps {
  site: 'onshore' | 'offshore';
  turbines: LayoutTurbine[];
  model: TurbineModel;
  farmCase: FarmCase;
  solved: FarmResult;
  extentM: number;
  playing: boolean;
  simSpeed: number;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  showWake: boolean;
  showParticles: boolean;
  showLabels: boolean;
  /** Optional per-turbine overrides (observed rotor rpm / nacelle yaw for real turbines). */
  observedRpm?: Record<string, number | null>;
  observedYaw?: Record<string, number | null>;
}

const RATED_RPM: Record<string, number> = { onshore: 17.2, offshore: 12.1 };

export const TwinScene = forwardRef<TwinSceneHandle, TwinSceneProps>(function TwinScene(p, ref) {
  const controls = useRef<OrbitControlsImpl>(null);
  const offshore = p.site === 'offshore';
  const H = p.model.hubHeight.value;
  const R = p.model.rotorDiameter.value / 2;
  const camDist = p.extentM * S * 1.15;
  const home = useMemo(() => ({ pos: [camDist * 0.3, camDist * 0.3, camDist * 0.6] as [number, number, number], target: [0, H * S * 0.4, 0] as [number, number, number] }), [camDist, H]);

  useImperativeHandle(ref, () => ({
    resetCamera: () => {
      const c = controls.current;
      if (!c) return;
      c.object.position.set(...home.pos);
      c.target.set(...home.target);
      c.update();
    },
    focus: (id: string) => {
      const c = controls.current;
      const t = p.turbines.find((x) => x.id === id);
      if (!c || !t) return;
      const [wx, wz] = toWorld(t.x, t.y);
      c.target.set(wx, H * S * 0.8, wz);
      c.object.position.set(wx + 22, H * S + 14, wz + 30);
      c.update();
    },
  }));

  const items = useMemo<TurbineVisual[]>(() => {
    return p.turbines.map((t, i) => {
      const [wx, wz] = toWorld(t.x, t.y);
      const ws = p.solved.effectiveWs[i] ?? 0;
      const power = p.solved.powerKw[i] ?? 0;
      const obsRpm = p.observedRpm?.[t.id];
      const obsYaw = p.observedYaw?.[t.id];
      // Modeled rotor speed: tip-speed ratio 8, capped at rated rpm; idles slowly below cut-in.
      const modeled = power > 0 ? Math.min(RATED_RPM[p.site], ((8 * ws) / R) * (60 / (2 * Math.PI))) : 0.6;
      return {
        turbine: t,
        baseY: offshore ? 0 : terrainHeight(wx, wz),
        yaw: yawForWind(obsYaw ?? p.farmCase.windDir),
        rpm: obsRpm ?? modeled,
        powerKw: power,
        deficit: p.solved.deficit[i] ?? 0,
      };
    });
  }, [p.turbines, p.solved, p.farmCase.windDir, p.observedRpm, p.observedYaw, offshore, R, p.site]);

  const hubY = H * S + (offshore ? 0 : 0.4);
  const groundSize = Math.max(900, p.extentM * S * 6);

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: home.pos, fov: 42, near: 0.5, far: 6000 }}
      frameloop={p.playing ? 'always' : 'demand'}
      gl={{ antialias: true, preserveDrawingBuffer: false }}
      onPointerMissed={() => p.onSelect(null)}
      aria-label={`${p.site} wind farm 3D digital twin`}
    >
      <color attach="background" args={[offshore ? '#dbe9f1' : '#e6eef3']} />
      <fog attach="fog" args={[offshore ? '#dbe9f1' : '#e6eef3', camDist * 1.6, camDist * 5]} />
      <Sky distance={4500} sunPosition={[80, 40, 60]} turbidity={6} rayleigh={1.2} mieCoefficient={0.004} mieDirectionalG={0.8} />
      <hemisphereLight args={['#f5f9ff', offshore ? '#2c5d74' : '#7f8f60', 0.75]} />
      <directionalLight
        position={[120, 160, 90]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-p.extentM * S}
        shadow-camera-right={p.extentM * S}
        shadow-camera-top={p.extentM * S}
        shadow-camera-bottom={-p.extentM * S}
        shadow-camera-far={600}
      />
      {offshore ? <Ocean size={groundSize} playing={p.playing} /> : <Terrain size={groundSize} />}
      <TurbineField
        items={items}
        hubHeightM={H}
        rotorDiameterM={p.model.rotorDiameter.value}
        playing={p.playing}
        simSpeed={p.simSpeed}
        selectedId={p.selectedId}
        hoveredId={p.hoveredId}
        onSelect={p.onSelect}
        onHover={p.onHover}
        offshore={offshore}
        showLabels={p.showLabels}
      />
      {p.showWake && p.farmCase.windSpeed > 0 && <WakeSlice farmCase={p.farmCase} solved={p.solved} extentM={p.extentM} heightY={hubY} />}
      {p.showParticles && (
        <WindParticles
          model={p.model}
          turbines={p.turbines}
          solved={p.solved}
          windDir={p.farmCase.windDir}
          windSpeed={p.farmCase.windSpeed}
          ti={p.farmCase.ti}
          extentM={p.extentM}
          hubY={hubY}
          playing={p.playing}
          simSpeed={p.simSpeed}
        />
      )}
      <WindArrow windDir={p.farmCase.windDir} extentM={p.extentM} y={hubY + R * S + 3} />
      <OrbitControls ref={controls} makeDefault target={home.target} maxPolarAngle={Math.PI / 2.08} minDistance={8} maxDistance={camDist * 4} enableDamping dampingFactor={0.08} />
    </Canvas>
  );
});
