/**
 * @planb/matching — deterministic, explainable matching of one person's profile against business records.
 *
 * Pure functions only: no I/O, no clock, no randomness, no LLM. No number that grades a business for a person
 * exists anywhere in this package; outcomes are categories with reasons, and research confidence is reported
 * apart from suitability. Specification: packages/matching/docs/MATCHING_ENGINE.md
 */
export { MATCHER_NAME, MATCHER_VERSION } from './version';

export { matchBusiness, matchBusinesses, compareMatchResults, explainChange, FEASIBLE_ORDER } from './match';

export {
  PersonProfileSchema,
  CapabilitySchema,
  OwnedAssetSchema,
  ProfileValidationError,
  parseProfile,
  validateProfile,
  EMPTY_PROFILE,
  RISK_TOLERANCES,
  INVOLVEMENT_LEVELS,
  MAX_AMOUNT_INR,
} from './profile';
export type { PersonProfile, Capability, OwnedAsset, RiskTolerance, Involvement, ProfileIssue } from './profile';

export { narrowSnapshot } from './snapshot';
export type {
  BusinessSnapshot,
  SnapshotVariant,
  SnapshotScenario,
  SnapshotScenarioSummary,
  SnapshotLifestyle,
  SnapshotFounderRequirements,
  SnapshotEvidenceQuality,
  SnapshotCompleteness,
} from './snapshot';

export { FEASIBILITY_CHECK_KEYS, FIT_DIMENSION_KEYS } from './result';
export type {
  MatchResult,
  MatchedBusiness,
  ScenarioBasis,
  Feasible,
  FeasibilityCheck,
  FeasibilityCheckKey,
  CheckStatus,
  Shortfall,
  UnknownCause,
  FitDimension,
  FitDimensionKey,
  FitLevel,
  MissingPrerequisite,
  PrerequisiteKind,
  ResearchConfidence,
  ConfidenceLevel,
  GradeProfile,
  MatchChange,
  CheckChange,
  DimensionChange,
} from './result';

export { FEASIBILITY_CHECK_LABELS, overallFeasibility, deployableCapital, parseRequirementText, holdsQualification } from './feasibility';
export { FIT_DIMENSION_LABELS, interestWords } from './fit';
export { researchConfidence } from './confidence';

export {
  CAPABILITY_HELD_MIN_PROFICIENCY,
  CAPABILITY_KEY_MIN_IMPORTANCE,
  INCOME_WEAK_BELOW_FRACTION,
  INVOLVEMENT_ORDER,
  LIFESTYLE_CONFLICT_MIN_STEPS,
  COMPLEXITY_HIGH_MIN,
  COMPLEXITY_LOW_MAX,
  TRAINING_STRETCH_ABOVE_FRACTION_OF_TIMELINE,
  WEEKS_PER_MONTH,
  RISK_CLOSURE_LOSS_BANDS,
  STRESS_REVENUE_MINUS_20_KEY,
  GEOGRAPHIC_STRONG_MIN_LOCAL_FRACTION,
  GEOGRAPHIC_MODERATE_MIN_LOCAL_FRACTION,
  CONFIDENCE_THRESHOLDS,
} from './thresholds';

export { formatInr } from './format';
