'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { act, backTo, mustAffect, optionalText, text, uuid, withMessage } from '@/lib/action';
import { requireStaff } from '@/lib/auth';
import { asUser, dbErrorMessage } from '@/lib/db';
import { contentPath, isPdf, MAX_UPLOAD_BYTES, putEvidence, sha256 } from '@/lib/storage';

/**
 * Server actions for analyst work. Each one: authenticate → validate input → run as the staff user
 * (so RLS and the database guard triggers decide what is allowed) → redirect back with a result.
 * No action trusts a client-supplied role, and none bypasses the workflow functions in the database.
 */

// ── Claims ───────────────────────────────────────────────────────────────────
export async function reviewClaim(form: FormData) {
  return act(form, z.object({ claim_id: uuid, decision: z.enum(['accept', 'reject']), note: optionalText() }),
    (r) => `Claim ${(r as string) === 'accept' ? 'accepted' : 'rejected'}.`,
    async (sql, i) => {
      await sql`select intel.review_claim(${i.claim_id}, ${i.decision}, ${i.note})`;
      return i.decision;
    });
}

export async function acceptVerifiedClaims(form: FormData) {
  return act(form, z.object({ document_id: uuid }), (n) => `${n} quote-verified claims accepted.`, async (sql, i) => {
    const rows = await sql`select id from intel.evidence_claims where source_document_id = ${i.document_id} and status = 'extracted' and quote_verified`;
    for (const row of rows) await sql`select intel.review_claim(${row.id}, 'accept', 'Accepted in bulk after reading the document against its claims.')`;
    return rows.length;
  });
}

export async function correctClaim(form: FormData) {
  return act(form, z.object({
    claim_id: uuid, value: z.coerce.number().finite(), unit_raw: optionalText(60), quote: text(1200).min(3),
    page: z.coerce.number().int().min(1), note: text().min(3), quantity: z.union([z.literal(''), z.coerce.number().positive()]).optional(),
  }), (r) => (r as { quote_verified: boolean }).quote_verified
    ? 'Correction recorded and accepted. Run a refresh to apply it to the model.'
    : 'Correction recorded, but its quote was not found on that page, so it stays unaccepted.',
  async (sql, i) => {
    const [row] = await sql`select (x).quote_verified from (select intel.correct_claim(${i.claim_id}, ${i.value}, ${i.unit_raw}, ${i.quote}, ${i.page}, ${i.note}, ${i.quantity === '' || i.quantity === undefined ? null : i.quantity}) as x) y`;
    return row;
  });
}

// ── Observations, conflicts, assumptions ─────────────────────────────────────
export async function setObservationStatus(form: FormData) {
  return act(form, z.object({ kind: z.enum(['cost', 'parameter', 'market', 'location']), id: uuid,
    status: z.enum(['unverified', 'verified', 'disputed', 'rejected']), note: optionalText() }),
  'Observation updated.', (sql, i) => sql`select intel.set_observation_status(${i.kind}, ${i.id}, ${i.status}, ${i.note})`);
}

export async function addCostObservation(form: FormData) {
  return act(form, z.object({
    cost_item_id: uuid, source_id: uuid, value: z.coerce.number().nonnegative(), observed_on: z.string().date(),
    evidence_type: z.enum(['supplier_quote', 'manufacturer_catalogue', 'owner_reported', 'market_report', 'listing_observation', 'analyst_estimate']),
    period: z.enum(['one_time', 'per_month', 'per_year']), tax_treatment: z.enum(['inclusive', 'exclusive', 'unknown', 'not_applicable']),
    installation: z.enum(['included', 'excluded', 'unknown', 'not_applicable']), geographic_scope: z.enum(['city', 'district', 'state', 'national', 'unspecified']),
    location_id: z.union([z.literal(''), uuid]).optional(), notes: optionalText(),
  }), 'Observation recorded alongside the existing ones. Run a refresh to cross-verify.', async (sql, i, userId) => {
    const [item] = await sql`select ci.data_origin from intel.cost_items ci where ci.id = ${i.cost_item_id}`;
    // A manually entered figure starts unverified; an estimate can only ever be grade D (enforced by the database too).
    const grade = i.evidence_type === 'analyst_estimate' ? 'D' : 'C';
    await sql`
      insert into intel.cost_observations (cost_item_id, value, unit_code, period, observed_on, source_id, evidence_type, evidence_grade,
                                           grade_basis, tax_treatment, installation, geographic_scope, location_id, analyst_notes,
                                           revalidate_by, created_by, data_origin)
      values (${i.cost_item_id}, ${i.value}, 'inr', ${i.period}, ${i.observed_on}, ${i.source_id}, ${i.evidence_type}, ${grade},
              ${grade === 'D' ? 'estimate' : 'single source, entered manually, unverified'}, ${i.tax_treatment}, ${i.installation},
              ${i.geographic_scope}, ${i.location_id || null}, ${i.notes}, (${i.observed_on}::date + 365), ${userId}, ${item?.data_origin ?? 'research'})`;
  });
}

export async function setLocationMapping(form: FormData) {
  return act(form, z.object({
    cost_item_id: uuid, metric_key: z.union([z.literal(''), z.string().regex(/^[a-z0-9_]+$/)]), segment: optionalText(120),
    multiplier: z.union([z.literal(''), z.coerce.number().positive()]).optional(), basis: optionalText(400),
  }).refine((i) => i.metric_key === '' || (i.multiplier !== '' && i.multiplier !== undefined && (i.basis ?? '').length >= 10), {
    message: 'a mapping needs a multiplier and a basis of at least 10 characters saying where the multiplier comes from',
  }), (r) => (r ? 'Local derivation recorded. Run a refresh to compute location scenarios.' : 'Local derivation removed.'),
  async (sql, i) => {
    const on = i.metric_key !== '';
    await mustAffect(sql`
      update intel.cost_items
         set location_metric_key = ${on ? i.metric_key : null}, location_metric_segment = ${on ? i.segment : null},
             location_metric_multiplier = ${on ? (i.multiplier as number) : null}, location_metric_basis = ${on ? i.basis : null}
       where id = ${i.cost_item_id}`, 'this cost item');
    return on;
  });
}

export async function resolveConflict(form: FormData) {
  return act(form, z.object({ conflict_id: uuid, status: z.enum(['resolved', 'accepted_as_range']), note: text().min(5) }),
    'Conflict closed.', (sql, i) => sql`select intel.resolve_conflict(${i.conflict_id}, ${i.status}, ${i.note})`);
}

export async function setAssumption(form: FormData) {
  return act(form, z.object({ variant_id: uuid, parameter_key: z.string().regex(/^[a-z0-9_]+$/), stream_id: z.union([z.literal(''), uuid]).optional(),
    value: z.coerce.number().finite(), rationale: text().min(10) }),
  'Assumption recorded (grade D). Run a refresh to recompute scenarios.',
  (sql, i) => sql`select intel.set_assumption(${i.variant_id}, ${i.parameter_key}, ${i.stream_id || null}, ${i.value}, ${i.rationale})`);
}

// ── Business record ──────────────────────────────────────────────────────────
export async function updateBusinessIdentity(form: FormData) {
  return act(form, z.object({ model_id: uuid, name: text(200).min(3), description: optionalText(4000), operating_model: optionalText(4000),
    target_customers: optionalText(2000) }), 'Record updated.',
  (sql, i) => mustAffect(sql`update intel.business_models set name = ${i.name}, description = ${i.description}, operating_model = ${i.operating_model},
                         target_customers = ${i.target_customers} where id = ${i.model_id}`, 'this business record'));
}

export async function enqueueRefresh(form: FormData) {
  return act(form, z.object({ model_id: uuid }), 'Refresh queued. It runs when a research worker picks it up (planb worker).', async (sql, i, userId) => {
    const [m] = await sql`select data_origin from intel.business_models where id = ${i.model_id}`;
    await sql`insert into ops.research_runs (pipeline, business_model_id, idempotency_key, requested_by, data_origin)
              values ('business_refresh', ${i.model_id}, ${`refresh:${i.model_id}:${Date.now()}`}, ${userId}, ${m.data_origin})`;
  });
}

export async function uploadDocument(form: FormData): Promise<never> {
  const user = await requireStaff();
  const back = backTo(form);
  const schema = z.object({ model_id: uuid, source_id: uuid, title: text(300).min(5), url: optionalText(1000) });
  const parsed = schema.safeParse({ model_id: form.get('model_id'), source_id: form.get('source_id'), title: form.get('title'), url: form.get('url') ?? undefined });
  const file = form.get('file');
  let target: string;
  if (!parsed.success || !(file instanceof File)) {
    target = withMessage(back, 'error', 'A business model, source, title and PDF file are required.');
  } else if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    target = withMessage(back, 'error', `The file must be between 1 byte and ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  } else {
    const data = Buffer.from(await file.arrayBuffer());
    if (!isPdf(data)) {
      target = withMessage(back, 'error', 'Only PDF documents are accepted (checked from the file contents, not its name).');
    } else {
      const digest = sha256(data);
      const storagePath = contentPath(digest);
      try {
        const message = await asUser(user.id, async (sql) => {
          const [source] = await sql`select id, reuse_status, recommended_ingestion, licence_name, terms_checked_on from intel.sources where id = ${parsed.data.source_id}`;
          if (!source) throw new Error('Unknown source.');
          if (source.reuse_status === 'prohibited' || source.recommended_ingestion === 'do_not_ingest') {
            throw new Error('This source is marked do-not-ingest in the source registry.');
          }
          const [model] = await sql`select data_origin from intel.business_models where id = ${parsed.data.model_id}`;
          let [doc] = await sql`select id from intel.source_documents where sha256 = ${digest}`;
          const existed = Boolean(doc);
          if (!doc) {
            await putEvidence(storagePath, data);
            [doc] = await sql`
              insert into intel.source_documents (source_id, title, url, retrieval_method, mime_type, byte_size, sha256, storage_path,
                                                  licence_snapshot, uploaded_by, data_origin)
              values (${source.id}, ${parsed.data.title}, ${parsed.data.url}, 'manual_upload', 'application/pdf', ${data.length}, ${digest},
                      ${storagePath}, ${`${source.licence_name ?? 'licence not recorded'} — reuse_status=${source.reuse_status} (terms checked ${source.terms_checked_on ?? 'never'})`},
                      ${user.id}, ${model.data_origin})
              returning id`;
            await sql`insert into ops.ingestion_log (source_id, adapter_key, action, outcome, byte_size, sha256, document_id, detail)
                      values (${source.id}, 'dashboard_upload', 'store', 'ok', ${data.length}, ${digest}, ${doc.id}, ${`uploaded by ${user.displayName}`})`;
          }
          await sql`insert into ops.research_runs (pipeline, business_model_id, source_document_id, idempotency_key, requested_by, budget_usd, data_origin)
                    values ('document_research', ${parsed.data.model_id}, ${doc.id}, ${`doc:${parsed.data.model_id}:${digest}`}, ${user.id}, 2, ${model.data_origin})
                    on conflict (idempotency_key) do nothing`;
          return existed ? 'This document was already in the evidence store (same SHA-256); a research run was queued for it.'
                         : 'Document stored and a research run queued. It runs when a research worker picks it up.';
        });
        target = withMessage(back, 'ok', message);
      } catch (error) {
        target = withMessage(back, 'error', dbErrorMessage(error));
      }
    }
  }
  revalidatePath('/', 'layout');
  redirect(target);
}

// ── Versions & publication ───────────────────────────────────────────────────
export async function submitVersion(form: FormData) {
  return act(form, z.object({ model_id: uuid, change_summary: text(1000).min(5) }), 'Version submitted for review.',
    (sql, i) => sql`select intel.submit_business_version(${i.model_id}, ${i.change_summary})`);
}

export async function decideVersion(form: FormData) {
  return act(form, z.object({ version_id: uuid, decision: z.enum(['approve', 'request_changes', 'reject']), comments: optionalText() }),
    'Decision recorded.', (sql, i) => sql`select intel.decide_business_version(${i.version_id}, ${i.decision}, ${i.comments})`);
}

export async function publishVersion(form: FormData) {
  return act(form, z.object({ version_id: uuid }), 'Published.', (sql, i) => sql`select pub.publish_business_version(${i.version_id})`);
}

export async function withdrawPublication(form: FormData) {
  return act(form, z.object({ publication_id: uuid, reason: text().min(10) }), 'Publication withdrawn.',
    (sql, i) => sql`select pub.withdraw_publication(${i.publication_id}, ${i.reason})`);
}

export async function updatePolicy(form: FormData) {
  return act(form, z.object({
    min_completeness_pct: z.coerce.number().min(0).max(100), max_critical_missing: z.coerce.number().int().min(0),
    max_open_conflicts: z.coerce.number().int().min(0), max_pending_claims: z.coerce.number().int().min(0),
    max_stale_observations: z.coerce.number().int().min(0), min_parameters_c_or_better_pct: z.coerce.number().min(0).max(100),
  }), 'Publication policy updated.', (sql, i, userId) => mustAffect(sql`
    update ops.publication_policy set min_completeness_pct = ${i.min_completeness_pct}, max_critical_missing = ${i.max_critical_missing},
      max_open_conflicts = ${i.max_open_conflicts}, max_pending_claims = ${i.max_pending_claims},
      max_stale_observations = ${i.max_stale_observations}, min_parameters_c_or_better_pct = ${i.min_parameters_c_or_better_pct},
      updated_at = now(), updated_by = ${userId}`, 'the publication policy (administrators only)'));
}

// ── Tasks ────────────────────────────────────────────────────────────────────
export async function updateTask(form: FormData) {
  return act(form, z.object({ task_id: uuid, status: z.enum(['open', 'in_progress', 'blocked', 'done', 'cancelled']), note: optionalText() }),
    'Task updated.', (sql, i, userId) => mustAffect(sql`
      update intel.research_tasks
         set status = ${i.status},
             assignee = case when ${i.status} = 'in_progress' then ${userId}::uuid else assignee end,
             resolution_note = coalesce(${i.note}, resolution_note),
             completed_at = case when ${i.status} in ('done', 'cancelled') then now() else null end,
             completed_by = case when ${i.status} in ('done', 'cancelled') then ${userId}::uuid else null end
       where id = ${i.task_id}`, 'this task'));
}

export async function createTask(form: FormData) {
  return act(form, z.object({ model_id: z.union([z.literal(''), uuid]).optional(), task_type: z.string().regex(/^[a-z_]+$/), title: text(240).min(5),
    description: optionalText(), priority: z.coerce.number().int().min(1).max(4) }), 'Task created.',
  (sql, i, userId) => sql`insert into intel.research_tasks (business_model_id, task_type, title, description, priority, generated_by, created_by)
                          values (${i.model_id || null}, ${i.task_type}, ${i.title}, ${i.description}, ${i.priority}, 'manual', ${userId})`);
}
