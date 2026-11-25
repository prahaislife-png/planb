import { describe, expect, it } from 'vitest';
import { CONFIDENCE_THRESHOLDS, EMPTY_PROFILE, matchBusiness, type BusinessSnapshot } from '../src/index';
import { SYNTHETIC_BARE_RECORD, SYNTHETIC_FULL_RECORD } from './fixtures';
import { person } from './helpers';

const confidence = (record: BusinessSnapshot) => matchBusiness(person(), record).researchConfidence;
const withEvidence = (patch: Record<string, number | null>, completeness: Record<string, unknown> = {}): BusinessSnapshot => {
  const record = SYNTHETIC_FULL_RECORD();
  Object.assign(record.quality!.evidence!, patch);
  Object.assign(record.quality!.completeness!, completeness);
  return record;
};

describe('research confidence', () => {
  it('documents its thresholds as exported constants', () => {
    expect(CONFIDENCE_THRESHOLDS).toEqual({
      wellEvidenced: {
        minCompleteness: 75, maxCriticalMissing: 0, maxOpenConflicts: 0, maxStaleObservations: 0, maxClaimsPendingReview: 0,
        minFractionGradeAOrB: 0.5, minFractionVerified: 0.5, maxFractionAssumedInputs: 0.1,
      },
      thinlyEvidenced: { noFigureGradeAOrB: true, belowCompleteness: 50, minCriticalMissing: 3, minFractionStale: 0.5, minFractionAssumedInputs: 1 / 3 },
    });
  });

  it('well evidenced: every condition met; the facts are returned as counts', () => {
    const c = confidence(SYNTHETIC_FULL_RECORD());
    expect(c.level).toBe('well_evidenced');
    expect(c).toMatchObject({
      gradeProfile: { A: 10, B: 10, C: 0, D: 0 },
      assumptionsAmongInputs: 2, inputsTotal: 40, verifiedObservations: 20, staleObservations: 0, openConflicts: 0,
      claimsPendingReview: 0, completenessPct: 90, criticalMissing: 0, criticalMissingSections: [],
    });
    expect(c.reasons[0]).toContain('Of the 20 graded figures behind this record, 10 are grade A and 10 are grade B and come from 4 sources');
    expect(c.reasons.at(-1)).toMatch(/^Classed as well evidenced/);
  });

  it('thinly evidenced: the single-source grade-C record of today, described in a sentence', () => {
    const c = confidence(SYNTHETIC_BARE_RECORD());
    expect(c.level).toBe('thinly_evidenced');
    expect(c.reasons[0]).toBe(
      'All 30 figures behind this record are grade C and come from a single source (SYNTHETIC single report); its cost observations are dated 2021 and are of the type government project report. None has been verified by a reviewer.',
    );
    expect(c.reasons).toContain('All 30 observations are past the date by which they were due to be re-checked.');
    expect(c.reasons).toContain("5 of the model's 40 inputs are assumptions, not evidence.");
    expect(c.reasons).toContain('50 extracted claims are still waiting for a reviewer.');
    expect(c.reasons).toContain('The record is 55% complete by weight (12 of 25 completeness checks met); 2 critical sections are missing (identity description and regulatory mapping).');
    expect(c.reasons.at(-1)).toBe('Classed as thinly evidenced because no figure is grade A or B and at least half of the observations are past their re-check date.');
    expect(c).toMatchObject({ gradeProfile: { A: 0, B: 0, C: 30, D: 0 }, verifiedObservations: 0, staleObservations: 30, completenessPct: 55, criticalMissing: 2 });
    expect(c.criticalMissingSections).toEqual(['identity description', 'regulatory mapping']);
  });

  it('thinly evidenced: each trigger on its own', () => {
    expect(confidence(withEvidence({ grade_a: 0, grade_b: 0, grade_c: 20 })).level).toBe('thinly_evidenced'); // no A or B
    expect(confidence(withEvidence({}, { completeness_pct: 49.9 })).level).toBe('thinly_evidenced');
    expect(confidence(withEvidence({}, { critical_missing: 3 })).level).toBe('thinly_evidenced');
    expect(confidence(withEvidence({ stale_count: 10 })).level).toBe('thinly_evidenced'); // 10 of 20
    expect(confidence(withEvidence({ assumption_count: 14 })).level).toBe('thinly_evidenced'); // 14 of 40 ≥ a third
    expect(confidence(withEvidence({ grade_a: 0, grade_b: 0, grade_c: 0, grade_d: 0, observation_count: 0 })).level).toBe('thinly_evidenced');
  });

  it('thinly evidenced: no evidence profile at all', () => {
    const record = SYNTHETIC_FULL_RECORD();
    record.quality = null;
    const c = confidence(record);
    expect(c.level).toBe('thinly_evidenced');
    expect(c.reasons[0]).toContain('carries no evidence profile');
    expect(c.gradeProfile).toBeNull();
  });

  it('partly evidenced: not thin, but short of well evidenced — the reason says where', () => {
    const cases: Array<[BusinessSnapshot, RegExp]> = [
      [withEvidence({ grade_a: 4, grade_b: 4, grade_c: 12 }), /fewer than half of the figures are grade A or B/],
      [withEvidence({ verified_count: 9 }), /fewer than half of the observations are verified/],
      [withEvidence({ assumption_count: 5 }), /more than a tenth of the model's inputs are assumptions/],
      [withEvidence({ stale_count: 1 }), /some observations are past their re-check date/],
      [withEvidence({ open_conflicts: 1 }), /conflicts between sources are open/],
      [withEvidence({ claims_pending_review: 3 }), /claims are still waiting for review/],
      [withEvidence({}, { completeness_pct: 74 }), /completeness is below 75%/],
      [withEvidence({}, { critical_missing: 1 }), /a critical section is missing/],
    ];
    for (const [record, why] of cases) {
      const c = confidence(record);
      expect(c.level).toBe('partly_evidenced');
      expect(c.reasons.at(-1)).toMatch(why);
    }
  });

  it('a fact that is not recorded never counts as met', () => {
    const c = confidence(withEvidence({ stale_count: null, verified_count: null }));
    expect(c.level).toBe('partly_evidenced');
    expect(c.staleObservations).toBeNull();
    expect(c.reasons.at(-1)).toContain('how many observations are stale is not recorded');
  });

  it('boundaries are inclusive as documented', () => {
    expect(confidence(withEvidence({ grade_a: 5, grade_b: 5, grade_c: 10, verified_count: 10, assumption_count: 4 }, { completeness_pct: 75 })).level).toBe('well_evidenced');
    expect(confidence(withEvidence({}, { completeness_pct: 50 })).level).toBe('partly_evidenced');
  });

  it('is a property of the record alone: no profile changes it', () => {
    const record = SYNTHETIC_BARE_RECORD();
    const a = matchBusiness(person(), record).researchConfidence;
    const b = matchBusiness(EMPTY_PROFILE, record).researchConfidence;
    const c = matchBusiness(person({ investableCapitalInr: 50_000_000, riskTolerance: 'high', interests: ['bare'] }), record).researchConfidence;
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('suitability is a property of the match alone: evidence quality changes no check and no dimension', () => {
    const strongEvidence = SYNTHETIC_FULL_RECORD();
    const weakEvidence = SYNTHETIC_FULL_RECORD();
    weakEvidence.quality = SYNTHETIC_BARE_RECORD().quality;
    const a = matchBusiness(person(), strongEvidence);
    const b = matchBusiness(person(), weakEvidence);
    expect(a.researchConfidence.level).toBe('well_evidenced');
    expect(b.researchConfidence.level).toBe('thinly_evidenced');
    expect(b.feasible).toBe(a.feasible);
    expect(b.feasibility).toEqual(a.feasibility);
    expect(b.fit).toEqual(a.fit);
    expect(b.tradeOffs).toEqual(a.tradeOffs);
  });

  it('a well-fitting business on thin evidence is reported as both, apart', () => {
    const record = SYNTHETIC_FULL_RECORD();
    record.quality = SYNTHETIC_BARE_RECORD().quality;
    const r = matchBusiness(person(), record);
    expect(r.feasible).toBe('yes');
    expect(r.researchConfidence.level).toBe('thinly_evidenced');
    expect(r.whyNotSuitable).toBeUndefined(); // thin evidence is not a reason against suitability — it is said separately
  });

  it('names the basis of judgement-based sections', () => {
    const c = confidence(SYNTHETIC_FULL_RECORD());
    expect(c.reasons.some((x) => x.includes('The lifestyle profile is recorded on the basis "owner interviews" (grade B)'))).toBe(true);
  });
});
