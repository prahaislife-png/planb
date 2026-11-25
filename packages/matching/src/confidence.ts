/**
 * Research confidence: how far the evidence behind a record can be trusted.
 *
 * It is computed from the record alone — the person's profile is not an input — and it is never merged with
 * feasibility or fit. A business can fit a person well and rest on weak evidence; both are said, apart.
 * Rules: docs/MATCHING_ENGINE.md §6.
 */

import type { ConfidenceLevel, GradeProfile, ResearchConfidence } from './result';
import { listOf, numberOrNull, textOrNull, type BusinessSnapshot, type SnapshotScenario } from './snapshot';
import { formatCount, humanise, joinList, plural } from './format';
import { CONFIDENCE_THRESHOLDS } from './thresholds';

const WELL = CONFIDENCE_THRESHOLDS.wellEvidenced;
const THIN = CONFIDENCE_THRESHOLDS.thinlyEvidenced;

const allOrCount = (n: number, total: number, noun: string): string => (n === total ? (total === 1 ? `The only ${noun}` : `All ${formatCount(total)} ${noun}s`) : `${formatCount(n)} of the ${formatCount(total)} ${noun}s`);

/** Where the cost figures come from, read from the cost observations the snapshot carries. */
function costObservationFacts(snapshot: BusinessSnapshot): { years: string[]; types: string[]; sources: string[] } {
  const years = new Set<string>();
  const types = new Set<string>();
  const sources = new Set<string>();
  for (const v of listOf(snapshot.variants)) {
    for (const item of listOf(v?.cost_items)) {
      for (const o of listOf(item?.observations)) {
        const on = textOrNull(o?.observed_on);
        if (on && /^\d{4}/.test(on)) years.add(on.slice(0, 4));
        const type = textOrNull(o?.evidence_type);
        if (type) types.add(type);
        const source = textOrNull(o?.source);
        if (source) sources.add(source);
      }
    }
  }
  const sorted = (s: Set<string>): string[] => [...s].sort();
  return { years: sorted(years), types: sorted(types), sources: sorted(sources) };
}

export function researchConfidence(snapshot: BusinessSnapshot, baseScenario: SnapshotScenario | null): ResearchConfidence {
  const ev = snapshot.quality?.evidence ?? null;
  const comp = snapshot.quality?.completeness ?? null;
  const reasons: string[] = [];

  const grades = ev ? [numberOrNull(ev.grade_a), numberOrNull(ev.grade_b), numberOrNull(ev.grade_c), numberOrNull(ev.grade_d)] : [null, null, null, null];
  const gradeProfile: GradeProfile | null = grades.some((g) => g !== null)
    ? { A: grades[0] ?? 0, B: grades[1] ?? 0, C: grades[2] ?? 0, D: grades[3] ?? 0 }
    : null;
  const graded = gradeProfile ? gradeProfile.A + gradeProfile.B + gradeProfile.C + gradeProfile.D : null;
  const observations = numberOrNull(ev?.observation_count) ?? graded;
  const verified = numberOrNull(ev?.verified_count);
  const stale = numberOrNull(ev?.stale_count);
  const conflicts = numberOrNull(ev?.open_conflicts);
  const pending = numberOrNull(ev?.claims_pending_review);
  const assumptions = numberOrNull(ev?.assumption_count) ?? numberOrNull(baseScenario?.assumption_count);
  const gp = baseScenario?.grade_profile;
  const scenarioInputs = gp ? [gp.A, gp.B, gp.C, gp.D].map(numberOrNull) : [];
  const inputsTotal = numberOrNull(ev?.parameter_count) ?? (scenarioInputs.length && scenarioInputs.every((n) => n !== null) ? scenarioInputs.reduce<number>((a, n) => a + (n ?? 0), 0) : null);
  const completeness = numberOrNull(comp?.completeness_pct);
  const criticalMissing = numberOrNull(comp?.critical_missing);
  const criticalSections = listOf(comp?.critical_missing_checks).map(textOrNull).filter((s): s is string => s !== null).map(humanise);

  // ── what the evidence is ───────────────────────────────────────────────────
  if (!ev || gradeProfile === null || graded === null) {
    reasons.push('This record carries no evidence profile, so nothing shows that its figures rest on evidence.');
  } else if (graded === 0) {
    reasons.push('No graded figure stands behind this record.');
  } else {
    const present = (['A', 'B', 'C', 'D'] as const).filter((g) => gradeProfile[g] > 0);
    let sentence = present.length === 1
      ? `${allOrCount(graded, graded, 'figure')} behind this record ${graded === 1 ? 'is' : 'are'} grade ${present[0]}`
      : `Of the ${formatCount(graded)} graded figures behind this record, ${joinList(present.map((g) => `${formatCount(gradeProfile[g])} ${gradeProfile[g] === 1 ? 'is' : 'are'} grade ${g}`))}`;
    const facts = costObservationFacts(snapshot);
    const sources = numberOrNull(ev.distinct_sources);
    if (sources === 1) sentence += ` and ${graded === 1 ? 'comes' : 'come'} from a single source${facts.sources.length === 1 ? ` (${facts.sources[0]})` : ''}`;
    else if (sources !== null) sentence += ` and come from ${plural(sources, 'source')}`;
    if (facts.years.length) {
      const span = facts.years.length === 1 ? facts.years[0]! : `${facts.years[0]!}–${facts.years[facts.years.length - 1]!}`;
      sentence += `; its cost observations are dated ${span}${facts.types.length ? ` and are of the type ${joinList(facts.types.map(humanise))}` : ''}`;
    }
    sentence += '.';
    if (verified !== null && observations !== null && observations > 0) {
      sentence += verified === 0 ? ' None has been verified by a reviewer.' : ` ${allOrCount(verified, observations, 'observation')} ${verified === 1 ? 'has' : 'have'} been verified by a reviewer.`;
    }
    reasons.push(sentence);
    reasons.push('Grades: A is verified primary evidence, B is two or more agreeing sources, C is a single source or an older benchmark, D is an unverified estimate or assumption.');
  }
  if (stale !== null && stale > 0 && observations !== null && observations > 0) {
    reasons.push(`${allOrCount(stale, observations, 'observation')} ${stale === 1 ? 'is' : 'are'} past the date by which ${stale === 1 ? 'it was' : 'they were'} due to be re-checked.`);
  }
  if (assumptions !== null && inputsTotal !== null && inputsTotal > 0) {
    reasons.push(assumptions === 0
      ? `None of the model's ${formatCount(inputsTotal)} inputs is an assumption.`
      : `${formatCount(assumptions)} of the model's ${formatCount(inputsTotal)} inputs ${assumptions === 1 ? 'is an assumption' : 'are assumptions'}, not evidence.`);
  }
  if (baseScenario?.grade_profile) {
    const observed = numberOrNull(gp?.observed);
    const derived = numberOrNull(gp?.derived);
    const assumed = numberOrNull(gp?.assumptions);
    const weakest = textOrNull(baseScenario.weakest_grade);
    if (observed !== null && derived !== null && assumed !== null) {
      reasons.push(`The base financial scenario runs on ${formatCount(observed)} observed, ${formatCount(derived)} derived and ${formatCount(assumed)} assumed inputs${weakest ? `; its weakest input is grade ${weakest}` : ''}. Every financial figure shown is what those inputs imply.`);
    }
  }
  if (conflicts !== null && conflicts > 0) reasons.push(`${plural(conflicts, 'conflict')} between sources ${conflicts === 1 ? 'is' : 'are'} still open.`);
  if (pending !== null && pending > 0) reasons.push(`${plural(pending, 'extracted claim')} ${pending === 1 ? 'is' : 'are'} still waiting for a reviewer.`);
  if (completeness !== null) {
    const passed = numberOrNull(comp?.checks_passed);
    const totalChecks = numberOrNull(comp?.checks_total);
    const checks = passed !== null && totalChecks !== null ? ` (${passed} of ${totalChecks} completeness checks met)` : '';
    const critical = criticalMissing === null ? '' : criticalMissing === 0 ? '; no critical section is missing' : `; ${plural(criticalMissing, 'critical section')} ${criticalMissing === 1 ? 'is' : 'are'} missing${criticalSections.length ? ` (${joinList(criticalSections)})` : ''}`;
    reasons.push(`The record is ${formatCount(completeness)}% complete by weight${checks}${critical}.`);
  } else {
    reasons.push('The completeness of this record is not recorded.');
  }
  const judged: string[] = [];
  const lifestyle = listOf(snapshot.variants).find((v) => v?.is_reference === true)?.lifestyle;
  if (lifestyle) judged.push(`the lifestyle profile is recorded on the basis "${humanise(textOrNull(lifestyle.basis) ?? 'not stated')}"${textOrNull(lifestyle.evidence_grade) ? ` (grade ${lifestyle.evidence_grade})` : ''}`);
  const fr = snapshot.founder_requirements;
  if (fr) judged.push(`the founder requirements are recorded on the basis "${humanise(textOrNull(fr.basis) ?? 'not stated')}"${textOrNull(fr.evidence_grade) ? ` (grade ${fr.evidence_grade})` : ''}`);
  if (judged.length) reasons.push(`${joinList(judged).replace(/^./, (c) => c.toUpperCase())}.`);

  // ── the level ──────────────────────────────────────────────────────────────
  const fraction = (n: number | null, of: number | null): number | null => (n !== null && of !== null && of > 0 ? n / of : null);
  const fracAB = gradeProfile && graded ? (gradeProfile.A + gradeProfile.B) / graded : null;
  const fracVerified = fraction(verified, observations);
  const fracStale = fraction(stale, observations);
  const fracAssumed = fraction(assumptions, inputsTotal);

  const thin: string[] = [];
  if (!ev || gradeProfile === null) thin.push('the record carries no evidence profile');
  else if (graded === 0) thin.push('no graded figure stands behind it');
  else if (THIN.noFigureGradeAOrB && gradeProfile.A + gradeProfile.B === 0) thin.push('no figure is grade A or B');
  if (completeness !== null && completeness < THIN.belowCompleteness) thin.push(`completeness is below ${THIN.belowCompleteness}%`);
  if (criticalMissing !== null && criticalMissing >= THIN.minCriticalMissing) thin.push(`${THIN.minCriticalMissing} or more critical sections are missing`);
  if (fracStale !== null && fracStale >= THIN.minFractionStale) thin.push('at least half of the observations are past their re-check date');
  if (fracAssumed !== null && fracAssumed >= THIN.minFractionAssumedInputs) thin.push("at least a third of the model's inputs are assumptions");

  const wellFailures: string[] = [];
  const need = (ok: boolean | null, failure: string, missing: string): void => {
    if (ok === null) wellFailures.push(missing);
    else if (!ok) wellFailures.push(failure);
  };
  need(fracAB === null ? null : fracAB >= WELL.minFractionGradeAOrB, 'fewer than half of the figures are grade A or B', 'the grades of its figures are not recorded');
  need(fracVerified === null ? null : fracVerified >= WELL.minFractionVerified, 'fewer than half of the observations are verified', 'how many observations are verified is not recorded');
  need(fracAssumed === null ? null : fracAssumed <= WELL.maxFractionAssumedInputs, "more than a tenth of the model's inputs are assumptions", "how many of the model's inputs are assumptions is not recorded");
  need(stale === null ? null : stale <= WELL.maxStaleObservations, 'some observations are past their re-check date', 'how many observations are stale is not recorded');
  need(conflicts === null ? null : conflicts <= WELL.maxOpenConflicts, 'conflicts between sources are open', 'whether conflicts are open is not recorded');
  need(pending === null ? null : pending <= WELL.maxClaimsPendingReview, 'claims are still waiting for review', 'whether claims are waiting for review is not recorded');
  need(completeness === null ? null : completeness >= WELL.minCompleteness, `completeness is below ${WELL.minCompleteness}%`, 'completeness is not recorded');
  need(criticalMissing === null ? null : criticalMissing <= WELL.maxCriticalMissing, 'a critical section is missing', 'whether critical sections are missing is not recorded');

  let level: ConfidenceLevel;
  if (thin.length) {
    level = 'thinly_evidenced';
    reasons.push(`Classed as thinly evidenced because ${joinList(thin)}.`);
  } else if (wellFailures.length === 0) {
    level = 'well_evidenced';
    reasons.push(`Classed as well evidenced: at least half of the figures are grade A or B and at least half are verified, no more than a tenth of the model's inputs are assumptions, nothing is stale, in conflict or waiting for review, completeness is at least ${WELL.minCompleteness}% and no critical section is missing.`);
  } else {
    level = 'partly_evidenced';
    reasons.push(`Classed as partly evidenced: it is not thin, but it falls short of well evidenced because ${joinList(wellFailures)}.`);
  }

  return {
    level,
    reasons,
    gradeProfile,
    assumptionsAmongInputs: assumptions,
    inputsTotal,
    verifiedObservations: verified,
    staleObservations: stale,
    openConflicts: conflicts,
    claimsPendingReview: pending,
    completenessPct: completeness,
    criticalMissing,
    criticalMissingSections: criticalSections,
  };
}
