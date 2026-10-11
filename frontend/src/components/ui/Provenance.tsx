import clsx from 'clsx';
import type { ProvenanceKind } from '../../data/types';
import { PROVENANCE } from '../../lib/provenance';
import { Tooltip } from './Tooltip';

export function ProvenanceBadge({ kind, className, detail }: { kind: ProvenanceKind; className?: string; detail?: string }) {
  const p = PROVENANCE[kind];
  return (
    <Tooltip
      content={
        <>
          <div className="font-semibold">{p.label}</div>
          <div className="mt-0.5 text-white/80">{p.description}</div>
          {detail && <div className="mt-1.5 border-t border-white/15 pt-1.5 text-white/90">{detail}</div>}
        </>
      }
    >
      <span
        tabIndex={0}
        className={clsx('inline-flex cursor-help items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide', className)}
        style={{ color: p.color, background: p.bg }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
        {p.label}
      </span>
    </Tooltip>
  );
}

export function ProvenanceLegend({ kinds }: { kinds?: ProvenanceKind[] }) {
  const list = kinds ?? (Object.keys(PROVENANCE) as ProvenanceKind[]);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {list.map((k) => (
        <ProvenanceBadge key={k} kind={k} />
      ))}
    </div>
  );
}
