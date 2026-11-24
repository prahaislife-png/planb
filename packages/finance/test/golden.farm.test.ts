import { describe, expect, it } from 'vitest';
import { runModel } from '../src/index';
import { SYNTHETIC_FARM } from './fixtures';
import { month, warningCodes, year } from './helpers';

/**
 * GOLDEN EXAMPLE (c): SYNTHETIC_FARM — `area_yield` driver with two harvests a year.
 * Synthetic round numbers only; all arithmetic by hand.
 *
 * CALENDAR  operating month 1 = June (startCalendarMonth 6)
 *   harvest calendar months: October (10) and March (3)
 *   -> operating months 5 (Oct), 10 (Mar), 17 (Oct), 22 (Mar); every other month has no revenue
 *
 * HARVEST MONTH
 *   units   = 2 area units × 1,000 per cycle       = 2,000
 *   revenue = 2,000 × 150                          = 300,000
 *   harvest & packing = 10 × 2,000                 =  20,000 (cogs)
 *   market commission = 5% × 300,000               =  15,000 (operating)
 *   contribution = 300,000 − 35,000                = 265,000
 *   fixed costs = lease 5,000 + inputs 8,000       =  13,000 ; staff 6,000
 *   EBITDA = 265,000 − 19,000                      = 246,000
 *   fixedCogs = inputs 8,000 + helper 6,000 = 14,000 -> cogs 34,000 -> gross profit 266,000
 *   depreciation = 120,000 / 120 months            =   1,000 -> PBT 245,000
 *   netCashFlow = 246,000 − drawings 5,000         = 241,000
 *
 * NON-HARVEST MONTH
 *   EBITDA = −19,000 ; PBT = −20,000 ; netCashFlow = −19,000 − 5,000 = −24,000
 *
 * CUMULATIVE CASH  (starts at −120,000 = the irrigation set, no loan)
 *   m1…m4: 4 × −24,000 -> −216,000   (lowest point: 96,000 below the upfront equity)
 *   m5 : +241,000 ->  +25,000        (first month ≥ 0 -> payback month 5)
 *   m6…m9: 4 × −24,000 -> −71,000    (dips below zero again before the next harvest!)
 *   m10: +241,000 -> +170,000 ; m11, m12: −48,000 -> 122,000
 *   year 2 repeats: +242,000 -> 364,000
 *
 * The ramp-up in the fixture (50% for 6 months) must NOT touch the harvest volume because
 * rampUp.applyToAreaYield defaults to false.
 *
 * STEADY-STATE MONTH for area_yield = annual harvests spread over 12 months
 *   units 2,000 × 2 / 12 = 333.33 ; revenue 600,000 / 12 = 50,000
 *   variableCogs 40,000 / 12 = 3,333.33 ; commission 30,000 / 12 = 2,500 -> total 5,833.33
 *   contribution 44,166.67 (88.33%) ; fixed base 19,000 ; EBITDA 25,166.67 (50.33%)
 *   cogs = 3,333.33 + 14,000 = 17,333.33 -> gross profit 32,666.67 (65.33%)
 */
describe('golden (c): SYNTHETIC_FARM (area_yield, seasonal)', () => {
  const result = runModel(SYNTHETIC_FARM);

  it('revenue is recognised only in harvest calendar months', () => {
    const harvestMonths = result.monthly.filter((row) => row.revenue > 0).map((row) => row.monthIndex);
    expect(harvestMonths).toEqual([5, 10, 17, 22]);
    expect(month(result, 5).calendarMonth).toBe(10);
    expect(month(result, 10).calendarMonth).toBe(3);
    expect(month(result, 1).calendarMonth).toBe(6);
    expect(month(result, 7).calendarMonth).toBe(12);
    expect(month(result, 8).calendarMonth).toBe(1);
  });

  it('harvest month (operating month 5)', () => {
    const row = month(result, 5);
    expect(row).toMatchObject({
      revenue: 300_000,
      variableCogs: 20_000,
      fixedCogs: 14_000,
      cogs: 34_000,
      grossProfit: 266_000,
      otherVariableCosts: 15_000,
      totalVariableCosts: 35_000,
      contribution: 265_000,
      fixedCosts: 13_000,
      staffCosts: 6_000,
      operatingProfitBeforeOwnerComp: 246_000,
      ownerCompensation: 5_000,
      depreciation: 1_000,
      profitBeforeTax: 245_000,
      netCashFlow: 241_000,
      cumulativeCash: 25_000,
    });
    // ramp multiplier for month 5 is 0.5 + 0.5 × 4/6 = 0.833333, reported but NOT applied to the harvest
    expect(row.rampMultiplier).toBe(0.833333);
    expect(row.streams[0]).toEqual({ key: 'crop', units: 2_000, revenue: 300_000, variableCosts: 35_000 });
  });

  it('non-harvest month (operating month 1)', () => {
    expect(month(result, 1)).toMatchObject({
      revenue: 0,
      variableCogs: 0,
      cogs: 14_000,
      grossProfit: -14_000,
      contribution: 0,
      operatingProfitBeforeOwnerComp: -19_000,
      operatingProfitAfterOwnerComp: -24_000,
      profitBeforeTax: -20_000,
      netCashFlow: -24_000,
      cumulativeCash: -144_000,
    });
  });

  it('cumulative cash path', () => {
    const expected: Array<[number, number]> = [
      [4, -216_000],
      [5, 25_000],
      [9, -71_000],
      [10, 170_000],
      [12, 122_000],
      [16, 26_000], // 122,000 − 4 × 24,000
      [17, 267_000],
      [21, 171_000],
      [22, 412_000],
      [24, 364_000],
    ];
    for (const [m, cumulativeCash] of expected) {
      expect(month(result, m).cumulativeCash, `cumulativeCash m${m}`).toBe(cumulativeCash);
    }
  });

  it('annual aggregates', () => {
    // year 1: revenue 2 × 300,000 ; EBITDA 2 × 246,000 − 10 × 19,000 = 302,000 ; NCF 2 × 241,000 − 10 × 24,000 = 242,000
    for (const y of [1, 2]) {
      expect(year(result, y)).toMatchObject({
        months: 12,
        revenue: 600_000,
        operatingProfitBeforeOwnerComp: 302_000,
        ownerCompensation: 60_000,
        depreciation: 12_000,
        profitBeforeTax: 290_000,
        netCashFlow: 242_000,
      });
      expect(year(result, y).unitsByStream).toEqual([{ key: 'crop', units: 4_000, revenue: 600_000 }]);
    }
    expect(result.annual.map((row) => row.year)).toEqual([1, 2]); // no pre-operating period -> no year 0
  });

  it('steady state uses annualised harvests', () => {
    expect(result.summary.steadyState).toEqual({
      referenceOperatingMonth: 7,
      reachedWithinHorizon: true,
      streams: [{ key: 'crop', unitsPerMonth: 333.33, pricePerUnit: 150, revenue: 50_000 }],
      revenue: 50_000,
      variableCogs: 3_333.33,
      cogs: 17_333.33,
      grossProfit: 32_666.67,
      grossMarginPct: 65.33,
      totalVariableCosts: 5_833.33,
      contribution: 44_166.67,
      contributionMarginPct: 88.33,
      fixedCosts: 13_000,
      staffCosts: 6_000,
      monthlyFixedCostBase: 19_000,
      ebitda: 25_166.67,
      ebitdaMarginPct: 50.33,
      ownerCompensation: 5_000,
      operatingProfitAfterOwnerComp: 20_166.67,
    });
    // 12 × steady-state EBITDA equals the annual EBITDA of a full year
    expect(year(result, 1).operatingProfitBeforeOwnerComp).toBeCloseTo(12 * 25_166.67, 0);
  });

  it('break-even, payback, funding need and owner income', () => {
    // contribution margin ratio = 265,000 / 300,000 = 0.883333…
    //   before owner compensation: 19,000 / 0.883333 = 21,509.43 (43.02% of 50,000)
    //   after owner compensation : 24,000 / 0.883333 = 27,169.81 (54.34%)
    expect(result.summary.breakEven.beforeOwnerCompensation).toEqual({
      fixedCostBase: 19_000,
      monthlyRevenueRequired: 21_509.43,
      pctOfSteadyStateRevenue: 43.02,
    });
    expect(result.summary.breakEven.afterOwnerCompensation).toEqual({
      fixedCostBase: 24_000,
      monthlyRevenueRequired: 27_169.81,
      pctOfSteadyStateRevenue: 54.34,
    });
    expect(result.summary.breakEven.firstOperatingMonthEbitdaPositive).toBe(5);
    expect(result.summary.breakEven.firstOperatingMonthNetCashPositive).toBe(5);

    expect(result.summary.capitalRecovery).toEqual({
      paybackOperatingMonth: 5,
      withinHorizon: true,
      paybackOperatingMonthIncludingOwnerComp: 5,
      cumulativeCashAtHorizonEnd: 364_000,
    });
    // four months without income before the first harvest: 4 × 24,000 = 96,000 beyond the upfront 120,000
    expect(result.summary.peakFundingNeed).toBe(96_000);
    expect(result.summary.peakFundingNeedMonthIndex).toBe(4);
    expect(result.summary.totalOwnerCashRequired).toBe(216_000);

    // (242,000 + 60,000 drawings) / 12 = 25,166.67
    expect(result.summary.ownerIncome.year1AvgMonthly).toBe(25_166.67);
    expect(result.summary.ownerIncome.year2AvgMonthly).toBe(25_166.67);
    expect(result.summary.ownerIncome.year3AvgMonthly).toBeNull();
    expect(warningCodes(result)).toEqual(['RESULTS_ARE_PRE_TAX', 'CASH_SHORTFALL']);
  });

  it('ramp-up applies to harvest volume only when applyToAreaYield is set', () => {
    const ramped = runModel({ ...SYNTHETIC_FARM, rampUp: { startPct: 50, monthsToSteadyState: 6, applyToAreaYield: true } });
    // month 5 ramp = 0.5 + 0.5 × 4/6 = 5/6 -> units 2,000 × 5/6 = 1,666.67 ; revenue 250,000
    expect(month(ramped, 5).streams[0]).toMatchObject({ units: 1_666.67, revenue: 250_000 });
    // month 10 is past the 6 ramp months -> full harvest
    expect(month(ramped, 10).revenue).toBe(300_000);
  });

  it('seasonality multipliers do not apply to area_yield streams', () => {
    const seasonal = runModel({ ...SYNTHETIC_FARM, seasonality: { multipliers: [2, 2, 2, 0, 0, 0, 0, 0, 0, 2, 2, 2] } });
    expect(month(seasonal, 5).revenue).toBe(300_000);
    expect(month(seasonal, 10).revenue).toBe(300_000);
  });
});
