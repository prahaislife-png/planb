/** Formatting helpers. Indian digit grouping; missing values are shown as missing, never as zero. */

export const MISSING = '—';

export function inr(value: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING;
  if (opts.compact) {
    const abs = Math.abs(value);
    if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
    if (abs >= 1e5) return `₹${(value / 1e5).toFixed(2)} L`;
  }
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)}`;
}

export function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING;
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING;
  return `${Number(value).toFixed(digits)}%`;
}

export function date(value: string | Date | null | undefined): string {
  if (!value) return MISSING;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return MISSING;
  const d = typeof value === 'string' ? new Date(value) : value;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}Z`;
}

export function humanize(value: string | null | undefined): string {
  if (!value) return MISSING;
  return value.replace(/[_.-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function valueWithUnit(value: number | null | undefined, unit: string | null | undefined, period?: string | null): string {
  if (value === null || value === undefined) return MISSING;
  const per = period && period !== 'one_time' && period !== 'point_in_time' ? ` / ${period.replace('per_', '')}` : '';
  if (unit === 'inr') return `${inr(value)}${per}`;
  if (unit === 'percent') return `${num(value, 2)}%`;
  return `${num(value, 2)}${unit ? ` ${unit}` : ''}${per}`;
}
