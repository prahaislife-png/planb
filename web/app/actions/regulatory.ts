'use server';

import { z } from 'zod';
import { act, optionalNumber, optionalText, optionalUuid, text, uuid } from '@/lib/action';

/**
 * Regulatory database: regulations, their mapping to business models, and government schemes.
 * An unverified regulation is a lead, not a fact; "to_be_determined" mappings are research leads,
 * never requirements. Verification needs a registry source and is dated so it can go stale.
 */

const slug = z.string().trim().max(100).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lower-case letters, digits and single hyphens only');
const optionalHttpUrl = optionalText(500).refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), 'must start with http:// or https://');

const RULES: Record<string, string> = {
  regulations_slug_key: 'A regulation with this slug already exists.',
  regulations_check: 'A regulation can only be verified with a verification date and a registry source.',
  regulations_check1: 'Grade A is only allowed on a verified regulation.',
  regulations_check2: 'Demo data must stay grade D and can never be verified.',
  business_regulations_business_model_id_regulation_id_key: 'This regulation is already mapped to this business model.',
  business_regulations_check: 'A conditional requirement must state its condition.',
  government_schemes_slug_key: 'A scheme with this slug already exists.',
  government_schemes_check: 'A scheme can only be verified with a verification date and a registry source.',
  business_scheme_eligibility_pkey: 'This scheme is already mapped to this business model.',
};
async function readable<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const name = (error as { constraint_name?: string }).constraint_name;
    if (name && RULES[name]) throw new Error(`${RULES[name]} [database rule ${name}]`);
    throw error;
  }
}

const LEVEL_LOCATION_TYPES: Record<string, string[]> = {
  central: ['country'], state: ['state'], local_body: ['division', 'district', 'city', 'locality'],
};

export async function addRegulation(form: FormData) {
  return act(form, z.object({
    slug, name: text(240).min(3),
    regulation_type: z.enum(['registration', 'licence', 'approval', 'certification', 'inspection', 'ongoing_compliance']),
    issuing_authority: text(240).min(2), jurisdiction_level: z.enum(['central', 'state', 'local_body']),
    jurisdiction_location_id: optionalUuid, legal_basis: optionalText(500), description: optionalText(), application_portal_url: optionalHttpUrl,
    fee_notes: optionalText(1000), validity_notes: optionalText(1000),
    typical_timeline_days: optionalNumber.refine((v) => v === null || v >= 0, 'cannot be negative'),
    source_id: optionalUuid, notes: optionalText(),
  }), 'Regulation added as an unverified lead (grade D). A reviewer verifies it against its authority.', (sql, i) => readable(async () => {
    if (i.jurisdiction_location_id) {
      const [loc] = await sql`select name, location_type from intel.locations where id = ${i.jurisdiction_location_id}`;
      if (!loc) throw new Error('Unknown jurisdiction location.');
      if (!LEVEL_LOCATION_TYPES[i.jurisdiction_level].includes(loc.location_type)) {
        throw new Error(`Jurisdiction level "${i.jurisdiction_level.replace('_', ' ')}" does not match ${loc.name} (${loc.location_type}).`);
      }
    }
    await sql`
      insert into intel.regulations (slug, name, regulation_type, issuing_authority, jurisdiction_location_id, jurisdiction_level, legal_basis,
                                     description, application_portal_url, fee_notes, validity_notes, typical_timeline_days, source_id, notes)
      values (${i.slug}, ${i.name}, ${i.regulation_type}, ${i.issuing_authority}, ${i.jurisdiction_location_id}, ${i.jurisdiction_level}, ${i.legal_basis},
              ${i.description}, ${i.application_portal_url}, ${i.fee_notes}, ${i.validity_notes}, ${i.typical_timeline_days}, ${i.source_id}, ${i.notes})`;
  }));
}

export async function verifyRegulation(form: FormData) {
  return act(form, z.object({
    regulation_id: uuid, source_id: uuid,
    evidence_grade: z.union([z.literal(''), z.enum(['A', 'B', 'C', 'D'])]).optional().transform((v) => (v ? v : null)),
  }), 'Regulation verified today; revalidation is due in 180 days.', (sql, i, userId) => readable(async () => {
    // intel.regulations has no database-level role guard for verification, so the reviewer rule is checked here, as the acting user.
    const [role] = await sql`select ops.has_role('admin', 'reviewer') as ok`;
    if (!role?.ok) throw new Error('Only a reviewer or admin can verify a regulation.');
    const [source] = await sql`select id from intel.sources where id = ${i.source_id}`;
    if (!source) throw new Error('Unknown source: a regulation is verified against a source in the registry.');
    const rows = await sql`
      update intel.regulations
         set verification_status = 'verified', verified_by = ${userId}, source_id = ${i.source_id}, last_verified_on = current_date,
             revalidate_by = current_date + 180, evidence_grade = coalesce(${i.evidence_grade}, evidence_grade)
       where id = ${i.regulation_id} returning id`;
    if (rows.length === 0) throw new Error('Regulation not found.');
  }));
}

export async function mapRegulation(form: FormData) {
  return act(form, z.object({
    business_model_id: uuid, regulation_id: uuid,
    applicability: z.enum(['mandatory', 'conditional', 'optional', 'to_be_determined']), condition_text: optionalText(1000),
    stage: z.enum(['pre_launch', 'at_launch', 'ongoing']), notes: optionalText(),
  }).superRefine((v, ctx) => {
    if (v.applicability === 'conditional' && !v.condition_text) ctx.addIssue({ code: 'custom', path: ['condition_text'], message: 'required when the requirement is conditional' });
  }), (r) => String(r), (sql, i) => readable(async () => {
    await sql`insert into intel.business_regulations (business_model_id, regulation_id, applicability, condition_text, stage, notes)
              values (${i.business_model_id}, ${i.regulation_id}, ${i.applicability}, ${i.condition_text}, ${i.stage}, ${i.notes})`;
    return i.applicability === 'to_be_determined'
      ? 'Mapping recorded as a research lead (to be determined) — not a requirement.'
      : 'Mapping recorded (unverified).';
  }));
}

export async function addScheme(form: FormData) {
  return act(form, z.object({
    slug, name: text(240).min(3), administering_body: text(240).min(2),
    scheme_type: z.enum(['capital_subsidy', 'interest_subvention', 'credit_guarantee', 'collateral_free_loan', 'training', 'marketing_support', 'tax_incentive', 'other']),
    jurisdiction_location_id: optionalUuid, benefit_summary: optionalText(), eligibility_summary: optionalText(), application_url: optionalHttpUrl,
    status: z.enum(['active', 'closed', 'unknown']), source_id: optionalUuid, notes: optionalText(),
  }), 'Scheme added as an unverified lead (grade D). Scheme terms change often; verify before relying on it.', (sql, i) => readable(async () => {
    await sql`
      insert into intel.government_schemes (slug, name, administering_body, scheme_type, jurisdiction_location_id, benefit_summary, eligibility_summary,
                                            application_url, status, source_id, notes)
      values (${i.slug}, ${i.name}, ${i.administering_body}, ${i.scheme_type}, ${i.jurisdiction_location_id}, ${i.benefit_summary}, ${i.eligibility_summary},
              ${i.application_url}, ${i.status}, ${i.source_id}, ${i.notes})`;
  }));
}

export async function mapScheme(form: FormData) {
  return act(form, z.object({
    business_model_id: uuid, scheme_id: uuid,
    eligibility: z.enum(['eligible', 'conditional', 'not_eligible', 'to_be_determined']), condition_text: optionalText(1000), notes: optionalText(),
  }).superRefine((v, ctx) => {
    if (v.eligibility === 'conditional' && !v.condition_text) ctx.addIssue({ code: 'custom', path: ['condition_text'], message: 'required when eligibility is conditional' });
  }), 'Scheme eligibility recorded (unverified).', (sql, i) => readable(async () => {
    await sql`insert into intel.business_scheme_eligibility (business_model_id, scheme_id, eligibility, condition_text, notes)
              values (${i.business_model_id}, ${i.scheme_id}, ${i.eligibility}, ${i.condition_text}, ${i.notes})`;
  }));
}
