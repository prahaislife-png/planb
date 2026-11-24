import { describe, expect, it } from 'vitest';
import {
  ModelInputSchema,
  ModelValidationError,
  parseModelInput,
  runModel,
  validateModelInput,
  type ModelInput,
} from '../src/index';
import { ALL_SYNTHETIC, SYNTHETIC_CAFE, SYNTHETIC_MANUFACTURING, SYNTHETIC_MINIMAL } from './fixtures';
import { clone } from './helpers';

/** Runs the model on deliberately broken input and returns the validation issues. */
function issuesOf(input: unknown): Array<{ path: string; message: string }> {
  try {
    runModel(input as ModelInput);
  } catch (error) {
    expect(error).toBeInstanceOf(ModelValidationError);
    return (error as ModelValidationError).issues;
  }
  throw new Error('expected runModel to throw a ModelValidationError');
}

/** Apply a mutation to a deep copy of a fixture. */
function mutated<T extends ModelInput>(input: T, mutate: (draft: any) => void): unknown {
  const draft = clone(input);
  mutate(draft);
  return draft;
}

describe('input validation', () => {
  it('accepts every synthetic fixture and fills defaults', () => {
    for (const input of Object.values(ALL_SYNTHETIC)) {
      expect(ModelInputSchema.safeParse(input).success).toBe(true);
    }
    const parsed = parseModelInput(SYNTHETIC_MINIMAL);
    expect(parsed).toMatchObject({
      horizonMonths: 60,
      preOperatingMonths: 0,
      startCalendarMonth: 1,
      capex: [],
      preOperativeExpenses: [],
      deposits: [],
      contingencyPct: 0,
      rampUp: { startPct: 100, monthsToSteadyState: 0, applyToAreaYield: false },
      fixedCosts: [],
      staff: [],
      owner: { monthlyCompensation: 0, treatment: 'drawings', annualEscalationPct: 0 },
      priceEscalationPctAnnual: 0,
      costInflationPctAnnual: 0,
      workingCapital: { inventoryDays: 0, receivableDays: 0, payableDays: 0 },
      tax: { kind: 'none' },
    });
    expect(parsed.revenueStreams[0]?.variableCosts).toEqual([]);
  });

  it('fills capex defaults: land is not depreciable, items with a life are replaced', () => {
    const parsed = parseModelInput({
      ...SYNTHETIC_MINIMAL,
      capex: [
        { key: 'land', label: 'SYNTHETIC land', amount: 1, category: 'land' },
        { key: 'm', label: 'SYNTHETIC machine', amount: 1, category: 'machinery', usefulLifeYears: 5 },
        { key: 'x', label: 'SYNTHETIC misc', amount: 1, category: 'other' },
      ],
    });
    expect(parsed.capex[0]).toMatchObject({ depreciable: false, salvagePct: 0, replaceAtEndOfLife: false });
    expect(parsed.capex[1]).toMatchObject({ depreciable: true, salvagePct: 0, replaceAtEndOfLife: true });
    expect(parsed.capex[2]).toMatchObject({ depreciable: true, replaceAtEndOfLife: false });
  });

  it('a validated input is itself valid and stable (idempotent)', () => {
    for (const input of Object.values(ALL_SYNTHETIC)) {
      const once = parseModelInput(input);
      const twice = parseModelInput(once);
      expect(twice).toEqual(once);
    }
  });

  it('rejects negative amounts with a clear message and path', () => {
    const issues = issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.capex[0].amount = -1)));
    expect(issues).toEqual([{ path: 'capex[0].amount', message: 'capex amount must not be negative' }]);

    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.fixedCosts[1].monthlyAmount = -5)))[0]).toEqual({
      path: 'fixedCosts[1].monthlyAmount',
      message: 'monthlyAmount must not be negative',
    });
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.staff[0].monthlySalary = -1)))[0]?.path).toBe('staff[0].monthlySalary');
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.owner.monthlyCompensation = -1)))[0]?.message).toBe(
      'owner.monthlyCompensation must not be negative',
    );
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.deposits[0].amount = -1)))[0]?.path).toBe('deposits[0].amount');
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.preOperativeExpenses[0].amount = -1)))[0]?.path).toBe('preOperativeExpenses[0].amount');
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.revenueStreams[0].driver.averageTicket = -200)))[0]).toEqual({
      path: 'revenueStreams[0].driver.averageTicket',
      message: 'averageTicket must not be negative',
    });
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.revenueStreams[0].variableCosts[0].value = -1)))[0]?.path).toBe(
      'revenueStreams[0].variableCosts[0].value',
    );
    expect(issuesOf(mutated(SYNTHETIC_MANUFACTURING, (d) => (d.financing.loan.principal = -1)))[0]?.path).toBe('financing.loan.principal');
    expect(issuesOf(mutated(SYNTHETIC_MANUFACTURING, (d) => (d.financing.subsidy.amount = -1)))[0]?.path).toBe('financing.subsidy.amount');
  });

  it('rejects utilisation-type ratios above 1 (a percentage was probably entered)', () => {
    const issues = issuesOf(mutated(SYNTHETIC_MANUFACTURING, (d) => (d.revenueStreams[0].driver.utilization = 80)));
    expect(issues).toEqual([
      {
        path: 'revenueStreams[0].driver.utilization',
        message: 'utilization must be a fraction between 0 and 1 (e.g. 0.65 for 65 %), not a percentage',
      },
    ]);
    const stream = (driver: unknown) => ({ ...SYNTHETIC_MINIMAL, revenueStreams: [{ key: 's', label: 'SYNTHETIC', driver }] });
    expect(issuesOf(stream({ kind: 'enrolment', capacityStudents: 100, enrolmentRate: 1.2, feePerStudentPerMonth: 1 }))[0]?.path).toBe(
      'revenueStreams[0].driver.enrolmentRate',
    );
    expect(issuesOf(stream({ kind: 'occupancy', rentableArea: 100, occupancy: 1.01, ratePerAreaPerMonth: 1 }))[0]?.path).toBe(
      'revenueStreams[0].driver.occupancy',
    );
    expect(issuesOf(stream({ kind: 'fleet_utilization', unitCount: 1, billableDaysPerMonth: 20, utilization: 2, ratePerUnitPerDay: 1 }))[0]?.path).toBe(
      'revenueStreams[0].driver.utilization',
    );
    expect(issuesOf(stream({ kind: 'capacity_utilization', capacityUnitsPerMonth: 1, utilization: -0.1, unitPrice: 1 }))[0]?.path).toBe(
      'revenueStreams[0].driver.utilization',
    );
  });

  it('rejects out-of-range horizon, pre-operating months and calendar month', () => {
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, horizonMonths: 11 })[0]).toEqual({ path: 'horizonMonths', message: 'horizonMonths must be between 12 and 120' });
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, horizonMonths: 121 })[0]?.path).toBe('horizonMonths');
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, horizonMonths: 24.5 })[0]?.message).toBe('horizonMonths must be a whole number');
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, preOperatingMonths: 25 })[0]?.message).toBe('preOperatingMonths must be between 0 and 24');
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, preOperatingMonths: -1 })[0]?.path).toBe('preOperatingMonths');
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, startCalendarMonth: 13 })[0]?.path).toBe('startCalendarMonth');
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, startCalendarMonth: 0 })[0]?.path).toBe('startCalendarMonth');
  });

  it('rejects percentages outside their range', () => {
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, contingencyPct: 101 })[0]?.message).toBe('contingencyPct must be between 0 and 100 (percent)');
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, rampUp: { startPct: 120, monthsToSteadyState: 3 } })[0]?.path).toBe('rampUp.startPct');
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, rampUp: { startPct: 50, monthsToSteadyState: 2.5 } })[0]?.path).toBe('rampUp.monthsToSteadyState');
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, priceEscalationPctAnnual: 500 })[0]?.path).toBe('priceEscalationPctAnnual');
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, tax: { kind: 'flat_rate', ratePct: 130 } })[0]?.path).toBe('tax.ratePct');
    expect(issuesOf(mutated(SYNTHETIC_MANUFACTURING, (d) => (d.capex[0].salvagePct = 150)))[0]?.path).toBe('capex[0].salvagePct');
    expect(issuesOf(mutated(SYNTHETIC_MANUFACTURING, (d) => (d.financing.loan.annualInterestPct = -2)))[0]?.path).toBe('financing.loan.annualInterestPct');
  });

  it('rejects non-numbers, NaN and infinities', () => {
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.capex[0].amount = '600000')))[0]?.message).toBe('capex amount must be a number');
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.capex[0].amount = Number.NaN)))[0]?.path).toBe('capex[0].amount');
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.capex[0].amount = null)))[0]?.path).toBe('capex[0].amount');
    const infinite = clone(SYNTHETIC_CAFE);
    infinite.capex![0]!.amount = Number.POSITIVE_INFINITY;
    expect(issuesOf(infinite)[0]?.message).toBe('capex amount must be a finite number');
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.capex[0].amount = 1e15)))[0]?.message).toContain('must not exceed');
  });

  it('rejects unknown keys instead of silently ignoring them (typo protection)', () => {
    // British spelling of the key: must be flagged, not ignored
    const issues = issuesOf(
      mutated(SYNTHETIC_MANUFACTURING, (d) => {
        d.revenueStreams[0].driver.utilisation = 0.5;
      }),
    );
    expect(issues[0]?.path).toBe('revenueStreams[0].driver');
    expect(issues[0]?.message).toContain('utilisation');
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, horizonMonth: 24 })[0]?.message).toContain('horizonMonth');
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.owner.salary = 1)))[0]?.path).toBe('owner');
  });

  it('rejects missing required parts', () => {
    expect(issuesOf({ owner: { monthlyCompensation: 0, treatment: 'drawings' } })[0]?.path).toBe('revenueStreams');
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, revenueStreams: [] })[0]).toEqual({ path: 'revenueStreams', message: 'at least one revenue stream is required' });
    expect(issuesOf({ revenueStreams: SYNTHETIC_MINIMAL.revenueStreams })[0]?.path).toBe('owner');
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => delete d.revenueStreams[0].driver.averageTicket))[0]).toEqual({
      path: 'revenueStreams[0].driver.averageTicket',
      message: 'averageTicket is required',
    });
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.revenueStreams[0].driver.kind = 'subscriptions')))[0]?.path).toBe('revenueStreams[0].driver.kind');
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.owner.treatment = 'dividends')))[0]?.path).toBe('owner.treatment');
    expect(issuesOf(null)[0]?.path).toBe('');
    expect(issuesOf('not an object').length).toBeGreaterThan(0);
  });

  it('rejects duplicate keys', () => {
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.capex[1].key = 'interiors')))[0]).toEqual({
      path: 'capex[1].key',
      message: 'duplicate key "interiors" in capex; keys must be unique',
    });
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.fixedCosts[1].key = 'rent')))[0]?.path).toBe('fixedCosts[1].key');
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.revenueStreams[0].variableCosts[1].key = 'ingredients')))[0]?.path).toBe(
      'revenueStreams[0].variableCosts[1].key',
    );
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => d.revenueStreams.push(clone(d.revenueStreams[0]))))[0]?.path).toBe('revenueStreams[1].key');
  });

  it('rejects inconsistent loan, subsidy and closure settings', () => {
    expect(issuesOf(mutated(SYNTHETIC_MANUFACTURING, (d) => (d.financing.loan.moratoriumMonths = 30)))[0]).toEqual({
      path: 'financing.loan.moratoriumMonths',
      message: 'loan.moratoriumMonths must be smaller than loan.tenureMonths',
    });
    expect(issuesOf(mutated(SYNTHETIC_MANUFACTURING, (d) => (d.financing.loan.principal = 0)))[0]?.message).toContain('greater than 0');
    expect(issuesOf(mutated(SYNTHETIC_MANUFACTURING, (d) => (d.financing.loan.disbursedAtStart = false)))[0]?.path).toBe('financing.loan.disbursedAtStart');
    expect(issuesOf(mutated(SYNTHETIC_MANUFACTURING, (d) => (d.financing.subsidy.receivedOperatingMonth = 37)))[0]).toEqual({
      path: 'financing.subsidy.receivedOperatingMonth',
      message: 'subsidy.receivedOperatingMonth (37) must not exceed horizonMonths (36)',
    });
    expect(issuesOf(mutated(SYNTHETIC_MANUFACTURING, (d) => (d.financing.subsidy.treatment = 'grant')))[0]?.path).toBe('financing.subsidy.treatment');
    expect(
      issuesOf({
        ...SYNTHETIC_MINIMAL,
        horizonMonths: 12,
        closure: { atOperatingMonth: 13, assetRecoveryPct: 50, refundableDepositRecoveryPct: 100 },
      })[0],
    ).toEqual({ path: 'closure.atOperatingMonth', message: 'closure.atOperatingMonth (13) must not exceed horizonMonths (12)' });
    expect(
      issuesOf({ ...SYNTHETIC_MINIMAL, closure: { atOperatingMonth: 6, assetRecoveryPct: 150, refundableDepositRecoveryPct: 100 } })[0]?.path,
    ).toBe('closure.assetRecoveryPct');
  });

  it('rejects malformed seasonality and harvest calendars', () => {
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, seasonality: { multipliers: [1, 1, 1] } })[0]).toEqual({
      path: 'seasonality.multipliers',
      message: 'seasonality.multipliers must contain exactly 12 values (January … December)',
    });
    expect(issuesOf({ ...SYNTHETIC_MINIMAL, seasonality: { multipliers: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1] } })[0]?.path).toBe('seasonality.multipliers[11]');
    const farm = (months: unknown) => ({
      ...SYNTHETIC_MINIMAL,
      revenueStreams: [
        { key: 'crop', label: 'SYNTHETIC', driver: { kind: 'area_yield', area: 1, yieldPerAreaPerCycle: 1, pricePerUnit: 1, harvestCalendarMonths: months } },
      ],
    });
    expect(issuesOf(farm([]))[0]?.message).toBe('harvestCalendarMonths must list at least one calendar month');
    expect(issuesOf(farm([13]))[0]?.path).toBe('revenueStreams[0].driver.harvestCalendarMonths[0]');
    expect(issuesOf(farm([3, 3]))[0]?.message).toBe('harvestCalendarMonths must not contain duplicates');
    expect(issuesOf(farm([0]))[0]?.message).toBe('harvest calendar month must be between 1 and 12');
  });

  it('rejects impossible capex settings', () => {
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.capex[0] = { key: 'land', label: 'x', amount: 1, category: 'land', depreciable: true })))[0]).toEqual({
      path: 'capex[0].depreciable',
      message: 'land is not depreciable',
    });
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.capex[0].usefulLifeYears = 0)))[0]?.message).toBe('usefulLifeYears must be greater than 0');
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.capex[0].usefulLifeYears = 0.7)))[0]?.message).toContain('whole number of months');
    expect(issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.capex[0].category = 'spaceship')))[0]?.path).toBe('capex[0].category');
    expect(
      issuesOf(mutated(SYNTHETIC_CAFE, (d) => (d.capex[0] = { key: 'x', label: 'x', amount: 1, category: 'other', replaceAtEndOfLife: true })))[0]?.message,
    ).toBe('replaceAtEndOfLife requires a depreciable item with usefulLifeYears');
  });

  it('reports all problems at once', () => {
    const issues = issuesOf(
      mutated(SYNTHETIC_CAFE, (d) => {
        d.capex[0].amount = -1;
        d.horizonMonths = 500;
        d.owner.treatment = 'x';
      }),
    );
    expect(issues.map((issue) => issue.path).sort()).toEqual(['capex[0].amount', 'horizonMonths', 'owner.treatment']);
  });

  it('validateModelInput returns issues instead of throwing', () => {
    const ok = validateModelInput(SYNTHETIC_MINIMAL);
    expect(ok.ok).toBe(true);
    const bad = validateModelInput({ ...SYNTHETIC_MINIMAL, horizonMonths: 1 });
    expect(bad).toEqual({ ok: false, issues: [{ path: 'horizonMonths', message: 'horizonMonths must be between 12 and 120' }] });
  });

  it('the error message names the first problem', () => {
    try {
      runModel({ ...SYNTHETIC_MINIMAL, horizonMonths: 1, contingencyPct: -1 });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelValidationError);
      expect((error as ModelValidationError).code).toBe('INVALID_INPUT');
      expect((error as Error).message).toBe('Invalid model input: horizonMonths: horizonMonths must be between 12 and 120 (+1 more)');
    }
  });
});
