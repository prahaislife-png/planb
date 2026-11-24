import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SENSITIVITY_DELTAS,
  DEFAULT_SENSITIVITY_PARAMS,
  ModelValidationError,
  hashModelInput,
  runModel,
  sensitivity,
} from '../src/index';
import { SYNTHETIC_CAFE, SYNTHETIC_MANUFACTURING, SYNTHETIC_RENTAL } from './fixtures';
import { clone } from './helpers';

describe('sensitivity (one-at-a-time tornado)', () => {
  it('steady-state EBITDA of the café, by hand', () => {
    const table = sensitivity(SYNTHETIC_CAFE, ['price', 'volume', 'fixed_costs', 'staff_costs', 'variable_costs', 'capex']);
    expect(table.metric).toBe('steadyStateEbitda');
    expect(table.deltasPct).toEqual([-20, -10, 10, 20]);
    expect(table.base).toBe(218_000);
    expect(table.inputHash).toBe(hashModelInput(SYNTHETIC_CAFE));
    const row = (param: string) => table.rows.find((r) => r.param === param)!;

    // price ±: revenue 600,000 × f ; ingredients + fees 37% of revenue ; packaging 30,000 fixed per unit
    //   EBITDA = 600,000 f × 0.63 − 30,000 − 130,000 = 378,000 f − 160,000
    //   f = 0.8: 142,400 | 0.9: 180,200 | 1.1: 255,800 | 1.2: 293,600
    expect(row('price').points).toEqual([
      { deltaPct: -20, value: 142_400, changeFromBase: -75_600 },
      { deltaPct: -10, value: 180_200, changeFromBase: -37_800 },
      { deltaPct: 10, value: 255_800, changeFromBase: 37_800 },
      { deltaPct: 20, value: 293_600, changeFromBase: 75_600 },
    ]);
    expect(row('price')).toMatchObject({ min: 142_400, max: 293_600, spread: 151_200, hasUndefinedPoint: false, notes: [] });

    // volume ±: EBITDA = 348,000 f − 130,000 -> 148,400 | 183,200 | 252,800 | 287,600
    expect(row('volume').points.map((p) => p.value)).toEqual([148_400, 183_200, 252_800, 287_600]);
    // fixed costs 70,000 × f: 232,000 | 225,000 | 211,000 | 204,000
    expect(row('fixed_costs').points.map((p) => p.value)).toEqual([232_000, 225_000, 211_000, 204_000]);
    // staff 60,000 × f: 230,000 | 224,000 | 212,000 | 206,000
    expect(row('staff_costs').points.map((p) => p.value)).toEqual([230_000, 224_000, 212_000, 206_000]);
    // variable costs 252,000 × f: 268,400 | 243,200 | 192,800 | 167,600
    expect(row('variable_costs').points.map((p) => p.value)).toEqual([268_400, 243_200, 192_800, 167_600]);
    // capex does not affect EBITDA at all
    expect(row('capex')).toMatchObject({ spread: 0, min: 218_000, max: 218_000 });

    // tornado order: largest spread first
    expect(table.rows.map((r) => [r.param, r.spread])).toEqual([
      ['price', 151_200],
      ['volume', 139_200],
      ['variable_costs', 100_800],
      ['fixed_costs', 28_000],
      ['staff_costs', 24_000],
      ['capex', 0],
    ]);
  });

  it('price sensitivity is monotonic for every metric', () => {
    const deltas = [-30, -20, -10, -5, 5, 10, 20, 30];
    for (const input of [SYNTHETIC_CAFE, SYNTHETIC_MANUFACTURING, SYNTHETIC_RENTAL]) {
      const valuesOf = (metric: Parameters<typeof sensitivity>[3]) => {
        const table = sensitivity(input, ['price'], deltas, metric);
        const points = table.rows[0]!.points;
        // insert the base at delta 0 to get the full ordered series
        return [...points.slice(0, 4).map((p) => p.value), table.base, ...points.slice(4).map((p) => p.value)];
      };
      // higher price -> EBITDA, cumulative cash and owner income never fall
      for (const metric of ['steadyStateEbitda', 'cumulativeCashAtHorizonEnd', 'ownerIncomeYear1AvgMonthly'] as const) {
        const values = valuesOf(metric) as number[];
        for (let i = 1; i < values.length; i++) expect(values[i]!, `${metric} #${i}`).toBeGreaterThan(values[i - 1]!);
      }
      // higher price -> payback never later, peak funding need never higher
      const payback = valuesOf('paybackOperatingMonth');
      for (let i = 1; i < payback.length; i++) {
        const previous = payback[i - 1] ?? Number.POSITIVE_INFINITY; // null = not within horizon
        const current = payback[i] ?? Number.POSITIVE_INFINITY;
        expect(current, `payback #${i}`).toBeLessThanOrEqual(previous);
      }
      const funding = valuesOf('peakFundingNeed') as number[];
      for (let i = 1; i < funding.length; i++) expect(funding[i]!, `funding #${i}`).toBeLessThanOrEqual(funding[i - 1]!);
    }
  });

  it('cost sensitivities move the other way', () => {
    const table = sensitivity(SYNTHETIC_MANUFACTURING, ['variable_costs', 'fixed_costs', 'staff_costs', 'rent'], [-10, 10]);
    for (const row of table.rows) {
      expect(row.points[0]!.value!).toBeGreaterThan(table.base!);
      expect(row.points[1]!.value!).toBeLessThan(table.base!);
    }
  });

  it('payback metric: undefined points are null and flagged', () => {
    // café payback is month 11. At price −20% (ticket 160):
    //   EBITDA(ramp) = (480,000 × 0.63 − 30,000) × ramp − 130,000 = 272,400 × ramp − 130,000
    //     m1 6,200 | m2 33,440 | m3 60,680 | m4 87,920 | m5 115,160 | m6+ 142,400
    //   NWC at 100% = (168,000 + 30,000) × 6/30 − (198,000 + 9,600) × 3/30 = 39,600 − 20,760 = 18,840
    //     change m1 9,420, then 1,884 per month until m6
    //   netCashFlow: m1 −43,220 | m2 −8,444 | m3 18,796 | m4 46,036 | m5 73,276 | m6 100,516 | m7+ 102,400
    //   cumulative after m6 = −1,390,000 − 43,220 − 8,444 + 18,796 + 46,036 + 73,276 + 100,516 = −1,203,040
    //   −1,203,040 / 102,400 = 11.75 -> 12 more months -> payback in month 18
    const table = sensitivity(SYNTHETIC_CAFE, ['price'], [-20, 20], 'paybackOperatingMonth');
    expect(table.base).toBe(11);
    const row = table.rows[0]!;
    expect(row.points[0]).toEqual({ deltaPct: -20, value: 18, changeFromBase: 7 });
    expect(row.points[1]!.value).toBeLessThan(11);
    const harsh = sensitivity(SYNTHETIC_CAFE, ['price'], [-50], 'paybackOperatingMonth');
    expect(harsh.rows[0]!.points[0]).toEqual({ deltaPct: -50, value: null, changeFromBase: null });
    expect(harsh.rows[0]!.hasUndefinedPoint).toBe(true);
  });

  it('peak funding need metric and capacity clamp notes', () => {
    const table = sensitivity(SYNTHETIC_MANUFACTURING, ['volume', 'capex'], [-20, 30], 'peakFundingNeed');
    expect(table.base).toBe(652_000);
    const volume = table.rows.find((r) => r.param === 'volume')!;
    // +30% would be utilisation 1.04 -> clamped to 1.0 and reported
    expect(volume.notes).toHaveLength(1);
    expect(volume.notes[0]).toContain('+30%');
    expect(volume.notes[0]).toContain('clamped to 1');
    // capex changes the upfront equity, not the reserve needed on top of it
    expect(table.rows.find((r) => r.param === 'capex')!.points.map((p) => p.changeFromBase)).toEqual([0, 0]);
  });

  it('defaults', () => {
    const table = sensitivity(SYNTHETIC_RENTAL);
    expect(table.rows.map((r) => r.param).sort()).toEqual([...DEFAULT_SENSITIVITY_PARAMS].sort());
    expect(table.deltasPct).toEqual([...DEFAULT_SENSITIVITY_DELTAS]);
    expect(DEFAULT_SENSITIVITY_DELTAS).toEqual([-20, -10, 10, 20]);
  });

  it('is deterministic and pure', () => {
    const input = clone(SYNTHETIC_MANUFACTURING);
    const before = JSON.stringify(input);
    const first = JSON.stringify(sensitivity(input, ['price', 'volume', 'interest_rate', 'ramp_months'], [-20, 20], 'cumulativeCashAtHorizonEnd'));
    const second = JSON.stringify(sensitivity(input, ['price', 'volume', 'interest_rate', 'ramp_months'], [-20, 20], 'cumulativeCashAtHorizonEnd'));
    expect(second).toBe(first);
    expect(JSON.stringify(input)).toBe(before);
    expect(runModel(input).inputHash).toBe(hashModelInput(SYNTHETIC_MANUFACTURING));
  });

  it('rejects invalid requests', () => {
    expect(() => sensitivity(SYNTHETIC_CAFE, [])).toThrow(ModelValidationError);
    expect(() => sensitivity(SYNTHETIC_CAFE, ['weather' as never])).toThrow(/unknown sensitivity parameter/);
    expect(() => sensitivity(SYNTHETIC_CAFE, ['price', 'price'])).toThrow(/duplicates/);
    expect(() => sensitivity(SYNTHETIC_CAFE, ['price'], [-100])).toThrow(/greater than -100/);
    expect(() => sensitivity(SYNTHETIC_CAFE, ['price'], [])).toThrow(ModelValidationError);
    expect(() => sensitivity(SYNTHETIC_CAFE, ['price'], [10], 'npv' as never)).toThrow(/unknown metric/);
    expect(() => sensitivity({ ...SYNTHETIC_CAFE, horizonMonths: 1 })).toThrow(ModelValidationError);
  });
});
