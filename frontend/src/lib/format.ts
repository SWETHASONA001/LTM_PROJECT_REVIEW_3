export function fmt(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('en-GB');
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function signedPct(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;
}

export function signed(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${fmt(v, digits)}`;
}

/** Power with automatic kW / MW scaling. */
export function power(kw: number | null | undefined, digits = 1): string {
  if (kw === null || kw === undefined || !Number.isFinite(kw)) return '—';
  return Math.abs(kw) >= 1000 ? `${fmt(kw / 1000, digits)} MW` : `${fmt(kw, 0)} kW`;
}

export function energy(mwh: number | null | undefined, digits = 1): string {
  if (mwh === null || mwh === undefined || !Number.isFinite(mwh)) return '—';
  return Math.abs(mwh) >= 1000 ? `${fmt(mwh / 1000, digits)} GWh` : `${fmt(mwh, digits)} MWh`;
}

export function mass(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return '—';
  return Math.abs(kg) >= 1000 ? `${fmt(kg / 1000, 1)} t` : `${fmt(kg, 0)} kg`;
}

export function date(iso: string | Date, withTime = false): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' } : { timeZone: 'UTC' }),
  });
}

export function compass(deg: number): string {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function bytes(n: number): string {
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n > 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

export function downloadFile(name: string, content: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
