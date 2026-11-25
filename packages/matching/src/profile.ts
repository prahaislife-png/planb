import { z } from 'zod';

/**
 * The person side of a match. Mirrors customer.user_profiles, customer.user_capabilities and
 * customer.user_assets (supabase/migrations/20261124001200_customer.sql).
 *
 * Every scalar is REQUIRED BUT NULLABLE: `null` means "the person has not said". The engine never substitutes a
 * default for a null — a check that needs the value reports `unknown` and says what is missing.
 */

export const RISK_TOLERANCES = ['low', 'moderate', 'high'] as const;
export type RiskTolerance = (typeof RISK_TOLERANCES)[number];

export const INVOLVEMENT_LEVELS = ['full_time_hands_on', 'full_time_managerial', 'part_time', 'semi_absentee', 'absentee'] as const;
export type Involvement = (typeof INVOLVEMENT_LEVELS)[number];

export const MAX_AMOUNT_INR = 1e12;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const amount = z.number().finite().min(0).max(MAX_AMOUNT_INR).nullable();
const slug = z.string().regex(SLUG, 'must be a lowercase slug such as "food-safety"');
const freeText = z.string().trim().min(1).max(200);

export const CapabilitySchema = z
  .object({
    /** intel.skills.slug — the same vocabulary business records use. */
    skillSlug: slug,
    /** 1 (aware) … 5 (expert). */
    proficiency: z.number().int().min(1).max(5),
  })
  .strict();

export const OwnedAssetSchema = z
  .object({
    /** intel.asset_types.slug. Only assets the person would make available to the business. */
    assetTypeSlug: slug,
  })
  .strict();

export const PersonProfileSchema = z
  .object({
    /** Money the person could put into a business, in INR. Includes the reserve below. */
    investableCapitalInr: amount,
    /** Part of the investable capital that must stay untouched, in INR. 0 is a valid answer; null is "not said". */
    reserveRequirementInr: amount,
    /** Monthly income the person wants the business to pay them, in INR. */
    monthlyIncomeGoalInr: amount,
    /** What the person earns per month today, in INR (for salary replacement). */
    currentMonthlyIncomeInr: amount,
    riskTolerance: z.enum(RISK_TOLERANCES).nullable(),
    desiredInvolvement: z.enum(INVOLVEMENT_LEVELS).nullable(),
    maxHoursPerWeek: z.number().finite().min(0).max(120).nullable(),
    weekendWorkOk: z.boolean().nullable(),
    /** 1 (desk work only) … 5 (heavy physical work is fine). */
    physicalWorkTolerance: z.number().int().min(1).max(5).nullable(),
    /**
     * Months the person has given themselves for the move from salary to the business, counted from the first
     * rupee spent. The runway check asks whether the business stops consuming cash within it.
     */
    transitionTimelineMonths: z.number().int().min(0).max(120).nullable(),
    /** intel.locations.slug of the city the person would operate in. */
    preferredLocationSlug: slug.nullable(),
    /**
     * Display name of that location as in intel.locations.name (e.g. "Pune (city)"). The snapshot labels its
     * location scenarios by name only, so this is what the engine uses to recognise a scenario for the person's city.
     */
    preferredLocationName: freeText.nullable().optional(),
    interests: z.array(freeText).max(50),
    capabilities: z.array(CapabilitySchema).max(200),
    assets: z.array(OwnedAssetSchema).max(100),
    qualificationsHeld: z.array(freeText).max(100),
    /** Would the person take a business loan? null = not said. */
    willingToTakeLoan: z.boolean().nullable(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    p.capabilities.forEach((c, i) => {
      if (seen.has(c.skillSlug)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['capabilities', i, 'skillSlug'], message: `capability "${c.skillSlug}" is listed more than once` });
      }
      seen.add(c.skillSlug);
    });
    if (p.preferredLocationName != null && p.preferredLocationSlug === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['preferredLocationName'], message: 'a location name needs preferredLocationSlug as well' });
    }
  });

export type PersonProfile = z.infer<typeof PersonProfileSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type OwnedAsset = z.infer<typeof OwnedAssetSchema>;

/** A profile in which nothing has been said. Useful as a form's starting state; it describes no one. */
export const EMPTY_PROFILE: PersonProfile = Object.freeze({
  investableCapitalInr: null,
  reserveRequirementInr: null,
  monthlyIncomeGoalInr: null,
  currentMonthlyIncomeInr: null,
  riskTolerance: null,
  desiredInvolvement: null,
  maxHoursPerWeek: null,
  weekendWorkOk: null,
  physicalWorkTolerance: null,
  transitionTimelineMonths: null,
  preferredLocationSlug: null,
  preferredLocationName: null,
  interests: [],
  capabilities: [],
  assets: [],
  qualificationsHeld: [],
  willingToTakeLoan: null,
}) as PersonProfile;

export interface ProfileIssue {
  /** Dot/bracket path into the profile, e.g. `capabilities[1].proficiency`. */
  path: string;
  message: string;
}

/** Thrown for an invalid profile. `issues` lists every problem found. */
export class ProfileValidationError extends Error {
  readonly code = 'INVALID_PROFILE' as const;
  readonly issues: ProfileIssue[];

  constructor(issues: ProfileIssue[]) {
    const first = issues[0];
    const summary = first ? `${first.path ? `${first.path}: ` : ''}${first.message}` : 'unknown validation error';
    const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : '';
    super(`Invalid person profile: ${summary}${more}`);
    this.name = 'ProfileValidationError';
    this.issues = issues;
  }
}

function formatPath(path: ReadonlyArray<string | number>): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? part : `.${part}`;
  }
  return out;
}

/** Check a raw profile without throwing. */
export function validateProfile(raw: unknown): { ok: true; profile: PersonProfile } | { ok: false; issues: ProfileIssue[] } {
  const parsed = PersonProfileSchema.safeParse(raw);
  if (parsed.success) return { ok: true, profile: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })) };
}

/** Validate a raw profile and return it normalised (strings trimmed), or throw `ProfileValidationError`. */
export function parseProfile(raw: unknown): PersonProfile {
  const result = validateProfile(raw);
  if (!result.ok) throw new ProfileValidationError(result.issues);
  return result.profile;
}
