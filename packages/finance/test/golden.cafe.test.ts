import { describe, expect, it } from 'vitest';
import { runModel } from '../src/index';
import { SYNTHETIC_CAFE } from './fixtures';
import { month, warningCodes, year } from './helpers';

/**
 * GOLDEN EXAMPLE (a): SYNTHETIC_CAFE — `transactions` driver.
 * Every expected number is derived by hand in the comments. Synthetic round numbers only.
 *
 * INITIAL INVESTMENT
 *   capex                 = 600,000 + 360,000                         =   960,000
 *   contingency           = 5% × 960,000                              =    48,000
 *   pre-operative expenses                                            =    72,000
 *   deposits                                                          =   150,000
 *   pre-operating costs   = rent 50,000 × 2 months                    =   100,000
 *                         + crew 4 × 15,000 × 1 month (last month)    =    60,000
 *                                                                     =   160,000
 *   total                                                             = 1,390,000
 *   no loan  ->  ownerEquityUpfront = 1,390,000
 *
 * STEADY-STATE MONTH (ramp 100%)
 *   units        = 100/day × 30 days                 = 3,000 transactions
 *   revenue      = 3,000 × 200                       = 600,000
 *   ingredients  = 35% × 600,000                     = 210,000  (cogs)
 *   packaging    = 10 × 3,000                        =  30,000  (cogs)
 *   payment fees = 2% × 600,000                      =  12,000  (operating)
 *   variableCogs = 240,000; totalVariableCosts = 252,000
 *   contribution = 600,000 − 252,000                 = 348,000  (58%)
 *   fixed costs  = 50,000 + 20,000                   =  70,000
 *   staff        = 4 × 15,000                        =  60,000
 *   EBITDA       = 348,000 − 130,000                 = 218,000  (36.33%)
 *   owner drawings 40,000 -> operating profit after owner compensation 178,000
 *
 * RAMP  startPct 50, monthsToSteadyState 5:  m1 0.5, m2 0.6, m3 0.7, m4 0.8, m5 0.9, m6+ 1.0
 *   EBITDA(ramp) = 348,000 × ramp − 130,000
 *     m1 44,000 | m2 78,800 | m3 113,600 | m4 148,400 | m5 183,200 | m6+ 218,000
 *
 * WORKING CAPITAL at 100%  (inventory 6 days, payables 3 days, receivables 0)
 *   inventory = 240,000 × 6/30 = 48,000 ; payables = 252,000 × 3/30 = 25,200 ; NWC = 22,800
 *   NWC(ramp) = 22,800 × ramp -> m1 11,400 (change 11,400), then +2,280 per month until m6, then 0
 *
 * NET CASH FLOW = EBITDA − drawings 40,000 − working-capital change   (no tax, no loan)
 *     m1  44,000 − 40,000 − 11,400 =  −7,400
 *     m2  78,800 − 40,000 −  2,280 =  36,520
 *     m3 113,600 − 40,000 −  2,280 =  71,320
 *     m4 148,400 − 40,000 −  2,280 = 106,120
 *     m5 183,200 − 40,000 −  2,280 = 140,920
 *     m6 218,000 − 40,000 −  2,280 = 175,720
 *     m7+ 218,000 − 40,000         = 178,000
 *
 * CUMULATIVE CASH (starts at −1,390,000)
 *     m1 −1,397,400 | m2 −1,360,880 | m3 −1,289,560 | m4 −1,183,440 | m5 −1,042,520 | m6 −866,800
 *     m7 −688,800 | m8 −510,800 | m9 −332,800 | m10 −154,800 | m11 +23,200  -> payback month 11
 *     m12 201,200 ; m24 = 201,200 + 12 × 178,000 = 2,337,200
 *   lowest point −1,397,400 in m1 -> peakFundingNeed = 1,397,400 − 1,390,000 = 7,400
 */
describe('golden (a): SYNTHETIC_CAFE (transactions)', () => {
  const result = runModel(SYNTHETIC_CAFE);

  it('initial investment and funding', () => {
    expect(result.initialInvestment).toEqual({
      capex: 960_000,
      contingency: 48_000,
      preOperativeExpenses: 72_000,
      deposits: 150_000,
      refundableDeposits: 150_000,
      preOperatingCosts: 160_000,
      preOperatingCostsBreakdown: { fixedCosts: 100_000, staffCosts: 60_000, interest: 0 },
      total: 1_390_000,
    });
    expect(result.funding).toEqual({ loan: 0, subsidy: 0, ownerEquityUpfront: 1_390_000 });
  });

  it('pre-operating months: costs are itemised and funded from the initial investment', () => {
    expect(result.monthly).toHaveLength(2 + 24);
    const first = month(result, -2);
    // operating month 1 is January, so the two months before are November and December
    expect(first).toMatchObject({
      phase: 'pre_operating',
      operatingYear: 0,
      calendarMonth: 11,
      revenue: 0,
      fixedCosts: 50_000,
      staffCosts: 0,
      operatingProfitBeforeOwnerComp: -50_000,
      ownerCompensation: 0,
      preOperatingFunding: 50_000,
      netCashFlow: 0,
      cumulativeCash: -1_390_000,
    });
    const second = month(result, -1);
    expect(second).toMatchObject({
      calendarMonth: 12,
      fixedCosts: 50_000,
      staffCosts: 60_000, // crew starts 1 month before opening
      operatingProfitBeforeOwnerComp: -110_000,
      profitBeforeTax: -110_000,
      preOperatingFunding: 110_000,
      netCashFlow: 0,
      cumulativeCash: -1_390_000,
    });
  });

  it('operating month 1 (ramp 50%)', () => {
    const row = month(result, 1);
    expect(row).toMatchObject({
      phase: 'operating',
      operatingYear: 1,
      calendarMonth: 1,
      rampMultiplier: 0.5,
      seasonalityMultiplier: 1,
      revenue: 300_000, // 1,500 × 200
      variableCogs: 120_000, // 35% × 300,000 + 10 × 1,500 = 105,000 + 15,000
      fixedCogs: 0,
      cogs: 120_000,
      grossProfit: 180_000,
      otherVariableCosts: 6_000, // 2% × 300,000
      totalVariableCosts: 126_000,
      contribution: 174_000,
      fixedCosts: 70_000,
      staffCosts: 60_000,
      operatingProfitBeforeOwnerComp: 44_000, // 174,000 − 130,000
      ownerCompensation: 40_000,
      operatingProfitAfterOwnerComp: 4_000,
      depreciation: 15_000, // 600,000/60 + 360,000/72 = 10,000 + 5,000
      amortisation: 5_000, // (72,000 + 48,000 contingency) / min(60, 24) months
      interest: 0,
      profitBeforeTax: 24_000, // 44,000 − 15,000 − 5,000 (drawings are not an expense)
      tax: 0,
      netProfit: 24_000,
      netProfitAfterOwnerComp: -16_000, // 24,000 − 40,000
      netWorkingCapital: 11_400, // 120,000 × 6/30 − 126,000 × 3/30 = 24,000 − 12,600
      workingCapitalChange: 11_400,
      capexOutflow: 0,
      netCashFlow: -7_400, // 44,000 − 40,000 − 11,400
      cumulativeCash: -1_397_400,
      loanBalance: 0,
    });
    expect(row.streams).toEqual([{ key: 'counter', units: 1_500, revenue: 300_000, variableCosts: 126_000 }]);
  });

  it('ramp-up months 2–6 and the first steady months', () => {
    const expected: Array<[number, number, number, number, number]> = [
      // month, ramp, EBITDA, netCashFlow, cumulativeCash
      [2, 0.6, 78_800, 36_520, -1_360_880],
      [3, 0.7, 113_600, 71_320, -1_289_560],
      [4, 0.8, 148_400, 106_120, -1_183_440],
      [5, 0.9, 183_200, 140_920, -1_042_520],
      [6, 1, 218_000, 175_720, -866_800],
      [7, 1, 218_000, 178_000, -688_800],
      [10, 1, 218_000, 178_000, -154_800],
      [11, 1, 218_000, 178_000, 23_200],
      [12, 1, 218_000, 178_000, 201_200],
      [24, 1, 218_000, 178_000, 2_337_200],
    ];
    for (const [m, ramp, ebitda, netCashFlow, cumulativeCash] of expected) {
      const row = month(result, m);
      expect(row.rampMultiplier, `ramp m${m}`).toBe(ramp);
      expect(row.operatingProfitBeforeOwnerComp, `EBITDA m${m}`).toBe(ebitda);
      expect(row.netCashFlow, `netCashFlow m${m}`).toBe(netCashFlow);
      expect(row.cumulativeCash, `cumulativeCash m${m}`).toBe(cumulativeCash);
    }
    expect(month(result, 6).netWorkingCapital).toBe(22_800);
    expect(month(result, 7).workingCapitalChange).toBe(0);
  });

  it('annual aggregates', () => {
    // year 0 = the two pre-operating months
    expect(year(result, 0)).toMatchObject({
      months: 2,
      revenue: 0,
      fixedCosts: 100_000,
      staffCosts: 60_000,
      operatingProfitBeforeOwnerComp: -160_000,
      preOperatingFunding: 160_000,
      netCashFlow: 0,
      cumulativeCashEnd: -1_390_000,
    });
    // year 1: Σ ramp = 0.5+0.6+0.7+0.8+0.9 + 7×1 = 10.5
    //   revenue = 600,000 × 10.5 = 6,300,000
    //   EBITDA  = 348,000 × 10.5 − 130,000 × 12 = 3,654,000 − 1,560,000 = 2,094,000
    //   PBT     = 2,094,000 − 12 × (15,000 + 5,000) = 1,854,000
    //   ΔNWC    = 22,800 ; netCashFlow = 2,094,000 − 480,000 − 22,800 = 1,591,200
    expect(year(result, 1)).toMatchObject({
      months: 12,
      revenue: 6_300_000,
      operatingProfitBeforeOwnerComp: 2_094_000,
      ownerCompensation: 480_000,
      operatingProfitAfterOwnerComp: 1_614_000,
      depreciation: 180_000,
      amortisation: 60_000,
      profitBeforeTax: 1_854_000,
      netProfit: 1_854_000,
      netProfitAfterOwnerComp: 1_374_000,
      workingCapitalChange: 22_800,
      netCashFlow: 1_591_200,
      cumulativeCashEnd: 201_200,
      dscr: null,
    });
    expect(year(result, 1).unitsByStream).toEqual([{ key: 'counter', units: 31_500, revenue: 6_300_000 }]);
    // year 2: 12 steady months
    expect(year(result, 2)).toMatchObject({
      revenue: 7_200_000,
      operatingProfitBeforeOwnerComp: 2_616_000,
      netCashFlow: 2_136_000, // 12 × 178,000
      cumulativeCashEnd: 2_337_200,
    });
  });

  it('steady-state summary (reference month = monthsToSteadyState + 1 = 6)', () => {
    expect(result.summary.steadyState).toEqual({
      referenceOperatingMonth: 6,
      reachedWithinHorizon: true,
      streams: [{ key: 'counter', unitsPerMonth: 3_000, pricePerUnit: 200, revenue: 600_000 }],
      revenue: 600_000,
      variableCogs: 240_000,
      cogs: 240_000,
      grossProfit: 360_000,
      grossMarginPct: 60,
      totalVariableCosts: 252_000,
      contribution: 348_000,
      contributionMarginPct: 58,
      fixedCosts: 70_000,
      staffCosts: 60_000,
      monthlyFixedCostBase: 130_000,
      ebitda: 218_000,
      ebitdaMarginPct: 36.33, // 218,000 / 600,000 = 36.333…%
      ownerCompensation: 40_000,
      operatingProfitAfterOwnerComp: 178_000,
    });
    // the steady-state summary equals the actual row of the reference month (no seasonality here)
    const row = month(result, 6);
    expect(row.revenue).toBe(result.summary.steadyState.revenue);
    expect(row.operatingProfitBeforeOwnerComp).toBe(result.summary.steadyState.ebitda);
  });

  it('break-even', () => {
    const breakEven = result.summary.breakEven;
    // before owner compensation: 130,000 / 0.58 = 224,137.93  -> 37.36% of 600,000
    expect(breakEven.beforeOwnerCompensation).toEqual({
      fixedCostBase: 130_000,
      monthlyRevenueRequired: 224_137.93,
      pctOfSteadyStateRevenue: 37.36,
    });
    // after owner compensation: (130,000 + 40,000) / 0.58 = 293,103.45 -> 48.85%
    expect(breakEven.afterOwnerCompensation).toEqual({
      fixedCostBase: 170_000,
      monthlyRevenueRequired: 293_103.45,
      pctOfSteadyStateRevenue: 48.85,
    });
    // no loan: the EMI level equals the after-owner-compensation level
    expect(breakEven.afterOwnerCompensationAndLoanEmi).toEqual(breakEven.afterOwnerCompensation);
    // headline = after owner compensation
    expect(breakEven.monthlyRevenueRequired).toBe(293_103.45);
    expect(breakEven.pctOfSteadyStateRevenue).toBe(48.85);
    expect(breakEven.components).toEqual({
      fixedCosts: 70_000,
      staffCosts: 60_000,
      loanInterest: 0,
      loanEmi: 0,
      ownerCompensation: 40_000,
      contributionMarginPct: 58,
    });
    expect(breakEven.firstOperatingMonthEbitdaPositive).toBe(1); // 44,000 > 0
    expect(breakEven.firstOperatingMonthProfitAfterOwnerCompPositive).toBe(1); // 4,000 > 0
    expect(breakEven.firstOperatingMonthNetCashPositive).toBe(2); // m1 is −7,400
  });

  it('capital recovery, peak funding need and owner income', () => {
    expect(result.summary.capitalRecovery).toEqual({
      paybackOperatingMonth: 11,
      withinHorizon: true,
      // cumulative cash BEFORE drawings: −1,390,000 +32,600 +76,520 +111,320 +146,120 +180,920 +215,720
      //   = −626,800 after m6; +218,000 per month -> −408,800, −190,800, +27,200 in m9
      paybackOperatingMonthIncludingOwnerComp: 9,
      cumulativeCashAtHorizonEnd: 2_337_200,
    });
    expect(result.summary.peakFundingNeed).toBe(7_400);
    expect(result.summary.peakFundingNeedMonthIndex).toBe(1);
    expect(result.summary.totalOwnerCashRequired).toBe(1_397_400);
    expect(result.summary.minDscr).toBeNull();
    expect(result.summary.avgDscr).toBeNull();

    // year 1: (netCashFlow 1,591,200 + drawings 480,000) / 12 = 172,600
    // year 2: 178,000 + 40,000 = 218,000 ; year 3 is outside the 24-month horizon
    expect(result.summary.ownerIncome.year1AvgMonthly).toBe(172_600);
    expect(result.summary.ownerIncome.year2AvgMonthly).toBe(218_000);
    expect(result.summary.ownerIncome.year3AvgMonthly).toBeNull();
    expect(result.summary.ownerIncome.components[0]).toEqual({
      year: 1,
      complete: true,
      avgMonthlyRevenue: 525_000, // 6,300,000 / 12
      avgMonthlyOperatingProfitBeforeOwnerComp: 174_500, // 2,094,000 / 12
      avgMonthlyCashBeforeOwnerComp: 172_600,
      avgMonthlyStatedOwnerCompensation: 40_000,
      avgMonthlyAffordableOwnerCompensation: 40_000,
      avgMonthlyResidualNetCashFlow: 132_600, // 1,591,200 / 12
      ownerIncomeAvgMonthly: 172_600,
    });
    expect(result.summary.ownerIncome.components[2]?.complete).toBe(false);
  });

  it('totals and warnings', () => {
    expect(result.summary.totals).toEqual({
      revenue: 13_500_000, // 6,300,000 + 7,200,000
      operatingProfitBeforeOwnerComp: 4_550_000, // −160,000 + 2,094,000 + 2,616,000
      ownerCompensation: 960_000,
      depreciation: 360_000,
      amortisation: 120_000, // fully amortised over the 24-month horizon
      interest: 0,
      tax: 0,
      netProfit: 4_070_000, // 4,550,000 − 360,000 − 120,000
      netCashFlow: 3_727_200, // 1,591,200 + 2,136,000
    });
    // month 1 needs 7,400 more than the upfront equity -> CASH_SHORTFALL; no tax modelled -> RESULTS_ARE_PRE_TAX
    expect(warningCodes(result)).toEqual(['RESULTS_ARE_PRE_TAX', 'CASH_SHORTFALL']);
    expect(result.closure).toBeNull();
  });
});
