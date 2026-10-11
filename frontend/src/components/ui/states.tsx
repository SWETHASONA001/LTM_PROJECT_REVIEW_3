import { AlertTriangle, Inbox, Loader2, PlugZap, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './primitives';

export function LoadingState({ label = 'Loading data…', className = 'h-48' }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`flex flex-col items-center justify-center gap-2 text-[13px] text-muted ${className}`}>
      <Loader2 className="animate-spin text-energy" size={20} />
      {label}
    </div>
  );
}

export function Skeleton({ className = 'h-24' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-sunken/70 ${className}`} />;
}

export function ErrorState({ error, onRetry, className = 'h-48' }: { error?: Error | string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={`flex flex-col items-center justify-center gap-2 px-6 text-center ${className}`}>
      <AlertTriangle className="text-danger" size={22} />
      <div className="text-[14px] font-semibold text-ink">Something went wrong</div>
      <div className="max-w-md text-[13px] text-muted">{typeof error === 'string' ? error : error?.message}</div>
      {onRetry && (
        <Button size="sm" icon={<RotateCw size={14} />} onClick={onRetry} className="mt-1">
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, body, action, icon, className = 'py-12' }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 px-6 text-center ${className}`}>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-subtle text-muted">{icon ?? <Inbox size={18} />}</div>
      <div className="text-[14px] font-semibold text-ink">{title}</div>
      {body && <div className="max-w-md text-[13px] leading-relaxed text-muted">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Explicit "integration not available" state for unimplemented backend/model features. */
export function UnavailableState({ title, reason, requirement, className = 'py-8' }: { title: string; reason: ReactNode; requirement?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-subtle/60 px-6 text-center ${className}`}>
      <PlugZap size={18} className="text-muted" />
      <div className="text-[13.5px] font-semibold text-ink">{title}</div>
      <div className="max-w-lg text-[12.5px] leading-relaxed text-muted">{reason}</div>
      {requirement && <div className="max-w-lg text-[12px] text-ink-2">{requirement}</div>}
    </div>
  );
}

/** Render children once data is ready, with consistent loading/error states. */
export function DataGate<T>({ state, children, loadingLabel, className }: { state: { data?: T; error?: Error; loading: boolean; reload: () => void }; children: (data: T) => ReactNode; loadingLabel?: string; className?: string }) {
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} className={className} />;
  if (state.loading || !state.data) return <LoadingState label={loadingLabel} className={className} />;
  return <>{children(state.data)}</>;
}
