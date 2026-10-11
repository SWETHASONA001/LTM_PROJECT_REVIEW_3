import clsx from 'clsx';
import { Bell, ChevronRight, Command, LogOut, Menu, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ROUTES } from '../../app/navigation';
import { date } from '../../lib/format';
import { useBackendStatus } from '../../services/api';
import { useUiStore } from '../../store/appStores';
import { useAuthStore } from '../../store/authStore';

export function Topbar() {
  const setMobile = useUiStore((s) => s.setMobileNav);
  const setSearch = useUiStore((s) => s.setSearch);
  return (
    <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:px-6">
      <button className="rounded-lg p-2 text-ink-2 hover:bg-subtle lg:hidden" aria-label="Open navigation" onClick={() => setMobile(true)}>
        <Menu size={19} />
      </button>
      <Breadcrumbs />
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
        <button
          onClick={() => setSearch(true)}
          className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-muted hover:border-line-strong sm:w-64"
          aria-label="Search (Ctrl+K)"
        >
          <Search size={15} />
          <span className="hidden truncate sm:inline">Search…</span>
          <kbd className="ml-auto hidden items-center gap-0.5 rounded border border-line bg-subtle px-1.5 text-[10.5px] font-medium sm:inline-flex">
            <Command size={10} />K
          </kbd>
        </button>
        <BackendPill />
        <Notifications />
        <ProfileMenu />
      </div>
    </header>
  );
}

function Breadcrumbs() {
  const { pathname } = useLocation();
  const route = [...ROUTES].sort((a, b) => b.path.length - a.path.length).find((r) => (r.path === '/' ? pathname === '/' : pathname.startsWith(r.path)));
  const crumbs: { label: string; to?: string }[] = [{ label: 'AeroHydro', to: '/' }];
  if (route && route.path !== '/') {
    if (route.parent) crumbs.push({ label: route.parent });
    crumbs.push({ label: route.label });
  } else if (pathname === '/') crumbs.push({ label: 'Overview' });
  else crumbs.push({ label: 'Not found' });
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-[13px] md:flex">
      {crumbs.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight size={13} className="text-faint" />}
          {c.to && i < crumbs.length - 1 ? (
            <Link to={c.to} className="text-muted hover:text-ink">
              {c.label}
            </Link>
          ) : (
            <span className={clsx('truncate', i === crumbs.length - 1 ? 'font-semibold text-ink' : 'text-muted')}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function BackendPill() {
  const [status] = useBackendStatus();
  const map = {
    standalone: { dot: 'bg-[#94a3b8]', text: 'Standalone', title: 'No backend configured: static data extracts + in-browser physics' },
    checking: { dot: 'bg-warn animate-pulse', text: 'Connecting', title: 'Checking backend health…' },
    online: { dot: 'bg-ok', text: 'API online', title: 'FastAPI backend reachable' },
    offline: { dot: 'bg-danger', text: 'API offline', title: 'Backend configured but unreachable' },
  }[status.state];
  return (
    <Link to="/settings" title={map.title} className="hidden h-9 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] font-medium text-ink-2 hover:border-line-strong md:flex">
      <span className={clsx('h-2 w-2 rounded-full', map.dot)} />
      {map.text}
    </Link>
  );
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOut();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onOut]);
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  const list = useUiStore((s) => s.notifications);
  const markAll = useUiStore((s) => s.markAllRead);
  const clear = useUiStore((s) => s.clearNotifications);
  const unread = list.filter((n) => !n.read).length;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(markAll, 1200);
        }}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-ink-2 hover:border-line-strong"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
      >
        <Bell size={16} />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-energy px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="card absolute right-0 top-11 z-50 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden shadow-[var(--shadow-pop)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-[13px] font-semibold">Activity</span>
            {list.length > 0 && (
              <button onClick={clear} className="text-[12px] text-muted hover:text-ink">
                Clear
              </button>
            )}
          </div>
          <div className="max-h-[360px] overflow-y-auto scroll-thin">
            {list.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12.5px] text-muted">
                No activity yet. Optimization runs, saved scenarios and exports appear here. There is no live plant telemetry feed.
              </div>
            ) : (
              list.map((n) => (
                <Link key={n.id} to={n.href ?? '#'} onClick={() => setOpen(false)} className="block border-b border-line px-4 py-2.5 last:border-0 hover:bg-subtle">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
                    <span className={clsx('h-1.5 w-1.5 rounded-full', n.tone === 'success' ? 'bg-ok' : n.tone === 'warning' ? 'bg-warn' : 'bg-wind')} />
                    {n.title}
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">{n.body}</div>
                  <div className="mt-0.5 text-[11px] text-faint">{date(n.createdAt, true)}</div>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const nav = useNavigate();
  const name = session?.user.name ?? 'Guest';
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex h-9 items-center gap-2 rounded-lg pl-1 pr-2 text-ink-2 hover:bg-subtle" aria-label="Account menu">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#0f8a6a] to-[#2b63c6] text-[12px] font-bold text-white">{initials}</span>
        <span className="hidden text-left leading-tight xl:block">
          <span className="block text-[12.5px] font-semibold text-ink">{name}</span>
          <span className="block text-[11px] text-muted">{session?.mode === 'backend' ? session.user.role : 'local workspace'}</span>
        </span>
      </button>
      {open && (
        <div className="card absolute right-0 top-11 z-50 w-72 p-3 shadow-[var(--shadow-pop)]">
          <div className="text-[13px] font-semibold text-ink">{name}</div>
          <div className="text-[12px] text-muted">{session?.user.email}</div>
          <div className="mt-2 rounded-lg bg-subtle px-2.5 py-2 text-[11.5px] leading-snug text-ink-2">
            {session?.mode === 'backend'
              ? `Signed in via the AeroHydro backend · session expires ${session.expiresAt ? new Date(session.expiresAt * 1000).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : ''}.`
              : 'Local workspace without server authentication. Layouts, scenarios and conversations are stored in this browser only.'}
          </div>
          <div className="mt-2 border-t border-line pt-2">
            <Link to="/settings" onClick={() => setOpen(false)} className="block rounded-md px-2 py-1.5 text-[13px] text-ink-2 hover:bg-subtle">
              Settings & data sources
            </Link>
            <Link to="/reports" onClick={() => setOpen(false)} className="block rounded-md px-2 py-1.5 text-[13px] text-ink-2 hover:bg-subtle">
              Reports & exports
            </Link>
            <button
              onClick={() => {
                signOut();
                nav('/login', { replace: true });
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-danger hover:bg-danger-soft"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
