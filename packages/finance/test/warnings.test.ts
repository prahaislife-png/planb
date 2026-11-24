import { describe, expect, it } from 'vitest';
import { runModel, type ModelInput } from '../src/index';
import { SYNTHETIC_MANUFACTURING, SYNTHETIC_RENTAL } from './fixtures';
import { clone, month, warningCodes } from './helpers';

/** SYNTHETIC: revenue 100,000, variable cost `variablePct`% of revenue, fixed cost `fixed`. */
const simple = (options: { variablePct?: number; fixed?: number; owner?: number; capex?: number; extra?: Partial<ModelInput> } = {}): ModelInput => ({
  horizonMonths: 12,
  capex: options.capex ? [{ key: 'kit', label: 'SYNTHETIC kit', amount: options.capex, category: 'equipment', usefulLifeYears: 5 }] : [],
  revenueStreams: [
    {
      key: 'jobs',
      label: 'SYNTHETIC jobs',
      driver: { kind: 'engagements', engagementsPerMonth: 10, realizedFee: 10_000 },
      variableCosts: [{ key: 'materials', label: 'Materials', basis: 'pct_of_revenue', value: options.variablePct ?? 40, classification: 'cogs' }],
    },
  ],
  fixedCosts: [{ key: 'rent', label: 'Rent', category: 'rent', monthlyAmount: options.fixed ?? 30_000, classification: 'operating' }],
  owner: { monthlyCompensation: options.owner ?? 0, treatment: 'drawings' },
  ...options.extra,
});

describe('warnings', () => {
  it('a healthy model with tax has no warnings at all', () => {
    const result = runModel(simple({ extra: { tax: { kind: 'flat_rate', ratePct: 25 } } }));
    expect(result.warnings).toEqual([]);
  });

  it('every warning has a code, a severity and a message', () => {
    const result = runModel(simple({ variablePct: 120 }));
    expect(result.warnings.length).toBeGreaterThan(0);
    for (const warning of result.warnings) {
      expect(warning.code).toMatch(/^[A-Z0-9_]+$/);
      expect(['info', 'warning', 'critical']).toContain(warning.severity);
      expect(warning.message.length).toBeGreaterThan(20);
    }
  });

  it('RESULTS_ARE_PRE_TAX fires exactly when no tax is modelled', () => {
    expect(warningCodes(runModel(simple()))).toEqual(['RESULTS_ARE_PRE_TAX']);
    expect(warningCodes(runModel(simple({ extra: { tax: { kind: 'flat_rate', ratePct: 0 } } })))).toEqual([]);
  });

  it('NEGATIVE_CONTRIBUTION_MARGIN: variable costs at or above revenue', () => {
    const result = runModel(simple({ variablePct: 120 }));
    expect(warningCodes(result)).toContain('NEGATIVE_CONTRIBUTION_MARGIN');
    expect(result.summary.steadyState.contributionMarginPct).toBe(-20);
    expect(result.summary.breakEven.monthlyRevenueRequired).toBeNull();
    expect(result.summary.breakEven.pctOfSteadyStateRevenue).toBeNull();
    // also at exactly zero contribution
    expect(warningCodes(runModel(simple({ variablePct: 100 })))).toContain('NEGATIVE_CONTRIBUTION_MARGIN');
    expect(warningCodes(runModel(simple({ variablePct: 99 })))).not.toContain('NEGATIVE_CONTRIBUTION_MARGIN');
  });

  it('NEVER_BREAKS_EVEN_IN_HORIZON: EBITDA is never positive', () => {
    // contribution 60,000 < fixed 70,000
    const result = runModel(simple({ fixed: 70_000 }));
    expect(warningCodes(result)).toContain('NEVER_BREAKS_EVEN_IN_HORIZON');
    expect(result.summary.breakEven.firstOperatingMonthEbitdaPositive).toBeNull();
    expect(warningCodes(result)).toContain('PAYBACK_NOT_WITHIN_HORIZON');
    expect(warningCodes(result)).toContain('CASH_SHORTFALL');
    // break-even revenue 70,000 / 0.6 = 116,666.67 is above the steady-state 100,000
    expect(result.summary.breakEven.monthlyRevenueRequired).toBe(116_666.67);
    expect(warningCodes(result)).toContain('BREAK_EVEN_ABOVE_STEADY_STATE_REVENUE');
    // not when EBITDA is positive
    expect(warningCodes(runModel(simple({ fixed: 50_000 })))).not.toContain('NEVER_BREAKS_EVEN_IN_HORIZON');
  });

  it('OWNER_COMPENSATION_NOT_COVERED: EBITDA positive but below the stated owner pay', () => {
    // EBITDA 30,000 ; owner 45,000
    const result = runModel(simple({ owner: 45_000 }));
    expect(warningCodes(result)).toContain('OWNER_COMPENSATION_NOT_COVERED');
    expect(warningCodes(result)).not.toContain('NEVER_BREAKS_EVEN_IN_HORIZON');
    expect(warningCodes(result)).toContain('BREAK_EVEN_ABOVE_STEADY_STATE_REVENUE'); // 75,000 / 0.6 = 125,000 > 100,000
    // owner income is what the business can really pay: 30,000, not the stated 45,000
    expect(result.summary.ownerIncome.year1AvgMonthly).toBe(30_000);
    expect(result.summary.ownerIncome.components[0]).toMatchObject({
      avgMonthlyStatedOwnerCompensation: 45_000,
      avgMonthlyAffordableOwnerCompensation: 30_000,
      avgMonthlyResidualNetCashFlow: -15_000,
    });
    expect(warningCodes(runModel(simple({ owner: 25_000 })))).not.toContain('OWNER_COMPENSATION_NOT_COVERED');
  });

  it('CASH_SHORTFALL: cash falls below the upfront equity; the amount is reported, no overdraft is assumed', () => {
    // monthly cash −10,000 − … : EBITDA 60,000 − 70,000 = −10,000 for 12 months -> 120,000 short
    const result = runModel(simple({ fixed: 70_000, capex: 200_000 }));
    expect(result.summary.peakFundingNeed).toBe(120_000);
    expect(result.summary.peakFundingNeedMonthIndex).toBe(12);
    expect(result.summary.totalOwnerCashRequired).toBe(320_000);
    const shortfall = result.warnings.find((warning) => warning.code === 'CASH_SHORTFALL');
    expect(shortfall?.severity).toBe('critical');
    expect(shortfall?.message).toContain('INR 120000.00');
    expect(shortfall?.message).toContain('month 12');
    // a model that only ever adds cash has no shortfall
    const fine = runModel(simple({ capex: 200_000 }));
    expect(fine.summary.peakFundingNeed).toBe(0);
    expect(warningCodes(fine)).not.toContain('CASH_SHORTFALL');
  });

  it('PAYBACK_NOT_WITHIN_HORIZON: equity not recovered by the end of the horizon', () => {
    // 30,000 per month × 12 = 360,000 < 500,000
    const result = runModel(simple({ capex: 500_000 }));
    expect(warningCodes(result)).toContain('PAYBACK_NOT_WITHIN_HORIZON');
    expect(result.summary.capitalRecovery).toMatchObject({ paybackOperatingMonth: null, withinHorizon: false, cumulativeCashAtHorizonEnd: -140_000 });
    // exactly recovered in month 12: 12 × 30,000 = 360,000
    const exact = runModel(simple({ capex: 360_000 }));
    expect(exact.summary.capitalRecovery.paybackOperatingMonth).toBe(12);
    expect(warningCodes(exact)).not.toContain('PAYBACK_NOT_WITHIN_HORIZON');
  });

  it('SEASONALITY_NOT_NORMALISED: mean multiplier deviates from 1 by more than 2%', () => {
    const withMean = (first: number) =>
      runModel(simple({ extra: { seasonality: { multipliers: [first, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] } } }));
    // mean = (first + 11) / 12
    expect(warningCodes(withMean(1))).not.toContain('SEASONALITY_NOT_NORMALISED'); // mean 1.000
    expect(warningCodes(withMean(1.12))).not.toContain('SEASONALITY_NOT_NORMALISED'); // mean 1.010
    expect(warningCodes(withMean(1.6))).toContain('SEASONALITY_NOT_NORMALISED'); // mean 1.050
    expect(warningCodes(withMean(0.4))).toContain('SEASONALITY_NOT_NORMALISED'); // mean 0.950
    expect(warningCodes(withMean(0.88))).not.toContain('SEASONALITY_NOT_NORMALISED'); // mean 0.990
    const message = withMean(1.6).warnings.find((warning) => warning.code === 'SEASONALITY_NOT_NORMALISED')?.message;
    expect(message).toContain('1.0500');
    expect(message).toContain('above');
  });

  it('DSCR_BELOW_1: operating cash does not cover debt service', () => {
    // EBITDA 30,000 per month; loan 1,000,000 at 12% over 12 months -> EMI 88,848.79
    const result = runModel(
      simple({ capex: 1_000_000, extra: { financing: { loan: { principal: 1_000_000, annualInterestPct: 12, tenureMonths: 12 } } } }),
    );
    // DSCR = 360,000 / (12 × 88,848.79) = 0.34
    expect(result.summary.minDscr).toBe(0.34);
    expect(result.summary.avgDscr).toBe(0.34);
    expect(warningCodes(result)).toContain('DSCR_BELOW_1');
    expect(warningCodes(result)).toContain('CASH_SHORTFALL');
    // the manufacturing fixture has comfortable cover
    const comfortable = runModel(SYNTHETIC_MANUFACTURING);
    expect(comfortable.summary.minDscr).toBeGreaterThan(1);
    expect(warningCodes(comfortable)).not.toContain('DSCR_BELOW_1');
    // no loan -> no DSCR at all
    expect(runModel(simple()).summary.minDscr).toBeNull();
  });

  it('VOLUME_CAPPED_AT_CAPACITY: seasonality cannot push a capacity-bound driver above 100%', () => {
    const input = clone(SYNTHETIC_MANUFACTURING);
    // utilisation 0.8 × 1.5 = 1.2 -> capped at 1.0 in the peak month; mean of multipliers is 1.0
    input.seasonality = { multipliers: [1.5, 0.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] };
    const result = runModel(input);
    expect(warningCodes(result)).toContain('VOLUME_CAPPED_AT_CAPACITY');
    // operating month 10 is January (start April): 10,000 units, not 12,000
    expect(month(result, 10)).toMatchObject({ calendarMonth: 1, revenue: 1_000_000 });
    expect(month(result, 10).streams[0]?.units).toBe(10_000);
    // February: 0.8 × 0.5 = 0.4 -> 4,000 units
    expect(month(result, 11).streams[0]?.units).toBe(4_000);
    // 0.8 × 1.25 = exactly full capacity is not a cap
    input.seasonality = { multipliers: [1.25, 0.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] };
    expect(warningCodes(runModel(input))).not.toContain('VOLUME_CAPPED_AT_CAPACITY');
  });

  it('STEADY_STATE_NOT_REACHED_IN_HORIZON: the ramp is longer than the horizon', () => {
    const result = runModel(simple({ extra: { rampUp: { startPct: 20, monthsToSteadyState: 18 } } }));
    expect(warningCodes(result)).toContain('STEADY_STATE_NOT_REACHED_IN_HORIZON');
    expect(result.summary.steadyState).toMatchObject({ referenceOperatingMonth: 19, reachedWithinHorizon: false, revenue: 100_000 });
    expect(warningCodes(runModel(simple({ extra: { rampUp: { startPct: 20, monthsToSteadyState: 11 } } })))).not.toContain(
      'STEADY_STATE_NOT_REACHED_IN_HORIZON',
    );
  });

  it('ASSET_WITHOUT_USEFUL_LIFE: depreciable capex without a life is neither depreciated nor replaced', () => {
    const result = runModel(
      simple({ extra: { capex: [{ key: 'kit', label: 'SYNTHETIC kit', amount: 100_000, category: 'equipment' }] } }),
    );
    expect(warningCodes(result)).toContain('ASSET_WITHOUT_USEFUL_LIFE');
    expect(result.warnings.find((warning) => warning.code === 'ASSET_WITHOUT_USEFUL_LIFE')?.message).toContain('"kit"');
    expect(result.summary.totals.depreciation).toBe(0);
    // land needs no life
    const land = runModel(simple({ extra: { capex: [{ key: 'plot', label: 'SYNTHETIC plot', amount: 100_000, category: 'land' }] } }));
    expect(warningCodes(land)).not.toContain('ASSET_WITHOUT_USEFUL_LIFE');
  });

  it('ZERO_REVENUE: nothing is sold at steady state', () => {
    const input = simple();
    (input.revenueStreams[0]!.driver as { engagementsPerMonth: number }).engagementsPerMonth = 0;
    const result = runModel(input);
    expect(warningCodes(result)).toContain('ZERO_REVENUE');
    expect(warningCodes(result)).toContain('NEVER_BREAKS_EVEN_IN_HORIZON');
    expect(warningCodes(result)).not.toContain('NEGATIVE_CONTRIBUTION_MARGIN');
    expect(result.summary.steadyState.contributionMarginPct).toBeNull();
  });

  it('LOAN_OUTSTANDING_AT_HORIZON_END and LOAN_EXCEEDS_INITIAL_INVESTMENT', () => {
    const result = runModel(simple({ extra: { financing: { loan: { principal: 200_000, annualInterestPct: 10, tenureMonths: 48 } } } }));
    expect(warningCodes(result)).toEqual(['RESULTS_ARE_PRE_TAX', 'LOAN_EXCEEDS_INITIAL_INVESTMENT', 'LOAN_OUTSTANDING_AT_HORIZON_END']);
  });

  it('warnings come in a fixed, deterministic order', () => {
    const run = () => warningCodes(runModel(simple({ fixed: 70_000, capex: 200_000 })));
    expect(run()).toEqual([
      'RESULTS_ARE_PRE_TAX',
      'NEVER_BREAKS_EVEN_IN_HORIZON',
      'BREAK_EVEN_ABOVE_STEADY_STATE_REVENUE',
      'CASH_SHORTFALL',
      'PAYBACK_NOT_WITHIN_HORIZON',
    ]);
    expect(run()).toEqual(run());
    expect(warningCodes(runModel(SYNTHETIC_RENTAL))).toEqual(['RESULTS_ARE_PRE_TAX']);
  });
});
