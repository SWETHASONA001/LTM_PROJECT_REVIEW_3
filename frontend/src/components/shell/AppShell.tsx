import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { FloatingCopilot } from '../copilot/FloatingCopilot';
import { LoadingState } from '../ui/states';
import { CommandSearch } from './CommandSearch';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/** Pages where the floating copilot button is shown. */
const COPILOT_PAGES = ['/', '/twin', '/planner', '/wind', '/hydro', '/hydrogen', '/scenarios', '/anomalies', '/models', '/forecasting'];

export function AppShell() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.getElementById('main')?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [pathname]);
  const showCopilot = COPILOT_PAGES.some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p)));
  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Suspense fallback={<LoadingState className="h-[60vh]" label="Loading module…" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <CommandSearch />
      {showCopilot && <FloatingCopilot />}
    </div>
  );
}
