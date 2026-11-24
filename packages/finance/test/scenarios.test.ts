import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENARIOS,
  DEFAULT_STRESS_TESTS,
  ModelValidationError,
  applyAdjustments,
  applyOverrides,
  hashModelInput,
  parseModelInput,
  runModel,
  runScenarios,
  type Adjustment,
  type ScenarioSpec,
} from '../src/index';
import { SYNTHETIC_CAFE, SYNTHETIC_FARM, SYNTHETIC_MANUFACTURING, SYNTHETIC_MINIMAL, SYNTHETIC_RENTAL } from './fixtures';
import { clone, month } from './helpers';

/** Recursively freeze so that any attempted mutation throws (ESM is strict mode). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('applyOverrides', () => {
  it('is pure: the input is never mutated, even when deeply frozen', () => {
    const frozen = deepFreeze(clone(SYNTHETIC_MANUFACTURING));
    const before = JSON.stringify(frozen);
    const adjustments: Adjustment[] = [
      { target: 'volume', op: 'multiply', value: 0.8 },
      { target: 'price', op: 'multiply', value: 1.1 },
      { target: 'variable_costs', op: 'multiply', value: 1.15 },
      { target: 'fixed_costs', op: 'add', value: 1_000 },
      { target: 'staff_costs', op: 'multiply', value: 1.05 },
      { target: 'capex', op: 'multiply', value: 1.2 },
      { target: 'ramp_months', op: 'set', value: 9 },
      { target: 'pre_operating_months', op: 'add', value: 3 },
      { target: 'interest_rate', op: 'add', value: 3 },
      { target: 'rent', op: 'multiply', value: 1.25 },
      { closureAtOperatingMonth: 12, assetRecoveryPct: 50, refundableDepositRecoveryPct: 100 },
    ];
    const adjusted = applyOverrides(frozen, deepFreeze(adjustments));
    expect(JSON.stringify(frozen)).toBe(before);
    expect(adjusted).not.toBe(frozen);
    // and the frozen original still runs and gives the base result
    expect(runModel(frozen).inputHash).toBe(hashModelInput(SYNTHETIC_MANUFACTURING));
  });

  it('with no overrides returns the validated input (same hash as the base)', () => {
    const adjusted = applyOverrides(SYNTHETIC_CAFE, []);
    expect(adjusted).toEqual(parseModelInput(SYNTHETIC_CAFE));
    expect(hashModelInput(adjusted)).toBe(hashModelInput(SYNTHETIC_CAFE));
  });

  it('each target changes exactly the documented parameter', () => {
    const base = parseModelInput(SYNTHETIC_MANUFACTURING);

    const volume = applyOverrides(base, [{ target: 'volume', op: 'multiply', value: 0.5 }]);
    expect(volume.revenueStreams[0]!.driver).toMatchObject({ utilization: 0.4, capacityUnitsPerMonth: 10_000, unitPrice: 100 });

    const price = applyOverrides(base, [{ target: 'price', op: 'add', value: 10 }]);
    expect(price.revenueStreams[0]!.driver).toMatchObject({ utilization: 0.8, unitPrice: 110 });

    const variable = applyOverrides(base, [{ target: 'variable_costs', op: 'multiply', value: 2 }]);
    expect(variable.revenueStreams[0]!.variableCosts.map((c) => c.value)).toEqual([100, 10, 10]);

    const fixed = applyOverrides(base, [{ target: 'fixed_costs', op: 'multiply', value: 2 }]);
    expect(fixed.fixedCosts.map((c) => c.monthlyAmount)).toEqual([80_000, 20_000]);

    const rent = applyOverrides(base, [{ target: 'rent', op: 'multiply', value: 1.25 }]);
    expect(rent.fixedCosts.map((c) => c.monthlyAmount)).toEqual([50_000, 10_000]); // only the 'rent' category

    const staff = applyOverrides(base, [{ target: 'staff_costs', op: 'set', value: 15_000 }]);
    expect(staff.staff.map((s) => s.monthlySalary)).toEqual([15_000, 15_000]);

    const capex = applyOverrides(base, [{ target: 'capex', op: 'multiply', value: 1.1, keys: ['machinery'] }]);
    expect(capex.capex.map((c) => c.amount)).toEqual([1_320_000, 600_000]);

    const ramp = applyOverrides(base, [{ target: 'ramp_months', op: 'multiply', value: 2 }]);
    expect(ramp.rampUp.monthsToSteadyState).toBe(6);

    const delay = applyOverrides(base, [{ target: 'pre_operating_months', op: 'add', value: 3 }]);
    expect(delay.preOperatingMonths).toBe(6);

    const interest = applyOverrides(base, [{ target: 'interest_rate', op: 'add', value: 3 }]);
    expect(interest.financing!.loan!.annualInterestPct).toBe(15);

    const closure = applyOverrides(base, [{ closureAtOperatingMonth: 18, assetRecoveryPct: 40, refundableDepositRecoveryPct: 90 }]);
    expect(closure.closure).toEqual({
      atOperatingMonth: 18,
      assetRecoveryPct: 40,
      refundableDepositRecoveryPct: 90,
      closureCosts: 0,
      workingCapitalRecoveryPct: 100,
    });

    // everything not targeted is untouched
    expect({ ...volume, revenueStreams: base.revenueStreams }).toEqual(base);
  });

  it('volume adjustments act on the right parameter of every driver kind', () => {
    const run = (driver: unknown) =>
      applyOverrides({ ...SYNTHETIC_MINIMAL, revenueStreams: [{ key: 's', label: 'SYNTHETIC', driver }] } as never, [
        { target: 'volume', op: 'multiply', value: 0.5 },
        { target: 'price', op: 'multiply', value: 2 },
      ]).revenueStreams[0]!.driver;
    expect(run({ kind: 'transactions', transactionsPerDay: 40, operatingDaysPerMonth: 25, averageTicket: 100 })).toMatchObject({ transactionsPerDay: 20, operatingDaysPerMonth: 25, averageTicket: 200 });
    expect(run({ kind: 'area_yield', area: 4, yieldPerAreaPerCycle: 500, pricePerUnit: 30, harvestCalendarMonths: [1] })).toMatchObject({ area: 4, yieldPerAreaPerCycle: 250, pricePerUnit: 60 });
    expect(run({ kind: 'enrolment', capacityStudents: 200, enrolmentRate: 0.6, feePerStudentPerMonth: 1_000 })).toMatchObject({ capacityStudents: 200, enrolmentRate: 0.3, feePerStudentPerMonth: 2_000 });
    expect(run({ kind: 'occupancy', rentableArea: 1_000, occupancy: 0.9, ratePerAreaPerMonth: 20 })).toMatchObject({ rentableArea: 1_000, occupancy: 0.45, ratePerAreaPerMonth: 40 });
    expect(run({ kind: 'fleet_utilization', unitCount: 5, billableDaysPerMonth: 26, utilization: 0.5, ratePerUnitPerDay: 1_000 })).toMatchObject({ unitCount: 5, utilization: 0.25, ratePerUnitPerDay: 2_000 });
    expect(run({ kind: 'engagements', engagementsPerMonth: 8, realizedFee: 5_000 })).toMatchObject({ engagementsPerMonth: 4, realizedFee: 10_000 });
  });

  it('clamps and reports: ratios stay ≤ 1, amounts stay ≥ 0, months stay whole and in range', () => {
    const up = applyAdjustments(SYNTHETIC_MANUFACTURING, [{ target: 'volume', op: 'multiply', value: 1.5 }]);
    expect(up.input.revenueStreams[0]!.driver).toMatchObject({ utilization: 1 }); // 0.8 × 1.5 = 1.2 -> 1
    expect(up.notes.join(' ')).toContain('clamped to 1');

    const negative = applyAdjustments(SYNTHETIC_MANUFACTURING, [{ target: 'fixed_costs', op: 'add', value: -25_000 }]);
    expect(negative.input.fixedCosts.map((c) => c.monthlyAmount)).toEqual([15_000, 0]); // 10,000 − 25,000 -> 0
    expect(negative.notes.join(' ')).toContain('clamped to 0');

    const ramp = applyAdjustments(SYNTHETIC_MANUFACTURING, [{ target: 'ramp_months', op: 'multiply', value: 1.5 }]);
    expect(ramp.input.rampUp.monthsToSteadyState).toBe(5); // 3 × 1.5 = 4.5 -> rounded UP to 5
    const exact = applyAdjustments({ ...SYNTHETIC_MANUFACTURING, rampUp: { startPct: 40, monthsToSteadyState: 6 } }, [
      { target: 'ramp_months', op: 'multiply', value: 1.5 },
    ]);
    expect(exact.input.rampUp.monthsToSteadyState).toBe(9); // 6 × 1.5 is exactly 9, no rounding up to 10
    expect(exact.notes).toEqual([]);

    const delay = applyAdjustments(SYNTHETIC_MANUFACTURING, [{ target: 'pre_operating_months', op: 'add', value: 40 }]);
    expect(delay.input.preOperatingMonths).toBe(24);
    expect(delay.notes).toHaveLength(1);
  });

  it('reports adjustments that had nothing to act on', () => {
    const noLoan = applyAdjustments(SYNTHETIC_CAFE, [{ target: 'interest_rate', op: 'add', value: 3 }]);
    expect(noLoan.input).toEqual(parseModelInput(SYNTHETIC_CAFE));
    expect(noLoan.notes).toEqual(['interest_rate: nothing to adjust — this adjustment had no effect']);

    const noRent = applyAdjustments(SYNTHETIC_MINIMAL, [{ target: 'rent', op: 'multiply', value: 1.25 }]);
    expect(noRent.notes[0]).toContain('rent: nothing to adjust');

    const wrongKey = applyAdjustments(SYNTHETIC_CAFE, [{ target: 'price', op: 'multiply', value: 2, keys: ['does_not_exist'] }]);
    expect(wrongKey.notes[0]).toContain('"does_not_exist"');

    const noRamp = applyAdjustments(SYNTHETIC_RENTAL, [{ target: 'ramp_months', op: 'multiply', value: 2 }]);
    expect(noRamp.notes).toEqual(['ramp_months: the adjustment did not change monthsToSteadyState']);
  });

  it('rejects malformed adjustments and adjustments that make the input invalid', () => {
    expect(() => applyOverrides(SYNTHETIC_CAFE, [{ target: 'weather', op: 'multiply', value: 2 } as never])).toThrow(ModelValidationError);
    expect(() => applyOverrides(SYNTHETIC_CAFE, [{ target: 'price', op: 'divide', value: 2 } as never])).toThrow(ModelValidationError);
    expect(() => applyOverrides(SYNTHETIC_CAFE, [{ target: 'price', op: 'multiply', value: -1 }])).toThrow(/must not be negative/);
    expect(() => applyOverrides(SYNTHETIC_CAFE, [{ target: 'price', op: 'multiply', value: Number.NaN }])).toThrow(ModelValidationError);
    // closure after the 24-month horizon
    expect(() =>
      applyOverrides(SYNTHETIC_CAFE, [{ closureAtOperatingMonth: 30, assetRecoveryPct: 50, refundableDepositRecoveryPct: 100 }]),
    ).toThrow(/must not exceed horizonMonths/);
    // the base input itself must be valid
    expect(() => applyOverrides({ ...SYNTHETIC_CAFE, horizonMonths: 5 }, [])).toThrow(ModelValidationError);
  });
});

describe('scenario effects on results (hand-checked)', () => {
  it('volume −20% on the café', () => {
    // steady state: revenue 480,000 ; contribution 58% = 278,400 ; EBITDA = 278,400 − 130,000 = 148,400
    const result = runModel(applyOverrides(SYNTHETIC_CAFE, [{ target: 'volume', op: 'multiply', value: 0.8 }]));
    expect(result.summary.steadyState).toMatchObject({ revenue: 480_000, contribution: 278_400, ebitda: 148_400 });
    // break-even revenue does not depend on volume
    expect(result.summary.breakEven.monthlyRevenueRequired).toBe(293_103.45);
    expect(result.summary.breakEven.pctOfSteadyStateRevenue).toBe(61.06); // 293,103.45 / 480,000
  });

  it('price −10% on the café hits the margin harder than volume −10%', () => {
    // price 180: revenue 540,000 ; ingredients 35% = 189,000 ; packaging 30,000 ; fees 10,800 -> contribution 310,200
    const price = runModel(applyOverrides(SYNTHETIC_CAFE, [{ target: 'price', op: 'multiply', value: 0.9 }]));
    expect(price.summary.steadyState).toMatchObject({ revenue: 540_000, contribution: 310_200, ebitda: 180_200 });
    // volume 2,700: revenue 540,000 ; contribution 58% = 313,200
    const volume = runModel(applyOverrides(SYNTHETIC_CAFE, [{ target: 'volume', op: 'multiply', value: 0.9 }]));
    expect(volume.summary.steadyState).toMatchObject({ revenue: 540_000, contribution: 313_200, ebitda: 183_200 });
  });

  it('launch delayed by 3 months adds three months of rent to the initial investment', () => {
    const result = runModel(applyOverrides(SYNTHETIC_CAFE, [{ target: 'pre_operating_months', op: 'add', value: 3 }]));
    // rent 5 × 50,000 + crew 1 × 60,000 = 310,000 (base 160,000)
    expect(result.initialInvestment.preOperatingCosts).toBe(310_000);
    expect(result.funding.ownerEquityUpfront).toBe(1_540_000);
    expect(result.monthly).toHaveLength(5 + 24);
    expect(month(result, 1).operatingProfitBeforeOwnerComp).toBe(44_000); // operations themselves unchanged
  });

  it('ramp-up twice as long delays steady state from month 6 to month 11', () => {
    const result = runModel(applyOverrides(SYNTHETIC_CAFE, [{ target: 'ramp_months', op: 'multiply', value: 2 }]));
    expect(result.summary.steadyState.referenceOperatingMonth).toBe(11);
    expect(month(result, 6).rampMultiplier).toBe(0.75); // 0.5 + 0.5 × 5/10
    expect(month(result, 11).rampMultiplier).toBe(1);
  });

  it('interest +3 points raises interest during the moratorium from 12,000 to 15,000', () => {
    const result = runModel(applyOverrides(SYNTHETIC_MANUFACTURING, [{ target: 'interest_rate', op: 'add', value: 3 }]));
    expect(month(result, 1).interest).toBe(15_000);
    expect(result.initialInvestment.preOperatingCostsBreakdown.interest).toBe(45_000);
  });
});

describe('runScenarios', () => {
  it('runs the default scenarios; the base scenario equals a plain run', () => {
    const runs = runScenarios(SYNTHETIC_MANUFACTURING);
    expect(runs.map((run) => run.key)).toEqual(['conservative', 'base', 'optimistic']);
    expect(runs.every((run) => run.status === 'ok' && run.error === null)).toBe(true);
    const base = runs[1]!;
    expect(JSON.stringify(base.result)).toBe(JSON.stringify(runModel(SYNTHETIC_MANUFACTURING)));
    // each scenario carries the hash of ITS adjusted input
    expect(new Set(runs.map((run) => run.result!.inputHash)).size).toBe(3);
    // ordering of outcomes: conservative ≤ base ≤ optimistic on steady-state EBITDA
    const ebitda = runs.map((run) => run.result!.summary.steadyState.ebitda);
    expect(ebitda[0]).toBeLessThan(ebitda[1]!);
    expect(ebitda[1]).toBeLessThan(ebitda[2]!);
    // conservative by hand: utilisation 0.68 -> 6,800 units, revenue 680,000
    //   variable: (50 + 5) × 1.05 × 6,800 = 392,700 ; commission 5.25% × 680,000 = 35,700 -> contribution 251,600
    //   fixed + staff: 130,000 × 1.05 = 136,500 -> EBITDA 115,100
    expect(runs[0]!.result!.summary.steadyState).toMatchObject({ revenue: 680_000, contribution: 251_600, ebitda: 115_100 });
    // optimistic: 0.8 × 1.1 = 0.88 -> revenue 880,000 ; contribution 40% = 352,000 ; EBITDA 222,000
    expect(runs[2]!.result!.summary.steadyState).toMatchObject({ revenue: 880_000, ebitda: 222_000 });
  });

  it('does not mutate the input or the scenario specs', () => {
    const input = deepFreeze(clone(SYNTHETIC_CAFE));
    const specs = deepFreeze(clone([...DEFAULT_SCENARIOS, ...DEFAULT_STRESS_TESTS])) as ScenarioSpec[];
    const before = JSON.stringify([input, specs]);
    runScenarios(input, specs);
    expect(JSON.stringify([input, specs])).toBe(before);
  });

  it('runs the default stress tests and marks inapplicable ones without failing the batch', () => {
    const runs = runScenarios(SYNTHETIC_CAFE, DEFAULT_STRESS_TESTS); // 24-month horizon, no loan
    expect(runs).toHaveLength(DEFAULT_STRESS_TESTS.length);
    const byKey = Object.fromEntries(runs.map((run) => [run.key, run]));
    expect(byKey['stress_revenue_minus_20']!.result!.summary.steadyState.revenue).toBe(480_000);
    expect(byKey['stress_revenue_minus_35']!.result!.summary.steadyState.revenue).toBe(390_000);
    expect(byKey['stress_rent_plus_25']!.result!.summary.steadyState.fixedCosts).toBe(82_500); // 62,500 + 20,000
    expect(byKey['stress_variable_costs_plus_15']!.result!.summary.steadyState.totalVariableCosts).toBe(289_800); // 252,000 × 1.15
    expect(byKey['stress_launch_delayed_3_months']!.result!.preOperatingMonths).toBe(5);
    expect(byKey['stress_ramp_twice_as_long']!.result!.summary.steadyState.referenceOperatingMonth).toBe(11);
    // no loan: the interest stress has no effect and says so
    expect(byKey['stress_interest_plus_3_points']!.notes[0]).toContain('no effect');
    expect(byKey['stress_interest_plus_3_points']!.result!.inputHash).toBe(hashModelInput(SYNTHETIC_CAFE));
    // failure cases
    expect(byKey['failure_closure_month_12']!.result!.closure).not.toBeNull();
    expect(byKey['failure_closure_month_24']!.status).toBe('ok');

    // on a 12-month horizon the month-24 closure cannot be applied: reported as invalid, others still run
    const short = runScenarios({ ...SYNTHETIC_CAFE, horizonMonths: 12 }, DEFAULT_STRESS_TESTS);
    const invalid = short.find((run) => run.key === 'failure_closure_month_24')!;
    expect(invalid).toMatchObject({ status: 'invalid', result: null });
    expect(invalid.error!.issues[0]!.path).toBe('closure.atOperatingMonth');
    expect(short.filter((run) => run.status === 'ok')).toHaveLength(DEFAULT_STRESS_TESTS.length - 1);
  });

  it('failure scenario on the café: owner capital lost by hand', () => {
    const run = runScenarios(SYNTHETIC_CAFE, DEFAULT_STRESS_TESTS).find((r) => r.key === 'failure_closure_month_12')!;
    // cumulativeCash after 12 operating months = 201,200 (see golden test)
    // book value: interiors 600,000 − 12 × 10,000 = 480,000 ; kitchen 360,000 − 12 × 5,000 = 300,000 -> 780,000
    // proceeds 50% = 390,000 ; deposit 150,000 ; working capital 22,800 (inventory 48,000 − payables 25,200)
    // closure cash flow = 390,000 + 150,000 + 22,800 = 562,800 -> final position 764,000 -> nothing lost
    expect(run.result!.closure).toMatchObject({
      assetBookValue: 780_000,
      assetSaleProceeds: 390_000,
      depositsRecovered: 150_000,
      workingCapitalRecovered: 22_800,
      netClosureCashFlow: 562_800,
      cumulativeCashAfterClosure: 764_000,
      ownerCapitalLost: 0,
      ownerCompensationDrawn: 480_000,
    });
    // with a 35% lower volume the same closure loses capital:
    const weak = runModel(
      applyOverrides(SYNTHETIC_CAFE, [
        { target: 'volume', op: 'multiply', value: 0.65 },
        { closureAtOperatingMonth: 12, assetRecoveryPct: 50, refundableDepositRecoveryPct: 100 },
      ]),
    );
    expect(weak.closure!.ownerCapitalLost).toBeGreaterThan(0);
    expect(weak.closure!.ownerCapitalLost).toBe(-weak.closure!.cumulativeCashAfterClosure);
  });

  it('default sets are labelled as illustrative shocks, never as forecasts', () => {
    for (const spec of [...DEFAULT_SCENARIOS, ...DEFAULT_STRESS_TESTS]) {
      if (spec.kind === 'base') continue;
      expect(spec.label.toLowerCase(), spec.key).toContain('illustrative');
      expect(spec.description, spec.key).toContain('not a forecast');
    }
    expect(DEFAULT_SCENARIOS.map((spec) => spec.kind)).toEqual(['conservative', 'base', 'optimistic']);
    expect(DEFAULT_STRESS_TESTS.map((spec) => spec.key)).toEqual([
      'stress_revenue_minus_20',
      'stress_revenue_minus_35',
      'stress_price_minus_10',
      'stress_rent_plus_25',
      'stress_variable_costs_plus_15',
      'stress_launch_delayed_3_months',
      'stress_ramp_twice_as_long',
      'stress_interest_plus_3_points',
      'failure_closure_month_12',
      'failure_closure_month_24',
    ]);
    const keys = [...DEFAULT_SCENARIOS, ...DEFAULT_STRESS_TESTS].map((spec) => spec.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('rejects invalid scenario specifications and invalid base inputs', () => {
    expect(() => runScenarios(SYNTHETIC_CAFE, [{ key: 'a', label: 'A', kind: 'custom' }, { key: 'a', label: 'B', kind: 'custom' }])).toThrow(/duplicate scenario key/);
    expect(() => runScenarios(SYNTHETIC_CAFE, [{ key: 'a', label: 'A', kind: 'pessimistic' } as never])).toThrow(ModelValidationError);
    expect(() => runScenarios({ ...SYNTHETIC_CAFE, horizonMonths: 1 })).toThrow(ModelValidationError);
  });

  it('works for seasonal agriculture too (volume acts on yield)', () => {
    const runs = runScenarios(SYNTHETIC_FARM, [
      { key: 'poor_harvest', label: 'Poor harvest (illustrative)', kind: 'custom', adjustments: [{ target: 'volume', op: 'multiply', value: 0.5 }] },
    ]);
    // harvest 1,000 units × 150 = 150,000
    expect(month(runs[0]!.result!, 5).revenue).toBe(150_000);
  });
});
