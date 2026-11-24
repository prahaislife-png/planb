import { z } from 'zod';

/**
 * Input schema for the PlanB financial model.
 *
 * Conventions
 *  - All money amounts are INR as plain numbers, never negative.
 *  - Rates named `...Pct` are percentages: `12` means 12 %.
 *  - Utilisation-type ratios (`utilization`, `enrolmentRate`, `occupancy`) are FRACTIONS in [0, 1].
 *  - Unknown keys are rejected everywhere (a misspelt key must never be silently ignored).
 */

/** Upper bound for any single amount: ₹1 lakh crore. Guards against unit mistakes and overflow. */
export const MAX_AMOUNT = 1e12;

export const MIN_HORIZON_MONTHS = 12;
export const MAX_HORIZON_MONTHS = 120;
export const MAX_PRE_OPERATING_MONTHS = 24;
/** Pre-operative expenses and contingency are amortised over this many months (or the horizon if shorter). */
export const PRE_OPERATIVE_AMORTISATION_MONTHS = 60;

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

const num = (what: string) =>
  z
    .number({
      required_error: `${what} is required`,
      invalid_type_error: `${what} must be a number`,
    })
    .finite(`${what} must be a finite number`);

const amount = (what: string) =>
  num(what)
    .min(0, `${what} must not be negative`)
    .max(MAX_AMOUNT, `${what} must not exceed ${MAX_AMOUNT}`);

const quantity = (what: string) =>
  num(what)
    .min(0, `${what} must not be negative`)
    .max(MAX_AMOUNT, `${what} must not exceed ${MAX_AMOUNT}`);

const pct0to100 = (what: string) =>
  num(what)
    .min(0, `${what} must be between 0 and 100 (percent)`)
    .max(100, `${what} must be between 0 and 100 (percent)`);

const fraction = (what: string) =>
  num(what)
    .min(0, `${what} must be a fraction between 0 and 1 (e.g. 0.65 for 65 %)`)
    .max(1, `${what} must be a fraction between 0 and 1 (e.g. 0.65 for 65 %), not a percentage`);

const annualChangePct = (what: string) =>
  num(what)
    .min(-50, `${what} must be between -50 and 100 (percent per year)`)
    .max(100, `${what} must be between -50 and 100 (percent per year)`);

const daysPerMonth = (what: string) =>
  num(what)
    .min(0, `${what} must be between 0 and 31`)
    .max(31, `${what} must be between 0 and 31`);

const days = (what: string) =>
  num(what)
    .min(0, `${what} must be between 0 and 365 days`)
    .max(365, `${what} must be between 0 and 365 days`);

const intInRange = (what: string, min: number, max: number) =>
  num(what)
    .int(`${what} must be a whole number`)
    .min(min, `${what} must be between ${min} and ${max}`)
    .max(max, `${what} must be between ${min} and ${max}`);

const key = z
  .string({ required_error: 'key is required', invalid_type_error: 'key must be a string' })
  .min(1, 'key must not be empty')
  .max(100, 'key must be at most 100 characters');

const label = z
  .string({ required_error: 'label is required', invalid_type_error: 'label must be a string' })
  .min(1, 'label must not be empty')
  .max(300, 'label must be at most 300 characters');

export const CostClassificationSchema = z.enum(['cogs', 'operating']);

// ---------------------------------------------------------------------------
// investment
// ---------------------------------------------------------------------------

export const CAPEX_CATEGORIES = [
  'land',
  'building_civil',
  'interiors',
  'machinery',
  'equipment',
  'furniture',
  'vehicle',
  'it',
  'other',
] as const;

export const CapexItemSchema = z
  .object({
    key,
    label,
    amount: amount('capex amount'),
    category: z.enum(CAPEX_CATEGORIES),
    /** Useful life in years; must be a whole number of months (e.g. 2.5 = 30 months). */
    usefulLifeYears: num('usefulLifeYears')
      .positive('usefulLifeYears must be greater than 0')
      .max(100, 'usefulLifeYears must not exceed 100')
      .refine(
        (years) => Math.abs(years * 12 - Math.round(years * 12)) < 1e-9 && Math.round(years * 12) >= 1,
        'usefulLifeYears must correspond to a whole number of months (e.g. 5, 2.5)',
      )
      .optional(),
    /** Salvage (resale) value at end of life, as % of cost. Default 0. */
    salvagePct: pct0to100('salvagePct').optional(),
    /** Default: true when the item is depreciable and has a useful life. */
    replaceAtEndOfLife: z.boolean().optional(),
    /** Default: false for land, true for everything else. */
    depreciable: z.boolean().optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.category === 'land' && item.depreciable === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['depreciable'],
        message: 'land is not depreciable',
      });
    }
    const depreciable = item.depreciable ?? item.category !== 'land';
    if (item.replaceAtEndOfLife === true && (!depreciable || item.usefulLifeYears === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replaceAtEndOfLife'],
        message: 'replaceAtEndOfLife requires a depreciable item with usefulLifeYears',
      });
    }
  })
  .transform((item) => {
    const depreciable = item.depreciable ?? item.category !== 'land';
    return {
      ...item,
      depreciable,
      salvagePct: item.salvagePct ?? 0,
      replaceAtEndOfLife: item.replaceAtEndOfLife ?? (depreciable && item.usefulLifeYears !== undefined),
    };
  });

export const PreOperativeExpenseSchema = z
  .object({ key, label, amount: amount('pre-operative expense amount') })
  .strict();

export const DepositSchema = z
  .object({
    key,
    label,
    amount: amount('deposit amount'),
    refundable: z.boolean({
      required_error: 'refundable is required',
      invalid_type_error: 'refundable must be true or false',
    }),
  })
  .strict();

// ---------------------------------------------------------------------------
// revenue
// ---------------------------------------------------------------------------

export const VariableCostSchema = z
  .object({
    key,
    label,
    basis: z.enum(['per_unit', 'pct_of_revenue']),
    /** `per_unit`: INR per unit sold. `pct_of_revenue`: percent of the stream's revenue. */
    value: num('variable cost value')
      .min(0, 'variable cost value must not be negative')
      .max(MAX_AMOUNT, `variable cost value must not exceed ${MAX_AMOUNT}`),
    classification: CostClassificationSchema,
  })
  .strict()
  .superRefine((cost, ctx) => {
    if (cost.basis === 'pct_of_revenue' && cost.value > 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'a pct_of_revenue variable cost must be a percentage between 0 and 1000',
      });
    }
  });

const TransactionsDriverSchema = z
  .object({
    kind: z.literal('transactions'),
    transactionsPerDay: quantity('transactionsPerDay'),
    operatingDaysPerMonth: daysPerMonth('operatingDaysPerMonth'),
    averageTicket: amount('averageTicket'),
  })
  .strict();

const CapacityUtilizationDriverSchema = z
  .object({
    kind: z.literal('capacity_utilization'),
    capacityUnitsPerMonth: quantity('capacityUnitsPerMonth'),
    utilization: fraction('utilization'),
    unitPrice: amount('unitPrice'),
  })
  .strict();

const AreaYieldDriverSchema = z
  .object({
    kind: z.literal('area_yield'),
    area: quantity('area'),
    yieldPerAreaPerCycle: quantity('yieldPerAreaPerCycle'),
    pricePerUnit: amount('pricePerUnit'),
    /** Calendar months (1 = January … 12 = December) in which one full cycle is harvested and sold. */
    harvestCalendarMonths: z
      .array(intInRange('harvest calendar month', 1, 12))
      .min(1, 'harvestCalendarMonths must list at least one calendar month')
      .max(12, 'harvestCalendarMonths can list at most 12 calendar months')
      .refine((months) => new Set(months).size === months.length, 'harvestCalendarMonths must not contain duplicates'),
  })
  .strict();

const EnrolmentDriverSchema = z
  .object({
    kind: z.literal('enrolment'),
    capacityStudents: quantity('capacityStudents'),
    enrolmentRate: fraction('enrolmentRate'),
    feePerStudentPerMonth: amount('feePerStudentPerMonth'),
  })
  .strict();

const OccupancyDriverSchema = z
  .object({
    kind: z.literal('occupancy'),
    rentableArea: quantity('rentableArea'),
    occupancy: fraction('occupancy'),
    ratePerAreaPerMonth: amount('ratePerAreaPerMonth'),
  })
  .strict();

const FleetUtilizationDriverSchema = z
  .object({
    kind: z.literal('fleet_utilization'),
    unitCount: quantity('unitCount'),
    billableDaysPerMonth: daysPerMonth('billableDaysPerMonth'),
    utilization: fraction('utilization'),
    ratePerUnitPerDay: amount('ratePerUnitPerDay'),
  })
  .strict();

const EngagementsDriverSchema = z
  .object({
    kind: z.literal('engagements'),
    engagementsPerMonth: quantity('engagementsPerMonth'),
    realizedFee: amount('realizedFee'),
  })
  .strict();

export const DriverSchema = z.discriminatedUnion('kind', [
  TransactionsDriverSchema,
  CapacityUtilizationDriverSchema,
  AreaYieldDriverSchema,
  EnrolmentDriverSchema,
  OccupancyDriverSchema,
  FleetUtilizationDriverSchema,
  EngagementsDriverSchema,
]);

export const DRIVER_KINDS = [
  'transactions',
  'capacity_utilization',
  'area_yield',
  'enrolment',
  'occupancy',
  'fleet_utilization',
  'engagements',
] as const;

export const RevenueStreamSchema = z
  .object({
    key,
    label,
    driver: DriverSchema,
    variableCosts: z.array(VariableCostSchema).default([]),
    /** Credit period given to customers of this stream; overrides `workingCapital.receivableDays`. */
    paymentTermsDays: days('paymentTermsDays').optional(),
  })
  .strict();

export const RampUpSchema = z
  .object({
    /** Volume in operating month 1 as % of steady state. */
    startPct: pct0to100('rampUp.startPct'),
    /** Number of operating months spent below steady state; month `monthsToSteadyState + 1` is the first at 100 %. */
    monthsToSteadyState: intInRange('rampUp.monthsToSteadyState', 0, MAX_HORIZON_MONTHS),
    applyToAreaYield: z.boolean().default(false),
  })
  .strict();

export const SeasonalitySchema = z
  .object({
    /** 12 volume multipliers, index 0 = January … index 11 = December. */
    multipliers: z
      .array(
        num('seasonality multiplier')
          .min(0, 'seasonality multipliers must not be negative')
          .max(10, 'seasonality multipliers must not exceed 10'),
      )
      .length(12, 'seasonality.multipliers must contain exactly 12 values (January … December)'),
  })
  .strict();

// ---------------------------------------------------------------------------
// costs
// ---------------------------------------------------------------------------

export const FIXED_COST_CATEGORIES = [
  'rent',
  'utilities',
  'marketing',
  'insurance',
  'maintenance',
  'admin',
  'transport',
  'licence_renewal',
  'other',
] as const;

export const FixedCostSchema = z
  .object({
    key,
    label,
    category: z.enum(FIXED_COST_CATEGORIES),
    monthlyAmount: amount('monthlyAmount'),
    /** If omitted the item follows `costInflationPctAnnual`. */
    annualEscalationPct: annualChangePct('annualEscalationPct').optional(),
    /** When true the cost is also paid in every pre-operating month (e.g. rent during fit-out). */
    accruesDuringPreOperating: z.boolean().default(false),
    classification: CostClassificationSchema,
  })
  .strict();

export const StaffSchema = z
  .object({
    key,
    role: label,
    count: quantity('staff count'),
    monthlySalary: amount('monthlySalary'),
    /** If omitted the role follows `costInflationPctAnnual`. */
    annualEscalationPct: annualChangePct('annualEscalationPct').optional(),
    classification: CostClassificationSchema,
    /** Number of pre-operating months (counted back from opening) in which this role is already paid. */
    startsPreOperatingMonthsBefore: intInRange('startsPreOperatingMonthsBefore', 0, MAX_PRE_OPERATING_MONTHS).default(0),
  })
  .strict();

export const OwnerSchema = z
  .object({
    /** What the owner intends to take out of the business each operating month. */
    monthlyCompensation: amount('owner.monthlyCompensation'),
    /**
     * `salary_expense`: deducted before profit and tax (company-style).
     * `drawings`: not an expense for profit/tax (proprietorship-style); only a cash outflow.
     */
    treatment: z.enum(['salary_expense', 'drawings']),
    /** Stepwise annual escalation of owner compensation. Default 0 (NOT linked to cost inflation). */
    annualEscalationPct: annualChangePct('owner.annualEscalationPct').default(0),
  })
  .strict();

export const WorkingCapitalSchema = z
  .object({
    inventoryDays: days('inventoryDays').default(0),
    receivableDays: days('receivableDays').default(0),
    payableDays: days('payableDays').default(0),
  })
  .strict();

// ---------------------------------------------------------------------------
// financing, tax, closure
// ---------------------------------------------------------------------------

export const LoanSchema = z
  .object({
    principal: amount('loan.principal').positive('loan.principal must be greater than 0 (omit the loan otherwise)'),
    annualInterestPct: pct0to100('loan.annualInterestPct'),
    /** Total loan life in OPERATING months, including the moratorium. */
    tenureMonths: intInRange('loan.tenureMonths', 1, 360),
    /** Interest-only operating months at the start of the tenure. */
    moratoriumMonths: intInRange('loan.moratoriumMonths', 0, 359).default(0),
    disbursedAtStart: z.literal(true).default(true),
  })
  .strict()
  .superRefine((loan, ctx) => {
    if (loan.moratoriumMonths >= loan.tenureMonths) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['moratoriumMonths'],
        message: 'loan.moratoriumMonths must be smaller than loan.tenureMonths',
      });
    }
  });

export const SubsidySchema = z
  .object({
    amount: amount('subsidy.amount'),
    receivedOperatingMonth: intInRange('subsidy.receivedOperatingMonth', 1, MAX_HORIZON_MONTHS),
    treatment: z.enum(['reduces_loan_principal', 'cash_inflow']),
  })
  .strict();

export const FinancingSchema = z
  .object({
    loan: LoanSchema.optional(),
    subsidy: SubsidySchema.optional(),
  })
  .strict();

export const TaxSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('none'),
      /** Accepted for convenience but ignored when kind is 'none'. */
      ratePct: pct0to100('tax.ratePct').optional(),
      carryForwardLosses: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('flat_rate'),
      ratePct: pct0to100('tax.ratePct'),
      carryForwardLosses: z.boolean().default(true),
    })
    .strict(),
]);

export const ClosureSchema = z
  .object({
    /** Operations run through this operating month, then the business is wound up at its end. */
    atOperatingMonth: intInRange('closure.atOperatingMonth', 1, MAX_HORIZON_MONTHS),
    /** Sale proceeds of fixed assets as % of their depreciated (net) book value at closure. */
    assetRecoveryPct: pct0to100('closure.assetRecoveryPct'),
    /** % of refundable deposits actually returned. */
    refundableDepositRecoveryPct: pct0to100('closure.refundableDepositRecoveryPct'),
    /** One-off cash costs of closing (notice pay, restoration, penalties). */
    closureCosts: amount('closure.closureCosts').default(0),
    /** % of inventory + receivables converted to cash at closure (payables are always paid in full). */
    workingCapitalRecoveryPct: pct0to100('closure.workingCapitalRecoveryPct').default(100),
  })
  .strict();

// ---------------------------------------------------------------------------
// model input
// ---------------------------------------------------------------------------

function uniqueKeys(
  ctx: z.RefinementCtx,
  items: ReadonlyArray<{ key: string }>,
  path: string,
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path, index, 'key'],
        message: `duplicate key "${item.key}" in ${path}; keys must be unique`,
      });
    }
    seen.add(item.key);
  });
}

export const ModelInputSchema = z
  .object({
    /** Number of operating months modelled. */
    horizonMonths: intInRange('horizonMonths', MIN_HORIZON_MONTHS, MAX_HORIZON_MONTHS).default(60),
    /** Setup months before opening: no revenue; flagged fixed costs, early staff and loan interest accrue. */
    preOperatingMonths: intInRange('preOperatingMonths', 0, MAX_PRE_OPERATING_MONTHS).default(0),
    /** Calendar month (1 = January … 12 = December) of operating month 1. */
    startCalendarMonth: intInRange('startCalendarMonth', 1, 12).default(1),

    capex: z.array(CapexItemSchema).default([]),
    preOperativeExpenses: z.array(PreOperativeExpenseSchema).default([]),
    deposits: z.array(DepositSchema).default([]),
    /** Contingency reserve as % of total capex; assumed fully spent. */
    contingencyPct: pct0to100('contingencyPct').default(0),

    revenueStreams: z.array(RevenueStreamSchema).min(1, 'at least one revenue stream is required'),
    rampUp: RampUpSchema.default({ startPct: 100, monthsToSteadyState: 0 }),
    seasonality: SeasonalitySchema.optional(),

    fixedCosts: z.array(FixedCostSchema).default([]),
    staff: z.array(StaffSchema).default([]),
    owner: OwnerSchema,

    /** Stepwise annual escalation of all selling prices, applied at each 12-month anniversary of opening. */
    priceEscalationPctAnnual: annualChangePct('priceEscalationPctAnnual').default(0),
    /** Stepwise annual inflation of per-unit variable costs, and of fixed/staff costs without their own escalation. */
    costInflationPctAnnual: annualChangePct('costInflationPctAnnual').default(0),

    workingCapital: WorkingCapitalSchema.default({}),
    financing: FinancingSchema.optional(),
    tax: TaxSchema.default({ kind: 'none' }),
    closure: ClosureSchema.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    uniqueKeys(ctx, input.capex, 'capex');
    uniqueKeys(ctx, input.preOperativeExpenses, 'preOperativeExpenses');
    uniqueKeys(ctx, input.deposits, 'deposits');
    uniqueKeys(ctx, input.revenueStreams, 'revenueStreams');
    uniqueKeys(ctx, input.fixedCosts, 'fixedCosts');
    uniqueKeys(ctx, input.staff, 'staff');
    input.revenueStreams.forEach((stream, index) => {
      const seen = new Set<string>();
      stream.variableCosts.forEach((cost, costIndex) => {
        if (seen.has(cost.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['revenueStreams', index, 'variableCosts', costIndex, 'key'],
            message: `duplicate key "${cost.key}" in variableCosts of stream "${stream.key}"`,
          });
        }
        seen.add(cost.key);
      });
    });
    if (input.closure && input.closure.atOperatingMonth > input.horizonMonths) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['closure', 'atOperatingMonth'],
        message: `closure.atOperatingMonth (${input.closure.atOperatingMonth}) must not exceed horizonMonths (${input.horizonMonths})`,
      });
    }
    const subsidy = input.financing?.subsidy;
    if (subsidy && subsidy.receivedOperatingMonth > input.horizonMonths) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['financing', 'subsidy', 'receivedOperatingMonth'],
        message: `subsidy.receivedOperatingMonth (${subsidy.receivedOperatingMonth}) must not exceed horizonMonths (${input.horizonMonths})`,
      });
    }
  });

/** What callers write: defaults may be omitted. */
export type ModelInput = z.input<typeof ModelInputSchema>;
/** Fully validated input with every default made explicit. This is what gets hashed. */
export type ValidatedModelInput = z.output<typeof ModelInputSchema>;

export type CapexItem = ValidatedModelInput['capex'][number];
export type CapexCategory = (typeof CAPEX_CATEGORIES)[number];
export type RevenueStream = ValidatedModelInput['revenueStreams'][number];
export type Driver = RevenueStream['driver'];
export type DriverKind = Driver['kind'];
export type VariableCost = RevenueStream['variableCosts'][number];
export type FixedCost = ValidatedModelInput['fixedCosts'][number];
export type FixedCostCategory = (typeof FIXED_COST_CATEGORIES)[number];
export type StaffRole = ValidatedModelInput['staff'][number];
export type Owner = ValidatedModelInput['owner'];
export type Loan = NonNullable<NonNullable<ValidatedModelInput['financing']>['loan']>;
export type Subsidy = NonNullable<NonNullable<ValidatedModelInput['financing']>['subsidy']>;
export type TaxConfig = ValidatedModelInput['tax'];
export type Closure = NonNullable<ValidatedModelInput['closure']>;
export type CostClassification = z.infer<typeof CostClassificationSchema>;

// ---------------------------------------------------------------------------
// validation entry points
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  /** Dot/bracket path into the input, e.g. `revenueStreams[0].driver.utilization`. */
  path: string;
  message: string;
}

/** Thrown for any invalid input. `issues` lists every problem found. */
export class ModelValidationError extends Error {
  readonly code = 'INVALID_INPUT' as const;
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[], what = 'model input') {
    const first = issues[0];
    const summary = first ? `${first.path ? `${first.path}: ` : ''}${first.message}` : 'unknown validation error';
    const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : '';
    super(`Invalid ${what}: ${summary}${more}`);
    this.name = 'ModelValidationError';
    this.issues = issues;
  }
}

export function formatIssuePath(path: ReadonlyArray<string | number>): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? part : `.${part}`;
  }
  return out;
}

export function zodIssuesToValidationIssues(error: z.ZodError): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const visit = (issue: z.ZodIssue): void => {
    if (issue.code === 'invalid_union' && issue.unionErrors.length > 0) {
      for (const unionError of issue.unionErrors) unionError.issues.forEach(visit);
      return;
    }
    issues.push({ path: formatIssuePath(issue.path), message: issue.message });
  };
  error.issues.forEach(visit);
  return issues;
}

/** Validate raw data and return the normalised input, or throw `ModelValidationError`. */
export function parseModelInput(raw: unknown): ValidatedModelInput {
  const parsed = ModelInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ModelValidationError(zodIssuesToValidationIssues(parsed.error));
  }
  return parsed.data;
}

/** Non-throwing variant of `parseModelInput`. */
export function validateModelInput(
  raw: unknown,
): { ok: true; input: ValidatedModelInput } | { ok: false; issues: ValidationIssue[] } {
  const parsed = ModelInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: zodIssuesToValidationIssues(parsed.error) };
  return { ok: true, input: parsed.data };
}
