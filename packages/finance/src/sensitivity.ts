import { computeModel, hashModelInput } from './engine';
import { round2, round2OrNull } from './round';
import { applyAdjustments } from './scenarios';
import { ModelValidationError, parseModelInput, type ModelInput } from './schema';
import type { ModelResult } from './types';
import { ENGINE_VERSION } from './version';

/**
 * One-at-a-time ("tornado") sensitivity analysis.
 *
 * Each parameter is multiplied by (1 + delta/100) while everything else stays at
 * the base input; the chosen output metric is re-computed for each delta. These
 * are mechanical what-ifs, not forecasts or probabilities.
 */

export const SENSITIVITY_PARAMS = [
  'volume',
  'price',
  'variable_costs',
  'fixed_costs',
  'staff_costs',
  'rent',
  'capex',
  'interest_rate',
  'ramp_months',
] as const;
export type SensitivityParam = (typeof SENSITIVITY_PARAMS)[number];

export const SENSITIVITY_METRICS = [
  'steadyStateEbitda',
  'paybackOperatingMonth',
  'peakFundingNeed',
  'cumulativeCashAtHorizonEnd',
  'ownerIncomeYear1AvgMonthly',
] as const;
export type SensitivityMetric = (typeof SENSITIVITY_METRICS)[number];

export const DEFAULT_SENSITIVITY_PARAMS: readonly SensitivityParam[] = [
  'volume',
  'price',
  'variable_costs',
  'fixed_costs',
  'staff_costs',
  'capex',
];
export const DEFAULT_SENSITIVITY_DELTAS: readonly number[] = [-20, -10, 10, 20];

export interface SensitivityPoint {
  /** Percentage change applied to the parameter. */
  deltaPct: number;
  /** Metric value; null when the metric is undefined (e.g. no payback within the horizon). */
  value: number | null;
  /** value − base; null if either is null. */
  changeFromBase: number | null;
}

export interface SensitivityRow {
  param: SensitivityParam;
  points: SensitivityPoint[];
  /** Lowest / highest non-null metric value over the deltas and the base. */
  min: number | null;
  max: number | null;
  /** max − min: the bar length of the tornado chart. */
  spread: number | null;
  /** True if the metric was undefined (null) for at least one delta. */
  hasUndefinedPoint: boolean;
  /** Clamping / no-effect remarks from applying the adjustments. */
  notes: string[];
}

export interface SensitivityResult {
  engineVersion: string;
  inputHash: string;
  metric: SensitivityMetric;
  deltasPct: number[];
  /** Metric value for the unadjusted input. */
  base: number | null;
  /** Sorted by `spread` descending (largest effect first); ties keep the order of `params`. */
  rows: SensitivityRow[];
}

export function metricValue(result: ModelResult, metric: SensitivityMetric): number | null {
  switch (metric) {
    case 'steadyStateEbitda':
      return result.summary.steadyState.ebitda;
    case 'paybackOperatingMonth':
      return result.summary.capitalRecovery.paybackOperatingMonth;
    case 'peakFundingNeed':
      return result.summary.peakFundingNeed;
    case 'cumulativeCashAtHorizonEnd':
      return result.summary.capitalRecovery.cumulativeCashAtHorizonEnd;
    case 'ownerIncomeYear1AvgMonthly':
      return result.summary.ownerIncome.year1AvgMonthly;
  }
}

export function sensitivity(
  input: ModelInput,
  params: readonly SensitivityParam[] = DEFAULT_SENSITIVITY_PARAMS,
  deltas: readonly number[] = DEFAULT_SENSITIVITY_DELTAS,
  metric: SensitivityMetric = 'steadyStateEbitda',
): SensitivityResult {
  const base = parseModelInput(input);

  const issues: Array<{ path: string; message: string }> = [];
  if (!Array.isArray(params) || params.length === 0) {
    issues.push({ path: 'params', message: 'params must be a non-empty array' });
  } else {
    params.forEach((param, index) => {
      if (!(SENSITIVITY_PARAMS as readonly string[]).includes(param)) {
        issues.push({
          path: `params[${index}]`,
          message: `unknown sensitivity parameter "${String(param)}"; expected one of ${SENSITIVITY_PARAMS.join(', ')}`,
        });
      }
    });
    if (new Set(params).size !== params.length) issues.push({ path: 'params', message: 'params must not contain duplicates' });
  }
  if (!Array.isArray(deltas) || deltas.length === 0) {
    issues.push({ path: 'deltas', message: 'deltas must be a non-empty array of percentages' });
  } else {
    deltas.forEach((delta, index) => {
      if (typeof delta !== 'number' || !Number.isFinite(delta) || delta <= -100 || delta > 1000) {
        issues.push({ path: `deltas[${index}]`, message: 'each delta must be a percentage greater than -100 and at most 1000' });
      }
    });
    if (new Set(deltas).size !== deltas.length) issues.push({ path: 'deltas', message: 'deltas must not contain duplicates' });
  }
  if (!(SENSITIVITY_METRICS as readonly string[]).includes(metric)) {
    issues.push({
      path: 'metric',
      message: `unknown metric "${String(metric)}"; expected one of ${SENSITIVITY_METRICS.join(', ')}`,
    });
  }
  if (issues.length > 0) throw new ModelValidationError(issues, 'sensitivity request');

  const baseValue = metricValue(computeModel(base), metric);

  const rows = params.map((param): SensitivityRow => {
    const notes: string[] = [];
    const points = deltas.map((deltaPct): SensitivityPoint => {
      const applied = applyAdjustments(base, [{ target: param, op: 'multiply', value: 1 + deltaPct / 100 }]);
      for (const note of applied.notes) notes.push(`${deltaPct > 0 ? '+' : ''}${deltaPct}%: ${note}`);
      const value = metricValue(computeModel(applied.input), metric);
      return {
        deltaPct,
        value,
        changeFromBase: value !== null && baseValue !== null ? round2(value - baseValue) : null,
      };
    });
    const defined = [baseValue, ...points.map((point) => point.value)].filter((v): v is number => v !== null);
    const min = defined.length > 0 ? Math.min(...defined) : null;
    const max = defined.length > 0 ? Math.max(...defined) : null;
    return {
      param,
      points,
      min,
      max,
      spread: min !== null && max !== null ? round2(max - min) : null,
      hasUndefinedPoint: points.some((point) => point.value === null),
      notes,
    };
  });

  // stable sort: largest spread first, undefined spreads last
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const sa = a.row.spread ?? -1;
      const sb = b.row.spread ?? -1;
      return sb - sa || a.index - b.index;
    })
    .map((entry) => entry.row);

  return {
    engineVersion: ENGINE_VERSION,
    inputHash: hashModelInput(base),
    metric,
    deltasPct: [...deltas],
    base: round2OrNull(baseValue),
    rows: ordered,
  };
}
