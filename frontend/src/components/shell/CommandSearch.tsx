import clsx from 'clsx';
import { CornerDownLeft, Search, Waves, Wind, FileText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../../app/navigation';
import { useDataset } from '../../services/dataService';
import { useSiteStore } from '../../store/siteStore';
import { useUiStore } from '../../store/appStores';

interface Item {
  id: string;
  label: string;
  hint: string;
  group: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandSearch() {
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearch);
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const { data: hydro } = useDataset('hydro_sites');
  const onshore = useSiteStore((s) => s.sites.onshore.turbines);
  const offshoreT = useSiteStore((s) => s.sites.offshore.turbines);
  const patch = useSiteStore((s) => s.patch);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (path: string) => () => {
      nav(path);
      setOpen(false);
    };
    const pages: Item[] = ROUTES.filter((r) => r.path !== '/twin').map((r) => ({
      id: r.path,
      label: r.parent ? `${r.parent} · ${r.label}` : r.label,
      hint: r.description,
      group: 'Pages',
      icon: <FileText size={15} />,
      run: go(r.path),
    }));
    const turb = (site: 'onshore' | 'offshore', list: typeof onshore): Item[] =>
      list.map((t) => ({
        id: `${site}-${t.id}`,
        label: `${t.label}`,
        hint: `${site === 'onshore' ? 'Onshore' : 'Offshore'} · ${t.status === 'real' ? 'real SCADA turbine' : 'proposed position'}`,
        group: 'Turbines',
        icon: <Wind size={15} />,
        run: () => {
          patch(site, { selectedId: t.id });
          go(`/twin/${site}`)();
        },
      }));
    const sites: Item[] = (hydro?.sites ?? []).map((s) => ({
      id: `hydro-${s.code}`,
      label: `${s.code} — ${s.name}`,
      hint: 'Tidal ADCP site (observed currents)',
      group: 'Hydro sites',
      icon: <Waves size={15} />,
      run: go(`/hydro?site=${s.code}`),
    }));
    return [...pages, ...turb('onshore', onshore), ...turb('offshore', offshoreT), ...sites];
  }, [nav, setOpen, hydro, onshore, offshoreT, patch]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items.filter((i) => i.group === 'Pages');
    return items.filter((i) => `${i.label} ${i.hint} ${i.group}`.toLowerCase().includes(s)).slice(0, 40);
  }, [q, items]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-ink/30 p-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div className="card w-[600px] max-w-full overflow-hidden shadow-[var(--shadow-pop)]" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={17} className="text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx((i) => Math.min(i + 1, filtered.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx((i) => Math.max(i - 1, 0));
              }
              if (e.key === 'Enter') filtered[idx]?.run();
            }}
            placeholder="Search pages, turbines (e.g. R80711), hydro sites…"
            className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
            aria-label="Search query"
          />
          <kbd className="rounded border border-line bg-subtle px-1.5 text-[10.5px] text-muted">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5 scroll-thin" role="listbox">
          {filtered.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-muted">No matches for “{q}”.</li>}
          {filtered.map((it, i) => (
            <li key={it.id} role="option" aria-selected={i === idx}>
              <button
                onMouseEnter={() => setIdx(i)}
                onClick={it.run}
                className={clsx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === idx ? 'bg-subtle' : '')}
              >
                <span className="text-muted">{it.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{it.label}</span>
                  <span className="block truncate text-[12px] text-muted">{it.hint}</span>
                </span>
                <span className="text-[11px] text-faint">{it.group}</span>
                {i === idx && <CornerDownLeft size={13} className="text-faint" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
