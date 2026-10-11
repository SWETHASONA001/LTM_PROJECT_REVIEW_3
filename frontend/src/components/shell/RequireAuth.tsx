import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { sessionValid, useAuthStore } from '../../store/authStore';

/** Redirects to /login (remembering the requested page) when there is no valid session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useAuthStore((s) => s.session);
  const loc = useLocation();
  if (!sessionValid(session)) {
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  return <>{children}</>;
}
