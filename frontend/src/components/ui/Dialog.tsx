import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { IconButton } from './primitives';

export function Dialog({ open, onClose, title, children, footer, width = 520 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/30 p-4 pt-[10vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card w-full max-w-full overflow-hidden shadow-[var(--shadow-pop)]"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4 scroll-thin">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-subtle/50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
