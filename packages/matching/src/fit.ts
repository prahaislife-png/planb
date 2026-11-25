/**
 * Fit dimensions. Each returns strong / moderate / weak / unknown with a reason that cites what was compared.
 * A level is a category decided by a stated rule — no dimension produces, stores or implies a number of merit.
 * Rules: docs/MATCHING_ENGINE.md §4.
 */

import type { PersonProfile } from './profile';
import type { FitDimension, FitDimensionKey, FitLevel, MissingPrerequisite, UnknownCause } from './result';
import { listOf, numberOrNull, textOrNull, type BusinessSnapshot, type SelectedScenarios, type SnapshotScenario } from './snapshot';
import { deployableCapital, financialCases, type FinancialCase } from './feasibility';
import { formatCount, formatInr, formatMonths, fractionInWords, humanise, joinList, monthSpan, plural } from './format';
import {
  CAPABILITY_HELD_MIN_PROFICIENCY,
  CAPABILITY_KEY_MIN_IMPORTANCE,
  COMPLEXITY_HIGH_MIN,
  COMPLEXITY_LOW_MAX,
  GEOGRAPHIC_MODERATE_MIN_LOCAL_FRACTION,
  GEOGRAPHIC_STRONG_MIN_LOCAL_FRACTION,
  INCOME_WEAK_BELOW_FRACTION,
  INVOLVEMENT_ORDER,
  LIFESTYLE_CONFLICT_MIN_STEPS,
  RISK_CLOSURE_LOSS_BANDS,
  TRAINING_STRETCH_ABOVE_FRACTION_OF_TIMELINE,
  WEEKS_PER_MONTH,
} from './thresholds';

export const FIT_DIMENSION_LABELS: Record<FitDimensionKey, string> = {
  transferable_capabilities: 'Transferable capabilities',
  personal_interests: 'Personal interests',
  income_potential: 'Income potential (salary replacement)',
  lifestyle_compatibility: 'Lifestyle compatibility',
  complexity_and_learning: 'Operational complexity and learning',
  risk_exposure: 'Risk exposure',
  geographic_fit: 'Geographic fit',
};

export interface Outcome {
  level: FitLevel;
  reason: string;
  unknownCause?: UnknownCause;
  /** Plain sentences this dimension contributes to the result's trade-offs. */
  tradeOffs?: string[];
  prerequisites?: MissingPrerequisite[];
}

const unknown = (cause: UnknownCause, reason: string, extra: Partial<Outcome> = {}): Outcome => ({ level: 'unknown', unknownCause: cause, reason, ...extra });
const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const NOT_A_FORECAST = 'not a forecast';

// ── aspects: the shared way lifestyle and complexity reach a level ───────────

type AspectState = 'ok' | 'stretch' | 'conflict' | 'record_silent' | 'person_silent';
interface Aspect {
  name: string;
  state: AspectState;
  text: string;
}

/**
 * Any conflict → weak (definite whatever else is missing). Otherwise a level is given only when EVERY aspect
 * could be compared: a stretch → moderate, none → strong. Anything less stays unknown.
 */
function levelFromAspects(aspects: Aspect[]): { level: FitLevel; unknownCause?: UnknownCause } {
  if (aspects.some((a) => a.state === 'conflict')) return { level: 'weak' };
  const silent = aspects.filter((a) => a.state === 'record_silent' || a.state === 'person_silent');
  if (silent.length > 0) {
    return { level: 'unknown', unknownCause: silent.some((a) => a.state === 'record_silent') ? 'not_researched' : 'not_stated_by_person' };
  }
  return { level: aspects.some((a) => a.state === 'stretch') ? 'moderate' : 'strong' };
}

function aspectsReason(aspects: Aspect[], level: FitLevel): string {
  const body = aspects.map((a) => `${a.name}: ${a.text}.`).join(' ');
  return level === 'unknown' ? `Not every aspect could be compared, so no level is given. ${body}` : body;
}

// ── 1. transferable capabilities ─────────────────────────────────────────────

const ACQUISITION_WORDS: Record<string, string> = {
  needed_at_start: 'needed from the start',
  learnable: 'can be learned',
  hireable: 'can be hired for',
};

export function fitCapabilities(snapshot: BusinessSnapshot, profile: PersonProfile): Outcome {
  const skills = listOf(snapshot.skills).filter((s) => textOrNull(s?.slug) !== null);
  if (skills.length === 0) {
    return unknown('not_researched', 'The capabilities this business asks of its founder have not been researched, so they cannot be compared with yours.');
  }
  const nameOf = (s: (typeof skills)[number]): string => textOrNull(s.name) ?? humanise(s.slug!);
  const startNeeds = skills.filter((s) => s.acquisition === 'needed_at_start');
  if (profile.capabilities.length === 0) {
    const start = startNeeds.length ? ` It marks ${joinList(startNeeds.map(nameOf))} as needed from the start.` : '';
    return unknown('not_stated_by_person', `The record lists ${plural(skills.length, 'capability', 'capabilities')} (${joinList(skills.map(nameOf))}); you have not listed any of your own, so the overlap cannot be assessed.${start}`);
  }
  const mine = new Map(profile.capabilities.map((c) => [c.skillSlug, c.proficiency]));
  const isHeld = (s: (typeof skills)[number]): boolean => (mine.get(s.slug!) ?? 0) >= CAPABILITY_HELD_MIN_PROFICIENCY;
  const held = skills.filter(isHeld);
  const notHeld = skills.filter((s) => !isHeld(s));
  const missingStart = notHeld.filter((s) => s.acquisition === 'needed_at_start');
  const missingKey = notHeld.filter((s) => s.acquisition !== 'needed_at_start' && (numberOrNull(s.importance) ?? 0) >= CAPABILITY_KEY_MIN_IMPORTANCE);

  const level: FitLevel = missingStart.length > 0 || held.length === 0 ? 'weak' : missingKey.length > 0 ? 'moderate' : 'strong';

  const mineNote = (s: (typeof skills)[number]): string => {
    const p = mine.get(s.slug!);
    return p === undefined ? 'not in your list' : `you list it at ${p}, below the ${CAPABILITY_HELD_MIN_PROFICIENCY} of 5 counted as held`;
  };
  const describeMissing = (s: (typeof skills)[number]): string => {
    const how = ACQUISITION_WORDS[s.acquisition ?? ''] ?? 'how it can be acquired is not recorded';
    const importance = numberOrNull(s.importance);
    return `${nameOf(s)} (${how}${importance !== null ? `, importance ${importance} of 5` : ''}; ${mineNote(s)})`;
  };
  const heldText = held.length
    ? `You hold ${held.length} of the ${plural(skills.length, 'capability', 'capabilities')} the record lists: ${joinList(held.map((s) => `${nameOf(s)} (at ${mine.get(s.slug!)} of 5)`))}.`
    : `You hold none of the ${plural(skills.length, 'capability', 'capabilities')} the record lists at ${CAPABILITY_HELD_MIN_PROFICIENCY} of 5 or above.`;
  const missingText = notHeld.length ? ` Not held: ${joinList(notHeld.map(describeMissing))}.` : '';

  const out: Outcome = { level, reason: `${heldText}${missingText}` };
  if (missingStart.length) {
    out.prerequisites = missingStart.map((s) => ({
      kind: 'skill' as const,
      description: `${nameOf(s)}: the record says this capability is needed from the start (${mineNote(s)}).`,
    }));
  }
  const laterGaps = notHeld.filter((s) => s.acquisition === 'learnable' || s.acquisition === 'hireable');
  if (laterGaps.length) {
    out.tradeOffs = [`You would have to learn or hire for ${joinList(laterGaps.map((s) => `${nameOf(s)} (${ACQUISITION_WORDS[s.acquisition!]})`))}.`];
  }
  return out;
}

// ── 2. personal interests ────────────────────────────────────────────────────

const STOP_WORDS = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'business', 'businesses', 'unit', 'units', 'other', 'own']);

/** Lower-cased words of three letters or more, without stop words, with a trailing "s" removed. */
export function interestWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
}

export function fitInterests(snapshot: BusinessSnapshot, profile: PersonProfile): Outcome {
  const m = snapshot.model;
  const identity = [m?.name, m?.family, m?.industry?.name].map(textOrNull).filter((t): t is string => t !== null);
  const descriptive = [m?.description, m?.operating_model, m?.target_customers, ...listOf(m?.classifications).map((c) => c?.title)]
    .map(textOrNull)
    .filter((t): t is string => t !== null);
  if (identity.length === 0 && descriptive.length === 0) {
    return unknown('not_researched', 'This record carries no name, industry or description to compare your interests with.');
  }
  if (profile.interests.length === 0) {
    return unknown('not_stated_by_person', 'You have not listed any interests, so there is nothing to compare this business with.');
  }
  const identityWords = new Set(identity.flatMap(interestWords));
  const descriptiveWords = new Set(descriptive.flatMap(interestWords));
  const matches = (interest: string, words: Set<string>): boolean => {
    const wanted = interestWords(interest);
    return wanted.length > 0 && wanted.every((w) => words.has(w));
  };
  const quote = (items: string[]): string => joinList(items.map((i) => `"${i}"`));
  const caveat = 'This is a plain word match, not a judgement of what you would enjoy.';
  const yours = (items: string[]): string => (items.length === 1 ? `Your interest ${quote(items)} appears` : `Your interests ${quote(items)} appear`);
  const inIdentity = profile.interests.filter((i) => matches(i, identityWords));
  if (inIdentity.length) {
    return { level: 'strong', reason: `${yours(inIdentity)} in this business's name, family or industry (${identity.join('; ')}). ${caveat}` };
  }
  const inDescription = profile.interests.filter((i) => matches(i, descriptiveWords));
  if (inDescription.length) {
    return { level: 'moderate', reason: `${yours(inDescription)} in this record's description of the business, but not in its name, family or industry (${identity.join('; ')}). ${caveat}` };
  }
  return { level: 'weak', reason: `None of your listed interests (${quote([...profile.interests])}) appears in this record's name, family, industry or description. ${caveat}` };
}

// ── 3. income potential (salary replacement) ─────────────────────────────────

interface YearIncome {
  year: number;
  income: number;
}

function ownerIncomeYears(scenario: SnapshotScenario): { y3: number | null; years: YearIncome[] } {
  const oi = scenario.summary?.summary?.ownerIncome;
  const raw: Array<[number, number | null]> = [
    [1, numberOrNull(oi?.year1AvgMonthly)],
    [2, numberOrNull(oi?.year2AvgMonthly)],
    [3, numberOrNull(oi?.year3AvgMonthly)],
  ];
  return { y3: raw[2]![1], years: raw.filter((r): r is [number, number] => r[1] !== null).map(([year, income]) => ({ year, income })) };
}

const isPreTax = (scenario: SnapshotScenario): boolean => listOf(scenario.warnings).some((w) => w?.code === 'RESULTS_ARE_PRE_TAX');
const yearList = (years: YearIncome[]): string => joinList(years.map((y) => `year ${y.year}`));

function incomeOn(c: FinancialCase, profile: PersonProfile): Outcome {
  const { y3, years } = ownerIncomeYears(c.scenario);
  if (y3 === null) {
    return unknown('not_researched', `${capitalise(c.name)} does not carry a complete third year of owner income.`);
  }
  const earlier = years.filter((y) => y.year < 3);
  const shown = `On the recorded inputs, ${c.name} shows owner income — what the business leaves for you each month after all its costs and loan repayments — averaging ${formatInr(y3)} a month in year 3${earlier.length ? ` (${earlier.map((y) => `year ${y.year}: ${formatInr(y.income)}`).join('; ')})` : ''}.`;
  const tail = ` These are model outputs${isPreTax(c.scenario) ? ' before income tax' : ''}, ${NOT_A_FORECAST}.`;
  const goal = profile.monthlyIncomeGoalInr;
  const current = profile.currentMonthlyIncomeInr;
  if (goal === null && current === null) {
    return unknown('not_stated_by_person', `${shown} You have given neither an income goal nor your current income, so there is nothing to compare it with.${tail}`);
  }

  let goalText = ' You have not given an income goal.';
  const tradeOffs: string[] = [];
  if (goal !== null) {
    const short = years.filter((y) => y.income < goal);
    if (short.length === 0) goalText = ` Every modelled year meets your income goal of ${formatInr(goal)} a month.`;
    else if (short.length === years.length) goalText = ` No modelled year reaches your income goal of ${formatInr(goal)} a month.`;
    else {
      goalText = ` Against your income goal of ${formatInr(goal)} a month, ${yearList(short)} ${short.length === 1 ? 'falls' : 'fall'} short.`;
      if (y3 >= goal) tradeOffs.push(`Owner income in ${c.name} is below your ${formatInr(goal)} goal in ${yearList(short)} before reaching it.`);
    }
  }
  let salaryText = ' You have not given your current income, so salary replacement is not compared.';
  if (current !== null) {
    const replacing = years.filter((y) => y.income >= current);
    if (y3 >= current) {
      const short = years.filter((y) => y.income < current);
      salaryText = ` Salary replacement: year 3 is at or above your current income of ${formatInr(current)} a month${short.length ? `; ${yearList(short)} ${short.length === 1 ? 'falls' : 'fall'} short of it` : ''}.`;
    } else {
      salaryText = ` Salary replacement: year 3 is ${formatInr(current - y3)} a month below your current income of ${formatInr(current)}; ${replacing.length ? `only ${yearList(replacing)} ${replacing.length === 1 ? 'replaces' : 'replace'} it` : 'no modelled year replaces it'}.`;
    }
  }
  const negative = y3 < 0 ? ' In year 3 the business is still taking money from you rather than paying you.' : '';
  const first = years.find((y) => y.year === 1);
  if (first && first.income < 0) tradeOffs.push(`In year 1, ${c.name} shows the business taking ${formatInr(-first.income)} a month from you rather than paying you.`);

  const benchmarks = [goal, current].filter((b): b is number => b !== null);
  let level: FitLevel;
  if (y3 < 0) level = 'weak';
  else if (y3 >= Math.max(...benchmarks)) level = 'strong';
  else if (y3 < INCOME_WEAK_BELOW_FRACTION * Math.min(...benchmarks)) level = 'weak';
  else level = 'moderate';

  return { level, reason: `${shown}${goalText}${salaryText}${negative}${tail}`, tradeOffs };
}

const FIT_ORDER: FitLevel[] = ['weak', 'unknown', 'moderate', 'strong'];

export function fitIncome(selected: SelectedScenarios, profile: PersonProfile): Outcome {
  const cases = financialCases(selected);
  if (cases.length === 0) {
    return unknown('not_researched', selected.variant
      ? 'No base financial scenario has been computed for this record, so owner income has not been worked out.'
      : 'This record does not mark a reference variant, so there is no costed case from which owner income could be read.');
  }
  const outcomes = cases.map((c) => incomeOn(c, profile));
  // the weaker of the national and the local reading decides; both are told
  const decisive = outcomes.reduce((a, b) => (FIT_ORDER.indexOf(b.level) < FIT_ORDER.indexOf(a.level) ? b : a));
  const out: Outcome = { level: decisive.level, reason: outcomes.map((o) => o.reason).join(' '), tradeOffs: outcomes.flatMap((o) => o.tradeOffs ?? []) };
  if (decisive.level === 'unknown') out.unknownCause = outcomes.some((o) => o.unknownCause === 'not_researched') ? 'not_researched' : 'not_stated_by_person';
  return out;
}

// ── 4. lifestyle compatibility ───────────────────────────────────────────────

const steps = (demand: number, accepted: number): AspectState => {
  const over = demand - accepted;
  return over <= 0 ? 'ok' : over >= LIFESTYLE_CONFLICT_MIN_STEPS ? 'conflict' : 'stretch';
};

export function fitLifestyle(selected: SelectedScenarios, profile: PersonProfile): Outcome {
  const ls = selected.variant?.lifestyle;
  if (ls == null) {
    return unknown('not_researched', "The owner's working life in this business — hours, weekends, involvement and physical demand — has not been researched.");
  }
  const aspects: Aspect[] = [];

  // hours
  const low = numberOrNull(ls.owner_hours_per_week_low) ?? numberOrNull(ls.owner_hours_per_week_high);
  const high = numberOrNull(ls.owner_hours_per_week_high) ?? low;
  if (low === null || high === null) aspects.push({ name: 'Hours', state: 'record_silent', text: 'owner hours are not recorded' });
  else {
    const range = low === high ? `${formatCount(low)}` : `${formatCount(low)}–${formatCount(high)}`;
    const max = profile.maxHoursPerWeek;
    if (max === null) aspects.push({ name: 'Hours', state: 'person_silent', text: `the record puts owner hours at ${range} a week; you have not given a maximum` });
    else if (low > max) aspects.push({ name: 'Hours', state: 'conflict', text: `the record puts owner hours at ${range} a week; even the low end is above your maximum of ${formatCount(max)}` });
    else if (high > max) aspects.push({ name: 'Hours', state: 'stretch', text: `the record puts owner hours at ${range} a week; the upper end is above your maximum of ${formatCount(max)}` });
    else aspects.push({ name: 'Hours', state: 'ok', text: `the record puts owner hours at ${range} a week, within your maximum of ${formatCount(max)}` });
  }

  // weekends
  const weekend = textOrNull(ls.weekend_work);
  const weekendWords: Record<string, string> = { none: 'no weekend work', occasional: 'occasional weekend work', peak_days: 'weekend work on peak days', regular: 'regular weekend work' };
  if (weekend === null || !(weekend in weekendWords)) aspects.push({ name: 'Weekends', state: 'record_silent', text: 'weekend work is not recorded' });
  else if (profile.weekendWorkOk === null) aspects.push({ name: 'Weekends', state: 'person_silent', text: `the record shows ${weekendWords[weekend]}; you have not said whether weekend work is acceptable` });
  else if (weekend === 'none') aspects.push({ name: 'Weekends', state: 'ok', text: 'the record shows no weekend work' });
  else if (profile.weekendWorkOk) aspects.push({ name: 'Weekends', state: 'ok', text: `the record shows ${weekendWords[weekend]}, which you accept` });
  else aspects.push({ name: 'Weekends', state: weekend === 'regular' ? 'conflict' : 'stretch', text: `the record shows ${weekendWords[weekend]}, and you do not want to work weekends` });

  // involvement
  const needed = textOrNull(ls.owner_involvement);
  const order = INVOLVEMENT_ORDER as Record<string, number>;
  if (needed === null || !(needed in order)) aspects.push({ name: 'Involvement', state: 'record_silent', text: 'the owner involvement this business needs is not recorded' });
  else if (profile.desiredInvolvement === null) aspects.push({ name: 'Involvement', state: 'person_silent', text: `the record describes the owner as ${humanise(needed)}; you have not said what involvement you want` });
  else {
    const state = steps(order[needed]!, order[profile.desiredInvolvement]!);
    const cmp = state === 'ok' ? 'which asks no more of you than' : 'which asks more of you than';
    aspects.push({ name: 'Involvement', state, text: `the record describes the owner as ${humanise(needed)}, ${cmp} the ${humanise(profile.desiredInvolvement)} role you want` });
  }

  // physical demand
  const demand = numberOrNull(ls.physical_demand);
  if (demand === null) aspects.push({ name: 'Physical demand', state: 'record_silent', text: 'physical demand is not recorded' });
  else if (profile.physicalWorkTolerance === null) aspects.push({ name: 'Physical demand', state: 'person_silent', text: `recorded as ${demand} on the record's 1–5 scale; you have not given your tolerance` });
  else {
    const state = steps(demand, profile.physicalWorkTolerance);
    aspects.push({ name: 'Physical demand', state, text: `recorded as ${demand} on the record's 1–5 scale, ${state === 'ok' ? 'within' : 'above'} the ${profile.physicalWorkTolerance} you accept` });
  }

  const { level, unknownCause } = levelFromAspects(aspects);
  const out: Outcome = { level, reason: aspectsReason(aspects, level) };
  if (unknownCause) out.unknownCause = unknownCause;
  const strained = aspects.filter((a) => a.state === 'stretch' || a.state === 'conflict');
  if (strained.length) out.tradeOffs = strained.map((a) => `${a.name}: ${a.text}.`);
  return out;
}

// ── 5. operational complexity and learning ───────────────────────────────────

function band(value: number): { words: string; state: AspectState } {
  if (value >= COMPLEXITY_HIGH_MIN) return { words: 'high', state: 'conflict' };
  if (value <= COMPLEXITY_LOW_MAX) return { words: 'low', state: 'ok' };
  return { words: 'medium', state: 'stretch' };
}

export function fitComplexity(snapshot: BusinessSnapshot, selected: SelectedScenarios, profile: PersonProfile): Outcome {
  const fr = snapshot.founder_requirements;
  const difficulty = numberOrNull(fr?.learning_difficulty);
  const weeks = numberOrNull(fr?.training_duration_weeks);
  const complexity = numberOrNull(selected.variant?.lifestyle?.operational_complexity);
  if (difficulty === null && weeks === null && complexity === null) {
    return unknown('not_researched', 'How hard this business is to learn and to run — learning difficulty, training time and operational complexity — has not been researched.');
  }
  const aspects: Aspect[] = [];
  if (difficulty === null) aspects.push({ name: 'Learning difficulty', state: 'record_silent', text: 'not recorded' });
  else aspects.push({ name: 'Learning difficulty', state: band(difficulty).state, text: `recorded as ${difficulty} on the record's 1–5 scale (${band(difficulty).words})` });

  if (complexity === null) aspects.push({ name: 'Operational complexity', state: 'record_silent', text: 'not recorded' });
  else aspects.push({ name: 'Operational complexity', state: band(complexity).state, text: `recorded as ${complexity} on the record's 1–5 scale (${band(complexity).words})` });

  const prerequisites: MissingPrerequisite[] = [];
  if (weeks === null) aspects.push({ name: 'Training', state: 'record_silent', text: 'training time is not recorded' });
  else if (weeks === 0) aspects.push({ name: 'Training', state: 'ok', text: 'the record states that no training period is needed' });
  else {
    const months = weeks / WEEKS_PER_MONTH;
    const length = `the recorded training takes about ${plural(weeks, 'week')} (about ${formatMonths(months)})`;
    prerequisites.push({ kind: 'training', description: `About ${plural(weeks, 'week')} of training, as recorded for this business.` });
    const timeline = profile.transitionTimelineMonths;
    if (timeline === null) aspects.push({ name: 'Training', state: 'person_silent', text: `${length}; you have not given a transition timeline to set it against` });
    else if (months > timeline) aspects.push({ name: 'Training', state: 'conflict', text: `${length}, longer than your ${monthSpan(timeline)} transition timeline` });
    else if (months > TRAINING_STRETCH_ABOVE_FRACTION_OF_TIMELINE * timeline) aspects.push({ name: 'Training', state: 'stretch', text: `${length}, more than ${fractionInWords(TRAINING_STRETCH_ABOVE_FRACTION_OF_TIMELINE)} of your ${monthSpan(timeline)} transition timeline` });
    else aspects.push({ name: 'Training', state: 'ok', text: `${length}, within ${fractionInWords(TRAINING_STRETCH_ABOVE_FRACTION_OF_TIMELINE)} of your ${monthSpan(timeline)} transition timeline` });
  }

  const { level, unknownCause } = levelFromAspects(aspects);
  const out: Outcome = { level, reason: aspectsReason(aspects, level), prerequisites };
  if (unknownCause) out.unknownCause = unknownCause;
  const strained = aspects.filter((a) => a.state === 'stretch' || a.state === 'conflict');
  if (strained.length) out.tradeOffs = strained.map((a) => `${a.name}: ${a.text}.`);
  return out;
}

// ── 6. risk exposure ─────────────────────────────────────────────────────────

type Concern = 'low' | 'elevated' | 'high' | 'record_silent' | 'person_silent';

export function fitRisk(snapshot: BusinessSnapshot, selected: SelectedScenarios, profile: PersonProfile): Outcome {
  if (!selected.nationalBase) {
    return unknown('not_researched', selected.variant
      ? 'No financial scenario has been computed for this record, so neither a closure case nor a stress case exists to set against your capital.'
      : 'This record does not mark a reference variant, so there is no costed case to read closure or stress figures from.');
  }
  const tolerance = profile.riskTolerance;
  const deployable = deployableCapital(profile);
  const sentences: string[] = [];
  const tradeOffs: string[] = [];
  const concerns: Concern[] = [];

  // (a) the worst modelled closure
  const closures = selected.closures
    .map((s) => ({ lost: numberOrNull(s.summary?.closure?.ownerCapitalLost), month: numberOrNull(s.summary?.closure?.atOperatingMonth) }))
    .filter((c): c is { lost: number; month: number | null } => c.lost !== null);
  if (closures.length === 0) {
    concerns.push('record_silent');
    sentences.push('No closure scenario has been computed for this record, so what you would lose if the business closed is not known.');
  } else {
    const worst = closures.reduce((a, b) => (b.lost > a.lost ? b : a));
    const when = worst.month !== null ? `after month ${worst.month} of trading` : 'early';
    const base = worst.lost > 0
      ? `If the business closed ${when}, the model shows ${formatInr(worst.lost)} of your own money not recovered`
      : `If the business closed ${when}, the model shows none of your own money lost`;
    if (worst.lost > 0) tradeOffs.push(`${base}.`);
    if (deployable === null || tolerance === null) {
      concerns.push('person_silent');
      sentences.push(`${base}.`);
    } else {
      const bands = RISK_CLOSURE_LOSS_BANDS[tolerance];
      const limitWords = bands.limitFraction >= 1 ? 'all' : fractionInWords(bands.limitFraction);
      if (worst.lost > bands.limitFraction * deployable) {
        concerns.push('high');
        sentences.push(`${base} — more than ${limitWords === 'all' ? '' : `${limitWords} of `}the ${formatInr(deployable)} you can deploy, the most this engine treats as within a ${tolerance} risk tolerance.`);
      } else if (worst.lost > bands.comfortableFraction * deployable) {
        concerns.push('elevated');
        sentences.push(`${base} — more than ${fractionInWords(bands.comfortableFraction)} of the ${formatInr(deployable)} you can deploy, though not beyond the ${limitWords === 'all' ? 'whole of it' : limitWords} this engine treats as the limit for a ${tolerance} risk tolerance.`);
      } else {
        concerns.push('low');
        sentences.push(`${base} — no more than ${fractionInWords(bands.comfortableFraction)} of the ${formatInr(deployable)} you can deploy, which this engine treats as comfortable for a ${tolerance} risk tolerance.`);
      }
    }
  }

  // (b) the deepest cash trough of the base case
  const total = numberOrNull(selected.nationalBase.summary?.summary?.totalOwnerCashRequired);
  const trough = numberOrNull(selected.nationalBase.summary?.summary?.peakFundingNeed);
  if (total === null) {
    concerns.push('record_silent');
    sentences.push('The base case does not state how much of your money it has taken at its deepest point.');
  } else {
    const base = `At its deepest point the base case has taken ${formatInr(total)} of your money in total${trough !== null && trough > 0 ? ` (${formatInr(trough)} of it after opening)` : ''}`;
    if (deployable === null) {
      concerns.push('person_silent');
      sentences.push(`${base}.`);
    } else if (total > deployable) {
      concerns.push('high');
      sentences.push(`${base}, more than the ${formatInr(deployable)} you can deploy.`);
    } else {
      concerns.push('low');
      sentences.push(`${base}, within the ${formatInr(deployable)} you can deploy.`);
    }
  }

  // (c) revenue 20% lower
  const baseY3 = numberOrNull(selected.nationalBase.summary?.summary?.ownerIncome?.year3AvgMonthly);
  const stressY3 = numberOrNull(selected.stressRevenueMinus20?.summary?.summary?.ownerIncome?.year3AvgMonthly);
  if (stressY3 === null) {
    concerns.push('record_silent');
    sentences.push('No stress case with revenue 20% lower has been computed for this record.');
  } else {
    const sentence = `With revenue 20% lower through lower sales, the model's year-3 owner income is ${formatInr(stressY3)} a month${baseY3 !== null ? ` instead of ${formatInr(baseY3)}` : ''}${stressY3 < 0 ? ' — the business would still be taking money from you' : ''}.`;
    sentences.push(sentence);
    tradeOffs.push(sentence);
    if (tolerance === null) concerns.push('person_silent');
    else if (stressY3 < 0) concerns.push(tolerance === 'high' ? 'elevated' : 'high');
    else concerns.push('low');
  }

  // the qualitative register is reported, never graded
  const risks = listOf(snapshot.risks).filter((r) => textOrNull(r?.title) !== null);
  if (risks.length === 0) sentences.push('No risk register has been researched for this record; only the modelled closure and stress cases are used here.');
  else {
    const severe = risks.filter((r) => r.severity === 'high');
    sentences.push(`The record's risk register lists ${plural(risks.length, 'risk')}${severe.length ? `, ${severe.length} rated high (${joinList(severe.map((r) => textOrNull(r.title)!))})` : ', none rated high'}.`);
  }
  if (tolerance === null) sentences.push('You have not stated a risk tolerance, so these figures are not set against one.');
  sentences.push(`These are illustrative model cases on the recorded inputs, ${NOT_A_FORECAST} and not the chance of anything happening.`);

  let level: FitLevel;
  let unknownCause: UnknownCause | undefined;
  if (concerns.includes('high')) level = 'weak';
  else if (concerns.includes('record_silent')) { level = 'unknown'; unknownCause = 'not_researched'; }
  else if (concerns.includes('person_silent')) { level = 'unknown'; unknownCause = 'not_stated_by_person'; }
  else level = concerns.includes('elevated') ? 'moderate' : 'strong';

  const out: Outcome = { level, reason: sentences.join(' '), tradeOffs };
  if (unknownCause) out.unknownCause = unknownCause;
  return out;
}

// ── 7. geographic fit ────────────────────────────────────────────────────────

export function fitGeography(selected: SelectedScenarios, profile: PersonProfile): Outcome {
  const available = selected.localScenarios.map((l) => l.locationName);
  if (profile.preferredLocationSlug === null) {
    const have = available.length ? ` This record has local scenarios for ${joinList(available)}.` : ' This record has no scenario built on local evidence for any city.';
    return unknown('not_stated_by_person', `You have not given a preferred location.${have}`);
  }
  const place = textOrNull(profile.preferredLocationName) ?? profile.preferredLocationSlug;
  if (!selected.localBase) {
    if (available.length === 0) {
      return unknown('not_researched', `This record has no scenario built on local evidence for any city: every figure in it is a national one. Whether rents, wages and prices in ${place} differ has not been researched.`);
    }
    return unknown('not_researched', `This record has local scenarios for ${joinList(available)}, but none labelled for ${place}. For ${place} only national figures are available.`);
  }
  const cov = selected.localBase.scenario.summary?.locationCoverage;
  const local = numberOrNull(cov?.local_inputs);
  const inherited = numberOrNull(cov?.inherited_national_inputs);
  if (local === null || inherited === null || local + inherited <= 0) {
    return unknown('not_researched', `A scenario for ${selected.localBase.locationName} exists, but it does not state how many of its inputs are local.`);
  }
  const total = local + inherited;
  const levels = Object.entries(cov?.by_level ?? {})
    .filter(([, n]) => typeof n === 'number' && n > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([lvl, n]) => `${n} ${humanise(lvl)}-level`);
  const detail = levels.length ? ` (${levels.join(', ')})` : '';
  const fraction = local / total;
  const level: FitLevel = fraction >= GEOGRAPHIC_STRONG_MIN_LOCAL_FRACTION ? 'strong' : fraction >= GEOGRAPHIC_MODERATE_MIN_LOCAL_FRACTION ? 'moderate' : 'weak';
  const rule = level === 'strong'
    ? `at least ${fractionInWords(GEOGRAPHIC_STRONG_MIN_LOCAL_FRACTION)} of the inputs are local`
    : level === 'moderate'
      ? `at least ${fractionInWords(GEOGRAPHIC_MODERATE_MIN_LOCAL_FRACTION)} but fewer than ${fractionInWords(GEOGRAPHIC_STRONG_MIN_LOCAL_FRACTION)} of the inputs are local`
      : `fewer than ${fractionInWords(GEOGRAPHIC_MODERATE_MIN_LOCAL_FRACTION)} of the inputs are local`;
  return {
    level,
    reason: `A scenario for ${selected.localBase.locationName} exists: ${local} of its ${total} inputs come from local evidence${detail} and ${inherited} inherit the national figure — ${rule}. The financial checks above report both the national and this local case.`,
  };
}

// ── all seven ────────────────────────────────────────────────────────────────

export function runFit(snapshot: BusinessSnapshot, selected: SelectedScenarios, profile: PersonProfile): { dimensions: FitDimension[]; outcomes: Outcome[] } {
  const outcomes: Array<[FitDimensionKey, Outcome]> = [
    ['transferable_capabilities', fitCapabilities(snapshot, profile)],
    ['personal_interests', fitInterests(snapshot, profile)],
    ['income_potential', fitIncome(selected, profile)],
    ['lifestyle_compatibility', fitLifestyle(selected, profile)],
    ['complexity_and_learning', fitComplexity(snapshot, selected, profile)],
    ['risk_exposure', fitRisk(snapshot, selected, profile)],
    ['geographic_fit', fitGeography(selected, profile)],
  ];
  const dimensions = outcomes.map(([key, o]) => {
    const d: FitDimension = { key, label: FIT_DIMENSION_LABELS[key], level: o.level, reason: o.reason };
    if (o.level === 'unknown') d.unknownCause = o.unknownCause ?? 'not_researched';
    return d;
  });
  return { dimensions, outcomes: outcomes.map(([, o]) => o) };
}
