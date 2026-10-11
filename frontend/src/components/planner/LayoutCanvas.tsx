import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { compass } from '../../lib/format';
import type { LayoutTurbine, Violation } from '../../physics/constraints';
import { downstreamVector, velocityField, type FarmCase, type FarmResult } from '../../physics/wake';

export type EditMode = 'select' | 'add';

interface Props {
  turbines: LayoutTurbine[];
  farmCase: FarmCase;
  solved: FarmResult;
  boundary: { width: number; height: number };
  minSpacingM: number;
  rotorD: number;
  violations: Violation[];
  selectedId: string | null;
  mode: EditMode;
  lockReal: boolean;
  snapM: number;
  showWake: boolean;
  readOnly?: boolean;
  onSelect: (id: string | null) => void;
  onAdd: (x: number, y: number) => void;
  onDragStart: () => void;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd: () => void;
}

/** Hub-height wake deficit rendered to a data URL (blue sequential ramp). */
function useWakeImage(farmCase: FarmCase, solved: FarmResult, ext: { x0: number; x1: number; y0: number; y1: number }, enabled: boolean) {
  return useMemo(() => {
    if (!enabled || farmCase.windSpeed <= 0 || typeof document === 'undefined') return null;
    const nx = 180;
    const ny = Math.round((nx * (ext.y1 - ext.y0)) / (ext.x1 - ext.x0));
    const field = velocityField(farmCase, solved, { xMin: ext.x0, xMax: ext.x1, yMin: ext.y0, yMax: ext.y1, nx, ny });
    const canvas = document.createElement('canvas');
    canvas.width = nx;
    canvas.height = ny;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(nx, ny);
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const d = 1 - field[iy * nx + ix] / farmCase.windSpeed;
        const t = Math.min(1, Math.max(0, d / 0.45));
        const o = ((ny - 1 - iy) * nx + ix) * 4; // canvas row 0 = north
        img.data[o] = 205 + (13 - 205) * t;
        img.data[o + 1] = 226 + (54 - 226) * t;
        img.data[o + 2] = 251 + (107 - 251) * t;
        img.data[o + 3] = t < 0.015 ? 0 : 60 + 175 * t;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }, [farmCase, solved, ext.x0, ext.x1, ext.y0, ext.y1, enabled]);
}

export function LayoutCanvas(p: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [aspect, setAspect] = useState(1.4);
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) setAspect(width / height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Fit the site to the container aspect so the map fills the panel.
  const pad = Math.max(p.boundary.width, p.boundary.height) * 0.1;
  const baseW = p.boundary.width + 2 * pad;
  const baseH = p.boundary.height + 2 * pad;
  const fitW = Math.max(baseW, baseH * aspect);
  const fitH = Math.max(baseH, fitW / aspect);
  const ext = { x0: -fitW / 2, x1: fitW / 2, y0: -fitH / 2, y1: fitH / 2 };
  const W = ext.x1 - ext.x0;
  const H = ext.y1 - ext.y0;
  const U = Math.min(W, H); // unit for text/stroke sizes
  const wake = useWakeImage(p.farmCase, p.solved, ext, p.showWake);
  const gridStep = U > 4000 ? 500 : 200;
  const R = p.rotorD / 2;
  const marker = Math.max(R * 0.55, U / 110);
  const violatingIds = useMemo(() => new Set(p.violations.flatMap((v) => v.ids)), [p.violations]);

  // SVG y grows downward; site y (north) grows upward → flip.
  const sy = (y: number) => -y;

  const toSite = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const r = pt.matrixTransform(m.inverse());
    const snap = (v: number) => (p.snapM > 0 ? Math.round(v / p.snapM) * p.snapM : v);
    return [snap(r.x), snap(-r.y)];
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const [x, y] = toSite(e.clientX, e.clientY);
      p.onDrag(drag, x, y);
    };
    const up = () => {
      setDrag(null);
      p.onDragEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  const [ux, uy] = downstreamVector(p.farmCase.windDir);
  const arrowLen = U * 0.1;
  const ax = ext.x1 - U * 0.12;
  const ay = ext.y1 - U * 0.12;
  const selected = p.turbines.find((t) => t.id === p.selectedId);
  const scaleLen = gridStep * (U > 4000 ? 2 : 2.5);

  return (
    <svg
      ref={svgRef}
      viewBox={`${ext.x0} ${-ext.y1} ${W} ${H}`}
      className={clsx('h-full w-full touch-none select-none', p.mode === 'add' && !p.readOnly ? 'cursor-crosshair' : 'cursor-default')}
      role="application"
      aria-label="Turbine layout editor. Drag turbines to move them."
      onPointerDown={(e) => {
        if (p.readOnly || e.target !== e.currentTarget && !(e.target as Element).hasAttribute('data-bg')) return;
        if (p.mode === 'add') {
          const [x, y] = toSite(e.clientX, e.clientY);
          p.onAdd(x, y);
        } else p.onSelect(null);
      }}
    >
      <rect data-bg x={ext.x0} y={-ext.y1} width={W} height={H} fill="#fbfaf7" />
      {wake && <image data-bg href={wake} x={ext.x0} y={-ext.y1} width={W} height={H} preserveAspectRatio="none" style={{ imageRendering: 'auto' }} />}
      {/* grid */}
      <g pointerEvents="none" stroke="#0b1f33" strokeOpacity={0.07} strokeWidth={U / 900}>
        {Array.from({ length: Math.floor(W / gridStep) + 2 }, (_, i) => Math.ceil(ext.x0 / gridStep) * gridStep + i * gridStep).map((x) => (
          <line key={`x${x}`} x1={x} x2={x} y1={-ext.y1} y2={-ext.y0} />
        ))}
        {Array.from({ length: Math.floor(H / gridStep) + 2 }, (_, i) => Math.ceil(ext.y0 / gridStep) * gridStep + i * gridStep).map((y) => (
          <line key={`y${y}`} y1={sy(y)} y2={sy(y)} x1={ext.x0} x2={ext.x1} />
        ))}
      </g>
      {/* boundary */}
      <rect
        x={-p.boundary.width / 2}
        y={-p.boundary.height / 2}
        width={p.boundary.width}
        height={p.boundary.height}
        fill="none"
        stroke="#0b1f33"
        strokeOpacity={0.45}
        strokeWidth={U / 450}
        strokeDasharray={`${W / 80} ${W / 140}`}
        pointerEvents="none"
      />
      <text x={-p.boundary.width / 2 + W / 120} y={-p.boundary.height / 2 + W / 45} fontSize={U / 43} fill="#66727f" pointerEvents="none">
        Site boundary {p.boundary.width / 1000} × {p.boundary.height / 1000} km
      </text>
      {/* spacing ring for selected */}
      {selected && (
        <circle cx={selected.x} cy={sy(selected.y)} r={p.minSpacingM} fill="#0f8a6a" fillOpacity={0.05} stroke="#0f8a6a" strokeOpacity={0.6} strokeWidth={U / 700} strokeDasharray={`${W / 160} ${W / 220}`} pointerEvents="none" />
      )}
      {/* violation links */}
      {p.violations
        .filter((v) => v.kind === 'spacing')
        .map((v) => {
          const a = p.turbines.find((t) => t.id === v.ids[0]);
          const b = p.turbines.find((t) => t.id === v.ids[1]);
          if (!a || !b) return null;
          return <line key={v.ids.join()} x1={a.x} y1={sy(a.y)} x2={b.x} y2={sy(b.y)} stroke="#b42318" strokeWidth={U / 350} strokeDasharray={`${W / 200} ${W / 300}`} pointerEvents="none" />;
        })}
      {/* turbines */}
      {p.turbines.map((t, i) => {
        const locked = t.status === 'real' && p.lockReal;
        const isSel = t.id === p.selectedId;
        const bad = violatingIds.has(t.id);
        const def = p.solved.deficit[i] ?? 0;
        return (
          <g
            key={t.id}
            transform={`translate(${t.x} ${sy(t.y)})`}
            className={clsx(!p.readOnly && (locked ? 'cursor-not-allowed' : 'cursor-grab'), drag === t.id && 'cursor-grabbing')}
            onPointerEnter={() => setHover(t.id)}
            onPointerLeave={() => setHover(null)}
            onPointerDown={(e) => {
              if (p.readOnly) return;
              e.stopPropagation();
              p.onSelect(t.id);
              if (!locked && p.mode === 'select') {
                p.onDragStart();
                setDrag(t.id);
              }
            }}
            role="button"
            aria-label={`${t.label}${locked ? ' (locked real asset)' : ''}`}
          >
            {/* rotor line perpendicular to wind */}
            <line x1={-uy * R} y1={ux * R} x2={uy * R} y2={-ux * R} stroke={t.status === 'real' ? '#0b1f33' : '#0f8a6a'} strokeWidth={U / 330} strokeLinecap="round" transform={`scale(1,-1)`} />
            <circle r={marker * (isSel || hover === t.id ? 1.25 : 1)} fill={t.status === 'real' ? '#0b1f33' : '#ffffff'} stroke={bad ? '#b42318' : isSel ? '#0f8a6a' : t.status === 'real' ? '#0b1f33' : '#1baf7a'} strokeWidth={U / (isSel ? 260 : 420)} />
            {def > 0.05 && <circle r={marker * 0.45} fill="#2b63c6" fillOpacity={Math.min(1, def * 2.2)} />}
            <text y={-marker * 1.7} textAnchor="middle" fontSize={U / 48} fontWeight={600} fill="#0b1f33" pointerEvents="none" style={{ paintOrder: 'stroke', stroke: '#ffffffcc', strokeWidth: W / 400 }}>
              {t.label}
              {locked ? ' 🔒' : ''}
            </text>
          </g>
        );
      })}
      {/* north + wind indicator */}
      <g transform={`translate(${ext.x0 + U * 0.07} ${-ext.y1 + U * 0.1})`} pointerEvents="none">
        <circle r={U * 0.03} fill="white" stroke="#cfccc3" strokeWidth={U / 900} />
        <path d={`M0 ${-U * 0.022} L${U * 0.009} ${U * 0.008} L0 ${U * 0.002} L${-U * 0.009} ${U * 0.008} Z`} fill="#0b1f33" />
        <text y={-U * 0.036} textAnchor="middle" fontSize={U / 43} fontWeight={700} fill="#0b1f33">
          N
        </text>
      </g>
      <g pointerEvents="none">
        <line x1={ax - (ux * arrowLen) / 2} y1={sy(ay - (uy * arrowLen) / 2)} x2={ax + (ux * arrowLen) / 2} y2={sy(ay + (uy * arrowLen) / 2)} stroke="#2b63c6" strokeWidth={U / 260} markerEnd="url(#arrow)" />
        <text x={ax} y={sy(ay) + U * 0.07} textAnchor="middle" fontSize={U / 46} fill="#2b63c6" fontWeight={600}>
          wind {Math.round(p.farmCase.windDir)}° {compass(p.farmCase.windDir)}
        </text>
      </g>
      {/* scale bar */}
      <g transform={`translate(${ext.x0 + U * 0.05} ${-ext.y0 - U * 0.05})`} pointerEvents="none">
        <rect width={scaleLen} height={U / 300} fill="#0b1f33" />
        <rect width={scaleLen / 2} height={U / 300} fill="#ffffff" stroke="#0b1f33" strokeWidth={U / 1500} />
        <text y={-U / 150} fontSize={U / 49} fill="#2f4256">
          0
        </text>
        <text x={scaleLen} y={-U / 150} fontSize={U / 49} fill="#2f4256" textAnchor="end">
          {scaleLen} m
        </text>
      </g>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#2b63c6" />
        </marker>
      </defs>
    </svg>
  );
}

/** Small read-only layout thumbnail used in comparisons. */
export function LayoutThumb({ turbines, boundary, highlight }: { turbines: LayoutTurbine[]; boundary: { width: number; height: number }; highlight?: LayoutTurbine[] }) {
  const pad = Math.max(boundary.width, boundary.height) * 0.08;
  const W = boundary.width + 2 * pad;
  const H = boundary.height + 2 * pad;
  const moved = new Set(
    highlight
      ? turbines.filter((t) => {
          const h = highlight.find((x) => x.id === t.id);
          return !h || Math.hypot(h.x - t.x, h.y - t.y) > 1;
        }).map((t) => t.id)
      : [],
  );
  return (
    <svg viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} className="h-full w-full">
      <rect x={-boundary.width / 2} y={-boundary.height / 2} width={boundary.width} height={boundary.height} fill="#fbfaf7" stroke="#cfccc3" strokeWidth={W / 300} />
      {highlight?.map((t) => (
        <circle key={`h${t.id}`} cx={t.x} cy={-t.y} r={W / 90} fill="none" stroke="#95a0aa" strokeWidth={W / 500} strokeDasharray={`${W / 200} ${W / 300}`} />
      ))}
      {turbines.map((t) => (
        <circle key={t.id} cx={t.x} cy={-t.y} r={W / 70} fill={t.status === 'real' ? '#0b1f33' : moved.has(t.id) ? '#0f8a6a' : '#ffffff'} stroke={t.status === 'real' ? '#0b1f33' : '#0f8a6a'} strokeWidth={W / 400} />
      ))}
    </svg>
  );
}
