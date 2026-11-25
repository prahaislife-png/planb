/**
 * Result types of the matching engine.
 *
 * There is deliberately no number here that grades a business for a person: every outcome is a category with a
 * plain-English reason. A guard test (test/guard.test.ts) fails if a property of this file, or of any produced
 * result, has a name suggesting such a number. `completenessPct` inside research confidence is the one
 * exception: it is a property of the research record, not of the person's suitability.
 */

// ── feasibility (mandatory checks) ───────────────────────────────────────────

export type CheckStatus = 'pass' | 'fail' | 'unknown';

export const FEASIBILITY_CHECK_KEYS = ['capital_affordability', 'financial_runway', 'required_qualifications', 'required_assets'] as const;
export type FeasibilityCheckKey = (typeof FEASIBILITY_CHECK_KEYS)[number];

/** Why something is `unknown`: the record lacks the research, or the person has not given the answer. */
export type UnknownCause = 'not_researched' | 'not_stated_by_person';

export type Shortfall =
  | { kind: 'money'; amountInr: number }
  | { kind: 'time'; months: number }
  | { kind: 'items'; items: string[] };

export interface FeasibilityCheck {
  key: FeasibilityCheckKey;
  label: string;
  status: CheckStatus;
  /** Plain English, citing the figures compared. */
  reason: string;
  /** Present only when `status` is `unknown`. Record-side gaps take precedence over person-side gaps. */
  unknownCause?: UnknownCause;
  /** Present only when `status` is `fail` and the gap can be stated. */
  shortfall?: Shortfall;
}

/** `no` if any check fails; otherwise `cannot_assess` if any is unknown; otherwise `yes`. */
export type Feasible = 'yes' | 'no' | 'cannot_assess';

// ── fit (named dimensions) ───────────────────────────────────────────────────

export type FitLevel = 'strong' | 'moderate' | 'weak' | 'unknown';

export const FIT_DIMENSION_KEYS = [
  'transferable_capabilities',
  'personal_interests',
  'income_potential',
  'lifestyle_compatibility',
  'complexity_and_learning',
  'risk_exposure',
  'geographic_fit',
] as const;
export type FitDimensionKey = (typeof FIT_DIMENSION_KEYS)[number];

export interface FitDimension {
  key: FitDimensionKey;
  label: string;
  level: FitLevel;
  /** Plain English, citing the figures compared. */
  reason: string;
  /** Present only when `level` is `unknown`. */
  unknownCause?: UnknownCause;
}

// ── prerequisites ────────────────────────────────────────────────────────────

export type PrerequisiteKind = 'capital' | 'time' | 'qualification' | 'asset' | 'skill' | 'training';

export interface MissingPrerequisite {
  kind: PrerequisiteKind;
  /** What the person would need to acquire, in plain English. */
  description: string;
}

// ── research confidence (kept apart from suitability) ────────────────────────

export type ConfidenceLevel = 'well_evidenced' | 'partly_evidenced' | 'thinly_evidenced';

export interface GradeProfile {
  A: number;
  B: number;
  C: number;
  D: number;
}

export interface ResearchConfidence {
  level: ConfidenceLevel;
  /** Plain-English statements about the evidence. The last one says which rule set the level. */
  reasons: string[];
  /** Count of graded observations per evidence grade; null when the record carries no evidence profile. */
  gradeProfile: GradeProfile | null;
  /** How many of the model's inputs are assumptions rather than evidence. */
  assumptionsAmongInputs: number | null;
  /** How many inputs the model has in total. */
  inputsTotal: number | null;
  verifiedObservations: number | null;
  staleObservations: number | null;
  openConflicts: number | null;
  claimsPendingReview: number | null;
  /** Weighted completeness of the research record, 0–100. A property of the record, never of suitability. */
  completenessPct: number | null;
  criticalMissing: number | null;
  /** Names of the critical sections that are missing. */
  criticalMissingSections: string[];
}

// ── the result for one business ──────────────────────────────────────────────

export interface MatchedBusiness {
  slug: string | null;
  name: string;
  industry: string | null;
  family: string | null;
}

/** Which costed case(s) the financial comparisons were made on. */
export interface ScenarioBasis {
  /** Name of the reference variant; null when the record marks none. */
  variantName: string | null;
  /** Label of the national base scenario; null when none has been computed. */
  nationalScenarioLabel: string | null;
  /** The scenario with local evidence for the person's preferred location, when one exists. */
  localScenario: { label: string | null; locationName: string; localInputs: number | null; inheritedNationalInputs: number | null } | null;
}

export interface MatchResult {
  matcherVersion: string;
  business: MatchedBusiness;
  basis: ScenarioBasis;
  feasible: Feasible;
  /** The mandatory checks, always all four, always in the order of FEASIBILITY_CHECK_KEYS. */
  feasibility: FeasibilityCheck[];
  /** The fit dimensions, always all seven, always in the order of FIT_DIMENSION_KEYS. */
  fit: FitDimension[];
  /** Plain sentences stating what the person would be accepting. */
  tradeOffs: string[];
  missingPrerequisites: MissingPrerequisite[];
  /** Present only when `feasible` is `no` or at least one fit dimension is `weak`. */
  whyNotSuitable?: string[];
  /** Sections of the record that have not been researched and therefore could not be compared. */
  notResearched: string[];
  /** How far the research behind the record can be trusted. Never merged into anything above. */
  researchConfidence: ResearchConfidence;
}

// ── change between two results ───────────────────────────────────────────────

export interface CheckChange {
  key: FeasibilityCheckKey;
  label: string;
  before: CheckStatus;
  after: CheckStatus;
  reasonAfter: string;
}

export interface DimensionChange {
  key: FitDimensionKey;
  label: string;
  before: FitLevel;
  after: FitLevel;
  reasonAfter: string;
}

export interface MatchChange {
  business: MatchedBusiness;
  /** True when anything below differs. */
  changed: boolean;
  feasible: { before: Feasible; after: Feasible } | null;
  checks: CheckChange[];
  dimensions: DimensionChange[];
  /** Changes only when the record itself differs between the two results; a profile change never moves it. */
  researchConfidence: { before: ConfidenceLevel; after: ConfidenceLevel } | null;
  /** One plain sentence per change, in the order above. */
  summary: string[];
}
