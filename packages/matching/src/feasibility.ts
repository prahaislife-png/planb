/**
 * Mandatory feasibility checks. Each returns pass / fail / unknown with a reason that cites the figures used.
 * Rules: docs/MATCHING_ENGINE.md §3.
 */

import type { PersonProfile } from './profile';
import type { CheckStatus, Feasible, FeasibilityCheck, FeasibilityCheckKey, Shortfall, UnknownCause } from './result';
import { listOf, numberOrNull, textOrNull, type BusinessSnapshot, type SelectedScenarios, type SnapshotScenario } from './snapshot';
import { formatCount, formatInr, formatMonths, joinList, monthSpan, plural } from './format';

export const FEASIBILITY_CHECK_LABELS: Record<FeasibilityCheckKey, string> = {
  capital_affordability: 'Capital affordability',
  financial_runway: 'Financial runway',
  required_qualifications: 'Required qualifications',
  required_assets: 'Required assets and infrastructure',
};

export interface Verdict {
  status: CheckStatus;
  reason: string;
  unknownCause?: UnknownCause;
  shortfall?: Shortfall;
}

const SEVERITY: Record<CheckStatus, number> = { pass: 0, unknown: 1, fail: 2 };

/** One verdict from the national case and (when it exists) the local case: the worse status wins, both are told. */
export function combineVerdicts(verdicts: Verdict[]): Verdict {
  const worst = verdicts.reduce((a, b) => (SEVERITY[b.status] > SEVERITY[a.status] ? b : a));
  const out: Verdict = { status: worst.status, reason: verdicts.map((v) => v.reason).join(' ') };
  if (worst.status === 'unknown') {
    const unknowns = verdicts.filter((v) => v.status === 'unknown');
    out.unknownCause = unknowns.some((v) => v.unknownCause === 'not_researched') ? 'not_researched' : 'not_stated_by_person';
  }
  if (worst.status === 'fail') {
    const failing = verdicts.filter((v) => v.status === 'fail' && v.shortfall);
    const money = failing.map((v) => v.shortfall).filter((s): s is Extract<Shortfall, { kind: 'money' }> => s?.kind === 'money');
    const time = failing.map((v) => v.shortfall).filter((s): s is Extract<Shortfall, { kind: 'time' }> => s?.kind === 'time');
    if (money.length) out.shortfall = { kind: 'money', amountInr: Math.max(...money.map((m) => m.amountInr)) };
    else if (time.length) out.shortfall = { kind: 'time', months: Math.max(...time.map((t) => t.months)) };
  }
  return out;
}

export interface FinancialCase {
  scenario: SnapshotScenario;
  /** How the case is named inside a sentence, e.g. "the model's base case". */
  name: string;
}

/** The national base case, then the local case for the person's city when the record has one. */
export function financialCases(selected: SelectedScenarios): FinancialCase[] {
  const cases: FinancialCase[] = [];
  if (selected.nationalBase) cases.push({ scenario: selected.nationalBase, name: "the model's national base case" });
  if (selected.localBase) cases.push({ scenario: selected.localBase.scenario, name: `the model's local case for ${selected.localBase.locationName}` });
  return cases;
}

function noCaseVerdict(selected: SelectedScenarios, what: string): Verdict {
  const reason = selected.variant
    ? `No base financial scenario has been computed for this record, so ${what} has not been worked out.`
    : `This record does not mark a reference variant, so there is no costed case from which ${what} could be read.`;
  return { status: 'unknown', reason, unknownCause: 'not_researched' };
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Money the person can put in: investable capital minus the reserve they must keep, never below zero. */
export function deployableCapital(profile: PersonProfile): number | null {
  if (profile.investableCapitalInr === null || profile.reserveRequirementInr === null) return null;
  return Math.max(0, profile.investableCapitalInr - profile.reserveRequirementInr);
}

function haveSentence(profile: PersonProfile): string {
  const capital = profile.investableCapitalInr!;
  const reserve = profile.reserveRequirementInr!;
  if (reserve >= capital) return `your ${formatInr(reserve)} reserve takes up all of your ${formatInr(capital)} capital, leaving nothing to invest`;
  if (reserve === 0) return `you have ${formatInr(capital)} and no reserve to keep`;
  return `you have ${formatInr(capital - reserve)} after keeping your ${formatInr(reserve)} reserve`;
}

// ── 1. capital affordability ─────────────────────────────────────────────────

function capitalVerdict(c: FinancialCase, profile: PersonProfile): Verdict {
  const summary = c.scenario.summary;
  const total = numberOrNull(summary?.summary?.totalOwnerCashRequired);
  if (total === null) {
    return { status: 'unknown', unknownCause: 'not_researched', reason: `${capitalise(c.name)} does not state the total owner cash it requires.` };
  }
  const upfront = numberOrNull(summary?.funding?.ownerEquityUpfront);
  const trough = numberOrNull(summary?.summary?.peakFundingNeed);
  let breakdown = '';
  if (upfront !== null && trough !== null) {
    breakdown = trough > 0
      ? ` (${formatInr(Math.max(upfront, 0))} before opening plus ${formatInr(trough)} to cover the deepest cash trough after it)`
      : ' (all of it before opening)';
  }
  const need = `On the recorded inputs, ${c.name} needs ${formatInr(total)} of your own money in total${breakdown}`;

  const missing: string[] = [];
  if (profile.investableCapitalInr === null) missing.push('how much capital you can invest');
  if (profile.reserveRequirementInr === null) missing.push('how much reserve you must keep (0 if none)');
  if (missing.length) {
    return { status: 'unknown', unknownCause: 'not_stated_by_person', reason: `${need}. You have not said ${joinList(missing)}, so this cannot be compared.` };
  }
  const deployable = deployableCapital(profile)!;
  const loan = numberOrNull(summary?.funding?.loan);

  if (profile.willingToTakeLoan !== true) {
    if (loan === null) {
      return {
        status: 'unknown', unknownCause: 'not_researched',
        reason: `${need}, but the scenario does not state whether that figure relies on a loan, and you have ${profile.willingToTakeLoan === false ? 'said you would not borrow' : 'not said whether you would borrow'}.`,
      };
    }
    if (loan > 0) {
      // Without the loan the owner must find more, never less. So if even the with-loan figure is beyond their money,
      // the answer is already known: not affordable, whether or not they would borrow.
      if (total > deployable) {
        const gap = total - deployable;
        return {
          status: 'fail',
          reason: `Even with the loan of ${formatInr(loan)} that the scenario assumes, ${c.name} needs ${formatInr(total)} of your own money in total${breakdown}; ${haveSentence(profile)} — at least ${formatInr(gap)} short. Without the loan the requirement would be higher still.`,
          shortfall: { kind: 'money', amountInr: Math.round(gap * 100) / 100 },
        };
      }
      const withLoan = `With the loan it needs ${formatInr(total)} of your own money in total${breakdown}; ${haveSentence(profile)}.`;
      if (profile.willingToTakeLoan === false) {
        return {
          status: 'unknown', unknownCause: 'not_researched',
          reason: `${capitalise(c.name)} is financed with a loan of ${formatInr(loan)}, and you have said you would not borrow. What it would need from you without that loan cannot be assessed from this scenario — no all-equity case has been computed. ${withLoan}`,
        };
      }
      return {
        status: 'unknown', unknownCause: 'not_stated_by_person',
        reason: `${capitalise(c.name)} is financed with a loan of ${formatInr(loan)}, and you have not said whether you would borrow. ${withLoan} Without the loan the requirement cannot be assessed from this scenario.`,
      };
    }
  }

  const loanNote = loan !== null && loan > 0
    ? ` This is alongside a loan of ${formatInr(loan)} that the scenario assumes; whether a lender would grant it is not assessed.`
    : '';
  if (total <= deployable) {
    return { status: 'pass', reason: `${need}; ${haveSentence(profile)}.${loanNote}` };
  }
  const gap = total - deployable;
  return {
    status: 'fail',
    reason: `${need}; ${haveSentence(profile)} — ${formatInr(gap)} short.${loanNote}`,
    shortfall: { kind: 'money', amountInr: Math.round(gap * 100) / 100 },
  };
}

export function checkCapitalAffordability(selected: SelectedScenarios, profile: PersonProfile): Verdict {
  const cases = financialCases(selected);
  if (cases.length === 0) return noCaseVerdict(selected, 'the money this business needs');
  return combineVerdicts(cases.map((c) => capitalVerdict(c, profile)));
}

// ── 2. financial runway ──────────────────────────────────────────────────────

/**
 * Months from the first rupee spent until the business first has a month of positive net cash:
 * pre-operating months + firstOperatingMonthNetCashPositive.
 *  - `never`: the scenario records that this is not reached within the modelled period;
 *  - `not_recorded`: the scenario does not carry the figure.
 */
export type Runway =
  | { state: 'not_recorded' }
  | { state: 'never' }
  | { state: 'reached'; firstPositiveMonthOfTrading: number; setUpMonths: number | null; monthsFromFirstSpend: number | null };

export function runwayOf(scenario: SnapshotScenario, selected: SelectedScenarios): Runway {
  const breakEven = scenario.summary?.summary?.breakEven;
  if (breakEven == null || breakEven.firstOperatingMonthNetCashPositive === undefined) return { state: 'not_recorded' };
  if (breakEven.firstOperatingMonthNetCashPositive === null) return { state: 'never' };
  const first = numberOrNull(breakEven.firstOperatingMonthNetCashPositive);
  if (first === null) return { state: 'not_recorded' };
  const setUp = numberOrNull(scenario.summary?.preOperatingMonths) ?? selected.preOperatingMonths;
  return { state: 'reached', firstPositiveMonthOfTrading: first, setUpMonths: setUp, monthsFromFirstSpend: setUp === null ? null : setUp + first };
}

function runwayVerdict(c: FinancialCase, selected: SelectedScenarios, profile: PersonProfile): Verdict {
  const runway = runwayOf(c.scenario, selected);
  if (runway.state === 'not_recorded') {
    return { status: 'unknown', unknownCause: 'not_researched', reason: `${capitalise(c.name)} does not record when its net cash first turns positive.` };
  }
  if (runway.state === 'never') {
    return {
      status: 'fail',
      reason: `On the recorded inputs, ${c.name} has no month within the modelled period in which the business brings in more cash than it spends. It keeps needing money for as long as the model runs, whatever your timeline.`,
    };
  }
  const timeline = profile.transitionTimelineMonths;
  const first = runway.firstPositiveMonthOfTrading;

  if (runway.monthsFromFirstSpend === null) {
    if (timeline !== null && first > timeline) {
      return {
        status: 'fail',
        reason: `On the recorded inputs, ${c.name} first brings in more cash than it spends in month ${first} of trading. The record does not state how long setting up takes before that, but this alone is ${formatMonths(first - timeline)} beyond your ${monthSpan(timeline)} transition timeline.`,
        shortfall: { kind: 'time', months: first - timeline },
      };
    }
    return {
      status: 'unknown', unknownCause: 'not_researched',
      reason: `On the recorded inputs, ${c.name} first brings in more cash than it spends in month ${first} of trading, but the record does not state how many set-up months come before opening, so the time from your first spend cannot be worked out.`,
    };
  }

  const total = runway.monthsFromFirstSpend;
  const setUp = runway.setUpMonths!;
  const how = setUp > 0 ? `${formatMonths(setUp)} of setting up, then month ${first} of trading` : `no set-up period is modelled, so this is month ${first} of trading`;
  const assumption = setUp > 0 && selected.preOperatingMonthsIsAssumption ? ` The ${monthSpan(setUp)} set-up period is an assumption in this record, not evidence.` : '';
  const when = `On the recorded inputs, ${c.name} first brings in more cash than it spends in month ${total} counted from your first spend (${how})`;

  if (timeline === null) {
    return { status: 'unknown', unknownCause: 'not_stated_by_person', reason: `${when}. You have not given a transition timeline to compare this with.${assumption}` };
  }
  if (total <= timeline) {
    return {
      status: 'pass',
      reason: `${when}, within your ${monthSpan(timeline)} transition timeline. Until then it spends more than it takes in; that money is counted in the capital check. A cash-positive month is not yet an income for you — see income potential.${assumption}`,
    };
  }
  return {
    status: 'fail',
    reason: `${when}, ${formatMonths(total - timeline)} after your ${monthSpan(timeline)} transition timeline ends. For those extra months you would still be funding the business and yourself.${assumption}`,
    shortfall: { kind: 'time', months: total - timeline },
  };
}

export function checkFinancialRunway(selected: SelectedScenarios, profile: PersonProfile): Verdict {
  const cases = financialCases(selected);
  if (cases.length === 0) return noCaseVerdict(selected, 'how long the business consumes cash');
  return combineVerdicts(cases.map((c) => runwayVerdict(c, selected, profile)));
}

// ── 3. required qualifications ───────────────────────────────────────────────

export type RequirementText = { state: 'not_recorded' } | { state: 'none_required' } | { state: 'listed'; items: string[] };

const NONE_STATED = /^(none|nil|no|n\/?a|not applicable|not required|none required|none mandatory|no (mandatory|formal|specific) (qualifications?|certifications?)( (is|are) required| required)?)\.?$/i;

/** Splits the record's free text into requirements: one per line, or separated by ";" or "•". */
export function parseRequirementText(text: string | null | undefined): RequirementText {
  const whole = textOrNull(text);
  if (whole === null) return { state: 'not_recorded' };
  const items = whole
    .split(/[\n;•]+/)
    .map((s) => s.replace(/^\s*(?:[-*–]|\d+[.)])\s*/, '').trim())
    .filter((s) => s !== '');
  if (items.length === 0) return { state: 'not_recorded' };
  const real = items.filter((s) => !NONE_STATED.test(s));
  return real.length === 0 ? { state: 'none_required' } : { state: 'listed', items: real };
}

const normalise = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * A requirement counts as held when one of the person's qualifications, compared without case or punctuation,
 * is the same text or contains the whole requirement as a phrase. Never the other way round: holding "Diploma"
 * does not satisfy "Diploma in pharmacy".
 */
export function holdsQualification(requirement: string, held: readonly string[]): boolean {
  const want = normalise(requirement);
  if (want === '') return false;
  const wantTight = want.replace(/ /g, '');
  return held.some((h) => {
    const have = normalise(h);
    return have === want || have.replace(/ /g, '') === wantTight || ` ${have} `.includes(` ${want} `);
  });
}

export function checkRequiredQualifications(snapshot: BusinessSnapshot, profile: PersonProfile): Verdict {
  const fr = snapshot.founder_requirements;
  if (fr == null) {
    return { status: 'unknown', unknownCause: 'not_researched', reason: 'Founder requirements have not been researched for this record, so it is not known whether any qualification or certification is mandatory.' };
  }
  const fields: Array<{ what: string; parsed: RequirementText }> = [
    { what: 'mandatory qualifications', parsed: parseRequirementText(fr.mandatory_qualifications) },
    { what: 'certifications', parsed: parseRequirementText(fr.certifications) },
  ];
  const required = fields.flatMap((f) => (f.parsed.state === 'listed' ? f.parsed.items : []));
  const missing = required.filter((r) => !holdsQualification(r, profile.qualificationsHeld));
  const heldOnes = required.filter((r) => holdsQualification(r, profile.qualificationsHeld));
  const notRecorded = fields.filter((f) => f.parsed.state === 'not_recorded').map((f) => f.what);
  const quote = (items: string[]): string => joinList(items.map((i) => `"${i}"`));
  const heldNote = heldOnes.length ? ` You list ${quote(heldOnes)}; this is a text match, so confirm it is the same qualification.` : '';

  if (missing.length) {
    const have = profile.qualificationsHeld.length ? `you list ${quote([...profile.qualificationsHeld])}` : 'you have not listed any qualification';
    return {
      status: 'fail',
      reason: `The record lists ${quote(required)} as required of the founder; ${have}, which does not include ${quote(missing)}.${heldNote}`,
      shortfall: { kind: 'items', items: missing },
    };
  }
  if (notRecorded.length) {
    const known = required.length ? ` It does list ${quote(required)}.${heldNote}` : '';
    return {
      status: 'unknown', unknownCause: 'not_researched',
      reason: `The record has founder requirements but does not state its ${joinList(notRecorded)} — neither a list nor "none" — so it is not known whether anything further is mandatory.${known}`,
    };
  }
  if (required.length === 0) {
    return { status: 'pass', reason: 'The record states that no qualification or certification is mandatory for the founder.' };
  }
  return { status: 'pass', reason: `The record lists ${quote(required)} as required of the founder.${heldNote}` };
}

// ── 4. required assets and infrastructure ────────────────────────────────────

export function checkRequiredAssets(selected: SelectedScenarios, profile: PersonProfile): Verdict {
  const variant = selected.variant;
  const needs = listOf(variant?.operating_requirements)
    .map((r) => {
      const name = textOrNull(r?.name) ?? textOrNull(r?.type);
      if (!name) return null;
      const value = numberOrNull(r?.value);
      const unit = textOrNull(r?.unit)?.replace(/_/g, ' ');
      const amount = value !== null ? `${formatCount(value)}${unit ? ` ${unit}` : ''}` : textOrNull(r?.text);
      return amount ? `${name}: ${amount}` : name;
    })
    .filter((s): s is string => s !== null);
  const needsNote = needs.length
    ? ` The record does list operating needs (${needs.join('; ')}), but not as asset types that can be compared with what you own.`
    : '';

  const rows = variant?.assets;
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      status: 'unknown', unknownCause: 'not_researched',
      reason: `Asset requirements have not been researched for this record, so they cannot be compared with the assets you have.${needsNote}`,
    };
  }
  const owned = new Set(profile.assets.map((a) => a.assetTypeSlug));
  const label = (r: { asset_type_slug?: string | null; name?: string | null }): string => textOrNull(r.name) ?? textOrNull(r.asset_type_slug) ?? 'unnamed asset';
  const required = rows.filter((r) => r?.requirement_level === 'required' && textOrNull(r.asset_type_slug) !== null);
  const missing = required.filter((r) => !owned.has(r.asset_type_slug!));
  if (missing.length) {
    return {
      status: 'fail',
      reason: `The record marks ${joinList(required.map(label))} as required, and you have not listed ${joinList(missing.map(label))}. If it can be rented or bought instead, that cost has to be part of the capital figure — check the cost items.`,
      shortfall: { kind: 'items', items: missing.map(label) },
    };
  }
  if (required.length === 0) {
    return { status: 'pass', reason: `The record lists ${plural(rows.length, 'asset')} for this business and marks none of them as required.` };
  }
  return { status: 'pass', reason: `The record marks ${joinList(required.map(label))} as required, and you have listed ${required.length === 1 ? 'it' : 'all of them'}.` };
}

// ── overall ──────────────────────────────────────────────────────────────────

export function runFeasibility(snapshot: BusinessSnapshot, selected: SelectedScenarios, profile: PersonProfile): FeasibilityCheck[] {
  const verdicts: Array<[FeasibilityCheckKey, Verdict]> = [
    ['capital_affordability', checkCapitalAffordability(selected, profile)],
    ['financial_runway', checkFinancialRunway(selected, profile)],
    ['required_qualifications', checkRequiredQualifications(snapshot, profile)],
    ['required_assets', checkRequiredAssets(selected, profile)],
  ];
  return verdicts.map(([key, v]) => {
    const check: FeasibilityCheck = { key, label: FEASIBILITY_CHECK_LABELS[key], status: v.status, reason: v.reason };
    if (v.status === 'unknown') check.unknownCause = v.unknownCause ?? 'not_researched';
    if (v.status === 'fail' && v.shortfall) check.shortfall = v.shortfall;
    return check;
  });
}

/** `no` if any check fails; otherwise `cannot_assess` if any is unknown; otherwise `yes`. */
export function overallFeasibility(checks: readonly FeasibilityCheck[]): Feasible {
  if (checks.some((c) => c.status === 'fail')) return 'no';
  if (checks.some((c) => c.status === 'unknown')) return 'cannot_assess';
  return 'yes';
}
