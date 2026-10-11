import { Calendar } from 'lucide-react';
import { Segmented } from '../ui/controls';

export interface RangePreset {
  value: string;
  label: string;
  start: string; // ISO date (UTC)
  end: string; // ISO date, exclusive
}

/** Presets covering the actual SCADA record span (2017-01-01 → 2018-01-12). */
export const SCADA_PRESETS: RangePreset[] = [
  { value: 'all', label: 'All', start: '2017-01-01', end: '2018-01-13' },
  { value: 'q1', label: 'Q1 2017', start: '2017-01-01', end: '2017-04-01' },
  { value: 'q2', label: 'Q2', start: '2017-04-01', end: '2017-07-01' },
  { value: 'q3', label: 'Q3', start: '2017-07-01', end: '2017-10-01' },
  { value: 'q4', label: 'Q4 (test)', start: '2017-10-01', end: '2018-01-01' },
  { value: 'nov', label: 'Nov 2017', start: '2017-11-01', end: '2017-12-01' },
  { value: 'wk', label: '1 week', start: '2017-11-06', end: '2017-11-13' },
];

export function TimeRangeSelect({ value, onChange, presets = SCADA_PRESETS }: { value: string; onChange: (v: string) => void; presets?: RangePreset[] }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto scroll-thin">
      <Calendar size={15} className="shrink-0 text-muted" />
      <Segmented size="sm" ariaLabel="Time range" value={value} onChange={onChange} options={presets.map((p) => ({ value: p.value, label: p.label }))} />
    </div>
  );
}
