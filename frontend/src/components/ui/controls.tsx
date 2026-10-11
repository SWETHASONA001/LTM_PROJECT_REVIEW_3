import clsx from 'clsx';
import { useId, type ReactNode } from 'react';

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  format,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={clsx('min-w-0', disabled && 'opacity-60')}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[12.5px] font-medium text-ink-2">
          {label}
        </label>
        <span className="num text-[12.5px] font-semibold text-ink">
          {format ? format(value) : value}
          {unit && !format && <span className="ml-0.5 font-normal text-muted">{unit}</span>}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer"
      />
      {hint && <div className="mt-1 text-[11px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

export function NumberField({ label, value, onChange, min, max, step = 1, unit, hint }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[12.5px] font-medium text-ink-2">
        {label}
      </label>
      <div className="flex items-center rounded-lg border border-line bg-surface focus-within:border-energy">
        <input
          id={id}
          type="number"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(min !== undefined || max !== undefined ? Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)) : v);
          }}
          className="num h-8 w-full min-w-0 rounded-lg bg-transparent px-2.5 text-[13px] text-ink outline-none"
        />
        {unit && <span className="pr-2.5 text-[12px] text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[11px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

export function Select<T extends string>({ label, value, options, onChange, className }: { label?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string }) {
  const id = useId();
  return (
    <div className={clsx('min-w-0', className)}>
      {label && (
        <label htmlFor={id} className="mb-1 block text-[12.5px] font-medium text-ink-2">
          {label}
        </label>
      )}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-8 w-full rounded-lg border border-line bg-surface px-2 text-[13px] text-ink outline-none focus:border-energy"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md', ariaLabel }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-md font-medium transition-all whitespace-nowrap',
            size === 'sm' ? 'h-7 px-2 text-[12px]' : 'h-8 px-3 text-[13px]',
            value === o.value ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-ink-2">{label}</span>
        {hint && <span className="block text-[11px] leading-snug text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-energy' : 'bg-line-strong')}
      >
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string; icon?: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-line scroll-thin">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-[13.5px] font-medium whitespace-nowrap transition-colors',
            value === t.value ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}
