import { describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, matchBusiness, matchBusinesses, parseProfile, PersonProfileSchema, ProfileValidationError, validateProfile } from '../src/index';
import { SYNTHETIC_FULL_RECORD, SYNTHETIC_PROFILE } from './fixtures';

const issuesOf = (raw: unknown) => {
  const r = validateProfile(raw);
  if (r.ok) throw new Error('expected the profile to be invalid');
  return r.issues;
};
const paths = (raw: unknown) => issuesOf(raw).map((i) => i.path);

describe('person profile validation', () => {
  it('accepts the synthetic profile and the empty profile', () => {
    expect(validateProfile(SYNTHETIC_PROFILE()).ok).toBe(true);
    expect(validateProfile(EMPTY_PROFILE).ok).toBe(true);
    expect(parseProfile(SYNTHETIC_PROFILE())).toEqual(SYNTHETIC_PROFILE());
  });

  it('the empty profile says nothing about anyone', () => {
    for (const [key, value] of Object.entries(EMPTY_PROFILE)) {
      expect(Array.isArray(value) ? value.length === 0 : value === null, key).toBe(true);
    }
  });

  it('requires every field to be present: "not said" is null, never an omitted key', () => {
    const { investableCapitalInr: _a, willingToTakeLoan: _b, ...rest } = SYNTHETIC_PROFILE();
    expect(paths(rest).sort()).toEqual(['investableCapitalInr', 'willingToTakeLoan']);
    expect(issuesOf(undefined)).toHaveLength(1);
    expect(issuesOf('a string')).toHaveLength(1);
  });

  it('rejects unknown keys (a typo must not silently become "not said")', () => {
    expect(issuesOf({ ...SYNTHETIC_PROFILE(), investableCapital: 5 })[0]!.message).toMatch(/Unrecognized key/);
  });

  it('rejects out-of-range and wrongly typed values, with the path of each', () => {
    expect(paths({ ...SYNTHETIC_PROFILE(), investableCapitalInr: -1 })).toEqual(['investableCapitalInr']);
    expect([...new Set(paths({ ...SYNTHETIC_PROFILE(), reserveRequirementInr: Number.POSITIVE_INFINITY }))]).toEqual(['reserveRequirementInr']);
    expect(paths({ ...SYNTHETIC_PROFILE(), reserveRequirementInr: Number.NaN })).toEqual(['reserveRequirementInr']);
    expect(paths({ ...SYNTHETIC_PROFILE(), monthlyIncomeGoalInr: '50000' })).toEqual(['monthlyIncomeGoalInr']);
    expect(paths({ ...SYNTHETIC_PROFILE(), riskTolerance: 'reckless' })).toEqual(['riskTolerance']);
    expect(paths({ ...SYNTHETIC_PROFILE(), desiredInvolvement: 'weekends_only' })).toEqual(['desiredInvolvement']);
    expect(paths({ ...SYNTHETIC_PROFILE(), maxHoursPerWeek: 121 })).toEqual(['maxHoursPerWeek']);
    expect(paths({ ...SYNTHETIC_PROFILE(), weekendWorkOk: 'yes' })).toEqual(['weekendWorkOk']);
    expect(paths({ ...SYNTHETIC_PROFILE(), physicalWorkTolerance: 6 })).toEqual(['physicalWorkTolerance']);
    expect(paths({ ...SYNTHETIC_PROFILE(), physicalWorkTolerance: 2.5 })).toEqual(['physicalWorkTolerance']);
    expect(paths({ ...SYNTHETIC_PROFILE(), transitionTimelineMonths: 121 })).toEqual(['transitionTimelineMonths']);
    expect(paths({ ...SYNTHETIC_PROFILE(), preferredLocationSlug: 'Pune City' })).toEqual(['preferredLocationSlug']);
    expect(paths({ ...SYNTHETIC_PROFILE(), interests: ['ok', ''] })).toEqual(['interests[1]']);
    expect(paths({ ...SYNTHETIC_PROFILE(), capabilities: [{ skillSlug: 'sales', proficiency: 0 }] })).toEqual(['capabilities[0].proficiency']);
    expect(paths({ ...SYNTHETIC_PROFILE(), capabilities: [{ skillSlug: 'Sales', proficiency: 3 }] })).toEqual(['capabilities[0].skillSlug']);
    expect(paths({ ...SYNTHETIC_PROFILE(), assets: [{ assetTypeSlug: '' }] })).toEqual(['assets[0].assetTypeSlug']);
    expect(paths({ ...SYNTHETIC_PROFILE(), qualificationsHeld: 'MBA' })).toEqual(['qualificationsHeld']);
  });

  it('rejects a capability listed twice and a location name without a slug', () => {
    const twice = { ...SYNTHETIC_PROFILE(), capabilities: [{ skillSlug: 'sales', proficiency: 3 }, { skillSlug: 'sales', proficiency: 5 }] };
    expect(issuesOf(twice)).toEqual([{ path: 'capabilities[1].skillSlug', message: 'capability "sales" is listed more than once' }]);
    expect(paths({ ...SYNTHETIC_PROFILE(), preferredLocationSlug: null, preferredLocationName: 'Somewhere' })).toEqual(['preferredLocationName']);
  });

  it('reports every problem at once', () => {
    expect(paths({ ...SYNTHETIC_PROFILE(), investableCapitalInr: -5, riskTolerance: 'x', maxHoursPerWeek: 500 }).sort()).toEqual(['investableCapitalInr', 'maxHoursPerWeek', 'riskTolerance']);
  });

  it('parseProfile throws ProfileValidationError carrying the issues', () => {
    let thrown: unknown;
    try {
      parseProfile({ ...SYNTHETIC_PROFILE(), investableCapitalInr: -5, riskTolerance: 'x' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ProfileValidationError);
    const err = thrown as ProfileValidationError;
    expect(err.code).toBe('INVALID_PROFILE');
    expect(err.issues).toHaveLength(2);
    expect(err.message).toMatch(/^Invalid person profile: investableCapitalInr: .* \(\+1 more\)$/);
  });

  it('matchBusiness and matchBusinesses refuse an invalid profile instead of matching on it', () => {
    const bad = { ...SYNTHETIC_PROFILE(), investableCapitalInr: -1 };
    expect(() => matchBusiness(bad, SYNTHETIC_FULL_RECORD())).toThrow(ProfileValidationError);
    expect(() => matchBusinesses(bad, [SYNTHETIC_FULL_RECORD()])).toThrow(ProfileValidationError);
    expect(() => matchBusinesses({}, [])).toThrow(ProfileValidationError);
  });

  it('trims free text', () => {
    const p = parseProfile({ ...SYNTHETIC_PROFILE(), interests: ['  widgets  '], qualificationsHeld: [' MBA '] });
    expect(p.interests).toEqual(['widgets']);
    expect(p.qualificationsHeld).toEqual(['MBA']);
  });

  it('exposes the schema', () => {
    expect(PersonProfileSchema.safeParse(SYNTHETIC_PROFILE()).success).toBe(true);
  });
});
