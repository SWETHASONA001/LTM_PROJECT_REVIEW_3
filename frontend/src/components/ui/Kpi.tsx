import clsx from 'clsx';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ProvenanceKind } from '../../data/types';
import { ProvenanceBadge } from './Provenance';
import { Tooltip } from './Tooltip';

export interface KpiProps {
  label: string;
  value: ReactNode;
  unit?: string;
  provenance: ProvenanceKind;
  /** Definition, units and source shown in the tooltip. */
  definition: string;
  source: string;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: 'wind' | 'water' | 'energy' | 'h2' | 'neutral';
  unavailable?: string;
}

export function KpiCard({ label, value, unit, provenance, definition, source, sub, icon, accent = 'neutral', unavailable }: KpiProps) {
  return (
    <div className="card relative flex min-w-0 flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon && (
            <span
              className={clsx(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                accent === 'wind' && 'bg-wind-soft text-wind',
                accent === 'water' && 'bg-water-soft text-water',
                accent === 'energy' && 'bg-energy-soft text-energy',
                accent === 'h2' && 'bg-h2-soft text-h2',
                accent === 'neutral' && 'bg-subtle text-ink-2',
              )}
            >
              {icon}
            </span>
          )}
          <span className="line-clamp-2 text-[12.5px] font-medium leading-tight text-ink-2">{label}</span>
        </div>
        <Tooltip
          width={300}
          content={
            <div className="space-y-1.5">
              <div className="font-semibold">{label}</div>
              <div className="text-white/85">{definition}</div>
              <div className="text-white/70">
                <span className="font-semibold text-white/85">Source: </span>
                {source}
              </div>
            </div>
          }
        >
          <button type="button" aria-label={`About ${label}`} className="rounded p-0.5 text-faint hover:text-ink">
            <Info size={14} />
          </button>
        </Tooltip>
      </div>
      {unavailable ? (
        <div>
          <div className="text-[15px] font-semibold text-muted">Unavailable</div>
          <div className="mt-0.5 text-[12px] leading-snug text-muted">{unavailable}</div>
        </div>
      ) : (
        <div className="num text-[24px] font-semibold leading-none tracking-tight text-ink">
          {value}
          {unit && <span className="ml-1 text-[13px] font-medium text-muted">{unit}</span>}
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <ProvenanceBadge kind={provenance} />
        {sub && <span className="text-[11.5px] text-muted">{sub}</span>}
      </div>
    </div>
  );
}
