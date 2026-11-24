import { describe, expect, it } from 'vitest';
import { runModel } from '../src/index';
import { SYNTHETIC_MANUFACTURING } from './fixtures';
import { month, warningCodes, year } from './helpers';

/**
 * GOLDEN EXAMPLE (b): SYNTHETIC_MANUFACTURING — `capacity_utilization` driver,
 * term loan with a 6-month moratorium, back-ended subsidy adjusted against the loan,
 * owner on salary, 25% flat tax with loss carry-forward. Synthetic round numbers only.
 * The expected figures were derived independently of the engine (plain arithmetic below).
 *
 * LOAN  1,200,000 at 12% p.a. -> 1% per month. Disbursed at the start of the 3 pre-operating months.
 *   pre-operating interest = 3 × 12,000 = 36,000 (interest only)
 *
 * INITIAL INVESTMENT
 *   capex 1,200,000 + 600,000                                   = 1,800,000
 *   contingency 0% ; pre-operative expenses                     =   180,000
 *   deposits                                                    =    50,000
 *   pre-operating costs = rent 3 × 40,000 + interest 36,000     =   156,000
 *   total                                                       = 2,186,000
 *   ownerEquityUpfront = 2,186,000 − 1,200,000                  =   986,000
 *
 * STEADY-STATE MONTH
 *   units = 10,000 × 0.8 = 8,000 ; revenue = 8,000 × 100         = 800,000
 *   raw material 50 × 8,000 = 400,000 ; power 5 × 8,000 = 40,000 -> variableCogs 440,000
 *   commission 5% × 800,000 = 40,000 -> totalVariableCosts 480,000
 *   contribution = 320,000 (40%)
 *   fixed costs 40,000 + 10,000 = 50,000 ; staff 5 × 12,000 + 20,000 = 80,000 -> base 130,000
 *   fixedCogs = maintenance 10,000 + operators 60,000 = 70,000 -> cogs 510,000, gross profit 290,000 (36.25%)
 *   EBITDA = 320,000 − 130,000 = 190,000 (23.75%)
 *   depreciation = 1,200,000 × 90% / 120 + 600,000 / 300 = 9,000 + 2,000 = 11,000
 *   amortisation = 180,000 / min(60, 36) = 5,000
 *
 * RAMP startPct 40, 3 months: m1 0.4, m2 0.6, m3 0.8, m4+ 1.0
 *   EBITDA = 320,000 × ramp − 130,000 : m1 −2,000 | m2 62,000 | m3 126,000 | m4+ 190,000
 *   NWC at 100% = inventory 440,000 × 15/30 + receivables 800,000 × 30/30 − payables 480,000 × 15/30
 *               = 220,000 + 800,000 − 240,000 = 780,000 ; NWC(ramp) = 780,000 × ramp
 *     changes: m1 312,000 | m2 156,000 | m3 156,000 | m4 156,000 | then 0
 *
 * PROFIT BEFORE TAX = EBITDA − owner salary 50,000 − 11,000 − 5,000 − interest
 *   m1 −2,000 − 50,000 − 16,000 − 12,000 = −80,000
 *   m2 −16,000 | m3 48,000 | m4…m7 112,000
 *
 * TAX 25%, losses carried forward. Loss pool from the pre-operating period = 156,000.
 *   tax accrues on max(0, year-to-date PBT − loss pool):
 *   YTD: m1 −80,000 | m2 −96,000 | m3 −48,000 | m4 64,000 (< 156,000 -> 0)
 *        m5 176,000 -> 25% × 20,000 = 5,000   -> tax m5 = 5,000
 *        m6 288,000 -> 25% × 132,000 = 33,000 -> tax m6 = 28,000
 *        afterwards tax = 25% × that month's PBT
 *
 * NET CASH FLOW = EBITDA − owner 50,000 − interest − tax − ΔNWC − principal
 *   m1 −2,000 − 50,000 − 12,000 − 0 − 312,000 = −376,000  -> cum −1,362,000
 *   m2 62,000 − 62,000 − 156,000              = −156,000  -> cum −1,518,000
 *   m3 126,000 − 62,000 − 156,000             =  −92,000  -> cum −1,610,000
 *   m4 190,000 − 62,000 − 156,000             =  −28,000  -> cum −1,638,000  (lowest point)
 *   m5 190,000 − 62,000 − 5,000               =  123,000  -> cum −1,515,000
 *   m6 190,000 − 62,000 − 28,000              =  100,000  -> cum −1,415,000
 *   peakFundingNeed = 1,638,000 − 986,000 = 652,000
 *
 * AMORTISATION SCHEDULE (moratorium m1–m6, 24 instalments m7–m30)
 *   1.01^24 = 1.2697346485
 *   EMI = 1,200,000 × 0.01 × 1.2697346485 / 0.2697346485 = 56,488.17
 *   m7: interest 12,000.00 ; principal 56,488.17 − 12,000.00 = 44,488.17 ; balance 1,155,511.83
 *   m8: interest 1% × 1,155,511.83 = 11,555.12 ; principal 44,933.05 ; balance 1,110,578.78
 *   …   balance after the 6th instalment (m12) = 926,308.13
 *   SUBSIDY 300,000 received at the end of m12 and adjusted against the loan -> balance 626,308.13
 *   m13: 18 instalments remain; EMI = 626,308.13 × 0.01 × 1.01^18 / (1.01^18 − 1) = 38,193.55
 *        interest 6,263.08 ; principal 31,930.47 ; balance 594,377.66
 *   m30: last instalment; balance 0
 */
describe('golden (b): SYNTHETIC_MANUFACTURING (capacity_utilization + loan + subsidy + tax)', () => {
  const result = runModel(SYNTHETIC_MANUFACTURING);

  it('initial investment and funding', () => {
    expect(result.initialInvestment).toEqual({
      capex: 1_800_000,
      contingency: 0,
      preOperativeExpenses: 180_000,
      deposits: 50_000,
      refundableDeposits: 50_000,
      preOperatingCosts: 156_000,
      preOperatingCostsBreakdown: { fixedCosts: 120_000, staffCosts: 0, interest: 36_000 },
      total: 2_186_000,
    });
    expect(result.funding).toEqual({ loan: 1_200_000, subsidy: 300_000, ownerEquityUpfront: 986_000 });
  });

  it('pre-operating months carry rent and interest on the full loan', () => {
    // operating month 1 is April -> pre-operating months are January, February, March
    expect(result.monthly.slice(0, 3).map((row) => row.calendarMonth)).toEqual([1, 2, 3]);
    for (const index of [-3, -2, -1]) {
      expect(month(result, index)).toMatchObject({
        phase: 'pre_operating',
        fixedCosts: 40_000,
        interest: 12_000,
        operatingProfitBeforeOwnerComp: -40_000,
        profitBeforeTax: -52_000,
        tax: 0,
        loanPrincipalRepayment: 0,
        preOperatingFunding: 52_000,
        netCashFlow: 0,
        cumulativeCash: -986_000,
        loanBalance: 1_200_000,
      });
    }
  });

  it('operating month 1 (ramp 40%)', () => {
    expect(month(result, 1)).toMatchObject({
      calendarMonth: 4,
      rampMultiplier: 0.4,
      revenue: 320_000, // 10,000 × 0.8 × 0.4 = 3,200 units × 100
      variableCogs: 176_000, // 55 × 3,200
      fixedCogs: 70_000, // maintenance 10,000 + operators 60,000
      cogs: 246_000,
      grossProfit: 74_000,
      otherVariableCosts: 16_000, // 5% × 320,000
      totalVariableCosts: 192_000,
      contribution: 128_000,
      fixedCosts: 50_000,
      staffCosts: 80_000,
      operatingProfitBeforeOwnerComp: -2_000,
      ownerCompensation: 50_000,
      operatingProfitAfterOwnerComp: -52_000,
      depreciation: 11_000,
      amortisation: 5_000,
      interest: 12_000,
      profitBeforeTax: -80_000,
      tax: 0,
      netProfit: -80_000,
      netProfitAfterOwnerComp: -80_000, // salary already deducted
      netWorkingCapital: 312_000, // 780,000 × 0.4
      workingCapitalChange: 312_000,
      loanPrincipalRepayment: 0,
      netCashFlow: -376_000,
      cumulativeCash: -1_362_000,
      loanBalance: 1_200_000,
    });
    expect(month(result, 1).streams[0]).toEqual({ key: 'widgets', units: 3_200, revenue: 320_000, variableCosts: 192_000 });
  });

  it('ramp-up, moratorium and the loss carry-forward (months 2–6)', () => {
    const expected: Array<[number, number, number, number, number, number]> = [
      // month, EBITDA, PBT, tax, netCashFlow, cumulativeCash
      [2, 62_000, -16_000, 0, -156_000, -1_518_000],
      [3, 126_000, 48_000, 0, -92_000, -1_610_000],
      [4, 190_000, 112_000, 0, -28_000, -1_638_000],
      [5, 190_000, 112_000, 5_000, 123_000, -1_515_000],
      [6, 190_000, 112_000, 28_000, 100_000, -1_415_000],
    ];
    for (const [m, ebitda, pbt, tax, netCashFlow, cumulativeCash] of expected) {
      const row = month(result, m);
      expect(row.operatingProfitBeforeOwnerComp, `EBITDA m${m}`).toBe(ebitda);
      expect(row.profitBeforeTax, `PBT m${m}`).toBe(pbt);
      expect(row.tax, `tax m${m}`).toBe(tax);
      expect(row.netCashFlow, `netCashFlow m${m}`).toBe(netCashFlow);
      expect(row.cumulativeCash, `cumulativeCash m${m}`).toBe(cumulativeCash);
      expect(row.loanPrincipalRepayment, `principal m${m}`).toBe(0); // moratorium
      expect(row.interest, `interest m${m}`).toBe(12_000);
      expect(row.loanBalance, `balance m${m}`).toBe(1_200_000);
    }
  });

  it('EMI phase: first instalments after the moratorium', () => {
    expect(month(result, 7)).toMatchObject({
      interest: 12_000,
      loanPrincipalRepayment: 44_488.17, // 56,488.17 − 12,000
      loanBalance: 1_155_511.83,
      profitBeforeTax: 112_000,
      tax: 28_000,
      netCashFlow: 55_511.83, // 190,000 − 50,000 − 12,000 − 28,000 − 44,488.17
      cumulativeCash: -1_359_488.17,
    });
    expect(month(result, 8)).toMatchObject({
      interest: 11_555.12, // 1% × 1,155,511.83
      loanPrincipalRepayment: 44_933.05, // 56,488.17 − 11,555.12
      loanBalance: 1_110_578.78,
      profitBeforeTax: 112_444.88, // 190,000 − 50,000 − 16,000 − 11,555.12
      tax: 28_111.22,
      netCashFlow: 55_400.61, // 190,000 − 50,000 − 11,555.12 − 28,111.22 − 44,933.05
      cumulativeCash: -1_304_087.55,
    });
    // the EMI (interest + principal) is constant during months 7–12
    // (each part is rounded separately, so the sum may be off by one paisa)
    for (let m = 7; m <= 12; m++) {
      const row = month(result, m);
      expect(Math.abs(row.interest + row.loanPrincipalRepayment - 56_488.17)).toBeLessThanOrEqual(0.011);
    }
  });

  it('back-ended subsidy reduces the loan at the end of month 12 and the EMI is recomputed', () => {
    expect(month(result, 12)).toMatchObject({
      interest: 9_730.66,
      loanPrincipalRepayment: 46_757.51,
      subsidyAppliedToLoan: 300_000,
      subsidyInflow: 0, // adjusted against the loan: no cash reaches the business
      loanBalance: 626_308.13, // 926,308.13 − 300,000
      tax: 28_567.34,
      netCashFlow: 54_944.5,
      cumulativeCash: -1_083_619.72,
    });
    expect(month(result, 13)).toMatchObject({
      interest: 6_263.08, // 1% × 626,308.13
      loanPrincipalRepayment: 31_930.47, // new EMI 38,193.55 − 6,263.08
      subsidyAppliedToLoan: 0,
      loanBalance: 594_377.66,
      profitBeforeTax: 117_736.92,
      tax: 29_434.23, // year 2: the loss pool is used up, 25% × PBT
      netCashFlow: 72_372.22,
      cumulativeCash: -1_011_247.5,
    });
    for (let m = 13; m <= 30; m++) {
      const row = month(result, m);
      expect(Math.abs(row.interest + row.loanPrincipalRepayment - 38_193.55)).toBeLessThanOrEqual(0.011);
    }
  });

  it('loan is fully repaid at the end of the tenure (month 30)', () => {
    expect(month(result, 29).loanBalance).toBe(37_815.4);
    expect(month(result, 30)).toMatchObject({
      interest: 378.15, // 1% × 37,815.40
      loanPrincipalRepayment: 37_815.4,
      loanBalance: 0,
      cumulativeCash: 206_190.29,
    });
    // after the loan: PBT = 190,000 − 50,000 − 16,000 = 124,000 ; tax 31,000 ; NCF = 190,000 − 50,000 − 31,000
    expect(month(result, 31)).toMatchObject({
      interest: 0,
      loanPrincipalRepayment: 0,
      profitBeforeTax: 124_000,
      tax: 31_000,
      netProfit: 93_000,
      netCashFlow: 109_000,
      cumulativeCash: 315_190.29,
    });
    expect(month(result, 36).cumulativeCash).toBe(860_190.29); // 315,190.29 + 5 × 109,000
    expect(result.summary.loanBalanceAtHorizonEnd).toBe(0);
    // principal repaid by instalments = 1,200,000 − 300,000 subsidy
    expect(result.summary.totals.interest).toBe(234_412.94); // 36,000 pre-operating + 198,412.94 operating
  });

  it('annual aggregates and DSCR', () => {
    // Year 1: EBITDA = −2,000 + 62,000 + 126,000 + 9 × 190,000 = 1,896,000
    //         PBT 966,762.87 ; tax = 25% × (966,762.87 − 156,000 loss pool) = 202,690.72
    //         debt service = interest 137,237.13 + principal 273,691.87 = 410,929.00
    //         DSCR = (1,896,000 − 600,000 owner − 202,690.72) / 410,929.00 = 2.66
    //         DSCR before owner compensation = (1,896,000 − 202,690.72) / 410,929.00 = 4.12
    expect(year(result, 1)).toMatchObject({
      revenue: 8_640_000, // 800,000 × (0.4 + 0.6 + 0.8 + 9)
      operatingProfitBeforeOwnerComp: 1_896_000,
      ownerCompensation: 600_000,
      interest: 137_237.13,
      loanPrincipalRepayment: 273_691.87,
      profitBeforeTax: 966_762.87,
      tax: 202_690.72,
      subsidyAppliedToLoan: 300_000,
      workingCapitalChange: 780_000,
      netCashFlow: -97_619.72,
      cumulativeCashEnd: -1_083_619.72,
      loanBalanceEnd: 626_308.13,
      dscr: 2.66,
      dscrBeforeOwnerComp: 4.12,
    });
    expect(year(result, 2)).toMatchObject({
      operatingProfitBeforeOwnerComp: 2_280_000,
      interest: 53_364.33,
      loanPrincipalRepayment: 404_958.29,
      tax: 358_658.92, // 25% × 1,434,635.67
      netCashFlow: 863_018.46,
      dscr: 2.88, // (2,280,000 − 600,000 − 358,658.92) / 458,322.62
      dscrBeforeOwnerComp: 4.19,
    });
    expect(year(result, 3)).toMatchObject({
      interest: 7_811.48,
      loanPrincipalRepayment: 221_349.83,
      tax: 370_047.13,
      netCashFlow: 1_080_791.56,
      loanBalanceEnd: 0,
      dscr: 5.72,
      dscrBeforeOwnerComp: 8.33,
    });
    expect(year(result, 0)).toMatchObject({ months: 3, interest: 36_000, fixedCosts: 120_000, dscr: null });
  });

  it('summary: steady state, break-even, funding need, DSCR, owner income', () => {
    const { summary } = result;
    expect(summary.steadyState).toMatchObject({
      referenceOperatingMonth: 4,
      revenue: 800_000,
      variableCogs: 440_000,
      cogs: 510_000,
      grossProfit: 290_000,
      grossMarginPct: 36.25,
      totalVariableCosts: 480_000,
      contribution: 320_000,
      contributionMarginPct: 40,
      monthlyFixedCostBase: 130_000,
      ebitda: 190_000,
      ebitdaMarginPct: 23.75,
      ownerCompensation: 50_000,
      operatingProfitAfterOwnerComp: 140_000,
    });

    // break-even: fixed base ÷ 40% contribution margin
    //   before owner compensation: (130,000 + interest 12,000) / 0.4            = 355,000 (44.38%)
    //   after owner compensation : (130,000 + 12,000 + 50,000) / 0.4            = 480,000 (60%)
    //   after owner comp. + EMI  : (130,000 + 50,000 + EMI 56,488.17) / 0.4     = 591,220.42 (73.90%)
    expect(summary.breakEven.beforeOwnerCompensation).toEqual({
      fixedCostBase: 142_000,
      monthlyRevenueRequired: 355_000,
      pctOfSteadyStateRevenue: 44.38,
    });
    expect(summary.breakEven.afterOwnerCompensation).toEqual({
      fixedCostBase: 192_000,
      monthlyRevenueRequired: 480_000,
      pctOfSteadyStateRevenue: 60,
    });
    expect(summary.breakEven.afterOwnerCompensationAndLoanEmi).toEqual({
      fixedCostBase: 236_488.17,
      monthlyRevenueRequired: 591_220.42,
      pctOfSteadyStateRevenue: 73.9,
    });
    expect(summary.breakEven.components).toMatchObject({ loanInterest: 12_000, loanEmi: 56_488.17, ownerCompensation: 50_000 });
    expect(summary.breakEven.firstOperatingMonthEbitdaPositive).toBe(2);
    expect(summary.breakEven.firstOperatingMonthProfitAfterOwnerCompPositive).toBe(2); // 62,000 − 50,000
    expect(summary.breakEven.firstOperatingMonthNetCashPositive).toBe(5);

    expect(summary.peakFundingNeed).toBe(652_000);
    expect(summary.peakFundingNeedMonthIndex).toBe(4);
    expect(summary.totalOwnerCashRequired).toBe(1_638_000);

    // payback: cumulativeCash is −6,792.55 after m27 and +64,294.72 after m28
    // counting the 50,000 salary as recovery: −116,743.34 after m15, +5,387.00 after m16
    expect(summary.capitalRecovery).toEqual({
      paybackOperatingMonth: 28,
      withinHorizon: true,
      paybackOperatingMonthIncludingOwnerComp: 16,
      cumulativeCashAtHorizonEnd: 860_190.29,
    });

    expect(summary.minDscr).toBe(2.66);
    // Σ cash available (after owner pay) ÷ Σ debt service over the three years = 3.39
    expect(summary.avgDscr).toBe(3.39);
    expect(summary.minDscrBeforeOwnerComp).toBe(4.12);
    expect(summary.avgDscrBeforeOwnerComp).toBe(5.03);

    // owner income = (netCashFlow + owner salary) / 12
    //   year 1: (−97,619.72 + 600,000) / 12 = 41,865.02  -> the stated 50,000 is NOT fully covered
    //   year 2: (863,018.46 + 600,000) / 12 = 121,918.20
    //   year 3: (1,080,791.56 + 600,000) / 12 = 140,065.96
    expect(summary.ownerIncome.year1AvgMonthly).toBe(41_865.02);
    expect(summary.ownerIncome.year2AvgMonthly).toBe(121_918.2);
    expect(summary.ownerIncome.year3AvgMonthly).toBe(140_065.96);
    expect(summary.ownerIncome.components[0]).toMatchObject({
      avgMonthlyStatedOwnerCompensation: 50_000,
      avgMonthlyAffordableOwnerCompensation: 41_865.02,
      avgMonthlyResidualNetCashFlow: -8_134.98, // −97,619.72 / 12
      avgMonthlyOperatingProfitBeforeOwnerComp: 158_000, // 1,896,000 / 12
      avgMonthlyRevenue: 720_000,
    });
  });

  it('warnings', () => {
    // tax is modelled -> no RESULTS_ARE_PRE_TAX; the ramp-up needs 652,000 beyond the upfront equity
    expect(warningCodes(result)).toEqual(['CASH_SHORTFALL']);
    expect(result.warnings[0]?.message).toContain('652000.00');
  });
});
