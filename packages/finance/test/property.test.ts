import { describe, expect, it } from 'vitest';
import { runModel, type ModelInput } from '../src/index';
import { sumOf } from './helpers';

/**
 * Deterministic pseudo-random inputs (fixed-seed LCG — the engine itself uses no randomness).
 * Guards against crashes, NaN/Infinity and broken accounting identities on input shapes that the
 * hand-written fixtures do not cover (zero rates, zero volumes, extreme ramps, closure, …).
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function syntheticRandomInput(seed: number): ModelInput {
  const next = lcg(seed);
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
  const money = (max: number): number => Math.round(next() * max);
  const horizonMonths = int(12, 120);

  const drivers: Array<() => ModelInput['revenueStreams'][number]['driver']> = [
    () => ({ kind: 'transactions', transactionsPerDay: int(0, 300), operatingDaysPerMonth: int(0, 31), averageTicket: money(500) }),
    () => ({ kind: 'capacity_utilization', capacityUnitsPerMonth: money(20_000), utilization: next(), unitPrice: money(300) }),
    () => ({ kind: 'area_yield', area: int(1, 10), yieldPerAreaPerCycle: money(2_000), pricePerUnit: money(100), harvestCalendarMonths: [int(1, 6), int(7, 12)] }),
    () => ({ kind: 'enrolment', capacityStudents: int(0, 500), enrolmentRate: next(), feePerStudentPerMonth: money(5_000) }),
    () => ({ kind: 'occupancy', rentableArea: money(20_000), occupancy: next(), ratePerAreaPerMonth: money(60) }),
    () => ({ kind: 'fleet_utilization', unitCount: int(0, 20), billableDaysPerMonth: int(0, 31), utilization: next(), ratePerUnitPerDay: money(3_000) }),
    () => ({ kind: 'engagements', engagementsPerMonth: int(0, 40), realizedFee: money(50_000) }),
  ];

  const withLoan = next() < 0.6;
  const tenureMonths = int(1, 96);
  const input: ModelInput = {
    horizonMonths,
    preOperatingMonths: int(0, 6),
    startCalendarMonth: int(1, 12),
    capex: Array.from({ length: int(0, 4) }, (_, i) => ({
      key: `capex_${i}`,
      label: 'SYNTHETIC',
      amount: money(2_000_000),
      category: pick(['land', 'building_civil', 'machinery', 'equipment', 'vehicle', 'it', 'other'] as const),
      ...(next() < 0.8 ? { usefulLifeYears: pick([0.5, 1, 2, 3, 5, 10, 25]), salvagePct: pick([0, 10, 25]) } : {}),
    })).map((item) => (item.category === 'land' ? { key: item.key, label: item.label, amount: item.amount, category: item.category } : item)),
    contingencyPct: pick([0, 5, 10]),
    preOperativeExpenses: next() < 0.5 ? [{ key: 'pre', label: 'SYNTHETIC', amount: money(300_000) }] : [],
    deposits: next() < 0.5 ? [{ key: 'dep', label: 'SYNTHETIC', amount: money(300_000), refundable: next() < 0.7 }] : [],
    revenueStreams: Array.from({ length: int(1, 3) }, (_, i) => ({
      key: `stream_${i}`,
      label: 'SYNTHETIC',
      driver: pick(drivers)(),
      variableCosts: [
        { key: 'a', label: 'SYNTHETIC', basis: 'pct_of_revenue' as const, value: int(0, 130), classification: 'cogs' as const },
        { key: 'b', label: 'SYNTHETIC', basis: 'per_unit' as const, value: money(40), classification: 'operating' as const },
      ],
      ...(next() < 0.3 ? { paymentTermsDays: int(0, 90) } : {}),
    })),
    rampUp: { startPct: int(0, 100), monthsToSteadyState: int(0, 30), applyToAreaYield: next() < 0.5 },
    ...(next() < 0.5 ? { seasonality: { multipliers: Array.from({ length: 12 }, () => Math.round(next() * 200) / 100) } } : {}),
    fixedCosts: [
      { key: 'rent', label: 'SYNTHETIC', category: 'rent', monthlyAmount: money(150_000), accruesDuringPreOperating: next() < 0.5, classification: 'operating' },
      { key: 'misc', label: 'SYNTHETIC', category: 'other', monthlyAmount: money(50_000), annualEscalationPct: int(-5, 15), classification: 'cogs' },
    ],
    staff: [{ key: 'team', role: 'SYNTHETIC', count: int(0, 10), monthlySalary: money(30_000), classification: pick(['cogs', 'operating'] as const), startsPreOperatingMonthsBefore: int(0, 3) }],
    owner: { monthlyCompensation: money(100_000), treatment: pick(['salary_expense', 'drawings'] as const), annualEscalationPct: int(0, 10) },
    priceEscalationPctAnnual: int(-3, 10),
    costInflationPctAnnual: int(-3, 10),
    workingCapital: { inventoryDays: int(0, 60), receivableDays: int(0, 90), payableDays: int(0, 60) },
    ...(withLoan
      ? {
          financing: {
            loan: { principal: 1 + money(3_000_000), annualInterestPct: pick([0, 8.5, 12, 18]), tenureMonths, moratoriumMonths: int(0, tenureMonths - 1) },
            ...(next() < 0.5
              ? { subsidy: { amount: money(800_000), receivedOperatingMonth: int(1, horizonMonths), treatment: pick(['reduces_loan_principal', 'cash_inflow'] as const) } }
              : {}),
          },
        }
      : {}),
    tax: next() < 0.5 ? { kind: 'none' } : { kind: 'flat_rate', ratePct: pick([0, 25, 30]), carryForwardLosses: next() < 0.5 },
    ...(next() < 0.25
      ? { closure: { atOperatingMonth: int(1, horizonMonths), assetRecoveryPct: int(0, 100), refundableDepositRecoveryPct: int(0, 100), closureCosts: money(100_000), workingCapitalRecoveryPct: int(0, 100) } }
      : {}),
  };
  return input;
}

describe('property checks on 300 deterministic pseudo-random SYNTHETIC inputs', () => {
  const seeds = Array.from({ length: 300 }, (_, i) => 20_240 + i * 7_919);

  it('never throws, never emits non-finite numbers, and keeps the accounting identities', { timeout: 60_000 }, () => {
    for (const seed of seeds) {
      const input = syntheticRandomInput(seed);
      const result = runModel(input);
      // plain checks collected into one list per seed (one assertion per seed keeps the test fast)
      const problems: string[] = [];
      const check = (condition: boolean, what: string): void => {
        if (!condition) problems.push(what);
      };

      // every number is finite; null only where a metric may legitimately be undefined
      const nullable = /Pct$|^pct|Dscr|dscr|Required$|Month|Positive$|AvgMonthly|avgMonthly|^closure$|^description$/;
      const walk = (value: unknown, key: string, path: string): void => {
        if (typeof value === 'number') check(Number.isFinite(value), `non-finite number at ${path}`);
        else if (value === null) check(nullable.test(key), `unexpected null at ${path}`);
        else if (Array.isArray(value)) value.forEach((item, index) => walk(item, key, `${path}[${index}]`));
        else if (typeof value === 'object') {
          for (const [childKey, item] of Object.entries(value as Record<string, unknown>)) walk(item, childKey, `${path}.${childKey}`);
        }
      };
      walk(result, 'result', 'result');

      // cumulative cash = −ownerEquityUpfront + running Σ netCashFlow
      let running = -result.funding.ownerEquityUpfront;
      result.monthly.forEach((row, index) => {
        running += row.netCashFlow;
        check(Math.abs(row.cumulativeCash - running) <= 0.006 * (index + 2), `cumulativeCash @ month ${row.monthIndex}`);
      });

      // Σ monthly = annual
      for (const annual of result.annual) {
        const rows = result.monthly.filter((row) => row.operatingYear === annual.year);
        for (const key of ['revenue', 'operatingProfitBeforeOwnerComp', 'tax', 'netCashFlow', 'depreciation', 'interest'] as const) {
          check(Math.abs(sumOf(rows, key) - annual[key]) <= 0.006 * (rows.length + 1), `Σ monthly ≠ annual for ${key} in year ${annual.year}`);
        }
        // annual tax is never negative (monthly tax may be, as a within-year reversal)
        check(annual.tax >= -0.01, `negative annual tax in year ${annual.year}`);
      }

      // loan: never negative, never increasing, repaid by the end of the tenure
      let previous = result.funding.loan;
      for (const row of result.monthly) {
        check(row.loanBalance >= 0, `negative loan balance @ month ${row.monthIndex}`);
        check(row.loanBalance <= previous + 0.006, `loan balance increased @ month ${row.monthIndex}`);
        previous = row.loanBalance;
      }
      const loan = input.financing?.loan;
      if (loan && !input.closure && loan.tenureMonths <= result.horizonMonths) {
        check(result.monthly[result.preOperatingMonths + loan.tenureMonths - 1]!.loanBalance === 0, 'loan not fully repaid at tenure end');
        check(result.summary.loanBalanceAtHorizonEnd === 0, 'loan outstanding at horizon end');
      }

      // depreciation never exceeds what was bought (initial capex + replacements)
      const purchased = result.initialInvestment.capex + sumOf(result.monthly, 'capexOutflow');
      check(sumOf(result.monthly, 'depreciation') <= purchased + 0.01 * result.monthly.length, 'depreciation exceeds purchases');

      // funding need and payback are consistent with the path
      check(result.summary.peakFundingNeed >= 0, 'negative peakFundingNeed');
      const payback = result.monthly.find((row) => row.phase === 'operating' && row.cumulativeCash >= 0)?.monthIndex ?? null;
      check(result.summary.capitalRecovery.paybackOperatingMonth === payback, 'payback month inconsistent with cumulativeCash');
      if (result.closure) {
        check(result.closure.ownerCapitalLost === Math.max(0, -result.closure.cumulativeCashAfterClosure), 'ownerCapitalLost ≠ max(0, −final position)');
        check(
          result.monthly.filter((row) => row.phase === 'closed').length === result.horizonMonths - result.closure.atOperatingMonth,
          'wrong number of closed months',
        );
      }

      // determinism
      check(JSON.stringify(runModel(input)) === JSON.stringify(result), 'two runs differ');

      expect(problems, `seed ${seed}`).toEqual([]);
    }
  });
});
