import { describe, expect, it } from 'vitest';
import { explainChange, matchBusiness } from '../src/index';
import { SYNTHETIC_BARE_RECORD, SYNTHETIC_FULL_RECORD } from './fixtures';
import { person } from './helpers';

describe('explainChange', () => {
  it('reports nothing when nothing changed', () => {
    const a = matchBusiness(person(), SYNTHETIC_FULL_RECORD());
    const b = matchBusiness(person(), SYNTHETIC_FULL_RECORD());
    expect(explainChange(a, b)).toEqual({ business: a.business, changed: false, feasible: null, checks: [], dimensions: [], researchConfidence: null, summary: [] });
  });

  it('lists the check that changed, the overall feasibility, and the new reason', () => {
    const before = matchBusiness(person(), SYNTHETIC_FULL_RECORD());
    const after = matchBusiness(person({ investableCapitalInr: 1_000_000 }), SYNTHETIC_FULL_RECORD()); // 7,00,000 deployable < 8,00,000
    const change = explainChange(before, after);
    expect(change.changed).toBe(true);
    expect(change.feasible).toEqual({ before: 'yes', after: 'no' });
    expect(change.checks.map((c) => [c.key, c.before, c.after])).toEqual([['capital_affordability', 'pass', 'fail']]);
    expect(change.checks[0]!.reasonAfter).toContain('₹1 L short');
    // risk exposure moves too: at its deepest the base case takes 8,00,000, more than the 7,00,000 now deployable
    expect(change.dimensions.map((d) => [d.key, d.before, d.after])).toEqual([['risk_exposure', 'strong', 'weak']]);
    expect(change.summary).toEqual([
      'Feasibility changed from "yes" to "no".',
      `Capital affordability changed from pass to fail: ${change.checks[0]!.reasonAfter}`,
      `Risk exposure changed from strong to weak: ${change.dimensions[0]!.reasonAfter}`,
    ]);
  });

  it('lists every dimension that changed and only those', () => {
    const before = matchBusiness(person(), SYNTHETIC_FULL_RECORD());
    const after = matchBusiness(person({ maxHoursPerWeek: 30, interests: ['cricket'], monthlyIncomeGoalInr: 55_000 }), SYNTHETIC_FULL_RECORD());
    const change = explainChange(before, after);
    expect(change.feasible).toBeNull();
    expect(change.checks).toEqual([]);
    expect(change.dimensions.map((d) => [d.key, d.before, d.after])).toEqual([
      ['personal_interests', 'strong', 'weak'],
      ['lifestyle_compatibility', 'strong', 'weak'],
    ]); // the income goal moved, but year 3 still meets it: same level, so not listed
  });

  it('unknown → known and known → unknown are changes', () => {
    const before = matchBusiness(person({ riskTolerance: null, transitionTimelineMonths: null }), SYNTHETIC_FULL_RECORD());
    const after = matchBusiness(person(), SYNTHETIC_FULL_RECORD());
    const forward = explainChange(before, after);
    expect(forward.feasible).toEqual({ before: 'cannot_assess', after: 'yes' });
    expect(forward.checks.map((c) => [c.key, c.before, c.after])).toEqual([['financial_runway', 'unknown', 'pass']]);
    expect(forward.dimensions.map((d) => [d.key, d.before, d.after])).toEqual([
      ['complexity_and_learning', 'unknown', 'strong'],
      ['risk_exposure', 'unknown', 'strong'],
    ]);
    const backward = explainChange(after, before);
    expect(backward.checks.map((c) => [c.before, c.after])).toEqual([['pass', 'unknown']]);
  });

  it('a profile change never moves research confidence; a different record version can', () => {
    const record = SYNTHETIC_FULL_RECORD();
    const a = matchBusiness(person(), record);
    expect(explainChange(a, matchBusiness(person({ riskTolerance: 'low' }), record)).researchConfidence).toBeNull();
    const newerVersion = SYNTHETIC_FULL_RECORD();
    newerVersion.quality = SYNTHETIC_BARE_RECORD().quality;
    const change = explainChange(a, matchBusiness(person(), newerVersion));
    expect(change.researchConfidence).toEqual({ before: 'well_evidenced', after: 'thinly_evidenced' });
    expect(change.changed).toBe(true);
    expect(change.summary).toEqual(['Research confidence changed from "well evidenced" to "thinly evidenced" — the record itself differs between the two results.']);
  });

  it('refuses to compare results for two different businesses', () => {
    const a = matchBusiness(person(), SYNTHETIC_FULL_RECORD());
    const b = matchBusiness(person(), SYNTHETIC_BARE_RECORD());
    expect(() => explainChange(a, b)).toThrow(/same business/);
  });
});
