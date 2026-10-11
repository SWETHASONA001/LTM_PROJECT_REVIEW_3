import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';
import { LogoMark } from '../components/shell/Logo';

export function RouteError() {
  const err = useRouteError();
  const msg = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : 'Unknown error';
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-canvas p-6 text-center">
      <LogoMark size={40} />
      <h1 className="text-xl font-semibold text-ink">This view failed to render</h1>
      <p className="max-w-md text-[13.5px] text-muted">{msg}</p>
      <div className="flex gap-2">
        <button className="h-9 rounded-lg border border-line bg-surface px-3 text-sm" onClick={() => window.location.reload()}>
          Reload
        </button>
        <Link to="/" className="flex h-9 items-center rounded-lg bg-ink px-3 text-sm text-white">
          Back to overview
        </Link>
      </div>
    </div>
  );
}
