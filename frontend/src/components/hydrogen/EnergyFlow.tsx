import { energy, mass } from '../../lib/format';
import type { DispatchResult } from '../../physics/hydrogen';

/**
 * Energy-flow diagram: sources → allocation → electrolyzer / storage /
 * curtailment → H2. Band widths are proportional to MWh, so the balance is
 * visible (no double counting).
 */
export function EnergyFlow({ windMWh, hydroMWh, r }: { windMWh: number; hydroMWh: number; r: DispatchResult }) {
  const total = Math.max(r.availableMWh, 1e-9);
  const H = 230;
  const scale = (v: number) => Math.max(2, (v / total) * (H - 40));
  const wind = scale(windMWh);
  const hydro = hydroMWh > 0 ? scale(hydroMWh) : 0;
  const direct = scale(r.directMWh);
  const charged = r.chargedMWh > 0 ? scale(r.chargedMWh) : 0;
  const curtailed = r.curtailedMWh > 0 ? scale(r.curtailedMWh) : 0;
  const discharged = r.dischargedMWh > 0 ? scale(r.dischargedMWh) : 0;

  const band = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, color: string, opacity = 0.32) => (
    <path d={`M${x0} ${y0} C${(x0 + x1) / 2} ${y0}, ${(x0 + x1) / 2} ${y1}, ${x1} ${y1} L${x1} ${y1 + h1} C${(x0 + x1) / 2} ${y1 + h1}, ${(x0 + x1) / 2} ${y0 + h0}, ${x0} ${y0 + h0} Z`} fill={color} fillOpacity={opacity} />
  );
  const node = (x: number, y: number, h: number, color: string) => <rect x={x - 5} y={y} width={10} height={Math.max(h, 2)} rx={3} fill={color} />;
  const label = (x: number, y: number, title: string, value: string, anchor: 'start' | 'end' | 'middle' = 'start') => (
    <g>
      <text x={x} y={y} textAnchor={anchor} fontSize={12} fontWeight={600} fill="#0b1f33">
        {title}
      </text>
      <text x={x} y={y + 15} textAnchor={anchor} fontSize={11.5} fill="#66727f">
        {value}
      </text>
    </g>
  );

  const srcY = 20;
  const allocY = 20;
  const allocH = wind + hydro;
  const elecY = 20;
  const elecH = direct + discharged;
  const storeY = elecY + elecH + 26;
  const curtY = storeY + charged + 26;

  return (
    <svg viewBox="0 0 920 300" className="w-full" role="img" aria-label="Energy flow from renewable sources to hydrogen">
      <g transform="translate(90 0)">
      {/* sources */}
      {node(70, srcY, wind, '#2a78d6')}
      {hydro > 0 && node(70, srcY + wind + 14, hydro, '#0e7490')}
      {label(60, srcY + wind / 2 - 4, 'Wind (modeled)', energy(windMWh), 'end')}
      {hydro > 0 && label(60, srcY + wind + 14 + hydro / 2 - 4, 'Hydro (modeled)', energy(hydroMWh), 'end')}
      {/* to allocation */}
      {band(75, srcY, wind, 295, allocY, wind, '#2a78d6')}
      {hydro > 0 && band(75, srcY + wind + 14, hydro, 295, allocY + wind, hydro, '#0e7490')}
      {node(300, allocY, allocH, '#0b1f33')}
      {label(300, allocY + allocH + 26, 'Allocation', energy(r.availableMWh), 'middle')}
      {/* outputs */}
      {band(305, allocY, direct, 545, elecY, direct, '#1baf7a', 0.35)}
      {charged > 0 && band(305, allocY + direct, charged, 545, storeY, charged, '#eda100', 0.35)}
      {curtailed > 0 && band(305, allocY + direct + charged, curtailed, 545, curtY, curtailed, '#95a0aa', 0.35)}
      {discharged > 0 && band(555, storeY, discharged, 545, elecY + direct, discharged, '#eda100', 0.25)}
      {node(550, elecY, elecH, '#1baf7a')}
      {charged > 0 && node(550, storeY, charged, '#eda100')}
      {curtailed > 0 && node(550, curtY, curtailed, '#95a0aa')}
      {label(562, elecY + 12, 'Electrolyzer', energy(r.toElectrolyzerMWh))}
      {charged > 0 && label(562, storeY + 12, 'Battery charge', `${energy(r.chargedMWh)} · losses ${energy(r.storageLossMWh)}`)}
      {curtailed > 0 && label(562, curtY + 12, 'Curtailed / unused', energy(r.curtailedMWh))}
      {/* H2 */}
      <g transform="translate(730 40)">
        <circle r={34} fill="#ecebfb" stroke="#5b5bd6" strokeWidth={1.5} />
        <text textAnchor="middle" y={-2} fontSize={18} fontWeight={700} fill="#5b5bd6">
          H₂
        </text>
        <text textAnchor="middle" y={16} fontSize={11.5} fontWeight={600} fill="#0b1f33">
          {mass(r.h2Kg)}
        </text>
      </g>
      <path d="M 660 40 L 692 40" stroke="#5b5bd6" strokeWidth={2} markerEnd="url(#h2arrow)" />
      </g>
      <defs>
        <marker id="h2arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="#5b5bd6" />
        </marker>
      </defs>
    </svg>
  );
}
