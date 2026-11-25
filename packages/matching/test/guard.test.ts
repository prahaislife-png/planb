import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index';
import { EMPTY_PROFILE, explainChange, matchBusiness, matchBusinesses, narrowSnapshot, type BusinessSnapshot, type PersonProfile } from '../src/index';
import { SYNTHETIC_BARE_RECORD, SYNTHETIC_FULL_RECORD, SYNTHETIC_LOCAL, SYNTHETIC_PROFILE, deepFreeze, referenceVariant, scenarioByKey } from './fixtures';
import { person } from './helpers';

/**
 * Product rule 1: no suitability score, percentage, star rating or probability of success — anywhere.
 *
 * A property whose name matches this pattern may not exist in any exported result type or in any object the
 * engine produces. (Note that "operating" contains "rating": result types therefore say "trading" / "set-up".)
 */
const FORBIDDEN_KEY = /score|percent|pct|probab|rating|likelihood|stars/i;

/**
 * THE SINGLE ALLOWED EXCEPTION: `completenessPct` on research confidence — how complete the research RECORD is.
 * It describes the record, not the person's suitability, and it is reported apart from feasibility and fit.
 */
const ALLOWED_EXCEPTIONS = ['completenessPct'];

function keysDeep(value: unknown, path = '', out: Array<{ key: string; path: string }> = []): Array<{ key: string; path: string }> {
  if (Array.isArray(value)) value.forEach((v, i) => keysDeep(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push({ key: k, path: `${path}.${k}` });
      keysDeep(v, `${path}.${k}`, out);
    }
  }
  return out;
}

function stringsDeep(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsDeep(v, out));
  else if (value !== null && typeof value === 'object') Object.values(value).forEach((v) => stringsDeep(v, out));
  return out;
}

/** A spread of profiles × records that reaches every branch that produces text or keys. */
function everyResult(): api.MatchResult[] {
  const withLocal = SYNTHETIC_FULL_RECORD();
  referenceVariant(withLocal).scenarios!.push(SYNTHETIC_LOCAL(4, 36));
  const never = SYNTHETIC_FULL_RECORD();
  scenarioByKey(never, 'base').summary!.summary!.breakEven = { firstOperatingMonthNetCashPositive: null };
  scenarioByKey(never, 'base').summary!.summary!.ownerIncome = { year1AvgMonthly: -90_000, year2AvgMonthly: -50_000, year3AvgMonthly: -20_000 };
  scenarioByKey(never, 'base').summary!.summary!.minDscr = 0.4;
  scenarioByKey(never, 'base').summary!.summary!.capitalRecovery = { paybackOperatingMonth: null };
  const partial = SYNTHETIC_FULL_RECORD();
  partial.founder_requirements!.certifications = null;
  referenceVariant(partial).lifestyle!.physical_demand = null;
  const records: BusinessSnapshot[] = [SYNTHETIC_FULL_RECORD(), SYNTHETIC_BARE_RECORD(), withLocal, never, partial, {}];
  const profiles: PersonProfile[] = [
    person(),
    EMPTY_PROFILE,
    person({ preferredLocationSlug: 'synthetic-city', preferredLocationName: 'Synthetic City' }),
    person({ willingToTakeLoan: false, riskTolerance: 'low', maxHoursPerWeek: 30, weekendWorkOk: false, interests: ['cricket'], capabilities: [{ skillSlug: 'negotiation', proficiency: 1 }], qualificationsHeld: [], assets: [] }),
    person({ willingToTakeLoan: null, investableCapitalInr: 200_000, reserveRequirementInr: 300_000, transitionTimelineMonths: 1, monthlyIncomeGoalInr: 500_000, riskTolerance: 'high' }),
    person({ riskTolerance: null, desiredInvolvement: 'absentee', physicalWorkTolerance: 1, monthlyIncomeGoalInr: null, currentMonthlyIncomeInr: null, capabilities: [] }),
  ];
  return profiles.flatMap((p) => matchBusinesses(p, records));
}

describe('guard: nothing that looks like a rating of suitability exists', () => {
  it('the allowed exception is exactly one name', () => {
    expect(ALLOWED_EXCEPTIONS).toEqual(['completenessPct']);
  });

  it('no produced object has a forbidden key (except researchConfidence.completenessPct)', () => {
    const results = everyResult();
    expect(results.length).toBe(36);
    const offending = keysDeep(results).filter(({ key }) => FORBIDDEN_KEY.test(key));
    // the exception is allowed only at this one place
    for (const o of offending) expect(o.path).toMatch(/^\[\d+\]\.researchConfidence\.completenessPct$/);
    expect([...new Set(offending.map((o) => o.key))]).toEqual(ALLOWED_EXCEPTIONS);

    const changes = results.slice(1).map((r, i) => (results[i]!.business.slug === r.business.slug && results[i]!.business.name === r.business.name ? explainChange(results[i]!, r) : null));
    const before = matchBusiness(person(), SYNTHETIC_FULL_RECORD());
    const after = matchBusiness(person({ investableCapitalInr: 100_000 }), SYNTHETIC_FULL_RECORD());
    expect(keysDeep([changes, explainChange(before, after)]).filter(({ key }) => FORBIDDEN_KEY.test(key))).toEqual([]);
  });

  it('no exported result type declares a forbidden property (except completenessPct)', () => {
    const source = readFileSync(new URL('../src/result.ts', import.meta.url), 'utf8');
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const properties = [...withoutComments.matchAll(/(?:^|[{;,|\s])([A-Za-z_$][\w$]*)\??\s*:/g)].map((m) => m[1]!);
    expect(properties).toContain('completenessPct'); // proves the scan sees property names
    expect(properties).toContain('whyNotSuitable');
    expect(properties.length).toBeGreaterThan(40);
    expect([...new Set(properties.filter((p) => FORBIDDEN_KEY.test(p)))]).toEqual(ALLOWED_EXCEPTIONS);
    // type and interface names too
    const typeNames = [...withoutComments.matchAll(/export (?:type|interface|const) ([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!);
    expect(typeNames.filter((n) => FORBIDDEN_KEY.test(n))).toEqual([]);
  });

  it('no exported name of the package is a forbidden word', () => {
    expect(Object.keys(api).filter((name) => FORBIDDEN_KEY.test(name))).toEqual([]);
  });

  it('no result carries a number that grades the match: numbers appear only as stated facts', () => {
    // every number in a result must sit under one of these fact-carrying keys
    const allowedNumberKeys = new Set([
      'amountInr', 'months', 'localInputs', 'inheritedNationalInputs',
      'A', 'B', 'C', 'D', 'assumptionsAmongInputs', 'inputsTotal', 'verifiedObservations', 'staleObservations', 'openConflicts',
      'claimsPendingReview', 'completenessPct', 'criticalMissing',
    ]);
    const numericKeys = new Set<string>();
    const walk = (value: unknown, key: string): void => {
      if (typeof value === 'number') numericKeys.add(key);
      else if (Array.isArray(value)) value.forEach((v) => walk(v, key));
      else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k);
    };
    walk(everyResult(), '');
    expect([...numericKeys].filter((k) => !allowedNumberKeys.has(k))).toEqual([]);
    // and the top level of a result and of each check / dimension holds no number at all
    for (const r of everyResult()) {
      expect(Object.values(r).some((v) => typeof v === 'number')).toBe(false);
      for (const x of [...r.feasibility, ...r.fit]) expect(Object.values(x).some((v) => typeof v === 'number')).toBe(false);
    }
  });
});

describe('guard: wording', () => {
  const texts = stringsDeep(everyResult());

  it('never promises, endorses or implies profit', () => {
    const banned = /guarantee|\bsafe\b|\bsafely\b|recommended for you|\brecommend|profitab|will succeed|sure to|risk[- ]free|chance of success|success rate/i;
    expect(texts.filter((t) => banned.test(t))).toEqual([]);
  });

  it('never states a percentage of fit, match or success', () => {
    const fitNumber = /\d+\s*%\s*(fit|match|suitab|success|likely|chance)|(fit|match|suitab|success)[^.]{0,20}\d+\s*%|\d+\s*(out of|\/)\s*(5|10|100)\b(?! (completeness|of))/i;
    expect(texts.filter((t) => fitNumber.test(t))).toEqual([]);
  });

  it('calls financial figures model outputs on recorded inputs, not forecasts', () => {
    const r = matchBusiness(person(), SYNTHETIC_FULL_RECORD());
    const income = r.fit.find((d) => d.key === 'income_potential')!.reason;
    expect(income).toMatch(/^On the recorded inputs, the model's national base case shows/);
    expect(income).toMatch(/These are model outputs before income tax, not a forecast\.$/);
    expect(r.feasibility[0]!.reason).toMatch(/^On the recorded inputs, the model's national base case needs/);
    expect(r.fit.find((d) => d.key === 'risk_exposure')!.reason).toContain('not a forecast and not the chance of anything happening');
  });

  it('every reason is a sentence', () => {
    for (const r of everyResult()) {
      for (const x of [...r.feasibility, ...r.fit]) {
        expect(x.reason, `${r.business.name} / ${x.key}`).toMatch(/^[A-Z"].*[.]$/s);
        expect(x.reason).not.toMatch(/undefined|null|NaN|\[object/);
      }
      for (const t of [...r.tradeOffs, ...r.researchConfidence.reasons, ...r.notResearched, ...r.missingPrerequisites.map((m) => m.description)]) {
        expect(t).not.toMatch(/undefined|null|NaN|\[object/);
      }
    }
  });
});

describe('determinism and purity', () => {
  it('same input → the same output, byte for byte', () => {
    const run = () => JSON.stringify(everyResult());
    const first = run();
    expect(run()).toBe(first);
    expect(run()).toBe(first);
  });

  it('does not depend on key order or object identity of the input', () => {
    const record = SYNTHETIC_FULL_RECORD();
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(record).reverse()))) as BusinessSnapshot;
    expect(matchBusiness(person(), reordered)).toEqual(matchBusiness(person(), record));
  });

  it('does not mutate the profile or the snapshots', () => {
    const profile = deepFreeze(person({ preferredLocationSlug: 'synthetic-city', preferredLocationName: 'Synthetic City' }));
    const withLocal = SYNTHETIC_FULL_RECORD();
    referenceVariant(withLocal).scenarios!.push(SYNTHETIC_LOCAL());
    const records = deepFreeze([withLocal, SYNTHETIC_BARE_RECORD()]);
    const before = JSON.stringify({ profile, records });
    expect(() => matchBusinesses(profile, records)).not.toThrow();
    expect(JSON.stringify({ profile, records })).toBe(before);
  });

  it('uses no clock, no randomness and no I/O', () => {
    for (const file of ['match', 'feasibility', 'fit', 'confidence', 'snapshot', 'format', 'profile', 'thresholds', 'result', 'index', 'version']) {
      const source = readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(source, file).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now|process\.|require\(|fetch\(|node:|from 'fs'|localStorage|crypto\./);
    }
  });

  it('the only runtime dependency is zod', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(Object.keys(pkg.dependencies)).toEqual(['zod']);
  });
});

describe('narrowSnapshot', () => {
  it('keeps everything the engine reads: results are identical', () => {
    for (const record of [SYNTHETIC_FULL_RECORD(), SYNTHETIC_BARE_RECORD(), {}]) {
      for (const p of [SYNTHETIC_PROFILE(), EMPTY_PROFILE]) {
        expect(matchBusiness(p, narrowSnapshot(record))).toEqual(matchBusiness(p, record));
      }
    }
  });

  it('drops what the engine does not read', () => {
    const record = SYNTHETIC_FULL_RECORD() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    record.launch_tasks = [{ title: 'SYNTHETIC task' }];
    record.variants[0].revenue_streams = [{ key: 'x' }];
    record.variants[0].cost_items[0].name = 'SYNTHETIC machine';
    record.variants[0].cost_items[0].observations[0].document_url = 'https://example.invalid/doc';
    record.variants[0].parameters.push({ key: 'unit_price', value: 50 });
    const narrow = narrowSnapshot(record) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(narrow.launch_tasks).toBeUndefined();
    expect(narrow.variants[0].revenue_streams).toBeUndefined();
    expect(narrow.variants[0].cost_items[0]).toEqual({ observations: [{ observed_on: '2025-01-01', evidence_type: 'supplier_quotation', source: 'SYNTHETIC source one' }] });
    expect(narrow.variants[0].parameters).toEqual([{ key: 'pre_operating_months', value: 2, basis: 'observation', is_resolved: true }]);
  });

  it('keeps null as null and absent as absent (the difference between "never" and "not recorded")', () => {
    const never = SYNTHETIC_FULL_RECORD();
    scenarioByKey(never, 'base').summary!.summary!.breakEven = { firstOperatingMonthNetCashPositive: null };
    const narrowNever = narrowSnapshot(never);
    expect(scenarioByKey(narrowNever, 'base').summary!.summary!.breakEven).toEqual({ firstOperatingMonthNetCashPositive: null });
    const silent = SYNTHETIC_FULL_RECORD();
    scenarioByKey(silent, 'base').summary!.summary!.breakEven = {};
    expect(scenarioByKey(narrowSnapshot(silent), 'base').summary!.summary!.breakEven).toEqual({});
    expect(narrowSnapshot(null)).toEqual({});
    expect(narrowSnapshot('nonsense')).toEqual({});
  });
});
