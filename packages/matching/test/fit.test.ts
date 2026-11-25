import { describe, expect, it } from 'vitest';
import { FIT_DIMENSION_KEYS, matchBusiness, interestWords } from '../src/index';
import { SYNTHETIC_FULL_RECORD, SYNTHETIC_LOCAL, referenceVariant, scenarioByKey, syntheticScenario } from './fixtures';
import { dim, person } from './helpers';

describe('fit: shape', () => {
  it('always returns the seven dimensions in the documented order, each with a reason', () => {
    const r = matchBusiness(person(), SYNTHETIC_FULL_RECORD());
    expect(r.fit.map((d) => d.key)).toEqual([...FIT_DIMENSION_KEYS]);
    expect(r.fit.map((d) => d.key)).toEqual([
      'transferable_capabilities', 'personal_interests', 'income_potential', 'lifestyle_compatibility',
      'complexity_and_learning', 'risk_exposure', 'geographic_fit',
    ]);
    for (const d of r.fit) expect(d.reason.length).toBeGreaterThan(20);
  });
});

describe('transferable capabilities', () => {
  const level = (capabilities: Array<{ skillSlug: string; proficiency: number }>, record = SYNTHETIC_FULL_RECORD()) =>
    dim(matchBusiness(person({ capabilities }), record), 'transferable_capabilities');

  it('strong: every needed-from-the-start skill and every skill of importance 4+ is held', () => {
    const d = level([{ skillSlug: 'sales', proficiency: 4 }, { skillSlug: 'food-safety', proficiency: 3 }]);
    expect(d.level).toBe('strong');
    expect(d.reason).toContain('You hold 2 of the 4 capabilities the record lists: Sales (at 4 of 5) and Food safety (at 3 of 5)');
    expect(d.reason).toContain('People management (can be hired for, importance 3 of 5; not in your list)');
  });

  it('moderate: start skills held, but a learnable skill of importance 4+ is not', () => {
    const r = matchBusiness(person({ capabilities: [{ skillSlug: 'sales', proficiency: 5 }] }), SYNTHETIC_FULL_RECORD());
    expect(dim(r, 'transferable_capabilities').level).toBe('moderate');
    expect(r.tradeOffs.some((t) => t.includes('learn or hire for') && t.includes('Food safety (can be learned)'))).toBe(true);
    expect(r.missingPrerequisites.filter((m) => m.kind === 'skill')).toEqual([]);
  });

  it('weak: a skill needed from the start is not held → it is a missing prerequisite', () => {
    const r = matchBusiness(person({ capabilities: [{ skillSlug: 'food-safety', proficiency: 5 }] }), SYNTHETIC_FULL_RECORD());
    expect(dim(r, 'transferable_capabilities').level).toBe('weak');
    expect(r.missingPrerequisites).toContainEqual({ kind: 'skill', description: 'Sales: the record says this capability is needed from the start (not in your list).' });
    expect(r.whyNotSuitable?.some((w) => w.startsWith('Transferable capabilities:'))).toBe(true);
  });

  it('weak: proficiency below 3 does not count as held, and the reason says so', () => {
    const d = level([{ skillSlug: 'sales', proficiency: 2 }, { skillSlug: 'food-safety', proficiency: 5 }]);
    expect(d.level).toBe('weak');
    expect(d.reason).toContain('you list it at 2, below the 3 of 5 counted as held');
  });

  it('weak: none of the record\'s skills is held', () => {
    const record = SYNTHETIC_FULL_RECORD();
    record.skills = [{ slug: 'data-analysis', name: 'Data analysis', importance: 2, acquisition: 'learnable' }];
    expect(level([{ skillSlug: 'negotiation', proficiency: 5 }], record).level).toBe('weak');
  });

  it('unknown (record): no capability mapping', () => {
    const record = SYNTHETIC_FULL_RECORD();
    record.skills = [];
    const d = level([{ skillSlug: 'sales', proficiency: 5 }], record);
    expect(d.level).toBe('unknown');
    expect(d.unknownCause).toBe('not_researched');
  });

  it('unknown (person): no capabilities listed — an empty list is not "has none"', () => {
    const r = matchBusiness(person({ capabilities: [] }), SYNTHETIC_FULL_RECORD());
    const d = dim(r, 'transferable_capabilities');
    expect(d.level).toBe('unknown');
    expect(d.unknownCause).toBe('not_stated_by_person');
    expect(d.reason).toContain('It marks Sales as needed from the start');
    expect(r.missingPrerequisites.filter((m) => m.kind === 'skill')).toEqual([]);
  });
});

describe('personal interests', () => {
  const level = (interests: string[], record = SYNTHETIC_FULL_RECORD()) => dim(matchBusiness(person({ interests }), record), 'personal_interests');

  it('strong: an interest appears in the name, family or industry', () => {
    const d = level(['Widgets']);
    expect(d.level).toBe('strong');
    expect(d.reason).toContain('Your interest "Widgets" appears');
    expect(d.reason).toContain('plain word match');
  });

  it('moderate: an interest appears only in the descriptive text', () => {
    expect(level(['gadgets']).level).toBe('moderate');
  });

  it('weak: no listed interest appears anywhere in the record', () => {
    const d = level(['cricket', 'travel']);
    expect(d.level).toBe('weak');
    expect(d.reason).toContain('None of your listed interests ("cricket" and "travel")');
  });

  it('unknown (person): no interests listed', () => {
    const d = level([]);
    expect(d.level).toBe('unknown');
    expect(d.unknownCause).toBe('not_stated_by_person');
  });

  it('unknown (record): nothing to compare with', () => {
    const d = level(['widgets'], {});
    expect(d.level).toBe('unknown');
    expect(d.unknownCause).toBe('not_researched');
  });

  it('matches whole words only, ignoring case, plurals and filler words', () => {
    expect(interestWords('Food-Processing Units')).toEqual(['food', 'processing']);
    expect(level(['the widget business']).level).toBe('strong');
    expect(level(['wid']).level).toBe('weak'); // not a substring match
    expect(level(['synthetic manufacturing']).level).toBe('strong'); // every word of the interest must appear
    expect(level(['synthetic farming']).level).toBe('weak');
  });
});

describe('income potential (salary replacement)', () => {
  const level = (overrides: Parameters<typeof person>[0], record = SYNTHETIC_FULL_RECORD()) => dim(matchBusiness(person(overrides), record), 'income_potential');

  it('strong: year 3 (60,000) meets both the goal and the current income; earlier shortfalls are named', () => {
    const r = matchBusiness(person({ monthlyIncomeGoalInr: 50_000, currentMonthlyIncomeInr: 60_000 }), SYNTHETIC_FULL_RECORD());
    const d = dim(r, 'income_potential');
    expect(d.level).toBe('strong');
    expect(d.reason).toContain('averaging ₹60,000 a month in year 3 (year 1: ₹10,000; year 2: ₹40,000)');
    expect(d.reason).toContain('Against your income goal of ₹50,000 a month, year 1 and year 2 fall short.');
    expect(d.reason).toContain('Salary replacement: year 3 is at or above your current income of ₹60,000 a month; year 1 and year 2 fall short of it.');
    expect(d.reason).toContain('model outputs before income tax, not a forecast');
    expect(r.tradeOffs.some((t) => t.includes('below your ₹50,000 goal in year 1 and year 2 before reaching it'))).toBe(true);
  });

  it('moderate: year 3 misses a benchmark but is at least half of the lower one', () => {
    const d = level({ monthlyIncomeGoalInr: 80_000, currentMonthlyIncomeInr: 60_000 });
    expect(d.level).toBe('moderate');
    expect(d.reason).toContain('No modelled year reaches your income goal of ₹80,000 a month.');
  });

  it('weak: year 3 is below half of the lower benchmark', () => {
    const d = level({ monthlyIncomeGoalInr: 150_000, currentMonthlyIncomeInr: 200_000 }); // 60,000 < 75,000
    expect(d.level).toBe('weak');
    expect(d.reason).toContain('Salary replacement: year 3 is ₹1.4 L a month below your current income of ₹2 L; no modelled year replaces it.');
  });

  it('weak: a negative year 3 is weak whatever the goal', () => {
    const record = SYNTHETIC_FULL_RECORD();
    scenarioByKey(record, 'base').summary!.summary!.ownerIncome = { year1AvgMonthly: -50_000, year2AvgMonthly: -20_000, year3AvgMonthly: -10_000 };
    const r = matchBusiness(person({ monthlyIncomeGoalInr: 0, currentMonthlyIncomeInr: null }), record);
    const d = dim(r, 'income_potential');
    expect(d.level).toBe('weak');
    expect(d.reason).toContain('−₹10,000');
    expect(d.reason).toContain('still taking money from you');
    expect(r.tradeOffs.some((t) => t.includes('taking ₹50,000 a month from you'))).toBe(true);
  });

  it('uses whichever benchmark was given and says which was not', () => {
    const goalOnly = level({ monthlyIncomeGoalInr: 50_000, currentMonthlyIncomeInr: null });
    expect(goalOnly.level).toBe('strong');
    expect(goalOnly.reason).toContain('You have not given your current income, so salary replacement is not compared.');
    const salaryOnly = level({ monthlyIncomeGoalInr: null, currentMonthlyIncomeInr: 100_000 });
    expect(salaryOnly.level).toBe('moderate');
    expect(salaryOnly.reason).toContain('You have not given an income goal.');
  });

  it('unknown (person): neither benchmark given — the figures are still told', () => {
    const d = level({ monthlyIncomeGoalInr: null, currentMonthlyIncomeInr: null });
    expect(d.level).toBe('unknown');
    expect(d.unknownCause).toBe('not_stated_by_person');
    expect(d.reason).toContain('₹60,000');
  });

  it('unknown (record): no third year of owner income, or no base scenario', () => {
    const noYear3 = SYNTHETIC_FULL_RECORD();
    scenarioByKey(noYear3, 'base').summary!.summary!.ownerIncome = { year1AvgMonthly: 10_000, year2AvgMonthly: null, year3AvgMonthly: null };
    const a = level({}, noYear3);
    expect(a.level).toBe('unknown');
    expect(a.unknownCause).toBe('not_researched');
    const noBase = SYNTHETIC_FULL_RECORD();
    referenceVariant(noBase).scenarios = [];
    expect(level({}, noBase).level).toBe('unknown');
  });

  it('with a local scenario the weaker reading decides and both are told', () => {
    const record = SYNTHETIC_FULL_RECORD();
    referenceVariant(record).scenarios!.push(SYNTHETIC_LOCAL()); // local year 3 = 55,000
    const d = level({ preferredLocationSlug: 'synthetic-city', preferredLocationName: 'Synthetic City', monthlyIncomeGoalInr: 60_000, currentMonthlyIncomeInr: null }, record);
    expect(d.level).toBe('moderate'); // national 60,000 meets the goal, local 55,000 does not
    expect(d.reason).toContain('₹60,000 a month in year 3');
    expect(d.reason).toContain("the model's local case for Synthetic City");
    expect(d.reason).toContain('₹55,000 a month in year 3');
  });
});

describe('lifestyle compatibility', () => {
  const level = (overrides: Parameters<typeof person>[0], record = SYNTHETIC_FULL_RECORD()) => dim(matchBusiness(person(overrides), record), 'lifestyle_compatibility');

  it('strong: all four aspects compared, none strained', () => {
    const d = level({});
    expect(d.level).toBe('strong');
    expect(d.reason).toContain('Hours: the record puts owner hours at 40–50 a week, within your maximum of 50.');
    expect(d.reason).toContain('Weekends: the record shows occasional weekend work, which you accept.');
    expect(d.reason).toContain('Involvement: the record describes the owner as full time managerial');
    expect(d.reason).toContain("Physical demand: recorded as 2 on the record's 1–5 scale, within the 3 you accept.");
  });

  it('moderate: one aspect is a stretch (upper end of hours above the maximum)', () => {
    const r = matchBusiness(person({ maxHoursPerWeek: 45 }), SYNTHETIC_FULL_RECORD());
    expect(dim(r, 'lifestyle_compatibility').level).toBe('moderate');
    expect(r.tradeOffs.some((t) => t.includes('the upper end is above your maximum of 45'))).toBe(true);
  });

  it('moderate: occasional weekend work for someone who does not want weekends; one step more involvement; one step more physical', () => {
    expect(level({ weekendWorkOk: false }).level).toBe('moderate');
    expect(level({ desiredInvolvement: 'part_time' }).level).toBe('moderate');
    expect(level({ physicalWorkTolerance: 1 }).level).toBe('moderate');
  });

  it('weak: a conflict on any one aspect', () => {
    expect(level({ maxHoursPerWeek: 30 }).reason).toContain('even the low end is above your maximum of 30');
    expect(level({ maxHoursPerWeek: 30 }).level).toBe('weak');
    expect(level({ desiredInvolvement: 'absentee' }).level).toBe('weak');
    const regular = SYNTHETIC_FULL_RECORD();
    referenceVariant(regular).lifestyle!.weekend_work = 'regular';
    expect(level({ weekendWorkOk: false }, regular).level).toBe('weak');
    const heavy = SYNTHETIC_FULL_RECORD();
    referenceVariant(heavy).lifestyle!.physical_demand = 5;
    expect(level({ physicalWorkTolerance: 3 }, heavy).level).toBe('weak');
  });

  it('a business that asks less than the person offers is not a strain', () => {
    expect(level({ desiredInvolvement: 'full_time_hands_on', maxHoursPerWeek: 80, physicalWorkTolerance: 5 }).level).toBe('strong');
  });

  it('unknown (record): no lifestyle profile', () => {
    const record = SYNTHETIC_FULL_RECORD();
    referenceVariant(record).lifestyle = null;
    const d = level({}, record);
    expect(d.level).toBe('unknown');
    expect(d.unknownCause).toBe('not_researched');
  });

  it('unknown: an aspect that cannot be compared is never assumed to fit', () => {
    const partial = SYNTHETIC_FULL_RECORD();
    referenceVariant(partial).lifestyle!.physical_demand = null;
    const a = level({}, partial);
    expect(a.level).toBe('unknown');
    expect(a.unknownCause).toBe('not_researched');
    expect(a.reason).toContain('Not every aspect could be compared');
    expect(a.reason).toContain('physical demand is not recorded');

    const b = level({ weekendWorkOk: null });
    expect(b.level).toBe('unknown');
    expect(b.unknownCause).toBe('not_stated_by_person');
  });

  it('a conflict is definite even when other aspects are missing', () => {
    expect(level({ maxHoursPerWeek: 20, weekendWorkOk: null, physicalWorkTolerance: null }).level).toBe('weak');
  });
});

describe('operational complexity and learning', () => {
  const level = (overrides: Parameters<typeof person>[0], record = SYNTHETIC_FULL_RECORD()) => dim(matchBusiness(person(overrides), record), 'complexity_and_learning');

  it('strong: low difficulty, low complexity, training within half the timeline', () => {
    const r = matchBusiness(person(), SYNTHETIC_FULL_RECORD());
    const d = dim(r, 'complexity_and_learning');
    expect(d.level).toBe('strong');
    expect(d.reason).toContain("Learning difficulty: recorded as 2 on the record's 1–5 scale (low).");
    expect(d.reason).toContain('the recorded training takes about 8 weeks (about 1.8 months), within half of your 12-month transition timeline');
    expect(r.missingPrerequisites).toContainEqual({ kind: 'training', description: 'About 8 weeks of training, as recorded for this business.' });
  });

  it('moderate: medium difficulty, medium complexity, or training over half the timeline', () => {
    const medium = SYNTHETIC_FULL_RECORD();
    medium.founder_requirements!.learning_difficulty = 3;
    expect(level({}, medium).level).toBe('moderate');
    const complex = SYNTHETIC_FULL_RECORD();
    referenceVariant(complex).lifestyle!.operational_complexity = 3;
    expect(level({}, complex).level).toBe('moderate');
    expect(level({ transitionTimelineMonths: 3 }).level).toBe('moderate'); // 1.8 months > half of 3
  });

  it('weak: high difficulty, high complexity, or training longer than the timeline', () => {
    const hard = SYNTHETIC_FULL_RECORD();
    hard.founder_requirements!.learning_difficulty = 4;
    expect(level({}, hard).level).toBe('weak');
    const complex = SYNTHETIC_FULL_RECORD();
    referenceVariant(complex).lifestyle!.operational_complexity = 5;
    expect(level({}, complex).level).toBe('weak');
    const d = level({ transitionTimelineMonths: 1 });
    expect(d.level).toBe('weak');
    expect(d.reason).toContain('longer than your 1-month transition timeline');
  });

  it('unknown (record): nothing recorded, or only part of it', () => {
    const none = SYNTHETIC_FULL_RECORD();
    none.founder_requirements = null;
    referenceVariant(none).lifestyle = null;
    const a = level({}, none);
    expect(a.level).toBe('unknown');
    expect(a.unknownCause).toBe('not_researched');

    const part = SYNTHETIC_FULL_RECORD();
    referenceVariant(part).lifestyle = null; // difficulty and training known and easy, complexity not recorded
    const b = level({}, part);
    expect(b.level).toBe('unknown');
    expect(b.unknownCause).toBe('not_researched');
    expect(b.reason).toContain('Operational complexity: not recorded.');
  });

  it('unknown (person): training recorded but no timeline given', () => {
    const d = level({ transitionTimelineMonths: null });
    expect(d.level).toBe('unknown');
    expect(d.unknownCause).toBe('not_stated_by_person');
  });
});

describe('risk exposure', () => {
  const level = (overrides: Parameters<typeof person>[0], record = SYNTHETIC_FULL_RECORD()) => dim(matchBusiness(person(overrides), record), 'risk_exposure');

  it('strong: worst closure loss within the comfortable band, trough affordable, stress case still pays', () => {
    // deployable 12,00,000; moderate tolerance: comfortable up to one quarter = 3,00,000; worst closure loses 3,00,000
    const r = matchBusiness(person(), SYNTHETIC_FULL_RECORD());
    const d = dim(r, 'risk_exposure');
    expect(d.level).toBe('strong');
    expect(d.reason).toContain('If the business closed after month 12 of trading, the model shows ₹3 L of your own money not recovered — no more than one quarter of the ₹12 L you can deploy');
    expect(d.reason).toContain('At its deepest point the base case has taken ₹8 L of your money in total (₹2 L of it after opening), within the ₹12 L you can deploy.');
    expect(d.reason).toContain("With revenue 20% lower through lower sales, the model's year-3 owner income is ₹20,000 a month instead of ₹60,000.");
    expect(d.reason).toContain("lists 3 risks, 1 rated high (SYNTHETIC demand risk)");
    expect(d.reason).toContain('not the chance of anything happening');
    expect(r.tradeOffs).toContain('If the business closed after month 12 of trading, the model shows ₹3 L of your own money not recovered.');
  });

  it('uses the worst of the closure scenarios', () => {
    const record = SYNTHETIC_FULL_RECORD();
    scenarioByKey(record, 'failure_closure_month_24').summary!.closure = { atOperatingMonth: 24, ownerCapitalLost: 700_000 };
    const d = level({}, record);
    expect(d.reason).toContain('closed after month 24 of trading');
    expect(d.level).toBe('weak'); // 7,00,000 > half of 12,00,000
  });

  it('moderate: the same loss is only "elevated" for a low tolerance when within its limit', () => {
    // low tolerance: comfortable one tenth = 1,20,000, limit one quarter = 3,00,000; loss 3,00,000
    const d = level({ riskTolerance: 'low' });
    expect(d.level).toBe('moderate');
    expect(d.reason).toContain('more than one tenth of the ₹12 L you can deploy, though not beyond the one quarter');
  });

  it('weak: closure loss beyond what the stated tolerance allows', () => {
    // deployable 8,00,000; low tolerance limit = 2,00,000 < 3,00,000
    const d = level({ riskTolerance: 'low', investableCapitalInr: 1_000_000, reserveRequirementInr: 200_000 });
    expect(d.level).toBe('weak');
    expect(d.reason).toContain('more than one quarter of the ₹8 L you can deploy, the most this engine treats as within a low risk tolerance');
  });

  it('the same facts read differently for a high tolerance', () => {
    expect(level({ riskTolerance: 'high', investableCapitalInr: 1_000_000, reserveRequirementInr: 200_000 }).level).toBe('strong');
  });

  it('weak: the base case takes more than the person can deploy', () => {
    const d = level({ investableCapitalInr: 700_000, reserveRequirementInr: 0, riskTolerance: 'high' });
    expect(d.level).toBe('weak');
    expect(d.reason).toContain('more than the ₹7 L you can deploy');
  });

  it('stress case with negative year-3 income: weak for low/moderate tolerance, moderate for high', () => {
    const record = SYNTHETIC_FULL_RECORD();
    scenarioByKey(record, 'stress_revenue_minus_20').summary!.summary!.ownerIncome = { year1AvgMonthly: -30_000, year2AvgMonthly: -20_000, year3AvgMonthly: -5_000 };
    expect(level({ riskTolerance: 'moderate' }, record).level).toBe('weak');
    expect(level({ riskTolerance: 'low', investableCapitalInr: 5_000_000 }, record).level).toBe('weak');
    const high = level({ riskTolerance: 'high' }, record);
    expect(high.level).toBe('moderate');
    expect(high.reason).toContain('−₹5,000 a month instead of ₹60,000 — the business would still be taking money from you');
  });

  it('unknown (record): no closure scenario, or no −20% stress case', () => {
    const noClosure = SYNTHETIC_FULL_RECORD();
    referenceVariant(noClosure).scenarios = referenceVariant(noClosure).scenarios!.filter((s) => s.kind !== 'failure');
    const a = level({}, noClosure);
    expect(a.level).toBe('unknown');
    expect(a.unknownCause).toBe('not_researched');
    expect(a.reason).toContain('No closure scenario has been computed');

    const noStress = SYNTHETIC_FULL_RECORD();
    referenceVariant(noStress).scenarios = referenceVariant(noStress).scenarios!.filter((s) => s.kind !== 'stress');
    const b = level({}, noStress);
    expect(b.level).toBe('unknown');
    expect(b.reason).toContain('No stress case with revenue 20% lower has been computed');
  });

  it('finds the stress case by kind and scenario_key, not by position or label', () => {
    const record = SYNTHETIC_FULL_RECORD();
    const v = referenceVariant(record);
    v.scenarios = [
      syntheticScenario({ key: 'stress_price_minus_10', kind: 'stress', label: 'SYNTHETIC other stress', income: [0, 0, -99_000] }),
      ...v.scenarios!.reverse(),
    ];
    expect(level({}, record).reason).toContain('year-3 owner income is ₹20,000 a month');
  });

  it('unknown (person): no risk tolerance, or no capital — the figures are still told', () => {
    const a = level({ riskTolerance: null });
    expect(a.level).toBe('unknown');
    expect(a.unknownCause).toBe('not_stated_by_person');
    expect(a.reason).toContain('₹3 L of your own money not recovered');
    expect(a.reason).toContain('You have not stated a risk tolerance');
    expect(level({ investableCapitalInr: null }).level).toBe('unknown');
  });

  it('says when no risk register has been researched', () => {
    const record = SYNTHETIC_FULL_RECORD();
    record.risks = [];
    expect(level({}, record).reason).toContain('No risk register has been researched for this record');
  });
});

describe('geographic fit', () => {
  const there = { preferredLocationSlug: 'synthetic-city', preferredLocationName: 'Synthetic City' };
  const withLocal = (local: number, inherited: number) => {
    const record = SYNTHETIC_FULL_RECORD();
    referenceVariant(record).scenarios!.push(SYNTHETIC_LOCAL(local, inherited));
    return record;
  };
  const level = (overrides: Parameters<typeof person>[0], record = SYNTHETIC_FULL_RECORD()) => dim(matchBusiness(person(overrides), record), 'geographic_fit');

  it('strong: a local scenario exists and at least half of its inputs are local', () => {
    const r = matchBusiness(person(there), withLocal(20, 20));
    const d = dim(r, 'geographic_fit');
    expect(d.level).toBe('strong');
    expect(d.reason).toContain('A scenario for Synthetic City exists: 20 of its 40 inputs come from local evidence (20 city-level) and 20 inherit the national figure');
    expect(r.basis.localScenario).toEqual({ label: 'Base case — Synthetic City', locationName: 'Synthetic City', localInputs: 20, inheritedNationalInputs: 20 });
  });

  it('moderate: at least a tenth but fewer than half of the inputs are local', () => {
    expect(level(there, withLocal(4, 36)).level).toBe('moderate');
  });

  it('weak: fewer than a tenth of the inputs are local', () => {
    const d = level(there, withLocal(2, 38));
    expect(d.level).toBe('weak');
    expect(d.reason).toContain('2 of its 40 inputs');
  });

  it('unknown (person): no preferred location', () => {
    const d = level({ preferredLocationSlug: null, preferredLocationName: null }, withLocal(20, 20));
    expect(d.level).toBe('unknown');
    expect(d.unknownCause).toBe('not_stated_by_person');
    expect(d.reason).toContain('This record has local scenarios for Synthetic City.');
  });

  it('unknown (record): no local scenario at all — the national case is never passed off as local', () => {
    const d = level(there);
    expect(d.level).toBe('unknown');
    expect(d.unknownCause).toBe('not_researched');
    expect(d.reason).toContain('every figure in it is a national one');
    expect(d.reason).toContain('Synthetic City');
  });

  it('unknown (record): local scenarios exist, but not for this person\'s city', () => {
    const d = level({ preferredLocationSlug: 'another-town', preferredLocationName: 'Another Town' }, withLocal(20, 20));
    expect(d.level).toBe('unknown');
    expect(d.unknownCause).toBe('not_researched');
    expect(d.reason).toContain('local scenarios for Synthetic City, but none labelled for Another Town');
  });

  it('recognises the scenario from the slug alone when the label spells the same words', () => {
    expect(level({ preferredLocationSlug: 'synthetic-city', preferredLocationName: null }, withLocal(20, 20)).level).toBe('strong');
  });
});
