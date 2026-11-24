import { describe, expect, it } from 'vitest';
import { levelPayment, runModel, type ModelInput } from '../src/index';
import { month, sumOf, warningCodes, year } from './helpers';

/** SYNTHETIC base: revenue 100,000 per month at steady state, fixed cost 40,000, nothing else. */
const base = (overrides: Partial<ModelInput> = {}): ModelInput => ({
  horizonMonths: 12,
  revenueStreams: [
    { key: 'jobs', label: 'SYNTHETIC jobs', driver: { kind: 'engagements', engagementsPerMonth: 10, realizedFee: 10_000 } },
  ],
  fixedCosts: [{ key: 'rent', label: 'Rent', category: 'rent', monthlyAmount: 40_000, accruesDuringPreOperating: true, classification: 'operating' }],
  owner: { monthlyCompensation: 0, treatment: 'drawings' },
  ...overrides,
});

describe('tax: flat rate on year-to-date profit', () => {
  it('losses early in a year are offset against profits later in the same year', () => {
    // ramp 0%, 2 months: m1 0, m2 0.5, m3+ 1.0  -> PBT m1 −40,000 ; m2 10,000 ; m3+ 60,000
    // YTD: −40,000 | −30,000 | 30,000 | 90,000 …   tax 20%: 0 | 0 | 6,000 | 12,000 | 12,000 …
    const result = runModel(
      base({ rampUp: { startPct: 0, monthsToSteadyState: 2 }, tax: { kind: 'flat_rate', ratePct: 20, carryForwardLosses: true } }),
    );
    expect([1, 2, 3, 4, 5].map((m) => month(result, m).tax)).toEqual([0, 0, 6_000, 12_000, 12_000]);
    // year: PBT = −40,000 + 10,000 + 10 × 60,000 = 570,000 -> tax 114,000
    expect(year(result, 1).profitBeforeTax).toBe(570_000);
    expect(year(result, 1).tax).toBe(114_000);
    expect(year(result, 1).netProfit).toBe(456_000);
  });

  it('pre-operating losses are carried forward only when carryForwardLosses is true', () => {
    const input = base({ preOperatingMonths: 2, rampUp: { startPct: 0, monthsToSteadyState: 2 } });
    // pre-operating loss = 2 × 40,000 rent = 80,000
    const withCarry = runModel({ ...input, tax: { kind: 'flat_rate', ratePct: 20, carryForwardLosses: true } });
    expect(year(withCarry, 1).tax).toBe(98_000); // 20% × (570,000 − 80,000)
    const withoutCarry = runModel({ ...input, tax: { kind: 'flat_rate', ratePct: 20, carryForwardLosses: false } });
    expect(year(withoutCarry, 1).tax).toBe(114_000); // 20% × 570,000
  });

  it('a loss-making year reduces the next year only with carry-forward', () => {
    // ramp 0% over 12 months: revenue in month m = 100,000 × (m − 1)/12, fixed cost 60,000
    //   year 1 revenue = 100,000 × (0+1+…+11)/12 = 550,000 ; PBT = 550,000 − 720,000 = −170,000 -> tax 0
    //   year 2 PBT = 12 × 40,000 = 480,000
    //     with carry-forward   : 20% × (480,000 − 170,000) = 62,000
    //     without carry-forward: 20% × 480,000             = 96,000
    const input = base({
      horizonMonths: 24,
      rampUp: { startPct: 0, monthsToSteadyState: 12 },
      fixedCosts: [{ key: 'rent', label: 'Rent', category: 'rent', monthlyAmount: 60_000, classification: 'operating' }],
    });
    const withCarry = runModel({ ...input, tax: { kind: 'flat_rate', ratePct: 20, carryForwardLosses: true } });
    expect(year(withCarry, 1).profitBeforeTax).toBe(-170_000);
    expect(year(withCarry, 1).tax).toBe(0);
    expect(withCarry.monthly.slice(0, 12).every((row) => row.tax === 0)).toBe(true);
    expect(year(withCarry, 2).tax).toBe(62_000);
    // YTD year 2: 40k, 80k, 120k, 160k (≤ 170k pool) -> 0 ; m17: 200k -> 20% × 30k = 6,000 ; then 8,000 per month
    expect([13, 16, 17, 18, 24].map((m) => month(withCarry, m).tax)).toEqual([0, 0, 6_000, 8_000, 8_000]);

    const withoutCarry = runModel({ ...input, tax: { kind: 'flat_rate', ratePct: 20, carryForwardLosses: false } });
    expect(year(withoutCarry, 2).tax).toBe(96_000);
  });

  it('tax accrued early in a year is reversed when later months of the same year lose money', () => {
    // seasonality: first six calendar months at 2×, the rest at 0 (mean 1.0)
    //   m1–m6: PBT = 200,000 − 60,000 = 140,000 -> tax 28,000 each
    //   m7–m12: PBT = −60,000 -> tax −12,000 each (reversal)
    //   year: PBT 480,000 -> tax 96,000
    const result = runModel(
      base({
        fixedCosts: [{ key: 'rent', label: 'Rent', category: 'rent', monthlyAmount: 60_000, classification: 'operating' }],
        seasonality: { multipliers: [2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0] },
        tax: { kind: 'flat_rate', ratePct: 20, carryForwardLosses: true },
      }),
    );
    expect(month(result, 6).tax).toBe(28_000);
    expect(month(result, 7).tax).toBe(-12_000);
    expect(year(result, 1).tax).toBe(96_000);
    expect(warningCodes(result)).not.toContain('SEASONALITY_NOT_NORMALISED');
  });

  it('owner salary is deductible, owner drawings are not', () => {
    const tax = { kind: 'flat_rate', ratePct: 20, carryForwardLosses: true } as const;
    const salary = runModel(base({ owner: { monthlyCompensation: 20_000, treatment: 'salary_expense' }, tax }));
    const drawings = runModel(base({ owner: { monthlyCompensation: 20_000, treatment: 'drawings' }, tax }));
    // EBITDA 60,000 in both; it is BEFORE owner compensation under either treatment
    expect(month(salary, 1).operatingProfitBeforeOwnerComp).toBe(60_000);
    expect(month(drawings, 1).operatingProfitBeforeOwnerComp).toBe(60_000);
    expect(month(salary, 1).operatingProfitAfterOwnerComp).toBe(40_000);
    expect(month(drawings, 1).operatingProfitAfterOwnerComp).toBe(40_000);
    // salary: PBT 40,000, tax 8,000, net profit 32,000, cash 60,000 − 20,000 − 8,000 = 32,000
    expect(month(salary, 1)).toMatchObject({ profitBeforeTax: 40_000, tax: 8_000, netProfit: 32_000, netProfitAfterOwnerComp: 32_000, netCashFlow: 32_000 });
    // drawings: PBT 60,000, tax 12,000, net profit 48,000 (before drawings), 28,000 after; cash 60,000 − 20,000 − 12,000
    expect(month(drawings, 1)).toMatchObject({ profitBeforeTax: 60_000, tax: 12_000, netProfit: 48_000, netProfitAfterOwnerComp: 28_000, netCashFlow: 28_000 });
  });

  it('tax kind "none" charges nothing and says so', () => {
    const result = runModel(base());
    expect(sumOf(result.monthly, 'tax')).toBe(0);
    expect(warningCodes(result)).toContain('RESULTS_ARE_PRE_TAX');
    const ignoredRate = runModel(base({ tax: { kind: 'none', ratePct: 30 } }));
    expect(sumOf(ignoredRate.monthly, 'tax')).toBe(0);
  });
});

describe('loan schedule', () => {
  const loanInput = (loan: NonNullable<ModelInput['financing']>['loan'], extra: Partial<ModelInput> = {}): ModelInput =>
    base({ horizonMonths: 36, financing: { loan }, ...extra });

  it('levelPayment matches the textbook EMI formula', () => {
    // 100,000 at 1% per month over 12 months: 100,000 × 0.01 / (1 − 1.01^−12) = 8,884.88
    expect(levelPayment(100_000, 0.01, 12)).toBeCloseTo(8_884.88, 2);
    // zero interest: straight division
    expect(levelPayment(120_000, 0, 12)).toBe(10_000);
  });

  it('constant EMI, interest on the reducing balance, balance exactly 0 at the end of the tenure', () => {
    const result = runModel(loanInput({ principal: 100_000, annualInterestPct: 12, tenureMonths: 12 }));
    // m1: interest 1,000 ; principal 8,884.88 − 1,000 = 7,884.88 ; balance 92,115.12
    expect(month(result, 1)).toMatchObject({ interest: 1_000, loanPrincipalRepayment: 7_884.88, loanBalance: 92_115.12 });
    // m2: interest 921.15 ; principal 7,963.73 ; balance 84,151.39
    expect(month(result, 2)).toMatchObject({ interest: 921.15, loanPrincipalRepayment: 7_963.73, loanBalance: 84_151.39 });
    expect(month(result, 12).loanBalance).toBe(0);
    expect(month(result, 13)).toMatchObject({ interest: 0, loanPrincipalRepayment: 0, loanBalance: 0 });
    expect(sumOf(result.monthly, 'loanPrincipalRepayment')).toBeCloseTo(100_000, 1);
    // total interest = 12 × 8,884.88 − 100,000 = 6,618.55 (unrounded EMI 8,884.8789)
    expect(result.summary.totals.interest).toBe(6_618.55);
    for (let m = 2; m <= 12; m++) {
      expect(month(result, m).loanBalance).toBeLessThan(month(result, m - 1).loanBalance);
    }
  });

  it('zero-interest loan amortises in equal instalments', () => {
    const result = runModel(loanInput({ principal: 120_000, annualInterestPct: 0, tenureMonths: 14, moratoriumMonths: 2 }));
    expect(month(result, 2)).toMatchObject({ interest: 0, loanPrincipalRepayment: 0, loanBalance: 120_000 });
    expect(month(result, 3)).toMatchObject({ interest: 0, loanPrincipalRepayment: 10_000, loanBalance: 110_000 });
    expect(month(result, 14).loanBalance).toBe(0);
  });

  it('tenure longer than the horizon leaves a balance and a warning', () => {
    const result = runModel(loanInput({ principal: 500_000, annualInterestPct: 12, tenureMonths: 60 }));
    expect(result.summary.loanBalanceAtHorizonEnd).toBeGreaterThan(0);
    expect(month(result, 36).loanBalance).toBe(result.summary.loanBalanceAtHorizonEnd);
    expect(warningCodes(result)).toContain('LOAN_OUTSTANDING_AT_HORIZON_END');
  });

  it('interest during pre-operating months is part of the initial investment', () => {
    const result = runModel(loanInput({ principal: 100_000, annualInterestPct: 12, tenureMonths: 12 }, { preOperatingMonths: 4 }));
    // 4 × 1,000 interest + 4 × 40,000 rent
    expect(result.initialInvestment.preOperatingCostsBreakdown).toEqual({ fixedCosts: 160_000, staffCosts: 0, interest: 4_000 });
    expect(result.initialInvestment.total).toBe(164_000);
    expect(result.funding.ownerEquityUpfront).toBe(64_000);
    // tenure and moratorium count from operating month 1: the first EMI is in operating month 1
    expect(month(result, -1)).toMatchObject({ interest: 1_000, loanPrincipalRepayment: 0, loanBalance: 100_000 });
    expect(month(result, 1).loanPrincipalRepayment).toBe(7_884.88);
    expect(month(result, 12).loanBalance).toBe(0);
  });

  it('loan larger than the initial investment: surplus is opening cash and a warning is raised', () => {
    const result = runModel(loanInput({ principal: 100_000, annualInterestPct: 12, tenureMonths: 12 }));
    // no capex at all -> initial investment 0 -> ownerEquityUpfront −100,000
    expect(result.funding.ownerEquityUpfront).toBe(-100_000);
    expect(warningCodes(result)).toContain('LOAN_EXCEEDS_INITIAL_INVESTMENT');
    // month 1: EBITDA 60,000 − interest 1,000 − principal 7,884.88 = 51,115.12 ; cumulative = 100,000 + 51,115.12
    expect(month(result, 1).cumulativeCash).toBe(151_115.12);
    expect(result.summary.peakFundingNeed).toBe(0);
    expect(result.summary.totalOwnerCashRequired).toBe(0);
  });
});

describe('subsidy', () => {
  const withSubsidy = (subsidy: NonNullable<ModelInput['financing']>['subsidy'], loan = true): ModelInput =>
    base({
      horizonMonths: 24,
      financing: {
        ...(loan ? { loan: { principal: 100_000, annualInterestPct: 12, tenureMonths: 12 } } : {}),
        subsidy,
      },
    });

  it('cash_inflow: the full amount reaches the business and the loan is untouched', () => {
    const result = runModel(withSubsidy({ amount: 30_000, receivedOperatingMonth: 3, treatment: 'cash_inflow' }));
    expect(month(result, 3)).toMatchObject({ subsidyInflow: 30_000, subsidyAppliedToLoan: 0 });
    const noSubsidy = runModel(base({ horizonMonths: 24, financing: { loan: { principal: 100_000, annualInterestPct: 12, tenureMonths: 12 } } }));
    expect(month(result, 3).netCashFlow).toBe(month(noSubsidy, 3).netCashFlow + 30_000);
    expect(month(result, 3).loanBalance).toBe(month(noSubsidy, 3).loanBalance);
    expect(result.funding.subsidy).toBe(30_000);
    // back-ended: the subsidy does not reduce the upfront equity
    expect(result.funding.ownerEquityUpfront).toBe(noSubsidy.funding.ownerEquityUpfront);
  });

  it('reduces_loan_principal: balance drops, later interest is lower, tenure end unchanged', () => {
    const result = runModel(withSubsidy({ amount: 30_000, receivedOperatingMonth: 3, treatment: 'reduces_loan_principal' }));
    const noSubsidy = runModel(base({ horizonMonths: 24, financing: { loan: { principal: 100_000, annualInterestPct: 12, tenureMonths: 12 } } }));
    expect(month(result, 3)).toMatchObject({ subsidyInflow: 0, subsidyAppliedToLoan: 30_000 });
    expect(month(result, 3).loanBalance).toBe(Math.round((month(noSubsidy, 3).loanBalance - 30_000) * 100) / 100);
    expect(month(result, 3).netCashFlow).toBe(month(noSubsidy, 3).netCashFlow); // non-cash in the month itself
    expect(month(result, 4).interest).toBeLessThan(month(noSubsidy, 4).interest);
    expect(month(result, 12).loanBalance).toBe(0);
    expect(month(result, 11).loanBalance).toBeGreaterThan(0);
  });

  it('a subsidy larger than the outstanding loan pays the remainder out as cash', () => {
    // after 11 instalments the balance is 8,796.91 (= last EMI 8,884.88 / 1.01); subsidy 30,000
    const result = runModel(withSubsidy({ amount: 30_000, receivedOperatingMonth: 11, treatment: 'reduces_loan_principal' }));
    const row = month(result, 11);
    expect(row.subsidyAppliedToLoan).toBe(8_796.91);
    expect(row.subsidyInflow).toBe(21_203.09);
    expect(row.loanBalance).toBe(0);
    expect(month(result, 12)).toMatchObject({ interest: 0, loanPrincipalRepayment: 0 });
  });

  it('reduces_loan_principal without any loan is a plain cash inflow', () => {
    const result = runModel(withSubsidy({ amount: 30_000, receivedOperatingMonth: 2, treatment: 'reduces_loan_principal' }, false));
    expect(month(result, 2)).toMatchObject({ subsidyInflow: 30_000, subsidyAppliedToLoan: 0 });
  });
});
