/**
 * Every threshold the matching engine uses, in one place.
 *
 * None of these is a weight and none feeds a number that is shown to anyone: each one is the cut-off of a
 * categorical rule whose outcome is reported in words together with the figures that were compared.
 * Definitions: docs/MATCHING_ENGINE.md.
 */

import type { RiskTolerance } from './profile';

// ── Transferable capabilities ────────────────────────────────────────────────
/** A capability counts as held when the person lists it at this proficiency (1–5) or above. */
export const CAPABILITY_HELD_MIN_PROFICIENCY = 3;
/** A skill the record gives this importance (1–5) or above must be held for the dimension to be `strong`. */
export const CAPABILITY_KEY_MIN_IMPORTANCE = 4;

// ── Income potential ─────────────────────────────────────────────────────────
/** Year-3 owner income below this fraction of the lowest income benchmark the person gave is `weak`. */
export const INCOME_WEAK_BELOW_FRACTION = 0.5;

// ── Lifestyle compatibility ──────────────────────────────────────────────────
/** Involvement ordered by the time it asks of the owner (higher = more). */
export const INVOLVEMENT_ORDER = {
  absentee: 0,
  semi_absentee: 1,
  part_time: 2,
  full_time_managerial: 3,
  full_time_hands_on: 4,
} as const;
/** A demand this many steps above what the person accepts is a conflict; exactly one step above is a stretch. */
export const LIFESTYLE_CONFLICT_MIN_STEPS = 2;

// ── Operational complexity and learning ──────────────────────────────────────
/** On the record's 1–5 scales: this value or above is "high". */
export const COMPLEXITY_HIGH_MIN = 4;
/** On the record's 1–5 scales: this value or below is "low"; anything between low and high is "medium". */
export const COMPLEXITY_LOW_MAX = 2;
/** Training that takes more than this fraction of the transition timeline (but still fits) is a stretch. */
export const TRAINING_STRETCH_ABOVE_FRACTION_OF_TIMELINE = 0.5;
/** Weeks per month used to convert the record's training weeks into months (52 weeks / 12 months). */
export const WEEKS_PER_MONTH = 52 / 12;

// ── Risk exposure ────────────────────────────────────────────────────────────
/**
 * How much of the person's deployable capital (investable capital minus reserve) the worst modelled closure may
 * lose, per stated risk tolerance. At or below `comfortableFraction`: no concern. Above `limitFraction`: beyond
 * tolerance. In between: elevated.
 */
export const RISK_CLOSURE_LOSS_BANDS: Record<RiskTolerance, { comfortableFraction: number; limitFraction: number }> = {
  low: { comfortableFraction: 0.1, limitFraction: 0.25 },
  moderate: { comfortableFraction: 0.25, limitFraction: 0.5 },
  high: { comfortableFraction: 0.5, limitFraction: 1 },
};
/** scenario_key of the stress case the risk dimension reads. */
export const STRESS_REVENUE_MINUS_20_KEY = 'stress_revenue_minus_20';

// ── Geographic fit ───────────────────────────────────────────────────────────
/** Local scenario with at least this fraction of its inputs taken from local evidence: `strong`. */
export const GEOGRAPHIC_STRONG_MIN_LOCAL_FRACTION = 0.5;
/** Local scenario with at least this fraction (but below the strong one): `moderate`; below it: `weak`. */
export const GEOGRAPHIC_MODERATE_MIN_LOCAL_FRACTION = 0.1;

// ── Research confidence (never combined with suitability) ────────────────────
export const CONFIDENCE_THRESHOLDS = {
  /** `well_evidenced` needs ALL of these, and each must be recorded (an unrecorded fact never counts as met). */
  wellEvidenced: {
    /** Weighted completeness of the record, 0–100, at least. Same bar as the default publication policy. */
    minCompleteness: 75,
    maxCriticalMissing: 0,
    maxOpenConflicts: 0,
    maxStaleObservations: 0,
    maxClaimsPendingReview: 0,
    /** At least this fraction of graded figures is grade A or B. */
    minFractionGradeAOrB: 0.5,
    /** At least this fraction of observations has been verified by a reviewer. */
    minFractionVerified: 0.5,
    /** At most this fraction of the model's inputs is an assumption. */
    maxFractionAssumedInputs: 0.1,
  },
  /** `thinly_evidenced` needs ANY ONE of these (or no evidence profile / no graded figure at all). */
  thinlyEvidenced: {
    /** No figure at all is grade A or B. */
    noFigureGradeAOrB: true,
    /** Weighted completeness below this. */
    belowCompleteness: 50,
    /** This many critical sections missing, or more. */
    minCriticalMissing: 3,
    /** At least this fraction of observations is past its revalidation date. */
    minFractionStale: 0.5,
    /** At least this fraction of the model's inputs is an assumption. */
    minFractionAssumedInputs: 1 / 3,
  },
} as const;
