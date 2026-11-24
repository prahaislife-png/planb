'use server';

import { z } from 'zod';
import { act, checkbox, optionalDate, optionalNumber, optionalText, optionalUuid, text, uuid } from '@/lib/action';

/**
 * Supplier management and quotation collection. Every action runs as the staff user through act():
 * zod mirrors the CHECK constraints so mistakes are caught with a readable message, and the database
 * (RLS, CHECKs, the observation guard triggers) remains the enforcement point.
 */

const today = () => new Date().toISOString().slice(0, 10);
const requiredNumber = z.string().trim().min(1, 'required').pipe(z.coerce.number().finite());
const optionalInt = optionalNumber.refine((v) => v === null || (Number.isInteger(v) && v >= 0), 'must be a whole number, 0 or more');
const optionalHttpUrl = optionalText(300).refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), 'must start with http:// or https://');
const optionalEmail = z.union([z.literal(''), z.string().trim().email().max(200)]).optional().transform((v) => (v ? v : null));

// Database rules a form can run into, in the researcher's language. The constraint name is kept for traceability.
const RULES: Record<string, string> = {
  supplier_quotes_check: 'A quotation cannot be valid until a date before it was quoted.',
  supplier_quotes_check1: 'A quotation can only be verified when the supplier consented to its use (consent_to_use). Record the consent first.',
  supplier_quotes_quantity_check: 'Quantity must be greater than zero.',
  supplier_quotes_quoted_price_check: 'The quoted price cannot be negative.',
  supplier_quotes_tax_rate_pct_check: 'GST rate must be between 0 and 100.',
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

export async function addSupplier(form: FormData) {
  return act(form, z.object({
    name: text(200).min(2),
    supplier_type: z.enum(['manufacturer', 'authorised_dealer', 'trader', 'importer', 'service_provider', 'raw_material_supplier']),
    location_id: optionalUuid, city_text: optionalText(120), website: optionalHttpUrl,
    contact_name: optionalText(160), contact_phone: optionalText(40), contact_email: optionalEmail,
    gstin: optionalText(15).transform((v) => (v ? v.toUpperCase() : null))
      .refine((v) => v === null || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v), 'not a 15-character GSTIN'),
    categories: optionalText(400), consent_to_list: checkbox, consent_recorded_on: optionalDate,
    first_contacted_on: optionalDate, notes: optionalText(),
  }).superRefine((v, ctx) => {
    if (v.consent_to_list && !v.consent_recorded_on) ctx.addIssue({ code: 'custom', path: ['consent_recorded_on'], message: 'required when consent to list is ticked' });
    if (!v.consent_to_list && v.consent_recorded_on) ctx.addIssue({ code: 'custom', path: ['consent_recorded_on'], message: 'only set a consent date when consent to list is ticked' });
    for (const k of ['consent_recorded_on', 'first_contacted_on'] as const) {
      if (v[k] && v[k]! > today()) ctx.addIssue({ code: 'custom', path: [k], message: 'cannot be in the future' });
    }
  }), 'Supplier added (unverified).', (sql, i, userId) => readable(async () => {
    const categories = [...new Set((i.categories ?? '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean))];
    await sql`
      insert into intel.suppliers (name, supplier_type, location_id, city_text, website, contact_name, contact_phone, contact_email, gstin,
                                   categories, consent_to_list, consent_recorded_on, first_contacted_on, notes, created_by)
      values (${i.name}, ${i.supplier_type}, ${i.location_id}, ${i.city_text}, ${i.website}, ${i.contact_name}, ${i.contact_phone},
              ${i.contact_email}, ${i.gstin}, array(select jsonb_array_elements_text(${JSON.stringify(categories)}::text::jsonb)),
              ${i.consent_to_list}, ${i.consent_recorded_on}, ${i.first_contacted_on}, ${i.notes}, ${userId})`;
  }));
}

export async function addQuote(form: FormData) {
  return act(form, z.object({
    supplier_id: uuid, cost_item_id: optionalUuid,
    item_description: text(300).min(3), model_or_spec: optionalText(300),
    capacity_value: optionalNumber, capacity_unit: optionalText(40),
    quoted_price: requiredNumber.refine((v) => v >= 0, 'cannot be negative'),
    quantity: requiredNumber.refine((v) => v > 0, 'must be greater than zero'),
    unit_code: optionalText(20),
    tax_treatment: z.enum(['inclusive', 'exclusive', 'unknown', 'not_applicable']),
    tax_rate_pct: optionalNumber.refine((v) => v === null || (v >= 0 && v <= 100), 'must be between 0 and 100'),
    installation: z.enum(['included', 'excluded', 'unknown', 'not_applicable']),
    freight_terms: optionalText(300), warranty_months: optionalInt, lead_time_days: optionalInt, payment_terms: optionalText(300),
    quoted_on: z.string().date(), valid_until: optionalDate, delivery_location_id: optionalUuid,
    collection_method: z.enum(['email', 'phone', 'in_person', 'supplier_portal', 'written_quotation']),
    consent_to_use: checkbox, consent_notes: optionalText(), analyst_notes: optionalText(),
  }).superRefine((v, ctx) => {
    if (v.quoted_on > today()) ctx.addIssue({ code: 'custom', path: ['quoted_on'], message: 'cannot be in the future' });
    if (v.valid_until && v.valid_until < v.quoted_on) ctx.addIssue({ code: 'custom', path: ['valid_until'], message: 'cannot be before the quotation date' });
  }), 'Quotation recorded (status: received). A reviewer verifies it before it can feed a cost.', (sql, i, userId) => readable(async () => {
    let variantId: string | null = null;
    if (i.cost_item_id) {
      const [item] = await sql`select business_variant_id from intel.cost_items where id = ${i.cost_item_id}`;
      if (!item) throw new Error('The selected cost item no longer exists.');
      variantId = item.business_variant_id;
    }
    await sql`
      insert into intel.supplier_quotes (supplier_id, business_variant_id, cost_item_id, item_description, model_or_spec, capacity_value, capacity_unit,
                                         quoted_price, unit_code, quantity, tax_treatment, tax_rate_pct, installation, freight_terms, warranty_months,
                                         lead_time_days, payment_terms, quoted_on, valid_until, delivery_location_id, collection_method,
                                         consent_to_use, consent_notes, collected_by, status, analyst_notes)
      values (${i.supplier_id}, ${variantId}, ${i.cost_item_id}, ${i.item_description}, ${i.model_or_spec}, ${i.capacity_value}, ${i.capacity_unit},
              ${i.quoted_price}, ${i.unit_code}, ${i.quantity}, ${i.tax_treatment}, ${i.tax_rate_pct}, ${i.installation}, ${i.freight_terms},
              ${i.warranty_months}, ${i.lead_time_days}, ${i.payment_terms}, ${i.quoted_on}, ${i.valid_until}, ${i.delivery_location_id},
              ${i.collection_method}, ${i.consent_to_use}, ${i.consent_notes}, ${userId}, 'received', ${i.analyst_notes})`;
  }));
}

const PERIOD_BY_RECURRENCE: Record<string, string> = { one_time: 'one_time', monthly: 'per_month', annual: 'per_year', per_unit_output: 'per_unit' };
const SCOPE_BY_LOCATION_TYPE: Record<string, string> = { country: 'national', state: 'state', district: 'district', city: 'city', locality: 'locality' };

export async function verifyQuote(form: FormData) {
  return act(form, z.object({ quote_id: uuid }), (message) => String(message), (sql, i, userId) => readable(async () => {
    // supplier_quotes has no database-level role guard for verification, so the reviewer rule is checked here, as the acting user.
    const [role] = await sql`select ops.has_role('admin', 'reviewer') as ok`;
    if (!role?.ok) throw new Error('Only a reviewer or admin can verify a quotation.');
    const [q] = await sql`
      select q.*, coalesce(q.delivery_location_id, s.location_id) as place_id
      from intel.supplier_quotes q join intel.suppliers s on s.id = q.supplier_id where q.id = ${i.quote_id}`;
    if (!q) throw new Error('Quotation not found.');
    if (q.status !== 'received') throw new Error(`Only a received quotation can be verified (this one is ${q.status}).`);

    await sql`update intel.supplier_quotes set status = 'verified', verified_by = ${userId}, verified_at = now() where id = ${q.id}`;
    if (!q.cost_item_id) return 'Quotation verified. It is not linked to a cost item, so no cost observation was created.';

    const [item] = await sql`select id, recurrence, data_origin from intel.cost_items where id = ${q.cost_item_id}`;
    if (!item) throw new Error('The linked cost item no longer exists.');
    const period = PERIOD_BY_RECURRENCE[item.recurrence];
    if (!period) throw new Error(`A quotation cannot price a cost item with recurrence "${item.recurrence}".`);
    if (q.currency !== 'INR') throw new Error(`Only INR quotations can become cost observations (this one is in ${q.currency}).`);
    const [existing] = await sql`select id from intel.cost_observations where supplier_quote_id = ${q.id} limit 1`;
    if (existing) throw new Error('A cost observation already exists for this quotation.');
    const [source] = await sql`
      select id, default_revalidation_days from intel.sources
      where slug in ('consented-supplier-quotations', 'supplier-quotations-consented') or source_type = 'primary_research'
      order by (slug = 'consented-supplier-quotations') desc, (slug = 'supplier-quotations-consented') desc, (slug like '%supplier%') desc, slug
      limit 1`;
    if (!source) {
      throw new Error('No primary-research source exists in the source registry (expected slug "consented-supplier-quotations"). Register it before verifying a quotation that feeds a cost item.');
    }
    const [place] = q.place_id ? await sql`select location_type from intel.locations where id = ${q.place_id}` : [];
    const origin = item.data_origin !== 'research' ? item.data_origin : q.data_origin;
    const demo = origin === 'demo'; // demo data must stay grade D (database guard)
    await sql`
      insert into intel.cost_observations (cost_item_id, value, currency, unit_code, period, observed_on, location_id, geographic_scope,
                                           capacity_value, capacity_unit, source_id, source_document_id, supplier_quote_id, tax_treatment,
                                           tax_rate_pct, installation, evidence_type, verification_status, evidence_grade, grade_basis,
                                           analyst_notes, valid_until, revalidate_by, created_by, data_origin)
      values (${q.cost_item_id}, round(${q.quoted_price}::numeric / ${q.quantity}::numeric, 2), 'INR', 'inr', ${period}, ${q.quoted_on},
              ${q.place_id}, ${SCOPE_BY_LOCATION_TYPE[place?.location_type ?? ''] ?? 'unspecified'}, ${q.capacity_value}, ${q.capacity_unit},
              ${source.id}, ${q.source_document_id}, ${q.id}, ${q.tax_treatment}, ${q.tax_rate_pct}, ${q.installation}, 'supplier_quote',
              'unverified', ${demo ? 'D' : 'C'}, ${demo ? 'demo data' : 'single supplier quotation; no document attached'},
              ${`Supplier quotation: ${q.item_description}${q.model_or_spec ? ` (${q.model_or_spec})` : ''}; quoted ${q.quoted_price} for quantity ${q.quantity}; collected by ${String(q.collection_method).replace(/_/g, ' ')}.`},
              ${q.valid_until}, coalesce(${q.valid_until}::date, ${q.quoted_on}::date + ${source.default_revalidation_days}::int), ${userId}, ${origin})`;
    return 'Quotation verified and a cost observation recorded (supplier quote, grade C, unverified) beside the existing ones.';
  }));
}
