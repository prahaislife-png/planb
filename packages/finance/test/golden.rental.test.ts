import { describe, expect, it } from 'vitest';
import { runModel } from '../src/index';
import { SYNTHETIC_RENTAL } from './fixtures';
import { month, operatingRows, sumOf, warningCodes, year } from './helpers';

/**
 * GOLDEN EXAMPLE (d): SYNTHETIC_RENTAL — `fleet_utilization` driver with stepwise price and
 * cost escalation and an asset that is replaced inside the horizon. Synthetic round numbers only.
 *
 * VOLUME  10 units × 20 billable days × 0.5 utilisation = 100 hire-days per month (no ramp)
 *
 * ESCALATION (stepwise at each 12-month anniversary)   price +5% p.a., cost inflation +10% p.a.
 *                         year 1        year 2 (m13–24)        year 3 (m25–36)
 *   rate per day          1,000         1,050                  1,102.50
 *   revenue             100,000       105,000                110,250
 *   servicing 100/day    10,000        11,000 (×1.1)          12,100 (×1.21)
 *   yard rent (own 0%)   10,000        10,000                 10,000
 *   insurance (follows cost inflation) 5,000   5,500           6,050
 *   technician (own 5%)  20,000        21,000                 22,050
 *   EBITDA               55,000        57,500                 60,050
 *   drawings             20,000        20,000                 20,000
 *   netCashFlow          35,000        37,500                 40,050
 *
 * DEPRECIATION
 *   machines 240,000, life 24 months, salvage 10%: (240,000 − 24,000) / 24 = 9,000 per month
 *   van 300,000, life 60 months, salvage 20%: (300,000 − 60,000) / 60     = 4,000 per month
 *   -> 13,000 per month in m1–m24
 *
 * REPLACEMENT at the end of month 24 (life of the machines ends)
 *   old machines sold at salvage value          = +24,000  (assetSaleProceeds)
 *   new machines cost 240,000 × 1.1 (month 24 is in year 2 -> one step of cost inflation) = 264,000 (capexOutflow)
 *   netCashFlow m24 = 37,500 − 264,000 + 24,000 = −202,500
 *   new depreciation = 264,000 × 90% / 24 = 9,900 -> 13,900 per month in m25–m36
 *
 * CUMULATIVE CASH (starts at −540,000 = 240,000 + 300,000)
 *   m12: −540,000 + 12 × 35,000 = −120,000
 *   m13 −82,500 | m14 −45,000 | m15 −7,500 | m16 +30,000  -> payback month 16
 *   m23: 30,000 + 7 × 37,500 = 292,500 ; m24: 292,500 − 202,500 = 90,000
 *   m36: 90,000 + 12 × 40,050 = 570,600
 */
describe('golden (d): SYNTHETIC_RENTAL (fleet_utilization + replacement capex + escalation)', () => {
  const result = runModel(SYNTHETIC_RENTAL);

  it('initial investment', () => {
    expect(result.initialInvestment.total).toBe(540_000);
    expect(result.funding.ownerEquityUpfront).toBe(540_000);
    expect(result.monthly).toHaveLength(36); // no pre-operating months
    expect(result.monthly[0]?.monthIndex).toBe(1);
  });

  it('year 1 month', () => {
    expect(month(result, 1)).toMatchObject({
      revenue: 100_000,
      variableCogs: 10_000,
      contribution: 90_000,
      fixedCosts: 15_000,
      staffCosts: 20_000,
      operatingProfitBeforeOwnerComp: 55_000,
      depreciation: 13_000,
      profitBeforeTax: 42_000,
      capexOutflow: 0,
      netCashFlow: 35_000,
      cumulativeCash: -505_000,
    });
    expect(month(result, 1).streams[0]).toEqual({ key: 'hire', units: 100, revenue: 100_000, variableCosts: 10_000 });
    expect(month(result, 12)).toMatchObject({ revenue: 100_000, cumulativeCash: -120_000 });
  });

  it('escalation steps exactly at the 12-month anniversaries', () => {
    expect(month(result, 13)).toMatchObject({
      revenue: 105_000,
      variableCogs: 11_000,
      fixedCosts: 15_500,
      staffCosts: 21_000,
      operatingProfitBeforeOwnerComp: 57_500,
      ownerCompensation: 20_000, // owner compensation does not follow cost inflation
      netCashFlow: 37_500,
      cumulativeCash: -82_500,
    });
    expect(month(result, 25)).toMatchObject({
      revenue: 110_250,
      variableCogs: 12_100,
      fixedCosts: 16_050,
      staffCosts: 22_050,
      operatingProfitBeforeOwnerComp: 60_050,
      netCashFlow: 40_050,
    });
  });

  it('equipment is replaced at the end of its 24-month life', () => {
    expect(month(result, 23)).toMatchObject({ capexOutflow: 0, assetSaleProceeds: 0, cumulativeCash: 292_500 });
    expect(month(result, 24)).toMatchObject({
      depreciation: 13_000,
      capexOutflow: 264_000,
      assetSaleProceeds: 24_000,
      netCashFlow: -202_500,
      cumulativeCash: 90_000,
    });
    expect(month(result, 25).depreciation).toBe(13_900);
    expect(month(result, 36)).toMatchObject({ depreciation: 13_900, capexOutflow: 0, cumulativeCash: 570_600 });
    // exactly one replacement in the horizon
    expect(operatingRows(result).filter((row) => row.capexOutflow > 0).map((row) => row.monthIndex)).toEqual([24]);
    // total depreciation = 24 × 13,000 + 12 × 13,900
    expect(sumOf(result.monthly, 'depreciation')).toBe(478_800);
  });

  it('an asset whose life ends in the final horizon month is not replaced', () => {
    const shortHorizon = runModel({ ...SYNTHETIC_RENTAL, horizonMonths: 24 });
    expect(sumOf(shortHorizon.monthly, 'capexOutflow')).toBe(0);
    expect(sumOf(shortHorizon.monthly, 'assetSaleProceeds')).toBe(0);
  });

  it('replaceAtEndOfLife: false leaves the asset at salvage value', () => {
    const input = structuredClone(SYNTHETIC_RENTAL);
    input.capex![0]!.replaceAtEndOfLife = false;
    const noReplacement = runModel(input);
    expect(sumOf(noReplacement.monthly, 'capexOutflow')).toBe(0);
    expect(month(noReplacement, 24).depreciation).toBe(13_000);
    expect(month(noReplacement, 25).depreciation).toBe(4_000); // only the van still depreciates
  });

  it('annual aggregates', () => {
    expect(year(result, 1)).toMatchObject({ revenue: 1_200_000, operatingProfitBeforeOwnerComp: 660_000, netCashFlow: 420_000 });
    expect(year(result, 2)).toMatchObject({
      revenue: 1_260_000,
      operatingProfitBeforeOwnerComp: 690_000,
      capexOutflow: 264_000,
      assetSaleProceeds: 24_000,
      netCashFlow: 210_000, // 12 × 37,500 − 240,000
      cumulativeCashEnd: 90_000,
    });
    expect(year(result, 3)).toMatchObject({
      revenue: 1_323_000,
      operatingProfitBeforeOwnerComp: 720_600,
      depreciation: 166_800,
      netCashFlow: 480_600,
      cumulativeCashEnd: 570_600,
    });
  });

  it('summary', () => {
    const { summary } = result;
    expect(summary.steadyState).toMatchObject({
      referenceOperatingMonth: 1,
      revenue: 100_000,
      contributionMarginPct: 90,
      monthlyFixedCostBase: 35_000,
      ebitda: 55_000,
      ebitdaMarginPct: 55,
    });
    // break-even: 35,000 / 0.9 = 38,888.89 ; (35,000 + 20,000) / 0.9 = 61,111.11
    expect(summary.breakEven.beforeOwnerCompensation.monthlyRevenueRequired).toBe(38_888.89);
    expect(summary.breakEven.afterOwnerCompensation.monthlyRevenueRequired).toBe(61_111.11);
    expect(summary.breakEven.pctOfSteadyStateRevenue).toBe(61.11);
    expect(summary.capitalRecovery).toEqual({
      paybackOperatingMonth: 16,
      withinHorizon: true,
      // before drawings: −540,000 + 9 × 55,000 = −45,000 ; + 55,000 -> +10,000 in month 10
      paybackOperatingMonthIncludingOwnerComp: 10,
      cumulativeCashAtHorizonEnd: 570_600,
    });
    expect(summary.peakFundingNeed).toBe(0);
    expect(summary.peakFundingNeedMonthIndex).toBeNull();
    expect(summary.totalOwnerCashRequired).toBe(540_000);
    // owner income: year 1 = 35,000 + 20,000 ; year 2 = (210,000 + 240,000) / 12 ; year 3 = 40,050 + 20,000
    expect(summary.ownerIncome.year1AvgMonthly).toBe(55_000);
    expect(summary.ownerIncome.year2AvgMonthly).toBe(37_500);
    expect(summary.ownerIncome.year3AvgMonthly).toBe(60_050);
    expect(warningCodes(result)).toEqual(['RESULTS_ARE_PRE_TAX']);
  });
});
