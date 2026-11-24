import { z } from 'zod';
import { computeModel } from './engine';
import {
  MAX_HORIZON_MONTHS,
  MAX_PRE_OPERATING_MONTHS,
  ModelValidationError,
  parseModelInput,
  zodIssuesToValidationIssues,
  type ModelInput,
  type RevenueStream,
  type ValidatedModelInput,
  type ValidationIssue,
} from './schema';
import type { ModelResult } from './types';

/**
 * Declarative scenario adjustments.
 *
 * A scenario never touches engine internals: it is a pure transformation
 * `ModelInput -> ModelInput`, and the transformed input is validated and run
 * exactly like any other input (so it has its own `inputHash`).
 */

export const ADJUSTMENT_TARGETS = [
  'volume',
  'price',
  'variable_costs',
  'fixed_costs',
  'staff_costs',
  'capex',
  'ramp_months',
  'pre_operating_months',
  'interest_rate',
  'rent',
] as const;

export type AdjustmentTarget = (typeof ADJUSTMENT_TARGETS)[number];
export type AdjustmentOp = 'multiply' | 'add' | 'set';

const NumericAdjustmentSchema = z
  .object({
    target: z.enum(ADJUSTMENT_TARGETS),
    op: z.enum(['multiply', 'add', 'set']),
    value: z
      .number({ required_error: 'adjustment value is required', invalid_type_error: 'adjustment value must be a number' })
      .finite('adjustment value must be a finite number'),
    /**
     * Optional filter: only items with these keys are adjusted
     * (stream keys for volume/price; cost keys for variable_costs, fixed_costs, rent;
     * staff keys for staff_costs; capex keys for capex). Ignored by the other targets.
     */
    keys: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .superRefine((adjustment, ctx) => {
    if (adjustment.op === 'multiply' && adjustment.value < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'a multiply adjustment must not be negative' });
    }
  });

const ClosureAdjustmentSchema = z
  .object({
    target: z.literal('closure').default('closure'),
    closureAtOperatingMonth: z
      .number()
      .int('closureAtOperatingMonth must be a whole number')
      .min(1, 'closureAtOperatingMonth must be at least 1')
      .max(MAX_HORIZON_MONTHS, `closureAtOperatingMonth must not exceed ${MAX_HORIZON_MONTHS}`),
    assetRecoveryPct: z.number().min(0).max(100),
    refundableDepositRecoveryPct: z.number().min(0).max(100),
    closureCosts: z.number().min(0).default(0),
    workingCapitalRecoveryPct: z.number().min(0).max(100).default(100),
  })
  .strict();

export const AdjustmentSchema = z.union([NumericAdjustmentSchema, ClosureAdjustmentSchema]);

export const SCENARIO_KINDS = ['conservative', 'base', 'optimistic', 'stress', 'failure', 'custom'] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

export const ScenarioSpecSchema = z
  .object({
    key: z.string().min(1, 'scenario key must not be empty'),
    label: z.string().min(1, 'scenario label must not be empty'),
    kind: z.enum(SCENARIO_KINDS),
    description: z.string().optional(),
    adjustments: z.array(AdjustmentSchema).default([]),
  })
  .strict();

export const ScenarioSpecsSchema = z.array(ScenarioSpecSchema).superRefine((specs, ctx) => {
  const seen = new Set<string>();
  specs.forEach((spec, index) => {
    if (seen.has(spec.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'key'], message: `duplicate scenario key "${spec.key}"` });
    }
    seen.add(spec.key);
  });
});

/** What callers write. */
export type Adjustment = z.input<typeof AdjustmentSchema>;
export type NumericAdjustment = z.input<typeof NumericAdjustmentSchema>;
export type ClosureAdjustment = z.input<typeof ClosureAdjustmentSchema>;
export type ScenarioSpec = z.input<typeof ScenarioSpecSchema>;
/** After validation (defaults filled). */
export type ValidatedAdjustment = z.output<typeof AdjustmentSchema>;
export type ValidatedScenarioSpec = z.output<typeof ScenarioSpecSchema>;

export interface ScenarioRun {
  key: string;
  label: string;
  kind: ScenarioKind;
  description: string | null;
  adjustments: ValidatedAdjustment[];
  /** `invalid`: the adjusted input failed validation (e.g. closure month beyond the horizon). */
  status: 'ok' | 'invalid';
  /** Human-readable remarks, e.g. an adjustment that had nothing to act on or a value that was clamped. */
  notes: string[];
  result: ModelResult | null;
  error: { message: string; issues: ValidationIssue[] } | null;
}

// ---------------------------------------------------------------------------
// applying adjustments
// ---------------------------------------------------------------------------

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => deepClone(item) as unknown) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepClone(v);
    return out as T;
  }
  return value;
}

function applyOp(current: number, op: AdjustmentOp, value: number): number {
  switch (op) {
    case 'multiply':
      return current * value;
    case 'add':
      return current + value;
    case 'set':
      return value;
  }
}

/** Name of the driver parameter that a 'volume' adjustment acts on, and whether it is a 0–1 ratio. */
export function volumeParameterOf(kind: RevenueStream['driver']['kind']): { parameter: string; isRatio: boolean } {
  switch (kind) {
    case 'transactions':
      return { parameter: 'transactionsPerDay', isRatio: false };
    case 'capacity_utilization':
      return { parameter: 'utilization', isRatio: true };
    case 'area_yield':
      return { parameter: 'yieldPerAreaPerCycle', isRatio: false };
    case 'enrolment':
      return { parameter: 'enrolmentRate', isRatio: true };
    case 'occupancy':
      return { parameter: 'occupancy', isRatio: true };
    case 'fleet_utilization':
      return { parameter: 'utilization', isRatio: true };
    case 'engagements':
      return { parameter: 'engagementsPerMonth', isRatio: false };
  }
}

/** Name of the driver parameter that a 'price' adjustment acts on. */
export function priceParameterOf(kind: RevenueStream['driver']['kind']): string {
  switch (kind) {
    case 'transactions':
      return 'averageTicket';
    case 'capacity_utilization':
      return 'unitPrice';
    case 'area_yield':
      return 'pricePerUnit';
    case 'enrolment':
      return 'feePerStudentPerMonth';
    case 'occupancy':
      return 'ratePerAreaPerMonth';
    case 'fleet_utilization':
      return 'ratePerUnitPerDay';
    case 'engagements':
      return 'realizedFee';
  }
}

export interface AppliedAdjustments {
  input: ValidatedModelInput;
  notes: string[];
}

function parseAdjustments(adjustments: readonly Adjustment[]): ValidatedAdjustment[] {
  const parsed = z.array(AdjustmentSchema).safeParse(adjustments);
  if (!parsed.success) {
    throw new ModelValidationError(zodIssuesToValidationIssues(parsed.error), 'scenario adjustments');
  }
  return parsed.data;
}

/**
 * Apply adjustments in order to a copy of `input` and re-validate the result.
 * Never mutates `input`. Throws `ModelValidationError` if the adjusted input is invalid.
 *
 * Clamping rules (each clamp is reported in `notes`):
 *  - amounts, prices and volumes never go below 0;
 *  - utilisation-type ratios are kept within [0, 1];
 *  - ramp months are rounded UP to a whole month and kept within [0, 120];
 *  - pre-operating months are rounded to a whole month and kept within [0, 24];
 *  - the interest rate is kept within [0, 100] %.
 */
export function applyAdjustments(input: ModelInput, adjustments: readonly Adjustment[]): AppliedAdjustments {
  const base = parseModelInput(input);
  const validated = parseAdjustments(adjustments);
  const draft = deepClone(base);
  const notes: string[] = [];

  const adjustAmount = (current: number, op: AdjustmentOp, value: number, what: string): number => {
    const next = applyOp(current, op, value);
    if (next < 0) {
      notes.push(`${what}: adjusted value ${next} is negative and was clamped to 0`);
      return 0;
    }
    return next;
  };
  const selected = (keys: string[] | undefined, itemKey: string): boolean => keys === undefined || keys.includes(itemKey);

  for (const adjustment of validated) {
    if (adjustment.target === 'closure') {
      draft.closure = {
        atOperatingMonth: adjustment.closureAtOperatingMonth,
        assetRecoveryPct: adjustment.assetRecoveryPct,
        refundableDepositRecoveryPct: adjustment.refundableDepositRecoveryPct,
        closureCosts: adjustment.closureCosts,
        workingCapitalRecoveryPct: adjustment.workingCapitalRecoveryPct,
      };
      continue;
    }

    const { target, op, value, keys } = adjustment;
    let touched = 0;

    switch (target) {
      case 'volume':
        for (const stream of draft.revenueStreams) {
          if (!selected(keys, stream.key)) continue;
          touched++;
          const { parameter, isRatio } = volumeParameterOf(stream.driver.kind);
          const driver = stream.driver as unknown as Record<string, number>;
          let next = adjustAmount(driver[parameter] as number, op, value, `volume of stream "${stream.key}"`);
          if (isRatio && next > 1) {
            notes.push(
              `volume of stream "${stream.key}": ${parameter} would be ${next}, above 100% of capacity; clamped to 1`,
            );
            next = 1;
          }
          driver[parameter] = next;
        }
        break;
      case 'price':
        for (const stream of draft.revenueStreams) {
          if (!selected(keys, stream.key)) continue;
          touched++;
          const parameter = priceParameterOf(stream.driver.kind);
          const driver = stream.driver as unknown as Record<string, number>;
          driver[parameter] = adjustAmount(driver[parameter] as number, op, value, `price of stream "${stream.key}"`);
        }
        break;
      case 'variable_costs':
        for (const stream of draft.revenueStreams) {
          for (const cost of stream.variableCosts) {
            if (!selected(keys, cost.key)) continue;
            touched++;
            cost.value = adjustAmount(cost.value, op, value, `variable cost "${cost.key}" of stream "${stream.key}"`);
          }
        }
        break;
      case 'fixed_costs':
      case 'rent':
        for (const item of draft.fixedCosts) {
          if (target === 'rent' && item.category !== 'rent') continue;
          if (!selected(keys, item.key)) continue;
          touched++;
          item.monthlyAmount = adjustAmount(item.monthlyAmount, op, value, `fixed cost "${item.key}"`);
        }
        break;
      case 'staff_costs':
        for (const role of draft.staff) {
          if (!selected(keys, role.key)) continue;
          touched++;
          role.monthlySalary = adjustAmount(role.monthlySalary, op, value, `salary of staff "${role.key}"`);
        }
        break;
      case 'capex':
        for (const item of draft.capex) {
          if (!selected(keys, item.key)) continue;
          touched++;
          item.amount = adjustAmount(item.amount, op, value, `capex "${item.key}"`);
        }
        break;
      case 'ramp_months': {
        touched++;
        const current = draft.rampUp.monthsToSteadyState;
        const raw = applyOp(current, op, value);
        // the small epsilon keeps e.g. 6 × 1.5 = 9.000000000000002 from being rounded up to 10
        const next = Math.min(MAX_HORIZON_MONTHS, Math.max(0, Math.ceil(raw - 1e-9)));
        if (next !== raw) notes.push(`ramp_months: ${raw} adjusted to ${next} (whole months within 0–${MAX_HORIZON_MONTHS})`);
        if (next === current) notes.push('ramp_months: the adjustment did not change monthsToSteadyState');
        draft.rampUp.monthsToSteadyState = next;
        break;
      }
      case 'pre_operating_months': {
        touched++;
        const raw = applyOp(draft.preOperatingMonths, op, value);
        const next = Math.min(MAX_PRE_OPERATING_MONTHS, Math.max(0, Math.round(raw)));
        if (next !== raw) {
          notes.push(`pre_operating_months: ${raw} adjusted to ${next} (whole months within 0–${MAX_PRE_OPERATING_MONTHS})`);
        }
        draft.preOperatingMonths = next;
        if (!draft.fixedCosts.some((item) => item.accruesDuringPreOperating && item.monthlyAmount > 0) && !draft.financing?.loan) {
          notes.push(
            'pre_operating_months: no fixed cost is flagged accruesDuringPreOperating and there is no loan, so a longer pre-operating period adds no cost in this model',
          );
        }
        break;
      }
      case 'interest_rate': {
        const loan = draft.financing?.loan;
        if (loan) {
          touched++;
          const raw = applyOp(loan.annualInterestPct, op, value);
          const next = Math.min(100, Math.max(0, raw));
          if (next !== raw) notes.push(`interest_rate: ${raw}% clamped to ${next}%`);
          loan.annualInterestPct = next;
        }
        break;
      }
    }

    if (touched === 0) {
      notes.push(
        `${target}: nothing to adjust${keys ? ` for keys ${keys.map((k) => `"${k}"`).join(', ')}` : ''} — this adjustment had no effect`,
      );
    }
  }

  return { input: parseModelInput(draft), notes };
}

/**
 * Pure: returns a new, validated input with `overrides` applied in order; `input` is not mutated.
 * Use `applyAdjustments` to also get the clamping / no-effect notes.
 */
export function applyOverrides(input: ModelInput, overrides: readonly Adjustment[]): ValidatedModelInput {
  return applyAdjustments(input, overrides).input;
}

// ---------------------------------------------------------------------------
// default scenario sets — ILLUSTRATIVE SHOCKS, NOT FORECASTS
// ---------------------------------------------------------------------------

const ILLUSTRATIVE = 'Illustrative shock, not a forecast and not based on data about any business.';

export const DEFAULT_SCENARIOS: readonly ScenarioSpec[] = [
  {
    key: 'conservative',
    label: 'Conservative (illustrative shocks)',
    kind: 'conservative',
    description: `Sales volume −15%, variable, fixed and staff costs +5%, ramp-up takes 1.5× as long. ${ILLUSTRATIVE}`,
    adjustments: [
      { target: 'volume', op: 'multiply', value: 0.85 },
      { target: 'variable_costs', op: 'multiply', value: 1.05 },
      { target: 'fixed_costs', op: 'multiply', value: 1.05 },
      { target: 'staff_costs', op: 'multiply', value: 1.05 },
      { target: 'ramp_months', op: 'multiply', value: 1.5 },
    ],
  },
  {
    key: 'base',
    label: 'Base (inputs as given)',
    kind: 'base',
    description: 'The inputs exactly as supplied, with no adjustment.',
    adjustments: [],
  },
  {
    key: 'optimistic',
    label: 'Optimistic (illustrative shocks)',
    kind: 'optimistic',
    description: `Sales volume +10% (capped at 100% of capacity), ramp-up takes 0.75× as long. ${ILLUSTRATIVE}`,
    adjustments: [
      { target: 'volume', op: 'multiply', value: 1.1 },
      { target: 'ramp_months', op: 'multiply', value: 0.75 },
    ],
  },
];

const stress = (key: string, label: string, description: string, adjustments: Adjustment[]): ScenarioSpec => ({
  key,
  label: `${label} (illustrative stress test)`,
  kind: 'stress',
  description: `${description} ${ILLUSTRATIVE}`,
  adjustments,
});

const failure = (month: number): ScenarioSpec => ({
  key: `failure_closure_month_${month}`,
  label: `Business closes after operating month ${month} (illustrative failure case)`,
  kind: 'failure',
  description: `Operations stop at the end of operating month ${month}; fixed assets are sold at 50% of depreciated book value, refundable deposits are returned in full, inventory and receivables are realised in full, the loan balance is repaid. ${ILLUSTRATIVE}`,
  adjustments: [
    {
      target: 'closure',
      closureAtOperatingMonth: month,
      assetRecoveryPct: 50,
      refundableDepositRecoveryPct: 100,
      closureCosts: 0,
      workingCapitalRecoveryPct: 100,
    },
  ],
});

export const DEFAULT_STRESS_TESTS: readonly ScenarioSpec[] = [
  stress('stress_revenue_minus_20', 'Revenue −20% through lower sales volume', 'Sales volume is 20% below the input in every month.', [
    { target: 'volume', op: 'multiply', value: 0.8 },
  ]),
  stress('stress_revenue_minus_35', 'Revenue −35% through lower sales volume', 'Sales volume is 35% below the input in every month.', [
    { target: 'volume', op: 'multiply', value: 0.65 },
  ]),
  stress('stress_price_minus_10', 'Selling prices −10%', 'All selling prices are 10% below the input; volumes and unit costs unchanged.', [
    { target: 'price', op: 'multiply', value: 0.9 },
  ]),
  stress('stress_rent_plus_25', 'Rent +25%', 'Every fixed cost of category "rent" is 25% above the input.', [
    { target: 'rent', op: 'multiply', value: 1.25 },
  ]),
  stress('stress_variable_costs_plus_15', 'Variable costs +15%', 'Every variable cost (per-unit and %-of-revenue) is 15% above the input.', [
    { target: 'variable_costs', op: 'multiply', value: 1.15 },
  ]),
  stress('stress_launch_delayed_3_months', 'Launch delayed by 3 months', 'Three additional pre-operating months: flagged fixed costs and loan interest accrue for longer before any revenue.', [
    { target: 'pre_operating_months', op: 'add', value: 3 },
  ]),
  stress('stress_ramp_twice_as_long', 'Ramp-up takes twice as long', 'The number of months needed to reach steady-state volume is doubled.', [
    { target: 'ramp_months', op: 'multiply', value: 2 },
  ]),
  stress('stress_interest_plus_3_points', 'Loan interest rate +3 percentage points', 'The annual loan interest rate is 3 percentage points above the input.', [
    { target: 'interest_rate', op: 'add', value: 3 },
  ]),
  failure(12),
  failure(24),
];

// ---------------------------------------------------------------------------
// running scenarios
// ---------------------------------------------------------------------------

/**
 * Run every scenario against `input`. The base input must be valid (throws otherwise);
 * a scenario whose ADJUSTED input is invalid is returned with `status: 'invalid'`
 * instead of failing the whole batch.
 */
export function runScenarios(input: ModelInput, scenarios: readonly ScenarioSpec[] = DEFAULT_SCENARIOS): ScenarioRun[] {
  const base = parseModelInput(input);
  const parsedSpecs = ScenarioSpecsSchema.safeParse(scenarios);
  if (!parsedSpecs.success) {
    throw new ModelValidationError(zodIssuesToValidationIssues(parsedSpecs.error), 'scenario specification');
  }

  return parsedSpecs.data.map((spec): ScenarioRun => {
    const common = {
      key: spec.key,
      label: spec.label,
      kind: spec.kind,
      description: spec.description ?? null,
      adjustments: spec.adjustments,
    };
    try {
      const applied = applyAdjustments(base, spec.adjustments);
      return { ...common, status: 'ok', notes: applied.notes, result: computeModel(applied.input), error: null };
    } catch (error) {
      if (error instanceof ModelValidationError) {
        return {
          ...common,
          status: 'invalid',
          notes: [],
          result: null,
          error: { message: error.message, issues: error.issues },
        };
      }
      throw error;
    }
  });
}
