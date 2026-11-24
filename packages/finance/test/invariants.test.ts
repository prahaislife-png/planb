import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENARIOS,
  DEFAULT_STRESS_TESTS,
  applyOverrides,
  runModel,
  type FlowFields,
  type ModelInput,
  type ModelResult,
} from '../src/index';
import { ALL_SYNTHETIC, SYNTHETIC_CAFE, SYNTHETIC_MANUFACTURING, SYNTHETIC_MINIMAL, SYNTHETIC_RENTAL } from './fixtures';
import { clone, month, operatingRows, sumOf } from './helpers';

/**
 * Structural invariants that must hold for EVERY input. They are checked on all
 * synthetic fixtures and on every default scenario / stress test applied to them.
 *
 * Reported figures are each rounded to 2 decimals independently, so identities
 * between reported figures hold up to a tolerance of half a paisa per term.
 */
const FLOW_KEYS: Array<keyof FlowFields> = [
  'revenue', 'variableCogs', 'fixedCogs', 'cogs', 'grossProfit', 'otherVariableCosts', 'totalVariableCosts',
  'contribution', 'fixedCosts', 'staffCosts', 'operatingProfitBeforeOwnerComp', 'ownerCompensation',
  'operatingProfitAfterOwnerComp', 'depreciation', 'amortisation', 'interest', 'profitBeforeTax', 'tax',
  'netProfit', 'netProfitAfterOwnerComp', 'workingCapitalChange', 'capexOutflow', 'assetSaleProceeds',
  'loanPrincipalRepayment', 'subsidyInflow', 'subsidyAppliedToLoan', 'preOperatingFunding', 'closureCashFlow',
  'netCashFlow',
];

const cases: Array<[string, ModelInput]> = [];
for (const [name, input] of Object.entries(ALL_SYNTHETIC)) {
  cases.push([name, input]);
  for (const spec of [...DEFAULT_SCENARIOS, ...DEFAULT_STRESS_TESTS]) {
    const horizon = input.horizonMonths ?? 60;
    const closesAfterHorizon = (spec.adjustments ?? []).some(
      (a) => 'closureAtOperatingMonth' in a && a.closureAtOperatingMonth > horizon,
    );
    if (closesAfterHorizon) continue;
    cases.push([`${name} + ${spec.key}`, applyOverrides(input, spec.adjustments ?? [])]);
  }
}
// a few extra shapes: seasonality, tax, partial final year
cases.push([
  'SYNTHETIC_CAFE + seasonality + tax + 30-month horizon',
  {
    ...SYNTHETIC_CAFE,
    horizonMonths: 30,
    startCalendarMonth: 9,
    seasonality: { multipliers: [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.2, 1.1, 1, 0.9, 0.8] },
    tax: { kind: 'flat_rate', ratePct: 30, carryForwardLosses: true },
  },
]);

describe.each(cases)('invariants: %s', (_name, input) => {
  const result: ModelResult = runModel(input);
  const EPS = 0.006; // half a paisa of rounding per reported term (+ float noise)

  it('row count and month indexing', () => {
    const P = result.preOperatingMonths;
    const H = result.horizonMonths;
    expect(result.monthly).toHaveLength(P + H);
    expect(result.monthly.map((row) => row.monthIndex)).toEqual([
      ...Array.from({ length: P }, (_, i) => i - P),
      ...Array.from({ length: H }, (_, i) => i + 1),
    ]);
    expect(result.monthly.filter((row) => row.phase === 'pre_operating')).toHaveLength(P);
    for (const row of result.monthly) {
      expect(row.calendarMonth).toBeGreaterThanOrEqual(1);
      expect(row.calendarMonth).toBeLessThanOrEqual(12);
      expect(row.operatingYear).toBe(row.monthIndex < 0 ? 0 : Math.ceil(row.monthIndex / 12));
    }
    // consecutive calendar months
    for (let i = 1; i < result.monthly.length; i++) {
      expect(result.monthly[i]!.calendarMonth).toBe((result.monthly[i - 1]!.calendarMonth % 12) + 1);
    }
  });

  it('Σ monthly = annual for every flow field', () => {
    expect(sumOf(result.annual, 'months')).toBe(result.monthly.length);
    for (const annual of result.annual) {
      const rows = result.monthly.filter((row) => row.operatingYear === annual.year);
      expect(rows).toHaveLength(annual.months);
      for (const key of FLOW_KEYS) {
        expect(Math.abs(sumOf(rows, key) - annual[key]), `${key} in year ${annual.year}`).toBeLessThanOrEqual(EPS * (rows.length + 1));
      }
      const last = rows[rows.length - 1]!;
      expect(annual.cumulativeCashEnd).toBe(last.cumulativeCash);
      expect(annual.loanBalanceEnd).toBe(last.loanBalance);
    }
  });

  it('cumulativeCash is the running sum of netCashFlow starting from −ownerEquityUpfront', () => {
    let running = -result.funding.ownerEquityUpfront;
    result.monthly.forEach((row, index) => {
      running += row.netCashFlow;
      expect(Math.abs(row.cumulativeCash - running), `month ${row.monthIndex}`).toBeLessThanOrEqual(EPS * (index + 2));
    });
    expect(result.summary.capitalRecovery.cumulativeCashAtHorizonEnd).toBe(result.monthly[result.monthly.length - 1]!.cumulativeCash);
  });

  it('funding: loan + ownerEquityUpfront = total initial investment', () => {
    const { initialInvestment: inv, funding } = result;
    expect(inv.capex + inv.contingency + inv.preOperativeExpenses + inv.deposits + inv.preOperatingCosts).toBeCloseTo(inv.total, 2);
    expect(funding.loan + funding.ownerEquityUpfront).toBeCloseTo(inv.total, 2);
    const b = inv.preOperatingCostsBreakdown;
    expect(b.fixedCosts + b.staffCosts + b.interest).toBeCloseTo(inv.preOperatingCosts, 2);
    const preOp = result.monthly.filter((row) => row.phase === 'pre_operating');
    expect(sumOf(preOp, 'preOperatingFunding')).toBeCloseTo(inv.preOperatingCosts, 1);
    expect(preOp.every((row) => row.netCashFlow === 0)).toBe(true);
  });

  it('profit-and-loss identities hold in every row', () => {
    for (const row of result.monthly) {
      const at = `month ${row.monthIndex}`;
      const near = (actual: number, expected: number, terms: number, what: string): void => {
        expect(Math.abs(actual - expected), `${what} @ ${at}`).toBeLessThanOrEqual(EPS * terms);
      };
      near(row.cogs, row.variableCogs + row.fixedCogs, 3, 'cogs');
      near(row.grossProfit, row.revenue - row.cogs, 3, 'grossProfit');
      near(row.totalVariableCosts, row.variableCogs + row.otherVariableCosts, 3, 'totalVariableCosts');
      near(row.contribution, row.revenue - row.totalVariableCosts, 3, 'contribution');
      near(row.operatingProfitBeforeOwnerComp, row.contribution - row.fixedCosts - row.staffCosts, 4, 'EBITDA');
      near(row.operatingProfitAfterOwnerComp, row.operatingProfitBeforeOwnerComp - row.ownerCompensation, 3, 'after owner');
      near(row.netProfit, row.profitBeforeTax - row.tax, 3, 'netProfit');
      near(row.revenue, row.streams.reduce((sum, s) => sum + s.revenue, 0), row.streams.length + 1, 'stream revenue');
      near(row.totalVariableCosts, row.streams.reduce((sum, s) => sum + s.variableCosts, 0), row.streams.length + 1, 'stream variable costs');
      expect(row.fixedCogs).toBeLessThanOrEqual(row.fixedCosts + row.staffCosts + EPS);
    }
  });

  it('net cash flow identity holds in every row', () => {
    for (const row of result.monthly) {
      const expected =
        row.operatingProfitBeforeOwnerComp -
        row.ownerCompensation -
        row.interest -
        row.tax -
        row.workingCapitalChange -
        row.capexOutflow +
        row.assetSaleProceeds -
        row.loanPrincipalRepayment +
        row.subsidyInflow +
        row.preOperatingFunding +
        row.closureCashFlow;
      expect(Math.abs(row.netCashFlow - expected), `month ${row.monthIndex}`).toBeLessThanOrEqual(EPS * 12);
    }
  });

  it('loan balance never increases, never goes negative, and reconciles with repayments', () => {
    let previous = result.funding.loan;
    for (const row of result.monthly) {
      expect(row.loanBalance).toBeGreaterThanOrEqual(0);
      expect(row.loanBalance).toBeLessThanOrEqual(previous + EPS);
      expect(row.interest).toBeGreaterThanOrEqual(0);
      expect(row.loanPrincipalRepayment).toBeGreaterThanOrEqual(0);
      previous = row.loanBalance;
    }
    const repaid = sumOf(result.monthly, 'loanPrincipalRepayment') + sumOf(result.monthly, 'subsidyAppliedToLoan');
    const atClosure = result.closure?.loanRepaidAtClosure ?? 0;
    const end = result.monthly[result.monthly.length - 1]!.loanBalance;
    expect(Math.abs(result.funding.loan - repaid - atClosure - end)).toBeLessThanOrEqual(EPS * (result.monthly.length + 2));
  });

  it('non-negativity of volumes, revenue and costs; working capital reconciles', () => {
    let previousNwc = 0;
    for (const row of result.monthly) {
      for (const key of ['revenue', 'variableCogs', 'otherVariableCosts', 'fixedCosts', 'staffCosts', 'ownerCompensation', 'depreciation', 'amortisation', 'capexOutflow', 'assetSaleProceeds'] as const) {
        expect(row[key], `${key} @ month ${row.monthIndex}`).toBeGreaterThanOrEqual(0);
      }
      for (const stream of row.streams) expect(stream.units).toBeGreaterThanOrEqual(0);
      if (row.phase === 'operating' && result.closure?.atOperatingMonth !== row.monthIndex) {
        expect(Math.abs(row.netWorkingCapital - previousNwc - row.workingCapitalChange)).toBeLessThanOrEqual(EPS * 3);
      }
      previousNwc = row.netWorkingCapital;
    }
  });

  it('summary figures are consistent with the monthly rows', () => {
    const ops = operatingRows(result);
    const { summary } = result;
    // payback = first operating month with cumulativeCash ≥ 0
    const payback = ops.find((row) => row.cumulativeCash >= 0)?.monthIndex ?? null;
    expect(summary.capitalRecovery.paybackOperatingMonth).toBe(payback);
    expect(summary.capitalRecovery.withinHorizon).toBe(payback !== null);
    // peak funding need = how far the cash position falls below the opening position (floored at 0)
    const upfront = Math.max(result.funding.ownerEquityUpfront, 0);
    const lowest = Math.min(...result.monthly.map((row) => row.cumulativeCash));
    expect(summary.peakFundingNeed).toBeCloseTo(Math.max(0, -(lowest + upfront)), 2);
    expect(summary.totalOwnerCashRequired).toBeCloseTo(upfront + summary.peakFundingNeed, 2);
    expect(summary.peakFundingNeed).toBeGreaterThanOrEqual(0);
    // first-month markers
    expect(summary.breakEven.firstOperatingMonthEbitdaPositive).toBe(ops.find((row) => row.operatingProfitBeforeOwnerComp > 0)?.monthIndex ?? null);
    expect(summary.breakEven.firstOperatingMonthNetCashPositive).toBe(ops.find((row) => row.netCashFlow > 0)?.monthIndex ?? null);
    // totals
    expect(Math.abs(summary.totals.netCashFlow - sumOf(result.monthly, 'netCashFlow'))).toBeLessThanOrEqual(EPS * result.monthly.length);
    expect(Math.abs(summary.totals.revenue - sumOf(result.monthly, 'revenue'))).toBeLessThanOrEqual(EPS * result.monthly.length);
    // headline break-even is the after-owner-compensation level, which is never below the before level
    expect(summary.breakEven.monthlyRevenueRequired).toBe(summary.breakEven.afterOwnerCompensation.monthlyRevenueRequired);
    const before = summary.breakEven.beforeOwnerCompensation.monthlyRevenueRequired;
    const after = summary.breakEven.afterOwnerCompensation.monthlyRevenueRequired;
    if (before !== null && after !== null) expect(after).toBeGreaterThanOrEqual(before);
    // owner income = stated owner compensation + residual net cash flow
    for (const component of summary.ownerIncome.components) {
      if (!component.complete) continue;
      expect(component.ownerIncomeAvgMonthly!).toBeCloseTo(
        component.avgMonthlyStatedOwnerCompensation! + component.avgMonthlyResidualNetCashFlow!,
        1,
      );
      expect(component.avgMonthlyAffordableOwnerCompensation!).toBeLessThanOrEqual(component.avgMonthlyStatedOwnerCompensation!);
      expect(component.avgMonthlyAffordableOwnerCompensation!).toBeGreaterThanOrEqual(0);
    }
  });

  it('never reports a probability, score or promise', () => {
    const json = JSON.stringify(result);
    const keys = new Set<string>();
    JSON.parse(json, (key: string, value: unknown) => {
      keys.add(key);
      return value;
    });
    for (const key of keys) expect(key).not.toMatch(/probab|score|likelihood|guarantee|success|chance/i);
    for (const warning of result.warnings) expect(warning.message).not.toMatch(/guarantee|will succeed|probability/i);
    // every number in the result is finite and has at most 2 decimals (6 for the two multipliers)
    JSON.parse(json, (key: string, value: unknown) => {
      if (typeof value === 'number') {
        expect(Number.isFinite(value)).toBe(true);
        const decimals = key === 'rampMultiplier' || key === 'seasonalityMultiplier' ? 6 : 2;
        expect(Math.abs(value * 10 ** decimals - Math.round(value * 10 ** decimals)), `${key}=${value}`).toBeLessThan(1e-6 * Math.max(1, Math.abs(value)));
      }
      return value;
    });
  });
});

describe('specific invariants', () => {
  it('loan balance amortises to exactly 0 at the end of the tenure', () => {
    const result = runModel(SYNTHETIC_MANUFACTURING);
    expect(month(result, 29).loanBalance).toBeGreaterThan(0);
    expect(month(result, 30).loanBalance).toBe(0);
    for (let m = 31; m <= 36; m++) expect(month(result, m).loanBalance).toBe(0);
  });

  it('total depreciation never exceeds depreciable base − salvage', () => {
    // no replacement: machines 240,000 × 90% = 216,000 fully depreciated after 24 months; van 4,000 × 36 = 144,000 ≤ 240,000
    const input = clone(SYNTHETIC_RENTAL);
    input.capex![0]!.replaceAtEndOfLife = false;
    const result = runModel(input);
    const total = sumOf(result.monthly, 'depreciation');
    expect(total).toBe(216_000 + 144_000);
    expect(total).toBeLessThanOrEqual(240_000 * 0.9 + 300_000 * 0.8);

    // with replacement the bound includes the replacement purchase: (240,000 + 264,000) × 90% + 300,000 × 80%
    const replaced = runModel(SYNTHETIC_RENTAL);
    expect(sumOf(replaced.monthly, 'depreciation')).toBeLessThanOrEqual((240_000 + 264_000) * 0.9 + 300_000 * 0.8);

    // a long horizon fully depreciates everything: 10-year horizon, 5-year assets, no replacement
    const long = runModel({
      ...SYNTHETIC_MINIMAL,
      horizonMonths: 120,
      capex: [
        { key: 'a', label: 'SYNTHETIC a', amount: 100_000, category: 'machinery', usefulLifeYears: 5, salvagePct: 25, replaceAtEndOfLife: false },
        { key: 'land', label: 'SYNTHETIC land', amount: 500_000, category: 'land' },
      ],
    });
    expect(sumOf(long.monthly, 'depreciation')).toBe(75_000); // exactly cost − salvage; land never depreciates
    expect(month(long, 61).depreciation).toBe(0);
  });

  it('pre-operative expenses and contingency are fully amortised over min(60, horizon) months', () => {
    const input: ModelInput = {
      ...SYNTHETIC_MINIMAL,
      horizonMonths: 72,
      capex: [{ key: 'a', label: 'SYNTHETIC a', amount: 100_000, category: 'other' }],
      contingencyPct: 10,
      preOperativeExpenses: [{ key: 'fees', label: 'SYNTHETIC fees', amount: 50_000 }],
    };
    const result = runModel(input);
    // (50,000 + 10,000) / 60 = 1,000 per month for 60 months
    expect(month(result, 1).amortisation).toBe(1_000);
    expect(month(result, 60).amortisation).toBe(1_000);
    expect(month(result, 61).amortisation).toBe(0);
    expect(sumOf(result.monthly, 'amortisation')).toBe(60_000);
    const short = runModel({ ...input, horizonMonths: 12 });
    expect(month(short, 1).amortisation).toBe(5_000); // 60,000 / 12
    expect(sumOf(short.monthly, 'amortisation')).toBe(60_000);
  });

  it('zero-volume model: revenue 0 and EBITDA = −(fixed + staff costs)', () => {
    const input = clone(SYNTHETIC_CAFE);
    (input.revenueStreams[0]!.driver as { transactionsPerDay: number }).transactionsPerDay = 0;
    const result = runModel(input);
    for (const row of operatingRows(result)) {
      expect(row.revenue).toBe(0);
      expect(row.totalVariableCosts).toBe(0);
      expect(row.contribution).toBe(0);
      expect(row.operatingProfitBeforeOwnerComp).toBe(-(row.fixedCosts + row.staffCosts));
      expect(row.operatingProfitBeforeOwnerComp).toBe(-130_000);
      expect(row.netWorkingCapital).toBe(0);
    }
    expect(result.summary.steadyState.revenue).toBe(0);
    expect(result.summary.steadyState.ebitda).toBe(-130_000);
    expect(result.summary.steadyState.grossMarginPct).toBeNull();
    expect(result.summary.breakEven.monthlyRevenueRequired).toBeNull();
    expect(result.summary.breakEven.firstOperatingMonthEbitdaPositive).toBeNull();
    expect(result.summary.capitalRecovery.paybackOperatingMonth).toBeNull();
  });

  it('determinism: the same input gives byte-identical JSON and the same inputHash', () => {
    for (const input of Object.values(ALL_SYNTHETIC)) {
      const first = JSON.stringify(runModel(input));
      const second = JSON.stringify(runModel(clone(input)));
      expect(second).toBe(first);
    }
  });

  it('runModel does not mutate its input', () => {
    for (const input of Object.values(ALL_SYNTHETIC)) {
      const before = JSON.stringify(input);
      runModel(input);
      expect(JSON.stringify(input)).toBe(before);
    }
  });

  it('seasonality scales volume by calendar month and the steady state ignores it', () => {
    // operating month 1 = March (3). multipliers: Jan 0.5, Feb 0.5, Mar 1.5, Apr 1.5, rest 1.0 (mean 1.0)
    const result = runModel({
      ...SYNTHETIC_MINIMAL,
      horizonMonths: 12,
      startCalendarMonth: 3,
      seasonality: { multipliers: [0.5, 0.5, 1.5, 1.5, 1, 1, 1, 1, 1, 1, 1, 1] },
    });
    expect(month(result, 1)).toMatchObject({ calendarMonth: 3, seasonalityMultiplier: 1.5, revenue: 150_000 });
    expect(month(result, 2)).toMatchObject({ calendarMonth: 4, revenue: 150_000 });
    expect(month(result, 3)).toMatchObject({ calendarMonth: 5, revenue: 100_000 });
    expect(month(result, 11)).toMatchObject({ calendarMonth: 1, seasonalityMultiplier: 0.5, revenue: 50_000 });
    expect(result.summary.steadyState.revenue).toBe(100_000);
    expect(result.annual[0]!.revenue).toBe(1_200_000);
  });

  it('stream-level paymentTermsDays overrides the global receivable days', () => {
    const result = runModel({
      ...SYNTHETIC_MINIMAL,
      horizonMonths: 12,
      revenueStreams: [
        { key: 'cash', label: 'SYNTHETIC cash sales', driver: { kind: 'engagements', engagementsPerMonth: 10, realizedFee: 10_000 }, paymentTermsDays: 0 },
        { key: 'credit', label: 'SYNTHETIC credit sales', driver: { kind: 'engagements', engagementsPerMonth: 10, realizedFee: 10_000 } },
      ],
      workingCapital: { receivableDays: 45 },
    });
    // receivables = 0 × 100,000 + 45/30 × 100,000 = 150,000
    expect(month(result, 1).netWorkingCapital).toBe(150_000);
    expect(month(result, 1).netCashFlow).toBe(200_000 - 150_000);
    expect(month(result, 2).workingCapitalChange).toBe(0);
  });

  it('every driver kind reduces to units × price', () => {
    const run = (driver: ModelInput['revenueStreams'][number]['driver']) =>
      month(runModel({ ...SYNTHETIC_MINIMAL, horizonMonths: 12, revenueStreams: [{ key: 's', label: 'SYNTHETIC', driver }] }), 1).streams[0]!;
    expect(run({ kind: 'transactions', transactionsPerDay: 40, operatingDaysPerMonth: 25, averageTicket: 150 })).toMatchObject({ units: 1_000, revenue: 150_000 });
    expect(run({ kind: 'capacity_utilization', capacityUnitsPerMonth: 2_000, utilization: 0.75, unitPrice: 40 })).toMatchObject({ units: 1_500, revenue: 60_000 });
    expect(run({ kind: 'area_yield', area: 4, yieldPerAreaPerCycle: 500, pricePerUnit: 30, harvestCalendarMonths: [1] })).toMatchObject({ units: 2_000, revenue: 60_000 });
    expect(run({ kind: 'enrolment', capacityStudents: 200, enrolmentRate: 0.6, feePerStudentPerMonth: 2_000 })).toMatchObject({ units: 120, revenue: 240_000 });
    expect(run({ kind: 'occupancy', rentableArea: 10_000, occupancy: 0.9, ratePerAreaPerMonth: 20 })).toMatchObject({ units: 9_000, revenue: 180_000 });
    expect(run({ kind: 'fleet_utilization', unitCount: 5, billableDaysPerMonth: 26, utilization: 0.5, ratePerUnitPerDay: 2_000 })).toMatchObject({ units: 65, revenue: 130_000 });
    expect(run({ kind: 'engagements', engagementsPerMonth: 8, realizedFee: 25_000 })).toMatchObject({ units: 8, revenue: 200_000 });
  });
});
