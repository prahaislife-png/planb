-- PlanB · 0018 · Human-only decisions and Ground Truth privacy rules, enforced in the database.
--
-- These rules were being applied by the dashboard's server actions. A rule that protects evidence or people
-- must hold for every write path, so each becomes a trigger here.

-- ── 1. Marking primary research as verified/reviewed is a reviewer or admin act, never the worker's ──
create or replace function ops.guard_reviewer_only() returns trigger
language plpgsql as $$
declare
  v_column text := tg_argv[0];
  v_value text := tg_argv[1];
  v_new text := to_jsonb(new) ->> v_column;
  v_old text := case when tg_op = 'UPDATE' then to_jsonb(old) ->> v_column end;
begin
  if v_new = v_value and v_old is distinct from v_value then
    if ops.is_worker() then
      raise exception 'automated workers cannot mark % as %', tg_table_name, v_value using errcode = '42501';
    end if;
    if ops.current_user_id() is not null and not ops.has_role('admin', 'reviewer') then
      raise exception 'only a reviewer or admin can mark % as %', tg_table_name, v_value using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger supplier_quotes_reviewer_only before insert or update on intel.supplier_quotes
  for each row execute function ops.guard_reviewer_only('status', 'verified');
create trigger regulations_reviewer_only before insert or update on intel.regulations
  for each row execute function ops.guard_reviewer_only('verification_status', 'verified');
create trigger business_regulations_reviewer_only before insert or update on intel.business_regulations
  for each row execute function ops.guard_reviewer_only('verification_status', 'verified');
create trigger government_schemes_reviewer_only before insert or update on intel.government_schemes
  for each row execute function ops.guard_reviewer_only('verification_status', 'verified');
create trigger business_scheme_eligibility_reviewer_only before insert or update on intel.business_scheme_eligibility
  for each row execute function ops.guard_reviewer_only('verification_status', 'verified');
create trigger owner_interviews_reviewer_only before insert or update on gt.owner_interviews
  for each row execute function ops.guard_reviewer_only('status', 'reviewed');
create trigger business_actuals_reviewer_only before insert or update on gt.business_actuals
  for each row execute function ops.guard_reviewer_only('verification_status', 'verified');

-- ── 2. An interview is located at district level or coarser, so it cannot identify the owner ──
create or replace function gt.guard_interview_location() returns trigger
language plpgsql as $$
begin
  if new.location_id is not null and exists (
       select 1 from intel.locations l where l.id = new.location_id and l.location_type in ('city', 'locality')) then
    raise exception 'an interview must be located at district level or coarser to stay de-identified' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger owner_interviews_location before insert or update of location_id on gt.owner_interviews
  for each row execute function gt.guard_interview_location();

-- ── 3. Nothing an owner said is recorded without an active consent on the interview ──
create or replace function gt.guard_consented_interview() returns trigger
language plpgsql as $$
begin
  if not exists (
       select 1 from gt.owner_interviews i join gt.consents c on c.id = i.consent_id
       where i.id = new.interview_id and c.withdrawn_on is null) then
    raise exception 'answers and actuals can only be recorded for an interview with an active consent' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger interview_responses_consent before insert or update on gt.interview_responses
  for each row execute function gt.guard_consented_interview();
create trigger business_actuals_consent before insert on gt.business_actuals
  for each row execute function gt.guard_consented_interview();

-- ── 4. One actual per questionnaire answer, by key rather than by a text marker ──
alter table gt.business_actuals add column question_id uuid references gt.questionnaire_questions (id);
comment on column gt.business_actuals.question_id is 'The questionnaire question this figure was captured from, when it came from a structured answer. NULL for separately recorded actuals.';
create unique index business_actuals_one_per_answer_idx on gt.business_actuals (interview_id, question_id) where question_id is not null;

revoke execute on all functions in schema ops, gt from public;
