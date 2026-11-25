import { describe, expect, it } from 'vitest';
import { FEASIBILITY_CHECK_KEYS, matchBusiness, parseRequirementText, holdsQualification, deployableCapital, overallFeasibility } from '../src/index';
import { SYNTHETIC_FULL_RECORD, SYNTHETIC_LOCAL, referenceVariant, scenarioByKey, syntheticScenario } from './fixtures';
import { check, person } from './helpers';

describe('feasibility: shape', () => {
  it('always returns the four mandatory checks in the documented order, each with a reason', () => {
    const r = matchBusiness(person(), SYNTHETIC_FULL_RECORD());
    expect(r.feasibility.map((c) => c.key)).toEqual([...FEASIBILITY_CHECK_KEYS]);
    expect(r.feasibility.map((c) => c.key)).toEqual(['capital_affordability', 'financial_runway', 'required_qualifications', 'required_assets']);
    for (const c of r.feasibility) expect(c.reason.length).toBeGreaterThan(20);
  });

  it('is feasible "yes" only when every check passes', () => {
    const r = matchBusiness(person(), SYNTHETIC_FULL_RECORD());
    expect(r.feasibility.map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(r.feasible).toBe('yes');
    expect(r.whyNotSuitable).toBeUndefined();
  });

  it('overall rule: any fail → no; else any unknown → cannot_assess; else yes', () => {
    const mk = (statuses: Array<'pass' | 'fail' | 'unknown'>) =>
      statuses.map((status, i) => ({ key: FEASIBILITY_CHECK_KEYS[i]!, label: 'x', status, reason: 'x' }));
    expect(overallFeasibility(mk(['pass', 'pass', 'pass', 'pass']))).toBe('yes');
    expect(overallFeasibility(mk(['pass', 'unknown', 'pass', 'pass']))).toBe('cannot_assess');
    expect(overallFeasibility(mk(['pass', 'unknown', 'fail', 'pass']))).toBe('no');
    expect(overallFeasibility(mk(['unknown', 'unknown', 'unknown', 'unknown']))).toBe('cannot_assess');
  });
});

describe('capital affordability', () => {
  it('pass: cites what is needed, the breakdown, what the person has and the reserve', () => {
    const c = check(matchBusiness(person(), SYNTHETIC_FULL_RECORD()), 'capital_affordability');
    expect(c.status).toBe('pass');
    expect(c.reason).toContain('needs ₹8 L of your own money in total');
    expect(c.reason).toContain('₹6 L before opening plus ₹2 L to cover the deepest cash trough');
    expect(c.reason).toContain('you have ₹12 L after keeping your ₹3 L reserve');
    expect(c.reason).toContain('loan of ₹4 L');
    expect(c.shortfall).toBeUndefined();
    expect(c.unknownCause).toBeUndefined();
  });

  it('pass at the boundary: needing exactly what is deployable passes', () => {
    const c = check(matchBusiness(person({ investableCapitalInr: 1_000_000, reserveRequirementInr: 200_000 }), SYNTHETIC_FULL_RECORD()), 'capital_affordability');
    expect(c.status).toBe('pass');
  });

  it('fail: states the shortfall in rupees', () => {
    const c = check(matchBusiness(person({ investableCapitalInr: 700_000, reserveRequirementInr: 0 }), SYNTHETIC_FULL_RECORD()), 'capital_affordability');
    expect(c.status).toBe('fail');
    expect(c.shortfall).toEqual({ kind: 'money', amountInr: 100_000 });
    expect(c.reason).toContain('you have ₹7 L and no reserve to keep — ₹1 L short');
  });

  it('reserve handling: the reserve is taken off the capital before comparing', () => {
    // 10,00,000 capital would cover the 8,00,000 needed, but 3,00,000 must stay untouched → 7,00,000 deployable
    const withReserve = check(matchBusiness(person({ investableCapitalInr: 1_000_000, reserveRequirementInr: 300_000 }), SYNTHETIC_FULL_RECORD()), 'capital_affordability');
    expect(withReserve.status).toBe('fail');
    expect(withReserve.shortfall).toEqual({ kind: 'money', amountInr: 100_000 });
    expect(withReserve.reason).toContain('you have ₹7 L after keeping your ₹3 L reserve');
    const withoutReserve = check(matchBusiness(person({ investableCapitalInr: 1_000_000, reserveRequirementInr: 0 }), SYNTHETIC_FULL_RECORD()), 'capital_affordability');
    expect(withoutReserve.status).toBe('pass');
  });

  it('reserve handling: a reserve as large as the capital leaves nothing, never a negative amount', () => {
    const p = person({ investableCapitalInr: 400_000, reserveRequirementInr: 500_000 });
    expect(deployableCapital(p)).toBe(0);
    const c = check(matchBusiness(p, SYNTHETIC_FULL_RECORD()), 'capital_affordability');
    expect(c.status).toBe('fail');
    expect(c.shortfall).toEqual({ kind: 'money', amountInr: 800_000 });
    expect(c.reason).toContain('your ₹5 L reserve takes up all of your ₹4 L capital');
  });

  it('unknown (person): capital or reserve not stated — never assumed to be zero', () => {
    for (const p of [person({ investableCapitalInr: null }), person({ reserveRequirementInr: null })]) {
      const c = check(matchBusiness(p, SYNTHETIC_FULL_RECORD()), 'capital_affordability');
      expect(c.status).toBe('unknown');
      expect(c.unknownCause).toBe('not_stated_by_person');
      expect(c.reason).toContain('You have not said');
      expect(c.reason).toContain('₹8 L'); // the requirement is still told
    }
    expect(deployableCapital(person({ reserveRequirementInr: null }))).toBeNull();
  });

  it('unknown (record): no reference variant, no base scenario, or no total in the scenario', () => {
    const noVariant = SYNTHETIC_FULL_RECORD();
    referenceVariant(noVariant).is_reference = false;
    const a = check(matchBusiness(person(), noVariant), 'capital_affordability');
    expect(a.status).toBe('unknown');
    expect(a.unknownCause).toBe('not_researched');
    expect(a.reason).toContain('does not mark a reference variant');

    const noBase = SYNTHETIC_FULL_RECORD();
    referenceVariant(noBase).scenarios = [];
    const b = check(matchBusiness(person(), noBase), 'capital_affordability');
    expect(b.status).toBe('unknown');
    expect(b.reason).toContain('No base financial scenario has been computed');

    const noTotal = SYNTHETIC_FULL_RECORD();
    scenarioByKey(noTotal, 'base').summary!.summary!.totalOwnerCashRequired = null;
    const c = check(matchBusiness(person(), noTotal), 'capital_affordability');
    expect(c.status).toBe('unknown');
    expect(c.unknownCause).toBe('not_researched');
  });

  it('never falls back to a non-reference variant', () => {
    const record = SYNTHETIC_FULL_RECORD();
    referenceVariant(record).is_reference = false; // the "larger" variant with a base scenario is still there
    const r = matchBusiness(person(), record);
    expect(check(r, 'capital_affordability').status).toBe('unknown');
    expect(check(r, 'financial_runway').status).toBe('unknown');
    expect(r.basis.variantName).toBeNull();
  });

  describe('loan vs no loan', () => {
    it('scenario has a loan and the person will not borrow → unknown, loan amount stated', () => {
      const c = check(matchBusiness(person({ willingToTakeLoan: false }), SYNTHETIC_FULL_RECORD()), 'capital_affordability');
      expect(c.status).toBe('unknown');
      expect(c.unknownCause).toBe('not_researched');
      expect(c.reason).toContain('financed with a loan of ₹4 L');
      expect(c.reason).toContain('you have said you would not borrow');
      expect(c.reason).toContain('cannot be assessed from this scenario');
      expect(c.reason).toContain('With the loan it needs ₹8 L');
    });

    it('…and the result warns that every other financial figure still comes from the loan-financed case', () => {
      const warning = /You have said you would not borrow, yet every financial figure here/;
      expect(matchBusiness(person({ willingToTakeLoan: false }), SYNTHETIC_FULL_RECORD()).tradeOffs.some((t) => warning.test(t))).toBe(true);
      expect(matchBusiness(person({ willingToTakeLoan: true }), SYNTHETIC_FULL_RECORD()).tradeOffs.some((t) => warning.test(t))).toBe(false);
    });

    it('scenario has a loan and even the with-loan figure is out of reach → fail, whatever they said about borrowing', () => {
      // Without the loan the owner must find more, never less: ₹8 L with the loan against ₹1 L available is already decided.
      for (const willingToTakeLoan of [false, null]) {
        const c = check(matchBusiness(person({ willingToTakeLoan, investableCapitalInr: 100_000, reserveRequirementInr: 0 }), SYNTHETIC_FULL_RECORD()), 'capital_affordability');
        expect(c.status).toBe('fail');
        expect(c.reason).toContain('Even with the loan of ₹4 L');
        expect(c.reason).toContain('at least ₹7 L short');
        expect(c.reason).toContain('Without the loan the requirement would be higher still');
        expect(c.shortfall).toEqual({ kind: 'money', amountInr: 700_000 });
      }
    });

    it('scenario has a loan and the person has not said → unknown (person), not a pass on an assumed loan', () => {
      const c = check(matchBusiness(person({ willingToTakeLoan: null }), SYNTHETIC_FULL_RECORD()), 'capital_affordability');
      expect(c.status).toBe('unknown');
      expect(c.unknownCause).toBe('not_stated_by_person');
      expect(c.reason).toContain('loan of ₹4 L');
      expect(c.reason).toContain('you have not said whether you would borrow');
    });

    it('scenario has a loan and the person would borrow → compared, with the loan named', () => {
      const c = check(matchBusiness(person({ willingToTakeLoan: true }), SYNTHETIC_FULL_RECORD()), 'capital_affordability');
      expect(c.status).toBe('pass');
      expect(c.reason).toContain('alongside a loan of ₹4 L');
      expect(c.reason).toContain('whether a lender would grant it is not assessed');
    });

    it('scenario has no loan → compared whatever the person said about borrowing', () => {
      for (const willing of [false, null, true]) {
        const record = SYNTHETIC_FULL_RECORD();
        referenceVariant(record).scenarios![0] = syntheticScenario({ key: 'base', kind: 'base', label: 'SYNTHETIC all-equity base', loan: 0, upfront: 1_000_000, trough: 0 });
        const pass = check(matchBusiness(person({ willingToTakeLoan: willing }), record), 'capital_affordability');
        expect(pass.status).toBe('pass');
        expect(pass.reason).not.toContain('loan');
        expect(pass.reason).toContain('(all of it before opening)');
        const fail = check(matchBusiness(person({ willingToTakeLoan: willing, investableCapitalInr: 900_000, reserveRequirementInr: 0 }), record), 'capital_affordability');
        expect(fail.status).toBe('fail');
      }
    });

    it('scenario does not say whether it has a loan and the person will not borrow → unknown', () => {
      const record = SYNTHETIC_FULL_RECORD();
      scenarioByKey(record, 'base').summary!.funding = null;
      const c = check(matchBusiness(person({ willingToTakeLoan: false }), record), 'capital_affordability');
      expect(c.status).toBe('unknown');
      expect(c.unknownCause).toBe('not_researched');
    });
  });

  it('with a local scenario for the person\'s city, both cases are told and the worse one decides', () => {
    const record = SYNTHETIC_FULL_RECORD();
    referenceVariant(record).scenarios!.push(SYNTHETIC_LOCAL()); // local case needs 9,00,000
    const there = { preferredLocationSlug: 'synthetic-city', preferredLocationName: 'Synthetic City' };
    const both = check(matchBusiness(person(there), record), 'capital_affordability');
    expect(both.status).toBe('pass');
    expect(both.reason).toContain("the model's national base case needs ₹8 L");
    expect(both.reason).toContain("the model's local case for Synthetic City needs ₹9 L");

    // 8,50,000 deployable: national (8,00,000) passes, local (9,00,000) does not → fail
    const tight = check(matchBusiness(person({ ...there, investableCapitalInr: 850_000, reserveRequirementInr: 0 }), record), 'capital_affordability');
    expect(tight.status).toBe('fail');
    expect(tight.shortfall).toEqual({ kind: 'money', amountInr: 50_000 });

    // someone who prefers another place is not shown the local case
    const elsewhere = check(matchBusiness(person({ preferredLocationSlug: 'another-town', preferredLocationName: 'Another Town' }), record), 'capital_affordability');
    expect(elsewhere.reason).not.toContain('Synthetic City');
  });
});

describe('financial runway', () => {
  it('pass: set-up months + first cash-positive month of trading, inside the timeline', () => {
    const c = check(matchBusiness(person({ transitionTimelineMonths: 6 }), SYNTHETIC_FULL_RECORD()), 'financial_runway');
    expect(c.status).toBe('pass'); // 2 + 4 = 6 ≤ 6
    expect(c.reason).toContain('month 6 counted from your first spend (2 months of setting up, then month 4 of trading)');
    expect(c.reason).toContain('within your 6-month transition timeline');
  });

  it('fail: later than the timeline, shortfall in months', () => {
    const c = check(matchBusiness(person({ transitionTimelineMonths: 5 }), SYNTHETIC_FULL_RECORD()), 'financial_runway');
    expect(c.status).toBe('fail');
    expect(c.shortfall).toEqual({ kind: 'time', months: 1 });
    expect(c.reason).toContain('1 month after your 5-month transition timeline ends');
  });

  it('fail — not unknown — when net cash never turns positive within the modelled period', () => {
    const record = SYNTHETIC_FULL_RECORD();
    scenarioByKey(record, 'base').summary!.summary!.breakEven = { firstOperatingMonthNetCashPositive: null };
    const c = check(matchBusiness(person(), record), 'financial_runway');
    expect(c.status).toBe('fail');
    expect(c.unknownCause).toBeUndefined();
    expect(c.reason).toContain('no month within the modelled period in which the business brings in more cash than it spends');
    // still a fail when the person gave no timeline: no timeline could be long enough
    expect(check(matchBusiness(person({ transitionTimelineMonths: null }), record), 'financial_runway').status).toBe('fail');
  });

  it('unknown (record): the scenario does not carry the figure at all', () => {
    const record = SYNTHETIC_FULL_RECORD();
    scenarioByKey(record, 'base').summary!.summary!.breakEven = {};
    const c = check(matchBusiness(person(), record), 'financial_runway');
    expect(c.status).toBe('unknown');
    expect(c.unknownCause).toBe('not_researched');
  });

  it('unknown (person): no transition timeline given', () => {
    const c = check(matchBusiness(person({ transitionTimelineMonths: null }), SYNTHETIC_FULL_RECORD()), 'financial_runway');
    expect(c.status).toBe('unknown');
    expect(c.unknownCause).toBe('not_stated_by_person');
    expect(c.reason).toContain('month 6 counted from your first spend');
  });

  it('set-up period not recorded: unknown, unless trading months alone already overrun the timeline', () => {
    const record = SYNTHETIC_FULL_RECORD();
    referenceVariant(record).parameters = [];
    const unknown = check(matchBusiness(person({ transitionTimelineMonths: 12 }), record), 'financial_runway');
    expect(unknown.status).toBe('unknown');
    expect(unknown.unknownCause).toBe('not_researched');
    expect(unknown.reason).toContain('does not state how many set-up months');
    const fail = check(matchBusiness(person({ transitionTimelineMonths: 3 }), record), 'financial_runway');
    expect(fail.status).toBe('fail'); // month 4 of trading > 3, whatever the set-up period
    expect(fail.shortfall).toEqual({ kind: 'time', months: 1 });
  });

  it('says so when the set-up period is an assumption in the record', () => {
    const record = SYNTHETIC_FULL_RECORD();
    referenceVariant(record).parameters = [{ key: 'pre_operating_months', value: 2, basis: 'assumption', is_resolved: true }];
    expect(check(matchBusiness(person(), record), 'financial_runway').reason).toContain('The 2-month set-up period is an assumption in this record, not evidence.');
  });
});

describe('required qualifications', () => {
  it('pass: the listed qualification is held', () => {
    const c = check(matchBusiness(person(), SYNTHETIC_FULL_RECORD()), 'required_qualifications');
    expect(c.status).toBe('pass');
    expect(c.reason).toContain('"SYNTHETIC diploma in widget making"');
  });

  it('pass: the record states that nothing is mandatory', () => {
    const record = SYNTHETIC_FULL_RECORD();
    record.founder_requirements!.mandatory_qualifications = 'None';
    record.founder_requirements!.certifications = 'Not required';
    const c = check(matchBusiness(person({ qualificationsHeld: [] }), record), 'required_qualifications');
    expect(c.status).toBe('pass');
    expect(c.reason).toContain('no qualification or certification is mandatory');
  });

  it('fail: a listed qualification is not held; the missing ones are named', () => {
    const record = SYNTHETIC_FULL_RECORD();
    record.founder_requirements!.certifications = 'SYNTHETIC safety certificate; SYNTHETIC hygiene certificate';
    const r = matchBusiness(person({ qualificationsHeld: ['SYNTHETIC diploma in widget making', 'synthetic hygiene certificate (2020)'] }), record);
    const c = check(r, 'required_qualifications');
    expect(c.status).toBe('fail');
    expect(c.shortfall).toEqual({ kind: 'items', items: ['SYNTHETIC safety certificate'] });
    expect(r.feasible).toBe('no');
    expect(r.missingPrerequisites).toContainEqual({ kind: 'qualification', description: '"SYNTHETIC safety certificate", which the record lists as required of the founder.' });
  });

  it('fail: nothing listed by the person', () => {
    const c = check(matchBusiness(person({ qualificationsHeld: [] }), SYNTHETIC_FULL_RECORD()), 'required_qualifications');
    expect(c.status).toBe('fail');
    expect(c.reason).toContain('you have not listed any qualification');
  });

  it('unknown: founder requirements not researched', () => {
    const record = SYNTHETIC_FULL_RECORD();
    record.founder_requirements = null;
    const c = check(matchBusiness(person(), record), 'required_qualifications');
    expect(c.status).toBe('unknown');
    expect(c.unknownCause).toBe('not_researched');
    expect(c.reason).toContain('have not been researched');
  });

  it('unknown: a blank field is "not recorded", never "nothing required"', () => {
    const record = SYNTHETIC_FULL_RECORD();
    record.founder_requirements!.certifications = null;
    const c = check(matchBusiness(person(), record), 'required_qualifications');
    expect(c.status).toBe('unknown');
    expect(c.reason).toContain('does not state its certifications');
    // …but a definite gap still fails
    expect(check(matchBusiness(person({ qualificationsHeld: [] }), record), 'required_qualifications').status).toBe('fail');
  });

  it('parses the record\'s free text', () => {
    expect(parseRequirementText(null)).toEqual({ state: 'not_recorded' });
    expect(parseRequirementText('   ')).toEqual({ state: 'not_recorded' });
    expect(parseRequirementText('None.')).toEqual({ state: 'none_required' });
    expect(parseRequirementText('No formal qualification required')).toEqual({ state: 'none_required' });
    expect(parseRequirementText('1. Alpha\n2. Beta; Gamma')).toEqual({ state: 'listed', items: ['Alpha', 'Beta', 'Gamma'] });
  });

  it('matches held qualifications conservatively', () => {
    expect(holdsQualification('B.Sc. Chemistry', ['bsc chemistry'])).toBe(true);
    expect(holdsQualification('Diploma in pharmacy', ['Diploma in Pharmacy, 2012'])).toBe(true);
    expect(holdsQualification('Diploma in pharmacy', ['Diploma'])).toBe(false); // holding less never satisfies more
    expect(holdsQualification('Diploma in pharmacy', [])).toBe(false);
  });
});

describe('required assets and infrastructure', () => {
  it('unknown: not in the snapshot (today\'s records) — says it has not been researched', () => {
    const record = SYNTHETIC_FULL_RECORD();
    delete referenceVariant(record).assets;
    const c = check(matchBusiness(person(), record), 'required_assets');
    expect(c.status).toBe('unknown');
    expect(c.unknownCause).toBe('not_researched');
    expect(c.reason).toContain('Asset requirements have not been researched');
    expect(c.reason).toContain('Built-up area: 1,000 sq ft'); // operating needs are quoted, not judged
  });

  it('unknown: an empty list is "not researched", not "nothing required"', () => {
    const record = SYNTHETIC_FULL_RECORD();
    referenceVariant(record).assets = [];
    expect(check(matchBusiness(person(), record), 'required_assets').status).toBe('unknown');
  });

  it('pass: every required asset is listed by the person', () => {
    const c = check(matchBusiness(person(), SYNTHETIC_FULL_RECORD()), 'required_assets');
    expect(c.status).toBe('pass');
    expect(c.reason).toContain('Commercial shop');
  });

  it('pass: assets are recorded and none is required', () => {
    const record = SYNTHETIC_FULL_RECORD();
    referenceVariant(record).assets = [{ asset_type_slug: 'vehicle-car', name: 'Car', requirement_level: 'advantage' }];
    const c = check(matchBusiness(person({ assets: [] }), record), 'required_assets');
    expect(c.status).toBe('pass');
    expect(c.reason).toContain('marks none of them as required');
  });

  it('fail: a required asset is not listed', () => {
    const r = matchBusiness(person({ assets: [{ assetTypeSlug: 'vehicle-car' }] }), SYNTHETIC_FULL_RECORD());
    const c = check(r, 'required_assets');
    expect(c.status).toBe('fail');
    expect(c.shortfall).toEqual({ kind: 'items', items: ['Commercial shop'] });
    expect(r.missingPrerequisites).toContainEqual({ kind: 'asset', description: 'Commercial shop, which the record marks as required.' });
  });
});
