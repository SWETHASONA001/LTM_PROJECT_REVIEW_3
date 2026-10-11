import { Bot, Crosshair, Map, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { WindHourly } from '../../data/types';
import { compass, fmt, pct } from '../../lib/format';
import type { LayoutTurbine } from '../../physics/constraints';
import type { FarmResult } from '../../physics/wake';
import { useUiStore } from '../../store/appStores';
import { Badge, Button, IconButton } from '../ui/primitives';
import { ProvenanceBadge } from '../ui/Provenance';

export function TurbineDetail({
  turbine,
  index,
  solved,
  hourly,
  timeIndex,
  observedMode,
  nearestM,
  rotorD,
  onClose,
  onFocus,
}: {
  turbine: LayoutTurbine;
  index: number;
  solved: FarmResult;
  hourly?: WindHourly;
  timeIndex: number;
  observedMode: boolean;
  nearestM: number;
  rotorD: number;
  onClose: () => void;
  onFocus: () => void;
}) {
  const nav = useNavigate();
  const openCopilot = useUiStore((s) => s.openCopilot);
  const real = turbine.status === 'real';
  const obs = real && hourly ? hourly.turbines[turbine.id] : undefined;
  const at = (arr?: (number | null)[]) => (arr ? arr[timeIndex] : null);
  const rows: { k: string; v: string; kind: 'observed' | 'physics' | 'assumption' }[] = [];
  if (obs) {
    rows.push(
      { k: 'Active power', v: `${fmt(at(obs.P), 0)} kW`, kind: 'observed' },
      { k: 'Wind speed (nacelle)', v: `${fmt(at(obs.Ws), 2)} m/s`, kind: 'observed' },
      { k: 'Wind direction', v: at(obs.Wa) !== null ? `${fmt(at(obs.Wa), 0)}° ${compass(at(obs.Wa) ?? 0)}` : '—', kind: 'observed' },
      { k: 'Rotor speed', v: `${fmt(at(obs.Rs), 1)} rpm`, kind: 'observed' },
      { k: 'Blade pitch', v: `${fmt(at(obs.Ba), 1)}°`, kind: 'observed' },
      { k: 'Outdoor temp.', v: `${fmt(at(obs.Ot), 1)} °C`, kind: 'observed' },
      { k: 'Records in hour', v: `${obs.n[timeIndex] ?? 0} / 6`, kind: 'observed' },
    );
  }
  rows.push(
    { k: 'Effective wind speed', v: `${fmt(solved.effectiveWs[index], 2)} m/s`, kind: 'physics' },
    { k: 'Wake velocity deficit', v: pct(solved.deficit[index]), kind: 'physics' },
    { k: 'Modeled power', v: `${fmt(solved.powerKw[index], 0)} kW`, kind: 'physics' },
    { k: 'Thrust coefficient Ct', v: fmt(solved.ct[index], 2), kind: 'physics' },
  );

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[16px] font-semibold">{turbine.label}</h3>
            {real ? <Badge tone="dark">Real SCADA asset</Badge> : <Badge tone="energy">Proposed position</Badge>}
          </div>
          <div className="num mt-1 text-[12px] text-muted">
            x {fmt(turbine.x, 0)} m · y {fmt(turbine.y, 0)} m · nearest {fmt(nearestM, 0)} m ({fmt(nearestM / rotorD, 1)}D)
          </div>
        </div>
        <div className="flex gap-0.5">
          <IconButton label="Focus camera" onClick={onFocus}>
            <Crosshair size={15} />
          </IconButton>
          <IconButton label="Close details" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </div>
      </div>
      {real && !observedMode && (
        <div className="mb-2 rounded-lg bg-subtle px-2.5 py-2 text-[12px] text-muted">Switch conditions to “Observed SCADA” to see this turbine’s measured values at a timestamp.</div>
      )}
      {!real && <div className="mb-2 rounded-lg bg-warn-soft px-2.5 py-2 text-[12px] text-[#6b4105]">No measurements exist for proposed positions — all values below are modeled.</div>}
      <dl className="divide-y divide-line text-[12.5px]">
        {rows.map((r) => (
          <div key={r.k} className="flex items-center justify-between gap-2 py-1.5">
            <dt className="flex items-center gap-1.5 text-muted">{r.k}</dt>
            <dd className="flex items-center gap-2">
              <span className="num font-semibold text-ink">{r.v}</span>
              <ProvenanceBadge kind={r.kind} className="!px-1.5 !text-[9.5px]" />
            </dd>
          </div>
        ))}
      </dl>
      {real && turbine.status === 'real' && (
        <p className="mt-2 text-[11px] leading-snug text-faint">Position is schematic: the repository contains no turbine coordinates for La Haute Borne.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" icon={<Map size={14} />} onClick={() => nav('/planner')}>
          Edit in planner
        </Button>
        <Button
          size="sm"
          variant="subtle"
          icon={<Bot size={14} />}
          onClick={() => openCopilot(real ? `Why did turbine ${turbine.id} generate less power than expected?` : `How does the wake affect ${turbine.label} in the current layout?`)}
        >
          Ask copilot
        </Button>
      </div>
    </div>
  );
}
