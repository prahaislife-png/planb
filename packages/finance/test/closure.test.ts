import { describe, expect, it } from 'vitest';
import { runModel, type ModelInput } from '../src/index';
import { SYNTHETIC_MANUFACTURING } from './fixtures';
import { month, warningCodes } from './helpers';

/**
 * CLOSURE (business-failure) arithmetic — SYNTHETIC numbers, all by hand.
 *
 * INITIAL INVESTMENT
 *   capex: land 100,000 (not depreciable) + equipment 120,000 (5 years -> 2,000 per month) = 220,000
 *   deposits: refundable 30,000 + non-refundable 10,000                                    =  40,000
 *   total 260,000 ; loan 100,000 -> ownerEquityUpfront 160,000
 *
 * EVERY OPERATING MONTH
 *   revenue 10 engagements × 10,000 = 100,000 ; variable cost 20% = 20,000 (cogs)
 *   fixed 30,000 + staff 20,000 -> EBITDA 30,000 ; drawings 10,000
 *   loan 12% p.a., moratorium 12 months -> interest only 1,000 per month
 *   working capital: inventory 20,000 × 15/30 = 10,000 ; receivables 100,000 × 30/30 = 100,000 ;
 *                    payables 20,000 × 15/30 = 10,000 -> NWC 100,000 (built in month 1)
 *   netCashFlow m1 = 30,000 − 10,000 − 1,000 − 100,000 = −81,000
 *   netCashFlow m2…m6 (before closure flows) = 30,000 − 10,000 − 1,000 = 19,000
 *
 * CLOSURE at the end of month 6  (asset recovery 50% of book value, deposits 80%, working capital 90%, costs 15,000)
 *   cumulativeCash before closure flows = −160,000 − 81,000 + 5 × 19,000        = −146,000
 *   asset book value = land 100,000 + equipment (120,000 − 6 × 2,000 = 108,000) =  208,000
 *   asset sale proceeds = 50% × 208,000                                         = +104,000
 *   deposits recovered  = 80% × 30,000 (refundable only)                        =  +24,000
 *   working capital     = 90% × (10,000 + 100,000) − payables 10,000            =  +89,000
 *   closure costs                                                               =  −15,000
 *   loan balance repaid                                                         = −100,000
 *   net closure cash flow                                                       = +102,000
 *   cumulativeCash after closure = −146,000 + 102,000                           =  −44,000
 *   => OWNER CAPITAL LOST = 44,000 (after having drawn 6 × 10,000 = 60,000 as compensation)
 *   lowest cash point: −241,000 after month 1 -> peakFundingNeed 81,000 ; total owner cash required 241,000
 */
const SYNTHETIC_CLOSURE: ModelInput = {
  horizonMonths: 12,
  capex: [
    { key: 'land', label: 'SYNTHETIC land', amount: 100_000, category: 'land' },
    { key: 'equipment', label: 'SYNTHETIC equipment', amount: 120_000, category: 'equipment', usefulLifeYears: 5 },
  ],
  deposits: [
    { key: 'refundable', label: 'SYNTHETIC refundable deposit', amount: 30_000, refundable: true },
    { key: 'non_refundable', label: 'SYNTHETIC non-refundable deposit', amount: 10_000, refundable: false },
  ],
  revenueStreams: [
    {
      key: 'jobs',
      label: 'SYNTHETIC jobs',
      driver: { kind: 'engagements', engagementsPerMonth: 10, realizedFee: 10_000 },
      variableCosts: [{ key: 'materials', label: 'Materials', basis: 'pct_of_revenue', value: 20, classification: 'cogs' }],
    },
  ],
  fixedCosts: [{ key: 'rent', label: 'Rent', category: 'rent', monthlyAmount: 30_000, classification: 'operating' }],
  staff: [{ key: 'assistant', role: 'Assistant', count: 1, monthlySalary: 20_000, classification: 'operating' }],
  owner: { monthlyCompensation: 10_000, treatment: 'drawings' },
  workingCapital: { inventoryDays: 15, receivableDays: 30, payableDays: 15 },
  financing: { loan: { principal: 100_000, annualInterestPct: 12, tenureMonths: 60, moratoriumMonths: 12 } },
  closure: {
    atOperatingMonth: 6,
    assetRecoveryPct: 50,
    refundableDepositRecoveryPct: 80,
    closureCosts: 15_000,
    workingCapitalRecoveryPct: 90,
  },
};

describe('closure scenario: owner capital lost', () => {
  const result = runModel(SYNTHETIC_CLOSURE);

  it('closure block matches the hand calculation', () => {
    expect(result.closure).toEqual({
      atOperatingMonth: 6,
      assetBookValue: 208_000,
      assetSaleProceeds: 104_000,
      depositsRecovered: 24_000,
      workingCapitalRecovered: 89_000,
      closureCosts: 15_000,
      loanRepaidAtClosure: 100_000,
      subsidyNotReceived: 0,
      netClosureCashFlow: 102_000,
      cumulativeCashAfterClosure: -44_000,
      totalOwnerCashRequired: 241_000,
      ownerCompensationDrawn: 60_000,
      ownerCapitalLost: 44_000,
      ownerNetPositionIncludingCompensation: 16_000,
    });
  });

  it('months before, at and after closure', () => {
    expect(result.funding.ownerEquityUpfront).toBe(160_000);
    expect(month(result, 1)).toMatchObject({ netCashFlow: -81_000, cumulativeCash: -241_000 });
    expect(month(result, 5)).toMatchObject({ phase: 'operating', netCashFlow: 19_000, closureCashFlow: 0, cumulativeCash: -165_000 });
    expect(month(result, 6)).toMatchObject({
      phase: 'operating',
      revenue: 100_000,
      operatingProfitBeforeOwnerComp: 30_000,
      closureCashFlow: 102_000,
      netCashFlow: 121_000, // 19,000 + 102,000
      cumulativeCash: -44_000,
      loanBalance: 0,
      netWorkingCapital: 0,
    });
    for (let m = 7; m <= 12; m++) {
      expect(month(result, m)).toMatchObject({
        phase: 'closed',
        revenue: 0,
        fixedCosts: 0,
        staffCosts: 0,
        ownerCompensation: 0,
        interest: 0,
        depreciation: 0,
        netCashFlow: 0,
        cumulativeCash: -44_000,
        loanBalance: 0,
      });
    }
    expect(result.summary.capitalRecovery).toMatchObject({ paybackOperatingMonth: null, withinHorizon: false, cumulativeCashAtHorizonEnd: -44_000 });
    expect(result.summary.peakFundingNeed).toBe(81_000);
    expect(warningCodes(result)).toContain('PAYBACK_NOT_WITHIN_HORIZON');
    expect(warningCodes(result)).not.toContain('LOAN_OUTSTANDING_AT_HORIZON_END');
  });

  it('recovery percentages drive the loss one-for-one', () => {
    // full recovery of everything, no closure costs:
    //   208,000 + 30,000 + (110,000 − 10,000) − 0 − 100,000 = 238,000 -> cumulative −146,000 + 238,000 = +92,000
    const benign = runModel({
      ...SYNTHETIC_CLOSURE,
      closure: { atOperatingMonth: 6, assetRecoveryPct: 100, refundableDepositRecoveryPct: 100, closureCosts: 0 },
    });
    expect(benign.closure).toMatchObject({ netClosureCashFlow: 238_000, cumulativeCashAfterClosure: 92_000, ownerCapitalLost: 0 });
    // nothing recovered: 0 + 0 + (0 − 10,000 payables) − 15,000 − 100,000 = −125,000 -> −271,000
    const total = runModel({
      ...SYNTHETIC_CLOSURE,
      closure: { atOperatingMonth: 6, assetRecoveryPct: 0, refundableDepositRecoveryPct: 0, closureCosts: 15_000, workingCapitalRecoveryPct: 0 },
    });
    expect(total.closure).toMatchObject({
      assetSaleProceeds: 0,
      depositsRecovered: 0,
      workingCapitalRecovered: -10_000,
      netClosureCashFlow: -125_000,
      cumulativeCashAfterClosure: -271_000,
      ownerCapitalLost: 271_000,
    });
  });

  it('closure in the final horizon month leaves no closed rows', () => {
    const atEnd = runModel({ ...SYNTHETIC_CLOSURE, closure: { ...SYNTHETIC_CLOSURE.closure!, atOperatingMonth: 12 } });
    expect(atEnd.monthly.every((row) => row.phase === 'operating')).toBe(true);
    // book value: 100,000 + 120,000 − 12 × 2,000 = 196,000
    expect(atEnd.closure?.assetBookValue).toBe(196_000);
  });

  it('a subsidy due after the closure month is never received', () => {
    const result12 = runModel({
      ...SYNTHETIC_MANUFACTURING,
      closure: { atOperatingMonth: 9, assetRecoveryPct: 40, refundableDepositRecoveryPct: 100, closureCosts: 0 },
    });
    expect(result12.closure?.subsidyNotReceived).toBe(300_000);
    expect(warningCodes(result12)).toContain('SUBSIDY_NOT_RECEIVED_BEFORE_CLOSURE');
    expect(result12.monthly.every((row) => row.subsidyAppliedToLoan === 0 && row.subsidyInflow === 0)).toBe(true);
    // the outstanding loan after 3 instalments (EMI 56,488.1667 at 1% per month) is repaid at closure:
    //   1,200,000 × 1.01 − EMI = 1,155,511.83 ; × 1.01 − EMI = 1,110,578.78 ; × 1.01 − EMI = 1,065,196.41
    expect(result12.closure?.loanRepaidAtClosure).toBe(1_065_196.41);
    expect(month(result12, 9).loanBalance).toBe(0);
  });

  it('assets are not replaced in the closure month', () => {
    // equipment with a 6-month life would normally be replaced at the end of month 6
    const input: ModelInput = {
      ...SYNTHETIC_CLOSURE,
      capex: [{ key: 'tools', label: 'SYNTHETIC tools', amount: 60_000, category: 'equipment', usefulLifeYears: 0.5, salvagePct: 0 }],
    };
    const closing = runModel(input);
    expect(month(closing, 6).capexOutflow).toBe(0);
    expect(closing.closure?.assetBookValue).toBe(0);
    const continuing = runModel({ ...input, closure: undefined });
    expect(month(continuing, 6).capexOutflow).toBe(60_000);
  });
});
