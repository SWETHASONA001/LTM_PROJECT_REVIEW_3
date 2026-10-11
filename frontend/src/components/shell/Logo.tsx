import clsx from 'clsx';
import { Link } from 'react-router-dom';

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0b1f33" />
      <path d="M4 24c4-2.5 8-2.5 12 0s8 2.5 12 0" stroke="#38bdf8" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.9" />
      <g stroke="#34d399" strokeWidth="2.2" strokeLinecap="round">
        <path d="M16 14 L16 5" />
        <path d="M16 14 L23.8 18.5" />
        <path d="M16 14 L8.2 18.5" />
      </g>
      <circle cx="16" cy="14" r="2.2" fill="#fff" />
    </svg>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="AeroHydro-PINN home">
      <LogoMark />
      <span className={clsx('leading-tight', compact && 'lg:hidden')}>
        <span className="block text-[15px] font-semibold tracking-tight text-ink">AeroHydro-PINN</span>
        <span className="block text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted">Physics-AI · Wind · H₂</span>
      </span>
    </Link>
  );
}
