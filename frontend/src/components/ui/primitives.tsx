import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-ink text-white hover:bg-[#13304d] shadow-sm',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:border-line-strong hover:bg-subtle',
        variant === 'ghost' && 'text-ink-2 hover:bg-subtle hover:text-ink',
        variant === 'subtle' && 'bg-energy-soft text-energy hover:bg-[#d3ece2]',
        variant === 'danger' && 'border border-[#f1c6c1] bg-surface text-danger hover:bg-danger-soft',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={clsx(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-subtle hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed',
        active && 'bg-ink text-white hover:bg-ink hover:text-white',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Card({ className, children, padded = true }: { className?: string; children: ReactNode; padded?: boolean }) {
  return <section className={clsx('card min-w-0', padded && 'p-5', className)}>{children}</section>;
}

export function CardHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <div className="mt-0.5 text-ink-2">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-tight text-ink">{title}</h3>
          {subtitle && <p className="mt-1 text-[13px] leading-snug text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'energy' | 'wind' | 'water' | 'warn' | 'danger' | 'h2' | 'dark'; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap',
        tone === 'neutral' && 'bg-subtle text-ink-2 ring-1 ring-line',
        tone === 'energy' && 'bg-energy-soft text-energy',
        tone === 'wind' && 'bg-wind-soft text-wind',
        tone === 'water' && 'bg-water-soft text-water',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'h2' && 'bg-h2-soft text-h2',
        tone === 'dark' && 'bg-ink text-white',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Soft tint per section, chosen from the current route. */
const BANNER_TONES: { match: string; from: string; to: string; accent: string }[] = [
  { match: '/twin', from: '#e6f4ef', to: '#e8f1fb', accent: '#0f8a6a' },
  { match: '/planner', from: '#e9f5ee', to: '#eef6e8', accent: '#0f8a6a' },
  { match: '/siting', from: '#e7f6ef', to: '#fdf5e4', accent: '#a15c07' },
  { match: '/wind', from: '#e6effb', to: '#eaf6f8', accent: '#2b63c6' },
  { match: '/hydro', from: '#e0f2f6', to: '#e6f0fb', accent: '#0e7490' },
  { match: '/hydrogen', from: '#efedfb', to: '#e8f3f8', accent: '#5b5bd6' },
  { match: '/forecasting', from: '#eef0fb', to: '#e9f5f2', accent: '#6250d6' },
  { match: '/scenarios', from: '#e9f5ee', to: '#eef0fb', accent: '#047857' },
  { match: '/anomalies', from: '#fdf1e6', to: '#fbeeee', accent: '#b45309' },
  { match: '/models', from: '#f0ecfb', to: '#e8f0fb', accent: '#6d28d9' },
  { match: '/copilot', from: '#e8f0fb', to: '#eef7f2', accent: '#2b63c6' },
  { match: '/reports', from: '#f1f3ef', to: '#eaf2f7', accent: '#2f4256' },
  { match: '/settings', from: '#eff2f5', to: '#eef6f2', accent: '#2f4256' },
];

function useBannerTone() {
  const { pathname } = useLocation();
  return BANNER_TONES.find((t) => pathname.startsWith(t.match)) ?? { from: '#e7f5ef', to: '#e8f0fb', accent: '#0f8a6a' };
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: string; description?: ReactNode; actions?: ReactNode }) {
  const tone = useBannerTone();
  return (
    <header className="page-banner mb-6 px-5 py-5 sm:px-6" style={{ background: `linear-gradient(115deg, ${tone.from} 0%, ${tone.to} 100%)` }}>
      <svg className="pointer-events-none absolute -right-6 -top-4 h-40 w-[420px] opacity-60" viewBox="0 0 420 160" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <path key={i} d={`M0 ${120 - i * 22} C 90 ${90 - i * 22}, 170 ${150 - i * 22}, 260 ${110 - i * 22} S 380 ${80 - i * 22}, 420 ${100 - i * 22}`} fill="none" stroke={tone.accent} strokeOpacity={0.12 + i * 0.03} strokeWidth={1.5} />
        ))}
        <g transform="translate(360 52)" stroke={tone.accent} strokeOpacity={0.35} strokeWidth={2.2} strokeLinecap="round">
          <line x1="0" y1="0" x2="0" y2="70" />
          <line x1="0" y1="0" x2="0" y2="-26" />
          <line x1="0" y1="0" x2="22" y2="13" />
          <line x1="0" y1="0" x2="-22" y2="13" />
        </g>
      </svg>
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          {eyebrow && (
            <div className="label-xs mb-1.5 flex items-center gap-2" style={{ color: tone.accent }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.accent }} />
              {eyebrow}
            </div>
          )}
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Stat({ label, value, unit, hint }: { label: ReactNode; value: ReactNode; unit?: string; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="num mt-0.5 text-[17px] font-semibold text-ink">
        {value}
        {unit && <span className="ml-1 text-[12px] font-medium text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

export function KeyValue({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line text-[13px]">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-muted">{k}</dt>
          <dd className="num min-w-0 break-words text-right font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Callout({ tone = 'info', title, children, icon }: { tone?: 'info' | 'warn' | 'success' | 'neutral'; title?: ReactNode; children: ReactNode; icon?: ReactNode }) {
  return (
    <div
      className={clsx(
        'flex gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed',
        tone === 'info' && 'border-[#cfe0f5] bg-wind-soft/60 text-ink-2',
        tone === 'warn' && 'border-[#f0dcb8] bg-warn-soft text-[#6b4105]',
        tone === 'success' && 'border-[#c4e6d7] bg-energy-soft text-[#0b5a45]',
        tone === 'neutral' && 'border-line bg-subtle text-ink-2',
      )}
    >
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0">
        {title && <div className="mb-0.5 font-semibold text-ink">{title}</div>}
        {children}
      </div>
    </div>
  );
}
