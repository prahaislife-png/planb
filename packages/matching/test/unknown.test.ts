import { describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, matchBusiness, matchBusinesses } from '../src/index';
import { SYNTHETIC_BARE_RECORD, SYNTHETIC_FULL_RECORD, referenceVariant } from './fixtures';
import { check, dim, person } from './helpers';

/**
 * "Unknown stays unknown." Today's records have costs and scenarios but EMPTY qualitative sections. These tests
 * pin down that nothing passes or fails silently on such a record.
 */

describe('a record with empty qualitative sections, compared with a complete profile', () => {
  const r = matchBusiness(person({ preferredLocationSlug: 'synthetic-city', preferredLocationName: 'Synthetic City', willingToTakeLoan: true }), SYNTHETIC_BARE_RECORD());

  it('the two checks that need unresearched sections are unknown and say what has not been researched', () => {
    const q = check(r, 'required_qualifications');
    expect(q.status).toBe('unknown');
    expect(q.unknownCause).toBe('not_researched');
    expect(q.reason).toMatch(/have not been researched/);
    const a = check(r, 'required_assets');
    expect(a.status).toBe('unknown');
    expect(a.unknownCause).toBe('not_researched');
    expect(a.reason).toMatch(/Asset requirements have not been researched/);
  });

  it('the financial checks still run on the figures that do exist', () => {
    expect(check(r, 'capital_affordability').status).toBe('pass');
    expect(check(r, 'financial_runway').status).toBe('pass'); // 3 + 4 = 7 ≤ 12
    expect(check(r, 'financial_runway').reason).toContain('The 3-month set-up period is an assumption in this record, not evidence.');
  });

  it('it cannot be called feasible: an unknown mandatory check is never a pass', () => {
    expect(r.feasible).toBe('cannot_assess');
  });

  it('every fit dimension that needs an unresearched section is unknown — not weak, not moderate', () => {
    for (const key of ['transferable_capabilities', 'lifestyle_compatibility', 'complexity_and_learning', 'geographic_fit'] as const) {
      const d = dim(r, key);
      expect(d.level, key).toBe('unknown');
      expect(d.unknownCause, key).toBe('not_researched');
      expect(d.reason, key).toMatch(/not been researched|has no scenario built on local evidence/);
    }
    // the dimensions the record CAN answer are answered
    expect(dim(r, 'income_potential').level).not.toBe('unknown');
    expect(dim(r, 'risk_exposure').level).not.toBe('unknown');
    expect(dim(r, 'personal_interests').level).toBe('weak'); // "widgets" is not in "SYNTHETIC bare unit"
  });

  it('lists the sections that have not been researched', () => {
    expect(r.notResearched).toEqual([
      'The capabilities the business asks of its founder',
      'Founder requirements (qualifications, certifications, training time, learning difficulty)',
      "The owner's working life (hours, weekends, involvement, physical demand, operational complexity)",
      'Asset requirements',
      'A risk register',
      'The licences and registrations that apply',
      'Local evidence for any city (every figure is national)',
    ]);
  });

  it('invents no prerequisites from sections that do not exist', () => {
    expect(r.missingPrerequisites).toEqual([]);
  });

  it('a fully researched record lists nothing as unresearched except what it truly lacks', () => {
    expect(matchBusiness(person(), SYNTHETIC_FULL_RECORD()).notResearched).toEqual(['Local evidence for any city (every figure is national)']);
  });
});

describe('the all-unknown case: empty qualitative sections AND nothing said by the person', () => {
  const r = matchBusiness(EMPTY_PROFILE, SYNTHETIC_BARE_RECORD());

  it('no check passes and no check fails', () => {
    expect(r.feasibility.map((c) => c.status)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    expect(r.feasible).toBe('cannot_assess');
  });

  it('no dimension is given a level', () => {
    expect(r.fit.map((d) => d.level)).toEqual(['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
  });

  it('every unknown says why, and names the right side of the gap', () => {
    const causes = Object.fromEntries([...r.feasibility, ...r.fit].map((x) => [x.key, x.unknownCause]));
    expect(causes).toEqual({
      capital_affordability: 'not_stated_by_person',
      financial_runway: 'not_stated_by_person',
      required_qualifications: 'not_researched',
      required_assets: 'not_researched',
      transferable_capabilities: 'not_researched',
      personal_interests: 'not_stated_by_person',
      income_potential: 'not_stated_by_person',
      lifestyle_compatibility: 'not_researched',
      complexity_and_learning: 'not_researched',
      risk_exposure: 'not_stated_by_person',
      geographic_fit: 'not_stated_by_person',
    });
    for (const x of [...r.feasibility, ...r.fit]) expect(x.reason.length, x.key).toBeGreaterThan(30);
  });

  it('gives no reasons against, no prerequisites, and still reports research confidence', () => {
    expect(r.whyNotSuitable).toBeUndefined();
    expect('whyNotSuitable' in r).toBe(false);
    expect(r.missingPrerequisites).toEqual([]);
    expect(r.researchConfidence.level).toBe('thinly_evidenced');
  });
});

describe('records with nothing in them', () => {
  it('an empty object: everything unknown, nothing thrown', () => {
    const r = matchBusiness(person(), {});
    expect(r.business.name).toBe('Unnamed business');
    expect(r.feasibility.every((c) => c.status === 'unknown' && c.unknownCause === 'not_researched')).toBe(true);
    expect(r.fit.every((d) => d.level === 'unknown')).toBe(true);
    expect(r.feasible).toBe('cannot_assess');
    expect(r.researchConfidence.level).toBe('thinly_evidenced');
    expect(r.researchConfidence.gradeProfile).toBeNull();
    expect(r.researchConfidence.completenessPct).toBeNull();
  });

  it('nulls everywhere: everything unknown, nothing thrown', () => {
    const r = matchBusiness(person(), {
      model: null, variants: null, skills: null, founder_requirements: null, regulations: null, risks: null, quality: null,
    });
    expect(r.feasibility.every((c) => c.status === 'unknown')).toBe(true);
    expect(r.fit.every((d) => d.level === 'unknown')).toBe(true);
  });

  it('a reference variant whose scenarios carry no summary: financial checks unknown', () => {
    const record = SYNTHETIC_BARE_RECORD();
    for (const s of referenceVariant(record).scenarios!) s.summary = null;
    const r = matchBusiness(person(), record);
    expect(check(r, 'capital_affordability').status).toBe('unknown');
    expect(check(r, 'financial_runway').status).toBe('unknown');
    expect(dim(r, 'income_potential').level).toBe('unknown');
    expect(dim(r, 'risk_exposure').level).toBe('unknown');
  });

  it('values of the wrong type are treated as missing, not coerced', () => {
    const record = SYNTHETIC_BARE_RECORD() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    record.variants[0].scenarios[0].summary.summary.totalOwnerCashRequired = '800000';
    record.variants[0].scenarios[0].summary.summary.ownerIncome.year3AvgMonthly = Number.NaN;
    const r = matchBusiness(person(), record);
    expect(check(r, 'capital_affordability').status).toBe('unknown');
    expect(dim(r, 'income_potential').level).toBe('unknown');
  });

  it('matchBusinesses on no records returns no results', () => {
    expect(matchBusinesses(person(), [])).toEqual([]);
  });
});
