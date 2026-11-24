/**
 * Rounding helpers.
 *
 * The engine computes everything in full double precision and rounds ONLY when a
 * figure is written into the reported result. `round2` is the single helper used
 * for every reported amount, unit count, percentage and ratio.
 *
 * Rounding mode: half away from zero, on the decimal value. A relative nudge of one
 * ULP compensates for binary representation error so that e.g. 1.005 -> 1.01
 * (plain `Math.round(1.005 * 100) / 100` gives 1.00).
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot round a non-finite number (${String(value)})`);
  }
  const factor = 10 ** decimals;
  const abs = Math.abs(value);
  const rounded = Math.round((abs + abs * Number.EPSILON) * factor) / factor;
  if (rounded === 0) return 0; // never emit -0
  return value < 0 ? -rounded : rounded;
}

/** Round to 2 decimals (paise). The only rounding applied to reported amounts. */
export function round2(value: number): number {
  return roundTo(value, 2);
}

/** round2 that passes null through (for metrics that may be undefined). */
export function round2OrNull(value: number | null): number | null {
  return value === null ? null : round2(value);
}

/** Multipliers (ramp, seasonality) are reported with 6 decimals. */
export function round6(value: number): number {
  return roundTo(value, 6);
}
