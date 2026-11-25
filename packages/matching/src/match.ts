/**
 * The matching engine's entry points. Pure: no I/O, no clock, no randomness, no LLM — the same profile and the
 * same snapshots always give the same results, in the same order, with the same words.
 */

import { parseProfile, type PersonProfile } from './profile';
import type {
  CheckChange,
  DimensionChange,
  Feasible,
  FitLevel,
  MatchChange,
  MatchResult,
  MissingPrerequisite,
  ScenarioBasis,
} from './result';
import { listOf, numberOrNull, textOrNull, type BusinessSnapshot, type SelectedScenarios } from './snapshot';
import { selectScenarios } from './snapshot';
import { overallFeasibility, runFeasibility } from './feasibility';
import { runFit } from './fit';
import { researchConfidence } from './confidence';
import { formatInr, formatMonths, humanise, joinList, plural } from './format';
import { STRESS_REVENUE_MINUS_20_KEY } from './thresholds';
import { MATCHER_VERSION } from './version';

function scenarioBasis(selected: SelectedScenarios): ScenarioBasis {
  const local = selected.localBase;
  return {
    variantName: selected.variant ? textOrNull(selected.variant.name) ?? textOrNull(selected.variant.slug) ?? 'unnamed variant' : null,
    nationalScenarioLabel: selected.nationalBase ? textOrNull(selected.nationalBase.label) ?? 'base' : null,
    localScenario: local
      ? {
          label: textOrNull(local.scenario.label),
          locationName: local.locationName,
          localInputs: numberOrNull(local.scenario.summary?.locationCoverage?.local_inputs),
          inheritedNationalInputs: numberOrNull(local.scenario.summary?.locationCoverage?.inherited_national_inputs),
        }
      : null,
  };
}

/** Sections the record lacks. Each is something the engine therefore could not compare. */
function notResearchedSections(snapshot: BusinessSnapshot, selected: SelectedScenarios): string[] {
  const out: string[] = [];
  if (!selected.variant) out.push('A reference variant (the costed case every financial comparison is made on)');
  else if (!selected.nationalBase) out.push('A base financial scenario');
  if (selected.variant && selected.nationalBase) {
    if (selected.closures.length === 0) out.push('A closure scenario (what is lost if the business closes)');
    if (!selected.stressRevenueMinus20) out.push('A stress case with revenue 20% lower');
  }
  if (listOf(snapshot.skills).length === 0) out.push('The capabilities the business asks of its founder');
  if (snapshot.founder_requirements == null) out.push('Founder requirements (qualifications, certifications, training time, learning difficulty)');
  if (selected.variant?.lifestyle == null) out.push("The owner's working life (hours, weekends, involvement, physical demand, operational complexity)");
  if (!Array.isArray(selected.variant?.assets) || selected.variant.assets.length === 0) out.push('Asset requirements');
  if (listOf(snapshot.risks).length === 0) out.push('A risk register');
  if (listOf(snapshot.regulations).length === 0) out.push('The licences and registrations that apply');
  if (selected.localScenarios.length === 0) out.push('Local evidence for any city (every figure is national)');
  return out;
}

function financialTradeOffs(snapshot: BusinessSnapshot, selected: SelectedScenarios, profile: PersonProfile): string[] {
  const out: string[] = [];
  const base = selected.nationalBase;
  if (base) {
    const loan = numberOrNull(base.summary?.funding?.loan);
    if (loan !== null && loan > 0) {
      out.push(`The base case relies on a loan of ${formatInr(loan)}; its repayments are inside the modelled cash flows, and whether a lender would grant it is not assessed.`);
      if (profile.willingToTakeLoan === false) {
        out.push('You have said you would not borrow, yet every financial figure here — runway, owner income, closure and stress cases — comes from that loan-financed case. No case without the loan has been computed, so none of them describes the business as you would run it.');
      }
    }
    const dscr = numberOrNull(base.summary?.summary?.minDscr);
    if (dscr !== null && dscr < 1) {
      out.push('In at least one modelled year the cash the business generates does not cover that year\'s loan repayments; the gap would come from you.');
    }
    const recovery = base.summary?.summary?.capitalRecovery;
    if (recovery != null && recovery.paybackOperatingMonth !== undefined) {
      const payback = numberOrNull(recovery.paybackOperatingMonth);
      out.push(payback === null
        ? 'On the recorded inputs, the base case does not return the money you put in within the modelled period.'
        : `On the recorded inputs, the base case has returned the money you put in by month ${payback} of trading, and not before.`);
    }
  }
  const mandatory = listOf(snapshot.regulations).filter((r) => r?.applicability === 'mandatory' && textOrNull(r.name) !== null);
  if (mandatory.length) {
    out.push(`The record maps ${plural(mandatory.length, 'mandatory licence or registration', 'mandatory licences or registrations')} to this business: ${joinList(mandatory.map((r) => textOrNull(r.name)!))}.`);
  }
  return out;
}

/** Compare one person with one business record. Validates the profile (throws `ProfileValidationError`). */
export function matchBusiness(profile: unknown, snapshot: BusinessSnapshot): MatchResult {
  return matchValidated(parseProfile(profile), snapshot);
}

function matchValidated(profile: PersonProfile, snapshot: BusinessSnapshot): MatchResult {
  const selected = selectScenarios(snapshot, { slug: profile.preferredLocationSlug, name: profile.preferredLocationName ?? null }, STRESS_REVENUE_MINUS_20_KEY);
  const feasibility = runFeasibility(snapshot, selected, profile);
  const feasible = overallFeasibility(feasibility);
  const { dimensions, outcomes } = runFit(snapshot, selected, profile);

  const missingPrerequisites: MissingPrerequisite[] = [];
  for (const check of feasibility) {
    if (check.status !== 'fail' || !check.shortfall) continue;
    const s = check.shortfall;
    if (check.key === 'capital_affordability' && s.kind === 'money') {
      missingPrerequisites.push({ kind: 'capital', description: `${formatInr(s.amountInr)} more of your own money (or a smaller reserve) to cover what the modelled case needs.` });
    } else if (check.key === 'financial_runway' && s.kind === 'time') {
      missingPrerequisites.push({ kind: 'time', description: `${formatMonths(s.months)} more than your transition timeline allows before the business first brings in more cash than it spends.` });
    } else if (check.key === 'required_qualifications' && s.kind === 'items') {
      for (const item of s.items) missingPrerequisites.push({ kind: 'qualification', description: `"${item}", which the record lists as required of the founder.` });
    } else if (check.key === 'required_assets' && s.kind === 'items') {
      for (const item of s.items) missingPrerequisites.push({ kind: 'asset', description: `${item}, which the record marks as required.` });
    }
  }
  for (const o of outcomes) missingPrerequisites.push(...(o.prerequisites ?? []));

  const tradeOffs = [...financialTradeOffs(snapshot, selected, profile), ...outcomes.flatMap((o) => o.tradeOffs ?? [])];

  const weak = dimensions.filter((d) => d.level === 'weak');
  const failed = feasibility.filter((c) => c.status === 'fail');

  const model = snapshot.model;
  const result: MatchResult = {
    matcherVersion: MATCHER_VERSION,
    business: {
      slug: textOrNull(model?.slug),
      name: textOrNull(model?.name) ?? (textOrNull(model?.slug) ? humanise(model!.slug!) : 'Unnamed business'),
      industry: textOrNull(model?.industry?.name),
      family: textOrNull(model?.family),
    },
    basis: scenarioBasis(selected),
    feasible,
    feasibility,
    fit: dimensions,
    tradeOffs: [...new Set(tradeOffs)],
    missingPrerequisites,
    notResearched: notResearchedSections(snapshot, selected),
    researchConfidence: researchConfidence(snapshot, selected.nationalBase),
  };
  if (feasible === 'no' || weak.length > 0) {
    result.whyNotSuitable = [
      ...failed.map((c) => `${c.label}: ${c.reason}`),
      ...weak.map((d) => `${d.label}: ${d.reason}`),
    ];
  }
  return result;
}

// ── ordering ─────────────────────────────────────────────────────────────────

/** Position of each feasibility outcome in the ordering: yes, then cannot_assess, then no. */
export const FEASIBLE_ORDER: readonly Feasible[] = ['yes', 'cannot_assess', 'no'];

const countLevel = (r: MatchResult, level: FitLevel): number => r.fit.filter((d) => d.level === level).length;
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The ordering rule of `matchBusinesses` — a plain lexicographic comparison, not a number:
 *   1. feasible `yes` before `cannot_assess` before `no`;
 *   2. within the same group, fewer `weak` fit dimensions first;
 *   3. then more `strong` fit dimensions first;
 *   4. then business name A–Z (case-insensitive), then slug.
 * Research confidence takes no part in it. `unknown` and `moderate` dimensions take no part in it either.
 */
export function compareMatchResults(a: MatchResult, b: MatchResult): number {
  return (
    FEASIBLE_ORDER.indexOf(a.feasible) - FEASIBLE_ORDER.indexOf(b.feasible) ||
    countLevel(a, 'weak') - countLevel(b, 'weak') ||
    countLevel(b, 'strong') - countLevel(a, 'strong') ||
    byText(a.business.name.toLowerCase(), b.business.name.toLowerCase()) ||
    byText(a.business.slug ?? '', b.business.slug ?? '')
  );
}

/**
 * Compare one person with many business records. Validates the profile (throws `ProfileValidationError`) and
 * returns one result per snapshot, ordered by `compareMatchResults`.
 */
export function matchBusinesses(profile: unknown, snapshots: readonly BusinessSnapshot[]): MatchResult[] {
  const person = parseProfile(profile);
  return snapshots.map((s) => matchValidated(person, s)).sort(compareMatchResults);
}

// ── what changed ─────────────────────────────────────────────────────────────

const words = (s: string): string => s.replace(/_/g, ' ');

/**
 * Lists the feasibility checks and fit dimensions whose outcome differs between two results for the SAME
 * business — for "change a preference and see what moves". Wording-only changes (same status, new figures)
 * are not listed.
 */
export function explainChange(before: MatchResult, after: MatchResult): MatchChange {
  if (before.business.slug !== after.business.slug || before.business.name !== after.business.name) {
    throw new Error(`explainChange compares two results for the same business; got "${before.business.name}" and "${after.business.name}"`);
  }
  const checks: CheckChange[] = [];
  for (const a of after.feasibility) {
    const b = before.feasibility.find((c) => c.key === a.key);
    if (b && b.status !== a.status) checks.push({ key: a.key, label: a.label, before: b.status, after: a.status, reasonAfter: a.reason });
  }
  const dimensions: DimensionChange[] = [];
  for (const a of after.fit) {
    const b = before.fit.find((d) => d.key === a.key);
    if (b && b.level !== a.level) dimensions.push({ key: a.key, label: a.label, before: b.level, after: a.level, reasonAfter: a.reason });
  }
  const feasible = before.feasible !== after.feasible ? { before: before.feasible, after: after.feasible } : null;
  const confidence = before.researchConfidence.level !== after.researchConfidence.level
    ? { before: before.researchConfidence.level, after: after.researchConfidence.level }
    : null;

  const summary: string[] = [];
  if (feasible) summary.push(`Feasibility changed from "${words(feasible.before)}" to "${words(feasible.after)}".`);
  for (const c of checks) summary.push(`${c.label} changed from ${c.before} to ${c.after}: ${c.reasonAfter}`);
  for (const d of dimensions) summary.push(`${d.label} changed from ${d.before} to ${d.after}: ${d.reasonAfter}`);
  if (confidence) summary.push(`Research confidence changed from "${words(confidence.before)}" to "${words(confidence.after)}" — the record itself differs between the two results.`);

  return {
    business: after.business,
    changed: feasible !== null || checks.length > 0 || dimensions.length > 0 || confidence !== null,
    feasible,
    checks,
    dimensions,
    researchConfidence: confidence,
    summary,
  };
}
