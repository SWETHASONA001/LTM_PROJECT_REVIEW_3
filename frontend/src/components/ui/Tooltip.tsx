import clsx from 'clsx';
import { useId, useState, type ReactNode } from 'react';

/** Accessible hover/focus tooltip (no portal; positioned above by default). */
export function Tooltip({ content, children, side = 'top', className, width = 280 }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom'; className?: string; width?: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className={clsx('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span
          id={id}
          role="tooltip"
          style={{ width }}
          className={clsx(
            'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-white shadow-[var(--shadow-pop)]',
            side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
