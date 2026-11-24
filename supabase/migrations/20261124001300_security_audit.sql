-- PlanB · 0013 · Row-level security, grants and audit triggers.
--
-- Access model
--   anon           : pub.catalog only.
--   authenticated  : customers → their own customer.* rows + pub.catalog.
--                    staff     → research data according to role (ops.staff_roles).
--   planb_worker   : research + ops tables (no customer data, no interview PII).
--   service_role   : never used by application code paths that serve customers.
-- RLS is enabled on EVERY table in intel, gt, pub, customer and ops; a table with no policy is closed.

-- ── Enable RLS everywhere ────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select schemaname, tablename from pg_tables where schemaname in ('intel', 'gt', 'pub', 'customer', 'ops')
  loop
    execute format('alter table %I.%I enable row level security', r.schemaname, r.tablename);
  end loop;
end $$;

-- ── intel: research records ──────────────────────────────────────────────────
-- Default for every intel table: staff read; researcher/reviewer/admin insert+update; admin delete;
-- worker read/insert/update (no delete). Tighter rules for specific tables follow.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'intel'
  loop
    execute format('grant select, insert, update, delete on intel.%I to authenticated', r.tablename);
    execute format('grant select, insert, update on intel.%I to planb_worker', r.tablename);
    execute format('create policy staff_read on intel.%I for select to authenticated using (ops.is_staff())', r.tablename);
    execute format('create policy staff_insert on intel.%I for insert to authenticated with check (ops.has_role(''admin'', ''researcher'', ''reviewer''))', r.tablename);
    execute format('create policy staff_update on intel.%I for update to authenticated using (ops.has_role(''admin'', ''researcher'', ''reviewer'')) with check (ops.has_role(''admin'', ''researcher'', ''reviewer''))', r.tablename);
    execute format('create policy admin_delete on intel.%I for delete to authenticated using (ops.has_role(''admin''))', r.tablename);
    execute format('create policy worker_read on intel.%I for select to planb_worker using (true)', r.tablename);
    execute format('create policy worker_insert on intel.%I for insert to planb_worker with check (true)', r.tablename);
    execute format('create policy worker_update on intel.%I for update to planb_worker using (true) with check (true)', r.tablename);
  end loop;
end $$;
grant select on all tables in schema intel to authenticated, planb_worker; -- includes views

-- Evidence is never deleted through the application: no role may delete observations, claims or reviews.
do $$
declare t text;
begin
  foreach t in array array['cost_observations', 'parameter_observations', 'market_observations', 'location_metrics',
                           'evidence_claims', 'research_reviews', 'business_versions', 'source_documents']
  loop
    execute format('drop policy admin_delete on intel.%I', t);
    execute format('revoke delete on intel.%I from authenticated', t);
  end loop;
end $$;

-- Only reviewers/admins may record a decision on a business version; workers may only submit.
drop policy staff_update on intel.business_versions;
create policy reviewer_decide on intel.business_versions for update to authenticated
  using (ops.has_role('admin', 'reviewer')) with check (ops.has_role('admin', 'reviewer'));
drop policy worker_update on intel.business_versions;
drop policy staff_insert on intel.business_versions;
create policy researcher_submit on intel.business_versions for insert to authenticated
  with check (ops.has_role('admin', 'researcher'));

-- Verification is a reviewer act: researchers may add observations but only reviewers/admins may
-- move one to verified (enforced by trigger so it holds on every observation table and write path).
create or replace function intel.guard_verification_role() returns trigger
language plpgsql as $$
begin
  if new.verification_status = 'verified'
     and (tg_op = 'INSERT' or old.verification_status is distinct from 'verified')
     and ops.current_user_id() is not null
     and not ops.has_role('admin', 'reviewer') then
    raise exception 'only a reviewer or admin can mark evidence as verified' using errcode = '42501';
  end if;
  if new.verification_status = 'verified' and ops.is_worker() then
    raise exception 'automated workers cannot mark evidence as verified' using errcode = '42501';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['cost_observations', 'parameter_observations', 'market_observations', 'location_metrics']
  loop
    execute format('create trigger %I before insert or update on intel.%I for each row execute function intel.guard_verification_role()', t || '_verify_role', t);
  end loop;
end $$;

-- A claim can only be accepted/rejected by a human reviewer (never by the worker that extracted it).
create or replace function intel.guard_claim_review() returns trigger
language plpgsql as $$
begin
  if new.status in ('accepted', 'rejected') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if ops.is_worker() then
      raise exception 'automated workers cannot accept or reject claims' using errcode = '42501';
    end if;
    if ops.current_user_id() is not null and not ops.has_role('admin', 'reviewer', 'researcher') then
      raise exception 'not permitted to review claims' using errcode = '42501';
    end if;
    if new.data_origin = 'research' and new.reviewed_by is null then
      raise exception 'a reviewed claim must record reviewed_by' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger evidence_claims_review_guard before insert or update on intel.evidence_claims
  for each row execute function intel.guard_claim_review();

-- ── gt: Ground Truth ─────────────────────────────────────────────────────────
grant select, insert, update, delete on all tables in schema gt to authenticated;
grant select on gt.questionnaires, gt.questionnaire_questions to planb_worker;

create policy staff_read on gt.questionnaires for select to authenticated using (ops.is_staff());
create policy admin_write on gt.questionnaires for all to authenticated using (ops.has_role('admin')) with check (ops.has_role('admin'));
create policy staff_read on gt.questionnaire_questions for select to authenticated using (ops.is_staff());
create policy admin_write on gt.questionnaire_questions for all to authenticated using (ops.has_role('admin')) with check (ops.has_role('admin'));
create policy worker_read on gt.questionnaires for select to planb_worker using (true);
create policy worker_read on gt.questionnaire_questions for select to planb_worker using (true);

-- PII: admins, plus the interviewer assigned to (or who created) the subject. Nobody else — not even other staff.
create policy pii_read on gt.interview_subjects for select to authenticated
  using (ops.has_role('admin') or (ops.is_staff() and (assigned_interviewer = ops.current_user_id() or created_by = ops.current_user_id())));
create policy pii_insert on gt.interview_subjects for insert to authenticated
  with check (ops.has_role('admin', 'researcher') and created_by = ops.current_user_id());
create policy pii_update on gt.interview_subjects for update to authenticated
  using (ops.has_role('admin') or (ops.is_staff() and (assigned_interviewer = ops.current_user_id() or created_by = ops.current_user_id())))
  with check (ops.has_role('admin') or (ops.is_staff() and (assigned_interviewer = ops.current_user_id() or created_by = ops.current_user_id())));
create policy pii_delete on gt.interview_subjects for delete to authenticated using (ops.has_role('admin'));

create policy consent_read on gt.consents for select to authenticated
  using (ops.has_role('admin') or exists (select 1 from gt.interview_subjects s where s.id = subject_id));
create policy consent_write on gt.consents for insert to authenticated
  with check (ops.has_role('admin', 'researcher') and exists (select 1 from gt.interview_subjects s where s.id = subject_id));
create policy consent_update on gt.consents for update to authenticated
  using (ops.has_role('admin') or exists (select 1 from gt.interview_subjects s where s.id = subject_id))
  with check (ops.has_role('admin') or exists (select 1 from gt.interview_subjects s where s.id = subject_id));

-- De-identified interview content: all staff may read; researchers write; reviewers review.
do $$
declare t text;
begin
  foreach t in array array['owner_interviews', 'interview_responses', 'business_actuals']
  loop
    execute format('create policy staff_read on gt.%I for select to authenticated using (ops.is_staff())', t);
    execute format('create policy staff_insert on gt.%I for insert to authenticated with check (ops.has_role(''admin'', ''researcher''))', t);
    execute format('create policy staff_update on gt.%I for update to authenticated using (ops.has_role(''admin'', ''researcher'', ''reviewer'')) with check (ops.has_role(''admin'', ''researcher'', ''reviewer''))', t);
    execute format('create policy admin_delete on gt.%I for delete to authenticated using (ops.has_role(''admin''))', t);
  end loop;
end $$;
revoke all on gt.v_actuals_aggregate from public;
grant select on gt.v_actuals_aggregate to authenticated;

-- Erase an interviewee's identity on request / consent withdrawal, keeping de-identified research if consent allowed it.
create or replace function gt.erase_subject(p_subject uuid) returns void
language plpgsql security definer set search_path = gt, pg_temp
as $$
begin
  if not ops.has_role('admin') then
    raise exception 'only an admin can erase an interview subject' using errcode = '42501';
  end if;
  update gt.owner_interviews set status = 'withdrawn', transcript_storage_path = null
   where subject_id = p_subject
     and consent_id in (select id from gt.consents where subject_id = p_subject and (withdrawn_on is not null or not allows_aggregate_use));
  update gt.interview_subjects
     set full_name = '[erased]', business_name = null, phone = null, email = null, address = null,
         referral_source = null, erased_at = now()
   where id = p_subject;
end $$;
revoke all on function gt.erase_subject(uuid) from public;
grant execute on function gt.erase_subject(uuid) to authenticated;

-- ── pub: publications ────────────────────────────────────────────────────────
grant select, insert, update on pub.publication_versions to authenticated;
create policy staff_read on pub.publication_versions for select to authenticated using (ops.is_staff());
create policy admin_publish on pub.publication_versions for insert to authenticated with check (ops.has_role('admin'));
create policy admin_update on pub.publication_versions for update to authenticated
  using (ops.has_role('admin')) with check (ops.has_role('admin'));
grant select on pub.catalog to anon, authenticated;

-- ── customer: personal data, owner-only ──────────────────────────────────────
grant select, insert, update, delete on customer.user_profiles, customer.profile_documents, customer.user_capabilities,
  customer.user_assets, customer.saved_businesses to authenticated;
grant select on customer.recommendations, customer.pricing_plans to authenticated;
grant select on customer.pricing_plans to anon;
do $$
declare t text;
begin
  foreach t in array array['user_profiles', 'profile_documents', 'user_capabilities', 'user_assets', 'saved_businesses']
  loop
    execute format('create policy owner_all on customer.%I for all to authenticated using (user_id = ops.current_user_id()) with check (user_id = ops.current_user_id())', t);
  end loop;
end $$;
create policy owner_read on customer.recommendations for select to authenticated using (user_id = ops.current_user_id());
create policy public_read on customer.pricing_plans for select to anon, authenticated using (is_active or ops.is_staff());
create policy admin_write on customer.pricing_plans for all to authenticated using (ops.has_role('admin')) with check (ops.has_role('admin'));
grant insert, update, delete on customer.pricing_plans to authenticated;

-- ── ops ──────────────────────────────────────────────────────────────────────
grant select on all tables in schema ops to authenticated;
grant insert, update on ops.research_runs to authenticated;
grant insert, update, delete on ops.staff_members, ops.staff_roles to authenticated;
grant update on ops.publication_policy to authenticated;
grant select, insert, update on ops.research_runs, ops.research_run_steps to planb_worker;
grant select, insert on ops.research_run_logs, ops.llm_usage, ops.ingestion_log to planb_worker;
grant select on ops.publication_policy to planb_worker;

create policy staff_read on ops.staff_members for select to authenticated using (ops.is_staff() or user_id = ops.current_user_id());
create policy admin_write on ops.staff_members for all to authenticated using (ops.has_role('admin')) with check (ops.has_role('admin'));
create policy staff_read on ops.staff_roles for select to authenticated using (ops.is_staff() or user_id = ops.current_user_id());
create policy admin_write on ops.staff_roles for all to authenticated using (ops.has_role('admin')) with check (ops.has_role('admin'));
create policy staff_read on ops.audit_log for select to authenticated using (ops.has_role('admin', 'reviewer'));
create policy staff_read on ops.publication_policy for select to authenticated using (ops.is_staff());
create policy admin_update on ops.publication_policy for update to authenticated using (ops.has_role('admin')) with check (ops.has_role('admin'));
create policy worker_read on ops.publication_policy for select to planb_worker using (true);

do $$
declare t text;
begin
  foreach t in array array['research_runs', 'research_run_steps', 'research_run_logs', 'llm_usage', 'ingestion_log']
  loop
    execute format('create policy staff_read on ops.%I for select to authenticated using (ops.is_staff())', t);
    execute format('create policy worker_read on ops.%I for select to planb_worker using (true)', t);
    execute format('create policy worker_insert on ops.%I for insert to planb_worker with check (true)', t);
  end loop;
end $$;
create policy worker_update on ops.research_runs for update to planb_worker using (true) with check (true);
create policy worker_update on ops.research_run_steps for update to planb_worker using (true) with check (true);
-- Staff may enqueue and cancel runs; they do not execute them.
create policy staff_enqueue on ops.research_runs for insert to authenticated
  with check (ops.has_role('admin', 'researcher') and status = 'queued');
create policy staff_cancel on ops.research_runs for update to authenticated
  using (ops.has_role('admin', 'researcher')) with check (ops.has_role('admin', 'researcher') and status in ('queued', 'cancelled'));

-- Functions are not callable by default: PostgreSQL grants EXECUTE to PUBLIC on creation, so take that away
-- and grant per role. (Trigger functions fire regardless; RLS helper functions were granted in 0001.)
revoke execute on all functions in schema intel, pub, ops, gt, customer from public;
grant execute on function ops.has_role(text[]), ops.is_staff(), ops.is_worker(), ops.current_user_id() to anon, authenticated, planb_worker;
grant execute on function customer.erase_user_data(uuid), gt.erase_subject(uuid) to authenticated;
grant execute on all functions in schema intel, pub, ops to authenticated;
grant execute on all functions in schema intel, ops to planb_worker;
grant execute on function pub.publication_blockers(uuid) to planb_worker;
grant usage on all sequences in schema ops to planb_worker;
revoke execute on function intel.decide_business_version(uuid, text, text) from planb_worker;

-- ── Audit triggers ───────────────────────────────────────────────────────────
-- Everything that carries research meaning or personal data is audited. High-volume machine tables
-- (document text, chunks, run logs, ingestion log, llm usage) are excluded: they are already append-only logs.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename from pg_tables
    where schemaname in ('intel', 'gt', 'pub', 'customer')
       or (schemaname = 'ops' and tablename in ('staff_members', 'staff_roles', 'publication_policy', 'research_runs'))
  loop
    if r.tablename in ('document_pages', 'document_chunks') then
      continue;
    end if;
    execute format('create trigger zz_audit after insert or update or delete on %I.%I for each row execute function ops.audit_row(%s)',
                   r.schemaname, r.tablename,
                   case when r.schemaname = 'customer' or (r.schemaname = 'gt' and r.tablename in ('interview_subjects', 'consents'))
                        then quote_literal('redact') else '' end);
  end loop;
end $$;
