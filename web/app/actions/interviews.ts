'use server';

import { z } from 'zod';
import { act, checkbox, optionalDate, optionalNumber, optionalText, optionalUuid, text, uuid } from '@/lib/action';
import type { Sql } from '@/lib/db';

/**
 * PlanB Ground Truth: interview subjects (personal data), consents, de-identified interviews, answers and actuals.
 * Row-level security decides who may see or write a subject; the CHECK constraints decide when an interview may
 * move on (consent before "conducted", anonymisation before "reviewed") and how an actual may be graded.
 */

const today = () => new Date().toISOString().slice(0, 10);
const optionalEmail = z.union([z.literal(''), z.string().trim().email().max(200)]).optional().transform((v) => (v ? v : null));
const optionalYear = optionalNumber.refine((v) => v === null || (Number.isInteger(v) && v >= 1950 && v <= 2100), 'must be a year between 1950 and 2100');
const COARSE_LEVELS = ['country', 'state', 'division', 'district'];
const ACTUAL_PERIODS = ['one_time', 'per_day', 'per_month', 'per_year', 'point_in_time'];

const RULES: Record<string, string> = {
  owner_interviews_check: 'The end year cannot be before the start year.',
  owner_interviews_check1: 'An interview cannot be recorded as conducted (or any later stage) without a consent on file. Record the consent and attach it first.',
  owner_interviews_check2: 'An interview cannot be marked reviewed until it is anonymised (or anonymisation is recorded as not required).',
  consents_check: 'A consent cannot be withdrawn before it was given.',
  business_actuals_check: 'An actual needs a value, or both a low and a high value.',
  business_actuals_check1: 'A documented actual must point at its supporting document.',
  business_actuals_check2: 'A self-reported figure can only be grade C or D — never A or B.',
  business_actuals_check3: 'Grade A is only allowed on a verified actual.',
  business_actuals_check4: 'Demo data must stay grade D and unverified.',
};
async function readable<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const e = error as { constraint_name?: string; code?: string; table_name?: string; message?: string };
    if (e.constraint_name && RULES[e.constraint_name]) throw new Error(`${RULES[e.constraint_name]} [database rule ${e.constraint_name}]`);
    if (e.code === '42501' && /interview_subjects|consents/.test(`${e.table_name ?? ''} ${e.message ?? ''}`)) {
      throw new Error('Not permitted: only a researcher or admin can record interview subjects and consents, and only for subjects they are assigned to. [row-level security]');
    }
    throw error;
  }
}

// ── Subjects and consent (personal data) ─────────────────────────────────────
export async function addSubject(form: FormData) {
  return act(form, z.object({
    full_name: text(200).min(2), business_name: optionalText(200), phone: optionalText(40), email: optionalEmail, referral_source: optionalText(300),
  }), 'Subject recorded. Visible only to you (as assigned interviewer) and to admins.', (sql, i, userId) => readable(async () => {
    // created_by and assigned_interviewer must both be the acting user: the insert policy requires it, and it keeps the identity readable to them.
    await sql`insert into gt.interview_subjects (full_name, business_name, phone, email, referral_source, assigned_interviewer, created_by)
              values (${i.full_name}, ${i.business_name}, ${i.phone}, ${i.email}, ${i.referral_source}, ${userId}, ${userId})`;
  }));
}

export async function recordConsent(form: FormData) {
  return act(form, z.object({
    subject_id: uuid, consent_form_version: text(40).min(1), allows_aggregate_use: checkbox, allows_anonymised_quotes: checkbox,
    allows_document_retention: checkbox, allows_recontact: checkbox,
    given_on: z.string().date().refine((v) => v <= today(), 'cannot be in the future'),
    collection_method: z.enum(['signed_form', 'recorded_verbal', 'email', 'digital_form']),
  }), (r) => String(r), (sql, i, userId) => readable(async () => {
    const [subject] = await sql`select id, erased_at from gt.interview_subjects where id = ${i.subject_id}`;
    if (!subject) throw new Error('Subject not found, or not visible to you.');
    if (subject.erased_at) throw new Error('This subject has been erased; no new consent can be recorded.');
    await sql`insert into gt.consents (subject_id, consent_form_version, allows_aggregate_use, allows_anonymised_quotes, allows_document_retention,
                                       allows_recontact, given_on, collection_method, recorded_by)
              values (${i.subject_id}, ${i.consent_form_version}, ${i.allows_aggregate_use}, ${i.allows_anonymised_quotes}, ${i.allows_document_retention},
                      ${i.allows_recontact}, ${i.given_on}, ${i.collection_method}, ${userId})`;
    return i.allows_aggregate_use
      ? 'Consent recorded.'
      : 'Consent recorded WITHOUT aggregate use: this interview can be conducted but will never enter the aggregates.';
  }));
}

/** A consent may be attached to an interview only if it belongs to the interview's subject and is still active. */
async function assertConsent(sql: Sql, consentId: string, subjectId: string | null) {
  const [consent] = await sql`select subject_id, withdrawn_on from gt.consents where id = ${consentId}`;
  if (!consent) throw new Error('Consent not found, or not visible to you.');
  if (consent.subject_id !== subjectId) throw new Error('That consent was given by a different subject.');
  if (consent.withdrawn_on) throw new Error('That consent was withdrawn and cannot be used.');
}

// ── Interviews ───────────────────────────────────────────────────────────────
export async function planInterview(form: FormData) {
  return act(form, z.object({
    subject_id: uuid, consent_id: optionalUuid, business_model_id: uuid, location_id: uuid, questionnaire_id: uuid,
    business_status: z.enum(['operating', 'closed', 'sold', 'paused']),
    started_year: optionalYear, ended_year: optionalYear, years_operated: optionalNumber.refine((v) => v === null || v >= 0, 'cannot be negative'),
    interview_date: optionalDate,
    interview_mode: z.union([z.literal(''), z.enum(['in_person', 'phone', 'video', 'written'])]).optional().transform((v) => (v ? v : null)),
  }).superRefine((v, ctx) => {
    if (v.started_year !== null && v.ended_year !== null && v.ended_year < v.started_year) ctx.addIssue({ code: 'custom', path: ['ended_year'], message: 'cannot be before the start year' });
  }), 'Interview planned. Attach a consent before recording it as conducted.', (sql, i, userId) => readable(async () => {
    const [subject] = await sql`select id, erased_at from gt.interview_subjects where id = ${i.subject_id}`;
    if (!subject) throw new Error('Subject not found, or not visible to you.');
    if (subject.erased_at) throw new Error('This subject has been erased.');
    if (i.consent_id) await assertConsent(sql, i.consent_id, i.subject_id);
    const [loc] = await sql`select name, location_type from intel.locations where id = ${i.location_id}`;
    if (!loc) throw new Error('Unknown location.');
    if (!COARSE_LEVELS.includes(loc.location_type)) {
      throw new Error(`${loc.name} is a ${loc.location_type}: an interview is located at district level or coarser so the owner cannot be identified.`);
    }
    const [questionnaire] = await sql`select title, audience, is_active from gt.questionnaires where id = ${i.questionnaire_id}`;
    if (!questionnaire || !questionnaire.is_active) throw new Error('Unknown or inactive questionnaire.');
    const former = i.business_status === 'closed' || i.business_status === 'sold';
    if ((former && questionnaire.audience !== 'former_owner') || (i.business_status === 'operating' && questionnaire.audience !== 'operating_owner')) {
      throw new Error(`“${questionnaire.title}” is not the instrument for a business that is ${i.business_status}.`);
    }
    await sql`insert into gt.owner_interviews (subject_id, consent_id, business_model_id, location_id, questionnaire_id, business_status, started_year,
                                               ended_year, years_operated, interview_date, interview_mode, interviewer, created_by)
              values (${i.subject_id}, ${i.consent_id}, ${i.business_model_id}, ${i.location_id}, ${i.questionnaire_id}, ${i.business_status},
                      ${i.started_year}, ${i.ended_year}, ${i.years_operated}, ${i.interview_date}, ${i.interview_mode}, ${userId}, ${userId})`;
  }));
}

export async function updateInterviewStatus(form: FormData) {
  return act(form, z.object({
    interview_id: uuid, status: z.enum(['planned', 'scheduled', 'conducted', 'transcribed', 'coded', 'reviewed', 'withdrawn']),
    anonymisation_status: z.enum(['pending', 'anonymised', 'not_required']), consent_id: optionalUuid,
  }), 'Interview updated.', (sql, i, userId) => readable(async () => {
    const [interview] = await sql`select id, subject_id, status from gt.owner_interviews where id = ${i.interview_id}`;
    if (!interview) throw new Error('Interview not found.');
    if (i.status === 'reviewed' && interview.status !== 'reviewed') {
      const [role] = await sql`select ops.has_role('admin', 'reviewer') as ok`;
      if (!role?.ok) throw new Error('Only a reviewer or admin can mark an interview reviewed.');
    }
    if (i.consent_id) await assertConsent(sql, i.consent_id, interview.subject_id);
    const reviewedNow = i.status === 'reviewed' && interview.status !== 'reviewed';
    // The database decides whether the move is allowed (consent before conducted, anonymisation before reviewed).
    await sql`
      update gt.owner_interviews
         set status = ${i.status}, anonymisation_status = ${i.anonymisation_status}, consent_id = coalesce(${i.consent_id}, consent_id),
             reviewed_by = case when ${reviewedNow} then ${userId}::uuid else reviewed_by end,
             reviewed_at = case when ${reviewedNow} then now() else reviewed_at end
       where id = ${i.interview_id}`;
  }));
}

// ── Answers and actuals ──────────────────────────────────────────────────────
function parseNumber(raw: unknown, label: string): number | null {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`${label}: "${s.slice(0, 40)}" is not a number.`);
  return n;
}

async function consentedInterview(sql: Sql, interviewId: string) {
  const [interview] = await sql`select id, questionnaire_id, consent_id, status, data_origin from gt.owner_interviews where id = ${interviewId}`;
  if (!interview) throw new Error('Interview not found.');
  if (interview.status === 'withdrawn') throw new Error('This interview was withdrawn; nothing more may be recorded against it.');
  if (!interview.consent_id) throw new Error('No consent is attached to this interview. Record the consent and attach it before capturing any answer.');
  return interview;
}

export async function saveResponses(form: FormData) {
  return act(form, z.object({ interview_id: uuid }).passthrough(), (r) => String(r), (sql, i) => readable(async () => {
    const interview = await consentedInterview(sql, i.interview_id);
    if (!interview.questionnaire_id) throw new Error('This interview has no questionnaire.');
    const questions = await sql`
      select q.id, q.key, q.prompt, q.answer_type, q.metric_key, q.choices, d.unit_code as metric_unit, d.period as metric_period
      from gt.questionnaire_questions q left join intel.metric_definitions d on d.key = q.metric_key
      where q.questionnaire_id = ${interview.questionnaire_id} order by q.sequence_no`;
    const field = (prefix: string, id: string) => (i as Record<string, unknown>)[`${prefix}_${id}`];
    let saved = 0;
    let actuals = 0;
    for (const q of questions) {
      const label = `“${q.key}”`;
      const note = String(field('note', q.id) ?? '').trim().slice(0, 2000) || null;
      let answerText: string | null = null;
      let numeric: number | null = null;
      let low: number | null = null;
      let high: number | null = null;
      if (String(q.answer_type).endsWith('_range')) {
        low = parseNumber(field('low', q.id), `${label} low`);
        high = parseNumber(field('high', q.id), `${label} high`);
        if ((low === null) !== (high === null)) throw new Error(`${label}: a range needs both a low and a high value.`);
        if (low !== null && high !== null && low > high) throw new Error(`${label}: the low value is above the high value.`);
      } else if (['money', 'number', 'percent', 'duration_months'].includes(q.answer_type)) {
        numeric = parseNumber(field('num', q.id), label);
      } else {
        answerText = String(field('txt', q.id) ?? '').trim().slice(0, 8000) || null;
        if (answerText && q.answer_type === 'boolean' && !['yes', 'no'].includes(answerText)) throw new Error(`${label}: answer yes or no.`);
        if (answerText && q.answer_type === 'choice' && q.choices?.length && !q.choices.includes(answerText)) throw new Error(`${label}: not one of the listed choices.`);
      }
      if (answerText === null && numeric === null && low === null && note === null) continue; // unanswered: leave whatever is stored
      const unit = q.answer_type.startsWith('money') ? 'inr' : q.answer_type === 'percent' ? 'percent' : q.answer_type === 'duration_months' ? 'month' : q.metric_unit ?? null;
      await sql`
        insert into gt.interview_responses (interview_id, question_id, answer_text, answer_numeric, answer_low, answer_high, unit_code, analyst_note)
        values (${interview.id}, ${q.id}, ${answerText}, ${numeric}, ${low}, ${high}, ${numeric === null && low === null ? null : unit}, ${note})
        on conflict (interview_id, question_id) do update
          set answer_text = excluded.answer_text, answer_numeric = excluded.answer_numeric, answer_low = excluded.answer_low,
              answer_high = excluded.answer_high, unit_code = excluded.unit_code, analyst_note = excluded.analyst_note`;
      saved += 1;
      if (q.metric_key && (numeric !== null || low !== null)) {
        // What an owner says in an interview is self-reported: grade C at best (D for demo data). One such row per question.
        const marker = `Questionnaire answer "${q.key}" (self-reported in interview)`;
        const [existing] = await sql`
          select id from gt.business_actuals
          where interview_id = ${interview.id} and metric_key = ${q.metric_key} and evidence_level = 'self_reported' and analyst_notes = ${marker}
          order by created_at limit 1`;
        if (existing) {
          await sql`
            update gt.business_actuals
               set value = ${numeric}, value_low = ${low}, value_high = ${high}, verification_status = 'unverified', verified_by = null
             where id = ${existing.id} and (value, value_low, value_high) is distinct from (${numeric}::numeric, ${low}::numeric, ${high}::numeric)`;
        } else {
          await sql`
            insert into gt.business_actuals (interview_id, metric_key, value, value_low, value_high, unit_code, period, evidence_level, evidence_grade,
                                             analyst_notes, data_origin)
            values (${interview.id}, ${q.metric_key}, ${numeric}, ${low}, ${high}, ${q.metric_unit}, ${ACTUAL_PERIODS.includes(q.metric_period) ? q.metric_period : null},
                    'self_reported', ${interview.data_origin === 'demo' ? 'D' : 'C'}, ${marker}, ${interview.data_origin})`;
        }
        actuals += 1;
      }
    }
    if (saved === 0) throw new Error('Nothing to save: no answer or note was entered.');
    return `${saved} answer${saved === 1 ? '' : 's'} saved; ${actuals} recorded as self-reported actual${actuals === 1 ? '' : 's'} (grade C).`;
  }));
}

export async function addActual(form: FormData) {
  return act(form, z.object({
    interview_id: uuid, metric_key: z.string().regex(/^[a-z0-9_]+$/), value: optionalNumber, value_low: optionalNumber, value_high: optionalNumber,
    reference_year: optionalYear, evidence_level: z.enum(['documented', 'self_reported']), supporting_document_path: optionalText(500),
    evidence_grade: z.enum(['A', 'B', 'C', 'D']), analyst_notes: optionalText(),
  }).superRefine((v, ctx) => {
    if (v.value === null && (v.value_low === null || v.value_high === null)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'enter a value, or both a low and a high value' });
    if (v.value_low !== null && v.value_high !== null && v.value_low > v.value_high) ctx.addIssue({ code: 'custom', path: ['value_low'], message: 'low is above high' });
    if (v.evidence_level === 'documented' && !v.supporting_document_path) ctx.addIssue({ code: 'custom', path: ['supporting_document_path'], message: 'a documented actual must point at its supporting document' });
    if (v.evidence_level === 'self_reported' && v.supporting_document_path) ctx.addIssue({ code: 'custom', path: ['supporting_document_path'], message: 'a figure with a supporting document is "documented", not self-reported' });
    if (v.evidence_level === 'self_reported' && !['C', 'D'].includes(v.evidence_grade)) ctx.addIssue({ code: 'custom', path: ['evidence_grade'], message: 'a self-reported figure can only be grade C or D' });
    if (v.evidence_grade === 'A') ctx.addIssue({ code: 'custom', path: ['evidence_grade'], message: 'grade A requires a verified actual; a new entry is always unverified' });
  }), 'Actual recorded (unverified).', (sql, i) => readable(async () => {
    const interview = await consentedInterview(sql, i.interview_id);
    const [def] = await sql`select key, unit_code, period from intel.metric_definitions where key = ${i.metric_key} and applies_to = 'actuals'`;
    if (!def) throw new Error(`"${i.metric_key}" is not an actuals metric.`);
    await sql`
      insert into gt.business_actuals (interview_id, metric_key, value, value_low, value_high, unit_code, period, reference_year, evidence_level,
                                       supporting_document_path, evidence_grade, analyst_notes, data_origin)
      values (${interview.id}, ${def.key}, ${i.value}, ${i.value_low}, ${i.value_high}, ${def.unit_code}, ${ACTUAL_PERIODS.includes(def.period) ? def.period : null},
              ${i.reference_year}, ${i.evidence_level}, ${i.supporting_document_path}, ${i.evidence_grade}, ${i.analyst_notes}, ${interview.data_origin})`;
  }));
}
