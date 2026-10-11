import clsx from 'clsx';
import { ChevronDown, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { NAV } from '../../app/navigation';
import { useUiStore } from '../../store/appStores';
import { Logo } from './Logo';

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const mobileOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobile = useUiStore((s) => s.setMobileNav);

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-ink/30 lg:hidden" onClick={() => setMobile(false)} />}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-line bg-surface transition-[width,transform] duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          collapsed ? 'lg:w-[68px]' : 'lg:w-[264px]',
          'w-[272px]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Primary navigation"
      >
        <div className={clsx('flex h-16 shrink-0 items-center border-b border-line', collapsed ? 'lg:justify-center lg:px-0' : 'px-4', 'px-4 justify-between')}>
          <Logo compact={collapsed} />
          <button className="rounded-lg p-1.5 text-muted hover:bg-subtle lg:hidden" aria-label="Close navigation" onClick={() => setMobile(false)}>
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 scroll-thin">
          {groupBy(NAV).map(([group, items]) => (
            <div key={group} className="mb-3">
              <div className={clsx('label-xs px-2.5 pb-1.5 pt-1 text-faint', collapsed && 'lg:hidden')}>{group}</div>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <NavEntry key={item.path} item={item} collapsed={collapsed} onNavigate={() => setMobile(false)} />
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="hidden shrink-0 border-t border-line p-2.5 lg:block">
          <button
            onClick={toggle}
            className={clsx('flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted hover:bg-subtle hover:text-ink', collapsed && 'justify-center px-0')}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            {!collapsed && 'Collapse'}
          </button>
        </div>
      </aside>
    </>
  );
}

function groupBy(items: typeof NAV) {
  const m = new Map<string, typeof NAV>();
  items.forEach((i) => m.set(i.group, [...(m.get(i.group) ?? []), i]));
  return [...m.entries()];
}

function NavEntry({ item, collapsed, onNavigate }: { item: (typeof NAV)[number]; collapsed: boolean; onNavigate: () => void }) {
  const loc = useLocation();
  const inSection = item.children ? loc.pathname.startsWith(item.path) : false;
  const [open, setOpen] = useState(true);
  const base = 'group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors';

  if (item.children) {
    return (
      <li>
        <div className="flex items-center">
          <NavLink
            to={item.children[0].path}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={clsx(base, 'flex-1', inSection ? 'text-ink' : 'text-ink-2 hover:bg-subtle hover:text-ink', collapsed && 'lg:justify-center lg:px-0')}
          >
            {inSection && <span className="absolute left-0 top-2 h-5 w-[3px] rounded-r bg-energy" />}
            <span className={inSection ? 'text-energy' : 'text-muted group-hover:text-ink-2'}>{item.icon}</span>
            <span className={clsx('truncate', collapsed && 'lg:hidden')}>{item.label}</span>
          </NavLink>
          {!collapsed && (
            <button aria-label={open ? 'Collapse section' : 'Expand section'} onClick={() => setOpen(!open)} className="rounded p-1 text-faint hover:text-ink">
              <ChevronDown size={14} className={clsx('transition-transform', !open && '-rotate-90')} />
            </button>
          )}
        </div>
        {open && (
          <ul className={clsx('mt-0.5 space-y-0.5', collapsed ? 'lg:hidden' : 'ml-[22px] border-l border-line pl-2')}>
            {item.children.map((c) => (
              <li key={c.path}>
                <NavLink
                  to={c.path}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    clsx('flex h-8 items-center gap-2 rounded-md px-2 text-[13px]', isActive ? 'bg-energy-soft font-semibold text-energy' : 'text-ink-2 hover:bg-subtle hover:text-ink')
                  }
                >
                  {c.icon}
                  {c.label}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <NavLink
        to={item.path}
        end={item.path === '/'}
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
        className={({ isActive }) =>
          clsx(base, isActive ? 'bg-subtle text-ink' : 'text-ink-2 hover:bg-subtle hover:text-ink', collapsed && 'lg:justify-center lg:px-0')
        }
      >
        {({ isActive }) => (
          <>
            {isActive && <span className="absolute left-0 top-2 h-5 w-[3px] rounded-r bg-energy" />}
            <span className={isActive ? 'text-energy' : 'text-muted group-hover:text-ink-2'}>{item.icon}</span>
            <span className={clsx('truncate', collapsed && 'lg:hidden')}>{item.label}</span>
          </>
        )}
      </NavLink>
    </li>
  );
}
