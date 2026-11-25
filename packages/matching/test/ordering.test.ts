import { describe, expect, it } from 'vitest';
import { compareMatchResults, FEASIBLE_ORDER, matchBusiness, matchBusinesses, type BusinessSnapshot, type Feasible, type FitLevel, type MatchResult } from '../src/index';
import { SYNTHETIC_BARE_RECORD, SYNTHETIC_FULL_RECORD, referenceVariant, scenarioByKey } from './fixtures';
import { person } from './helpers';

/** A result with a given feasibility and fit levels; everything else taken from a real run. */
function shaped(name: string, feasible: Feasible, levels: FitLevel[]): MatchResult {
  const base = matchBusiness(person(), SYNTHETIC_FULL_RECORD());
  return {
    ...base,
    business: { ...base.business, name, slug: name.toLowerCase().replace(/\s+/g, '-') },
    feasible,
    fit: base.fit.map((d, i) => ({ ...d, level: levels[i] ?? 'unknown' })),
  };
}

describe('compareMatchResults — the documented ordering rule', () => {
  it('1. feasible yes, then cannot_assess, then no', () => {
    expect(FEASIBLE_ORDER).toEqual(['yes', 'cannot_assess', 'no']);
    const yes = shaped('C', 'yes', ['weak', 'weak', 'weak']);
    const cannot = shaped('B', 'cannot_assess', ['strong', 'strong']);
    const no = shaped('A', 'no', ['strong', 'strong', 'strong', 'strong', 'strong', 'strong', 'strong']);
    expect([no, cannot, yes].sort(compareMatchResults).map((r) => r.business.name)).toEqual(['C', 'B', 'A']);
  });

  it('2. within a group, fewer weak dimensions first', () => {
    const oneWeak = shaped('A', 'yes', ['weak', 'strong', 'strong', 'strong']);
    const noWeak = shaped('B', 'yes', ['moderate', 'unknown']);
    expect(compareMatchResults(noWeak, oneWeak)).toBeLessThan(0);
    expect(compareMatchResults(oneWeak, noWeak)).toBeGreaterThan(0);
  });

  it('3. then more strong dimensions first', () => {
    const twoStrong = shaped('B', 'yes', ['strong', 'strong', 'weak']);
    const oneStrong = shaped('A', 'yes', ['strong', 'moderate', 'weak']);
    expect([oneStrong, twoStrong].sort(compareMatchResults).map((r) => r.business.name)).toEqual(['B', 'A']);
  });

  it('4. then business name A–Z, case-insensitive, then slug', () => {
    const a = shaped('alpha', 'yes', ['strong']);
    const b = shaped('Beta', 'yes', ['strong']);
    expect([b, a].sort(compareMatchResults).map((r) => r.business.name)).toEqual(['alpha', 'Beta']);
    const same1 = { ...a, business: { ...a.business, slug: 'a-1' } };
    const same2 = { ...a, business: { ...a.business, slug: 'a-2' } };
    expect(compareMatchResults(same1, same2)).toBeLessThan(0);
    expect(compareMatchResults(a, a)).toBe(0);
  });

  it('moderate and unknown dimensions take no part', () => {
    const moderates = shaped('A', 'yes', ['moderate', 'moderate', 'moderate', 'moderate', 'moderate', 'moderate', 'moderate']);
    const unknowns = shaped('B', 'yes', []);
    expect(compareMatchResults(moderates, unknowns)).toBeLessThan(0); // decided by name only
  });

  it('research confidence takes no part', () => {
    const thin = shaped('A', 'yes', ['strong']);
    const well = shaped('B', 'yes', ['strong']);
    thin.researchConfidence = { ...thin.researchConfidence, level: 'thinly_evidenced' };
    well.researchConfidence = { ...well.researchConfidence, level: 'well_evidenced' };
    expect(compareMatchResults(thin, well)).toBeLessThan(0);
  });
});

describe('matchBusinesses', () => {
  const never = (): BusinessSnapshot => {
    const record = SYNTHETIC_FULL_RECORD();
    record.model!.name = 'SYNTHETIC aardvark farm';
    record.model!.slug = 'synthetic-aardvark-farm';
    scenarioByKey(record, 'base').summary!.summary!.breakEven = { firstOperatingMonthNetCashPositive: null };
    return record;
  };

  it('returns one result per record, ordered by the rule whatever the input order', () => {
    const records = [never(), SYNTHETIC_BARE_RECORD(), SYNTHETIC_FULL_RECORD()];
    const expected = ['SYNTHETIC widget workshop', 'SYNTHETIC bare unit', 'SYNTHETIC aardvark farm'];
    const results = matchBusinesses(person(), records);
    expect(results.map((r) => r.feasible)).toEqual(['yes', 'cannot_assess', 'no']);
    expect(results.map((r) => r.business.name)).toEqual(expected);
    expect(matchBusinesses(person(), [...records].reverse()).map((r) => r.business.name)).toEqual(expected);
    expect([...results].sort(compareMatchResults)).toEqual(results);
  });

  it('gives each record the same result as matchBusiness', () => {
    const records = [SYNTHETIC_FULL_RECORD(), SYNTHETIC_BARE_RECORD()];
    const results = matchBusinesses(person(), records);
    for (const record of records) {
      expect(results).toContainEqual(matchBusiness(person(), record));
    }
  });

  it('uses only the reference variant of each record', () => {
    const record = SYNTHETIC_FULL_RECORD();
    const [r] = matchBusinesses(person(), [record]);
    expect(r!.basis.variantName).toBe('SYNTHETIC reference variant');
    expect(r!.basis.nationalScenarioLabel).toBe('SYNTHETIC base');
    expect(r!.basis.localScenario).toBeNull();
    referenceVariant(record).scenarios = [];
    expect(matchBusinesses(person(), [record])[0]!.basis.nationalScenarioLabel).toBeNull();
  });
});
