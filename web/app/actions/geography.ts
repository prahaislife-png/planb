'use server';

import { z } from 'zod';
import { act, optionalNumber, optionalText, optionalUuid, text, uuid } from '@/lib/action';

/**
 * Geographic data management: the location tree, location metrics and market observations.
 * Observations are append-only in the database (freeze trigger) and graded by the guard trigger;
 * these actions only choose the starting grade the rules allow for a manual entry.
 */

const today = () => new Date().toISOString().slice(0, 10);
const requiredNumber = z.string().trim().min(1, 'required').pipe(z.coerce.number().finite());
const pastDate = z.string().date().refine((v) => v <= today(), 'cannot be in the future');
const metricKey = z.string().regex(/^[a-z0-9_]+$/);
// llm_estimate is deliberately absent: a person filling this form is never an LLM.
const EVIDENCE_TYPES = ['government_project_report', 'government_tariff_or_notification', 'regulatory_fee_schedule', 'supplier_quote',
  'manufacturer_catalogue', 'owner_documented', 'owner_reported', 'market_report', 'listing_observation', 'analyst_estimate'] as const;
const LEVELS = ['country', 'state', 'division', 'district', 'city', 'locality'] as const;
const SCOPE_BY_TYPE: Record<string, string> = { country: 'national', state: 'state', district: 'district', city: 'city', locality: 'locality' };

const RULES: Record<string, string> = {
  locations_slug_key: 'A location with this slug already exists.',
  locations_root_is_country: 'Only a country can be a root of the tree; every other location needs a parent.',
  locations_slug_check: 'Slug must be lower-case letters, digits and single hyphens.',
  market_observations_check: 'A market observation needs a numeric value or a text value.',
  market_observations_check1: 'A market observation needs a business model or a location.',
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

export async function addLocation(form: FormData) {
  return act(form, z.object({
    name: text(160).min(2), slug: z.string().trim().max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lower-case letters, digits and single hyphens only'),
    location_type: z.enum(LEVELS), parent_id: optionalUuid,
    tier: z.union([z.literal(''), z.enum(['metro', 'tier1', 'tier2', 'tier3', 'rural'])]).optional().transform((v) => (v ? v : null)),
  }).superRefine((v, ctx) => {
    if (!v.parent_id && v.location_type !== 'country') ctx.addIssue({ code: 'custom', path: ['parent_id'], message: 'required for everything except a country' });
  }), 'Location added. Official codes stay empty until verified against the Local Government Directory / Census.', (sql, i) => readable(async () => {
    if (i.parent_id) {
      const [parent] = await sql`select name, location_type from intel.locations where id = ${i.parent_id}`;
      if (!parent) throw new Error('The selected parent location does not exist.');
      if (LEVELS.indexOf(parent.location_type) >= LEVELS.indexOf(i.location_type)) {
        throw new Error(`A ${i.location_type} cannot sit under ${parent.name} (${parent.location_type}): the parent must be a coarser level.`);
      }
    }
    await sql`insert into intel.locations (name, slug, location_type, parent_id, tier) values (${i.name}, ${i.slug}, ${i.location_type}, ${i.parent_id}, ${i.tier})`;
  }));
}

export async function addLocationMetric(form: FormData) {
  return act(form, z.object({
    location_id: uuid, metric_key: metricKey, value: requiredNumber.refine((v) => v >= 0, 'cannot be negative'), segment: optionalText(160),
    observed_on: pastDate, source_id: uuid, evidence_type: z.enum(EVIDENCE_TYPES), notes: optionalText(),
  }), 'Location metric recorded on that exact node (unverified). Existing values are kept beside it.', (sql, i, userId) => readable(async () => {
    const [def] = await sql`select key, unit_code, period from intel.metric_definitions where key = ${i.metric_key} and applies_to = 'location'`;
    if (!def) throw new Error(`"${i.metric_key}" is not a location metric.`);
    const [loc] = await sql`select location_type from intel.locations where id = ${i.location_id}`;
    if (!loc) throw new Error('Unknown location.');
    const [source] = await sql`select reuse_status from intel.sources where id = ${i.source_id}`;
    if (!source) throw new Error('Unknown source.');
    if (source.reuse_status === 'prohibited') throw new Error('This source is marked prohibited in the source registry; its figures cannot be recorded.');
    // An estimate can only ever be grade D (the database guard enforces this too); a single manual entry starts at C.
    const estimate = i.evidence_type === 'analyst_estimate';
    await sql`
      insert into intel.location_metrics (location_id, metric_key, segment, value, currency, unit_code, period, observed_on, geographic_scope,
                                          source_id, evidence_type, evidence_grade, grade_basis, analyst_notes, revalidate_by, created_by)
      values (${i.location_id}, ${def.key}, ${i.segment}, ${i.value}, ${def.unit_code === 'inr' ? 'INR' : null}, ${def.unit_code}, ${def.period},
              ${i.observed_on}, ${SCOPE_BY_TYPE[loc.location_type] ?? 'unspecified'}, ${i.source_id}, ${i.evidence_type}, ${estimate ? 'D' : 'C'},
              ${estimate ? 'estimate' : 'single source, entered manually, unverified'}, ${i.notes}, (${i.observed_on}::date + 365), ${userId})`;
  }));
}

export async function addMarketObservation(form: FormData) {
  return act(form, z.object({
    business_model_id: optionalUuid, location_id: uuid, metric_key: metricKey, subject: optionalText(300),
    value: optionalNumber, value_text: optionalText(1000), observed_on: pastDate, source_id: uuid,
    evidence_type: z.enum(EVIDENCE_TYPES), notes: optionalText(),
  }).superRefine((v, ctx) => {
    if (v.value === null && v.value_text === null) ctx.addIssue({ code: 'custom', path: ['value'], message: 'enter a numeric value or a text value' });
  }), 'Market observation recorded (unverified). It is an indicator, not a demand estimate.', (sql, i, userId) => readable(async () => {
    const [def] = await sql`select key, name, unit_code, period from intel.metric_definitions where key = ${i.metric_key} and applies_to = 'market'`;
    if (!def) throw new Error(`"${i.metric_key}" is not a market metric.`);
    if (def.unit_code === null && i.value_text === null) {
      throw new Error(`"${def.name}" has no fixed unit: the text value must say what was measured.`);
    }
    const [loc] = await sql`select location_type from intel.locations where id = ${i.location_id}`;
    if (!loc) throw new Error('Unknown location.');
    const [source] = await sql`select reuse_status from intel.sources where id = ${i.source_id}`;
    if (!source) throw new Error('Unknown source.');
    if (source.reuse_status === 'prohibited') throw new Error('This source is marked prohibited in the source registry; its figures cannot be recorded.');
    const estimate = i.evidence_type === 'analyst_estimate';
    await sql`
      insert into intel.market_observations (business_model_id, location_id, metric_key, subject, value, value_text, currency, unit_code, period,
                                             observed_on, geographic_scope, source_id, evidence_type, evidence_grade, grade_basis, analyst_notes,
                                             revalidate_by, created_by)
      values (${i.business_model_id}, ${i.location_id}, ${def.key}, ${i.subject}, ${i.value}, ${i.value_text}, ${def.unit_code === 'inr' ? 'INR' : null},
              ${def.unit_code}, ${def.period}, ${i.observed_on}, ${SCOPE_BY_TYPE[loc.location_type] ?? 'unspecified'}, ${i.source_id},
              ${i.evidence_type}, ${estimate ? 'D' : 'C'}, ${estimate ? 'estimate' : 'single source, entered manually, unverified'}, ${i.notes},
              (${i.observed_on}::date + 365), ${userId})`;
  }));
}
