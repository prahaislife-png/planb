/**
 * Text helpers for reasons. Hand-written (no Intl, no locale lookup) so the same input gives the same sentence
 * in every runtime.
 */

function indianGrouping(whole: number): string {
  const digits = String(whole);
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) groups.unshift(rest);
  return `${groups.join(',')},${last3}`;
}

function trimDecimals(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.?0+$/, '');
}

/**
 * Rupees the way Indian readers write them: ₹42,132 · ₹8.9 L (lakh) · ₹1.25 Cr (crore).
 * Lakh and crore figures are rounded to two decimals for reading; every comparison uses the exact number.
 */
export function formatInr(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1e7) return `${sign}₹${trimDecimals(abs / 1e7, 2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trimDecimals(abs / 1e5, 2)} L`;
  return `${sign}₹${indianGrouping(Math.round(abs))}`;
}

export function formatMonths(n: number): string {
  const shown = trimDecimals(n, 1);
  return `${shown} ${shown === '1' ? 'month' : 'months'}`;
}

/** For use before a noun: "12-month transition timeline". */
export function monthSpan(n: number): string {
  return `${trimDecimals(n, 1)}-month`;
}

export function formatCount(n: number): string {
  return Number.isInteger(n) ? indianGrouping(Math.abs(n)) : trimDecimals(n, 1);
}

/** "a", "a and b", "a, b and c". */
export function joinList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

/** Words for the few fractions used as rule cut-offs, so a reason never shows a ratio as a figure of merit. */
export function fractionInWords(fraction: number): string {
  const known: Array<[number, string]> = [
    [1, 'all'],
    [0.5, 'half'],
    [1 / 3, 'one third'],
    [0.25, 'one quarter'],
    [0.1, 'one tenth'],
  ];
  for (const [value, words] of known) if (Math.abs(value - fraction) < 1e-9) return words;
  return `${trimDecimals(fraction, 2)} times`;
}

/** snake_case / dotted keys as words: "government_project_report" → "government project report". */
export function humanise(key: string): string {
  return key.replace(/[_.-]+/g, ' ').trim();
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : pluralForm}`;
}
