-- PlanB · 0015 · Analyst review actions (stage 9). One function per decision so the dashboard, tests and
-- any future tool share the same rules. All are SECURITY INVOKER: RLS and the guard triggers decide who may call them.

-- Whitespace/case-insensitive check that a quote occurs on a page of a stored document.
create or replace function intel.quote_occurs(p_document uuid, p_page int, p_quote text) returns boolean
language sql stable
as $$
  select exists (
    select 1 from intel.document_pages dp
    where dp.document_id = p_document and dp.page_no = p_page
      and position(lower(btrim(regexp_replace(p_quote, '\s+', ' ', 'g'))) in lower(regexp_replace(dp.text, '\s+', ' ', 'g'))) > 0)
$$;

-- Everything materialised from a claim stops being usable when the claim is rejected or superseded.
create or replace function intel._retire_claim_outputs(p_claim uuid, p_reason text) returns int
language plpgsql
as $$
declare n int := 0; r record;
begin
  for r in select target_table, target_id from intel.evidence_links where claim_id = p_claim loop
    if r.target_table = 'cost_observations' then
      update intel.cost_observations set verification_status = 'rejected',
             analyst_notes = concat_ws(' ', analyst_notes, p_reason) where id = r.target_id and verification_status <> 'rejected';
      n := n + 1;
    elsif r.target_table = 'parameter_observations' then
      update intel.parameter_observations set verification_status = 'rejected',
             analyst_notes = concat_ws(' ', analyst_notes, p_reason) where id = r.target_id and verification_status <> 'rejected';
      n := n + 1;
    elsif r.target_table = 'operating_requirements' then
      update intel.operating_requirements set verification_status = 'rejected' where id = r.target_id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function intel.review_claim(p_claim uuid, p_decision text, p_note text default null)
returns intel.evidence_claims
language plpgsql
as $$
declare v intel.evidence_claims;
begin
  if p_decision not in ('accept', 'reject') then
    raise exception 'decision must be accept or reject' using errcode = '22023';
  end if;
  if p_decision = 'reject' and coalesce(length(btrim(p_note)), 0) = 0 then
    raise exception 'rejecting a claim requires a reason' using errcode = '23514';
  end if;
  update intel.evidence_claims
     set status = case p_decision when 'accept' then 'accepted' else 'rejected' end,
         reviewed_by = ops.current_user_id(), reviewed_at = now(), review_note = p_note
   where id = p_claim and status in ('extracted', 'accepted', 'rejected')
  returning * into v;
  if not found then
    raise exception 'claim % not found, not visible, or already superseded', p_claim using errcode = 'P0002';
  end if;
  if p_decision = 'reject' then
    perform intel._retire_claim_outputs(p_claim, 'Rejected in review: ' || p_note);
  end if;
  insert into intel.research_reviews (subject_type, subject_id, business_model_id, decision, comments, reviewer)
  values ('evidence_claim', p_claim, v.business_model_id, p_decision, p_note, ops.current_user_id());
  return v;
end $$;
comment on function intel.review_claim is 'Accept or reject an extracted claim. Acceptance requires a verified quote (table constraint); rejection retires every observation materialised from the claim.';

-- Correct an extraction: the original stays on record as superseded; a new manual claim replaces it.
create or replace function intel.correct_claim(p_claim uuid, p_value numeric, p_unit_raw text, p_quote text, p_page int,
                                               p_note text, p_quantity numeric default null)
returns intel.evidence_claims
language plpgsql
as $$
declare old intel.evidence_claims; v intel.evidence_claims;
begin
  if coalesce(length(btrim(p_note)), 0) = 0 then
    raise exception 'a correction requires a note explaining what was wrong' using errcode = '23514';
  end if;
  select * into old from intel.evidence_claims where id = p_claim and status in ('extracted', 'accepted') for update;
  if not found then
    raise exception 'claim % not found or not correctable', p_claim using errcode = 'P0002';
  end if;
  insert into intel.evidence_claims (
    source_document_id, page_no, section_ref, quote, quote_verified, quote_match_score, business_model_id, business_variant_id,
    claim_type, subject, attribute, value_numeric, unit_raw, currency, period_raw, quantity, qualifiers, target_kind,
    cost_category_slug, parameter_key, extraction_method, extractor, dedupe_hash, status, reviewed_by, reviewed_at,
    review_note, corrected_from_id, data_origin, created_by)
  values (
    old.source_document_id, p_page, old.section_ref, p_quote, intel.quote_occurs(old.source_document_id, p_page, p_quote),
    null, old.business_model_id, old.business_variant_id, old.claim_type, old.subject, old.attribute, p_value,
    coalesce(p_unit_raw, old.unit_raw), old.currency, old.period_raw, coalesce(p_quantity, old.quantity), old.qualifiers,
    old.target_kind, old.cost_category_slug, old.parameter_key, 'manual', 'analyst_correction',
    encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'), 'extracted', null, null, p_note, old.id,
    old.data_origin, ops.current_user_id())
  returning * into v;
  -- a corrected claim is accepted immediately only when its quote really is on the page
  if v.quote_verified then
    update intel.evidence_claims set status = 'accepted', reviewed_by = ops.current_user_id(), reviewed_at = now() where id = v.id returning * into v;
  end if;
  update intel.evidence_claims set status = 'superseded', review_note = concat_ws(' ', review_note, 'Superseded by correction: ' || p_note)
   where id = old.id;
  perform intel._retire_claim_outputs(old.id, 'Superseded by an analyst correction.');
  insert into intel.research_reviews (subject_type, subject_id, business_model_id, decision, comments, reviewer)
  values ('evidence_claim', old.id, old.business_model_id, 'correct', p_note, ops.current_user_id());
  return v;
end $$;
comment on function intel.correct_claim is 'Replace a wrong extraction with an analyst-entered claim. The corrected value becomes usable only if its quote is found on the cited page; it is structured into the record on the next business_refresh run.';

create or replace function intel.set_observation_status(p_kind text, p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
as $$
declare v_model uuid; v_table text;
begin
  v_table := case p_kind when 'cost' then 'cost_observations' when 'parameter' then 'parameter_observations'
                         when 'market' then 'market_observations' when 'location' then 'location_metrics' end;
  if v_table is null then
    raise exception 'unknown observation kind %', p_kind using errcode = '22023';
  end if;
  if p_status not in ('unverified', 'verified', 'disputed', 'rejected') then
    raise exception 'unknown status %', p_status using errcode = '22023';
  end if;
  execute format(
    'update intel.%I set verification_status = $1,
            verified_by = case when $1 = ''verified'' then ops.current_user_id() else verified_by end,
            verified_at = case when $1 = ''verified'' then now() else verified_at end,
            analyst_notes = case when $2 is null then analyst_notes else concat_ws('' '', analyst_notes, $2) end
      where id = $3', v_table) using p_status, p_note, p_id;
  select business_model_id into v_model from intel.v_observations where id = p_id;
  insert into intel.research_reviews (subject_type, subject_id, business_model_id, decision, comments, reviewer)
  values (case p_kind when 'cost' then 'cost_observation' when 'parameter' then 'parameter_observation'
                      when 'market' then 'market_observation' else 'location_metric' end,
          p_id, v_model, case p_status when 'verified' then 'verify' when 'disputed' then 'dispute'
                                       when 'rejected' then 'reject' else 'accept' end,
          coalesce(p_note, case when p_status in ('disputed', 'rejected') then null end), ops.current_user_id());
end $$;

create or replace function intel.resolve_conflict(p_conflict uuid, p_status text, p_note text) returns void
language plpgsql
as $$
declare v_model uuid;
begin
  if p_status not in ('resolved', 'accepted_as_range') then
    raise exception 'status must be resolved or accepted_as_range' using errcode = '22023';
  end if;
  update intel.observation_conflicts
     set status = p_status, resolution_note = p_note, resolved_by = ops.current_user_id(), resolved_at = now()
   where id = p_conflict and status = 'open';
  if not found then
    raise exception 'conflict % is not open', p_conflict using errcode = 'P0001';
  end if;
  select bv.business_model_id into v_model from intel.observation_conflicts c
    join intel.business_variants bv on bv.id = c.business_variant_id where c.id = p_conflict;
  insert into intel.research_reviews (subject_type, subject_id, business_model_id, decision, comments, reviewer)
  values ('observation_conflict', p_conflict, v_model, 'resolve', p_note, ops.current_user_id());
end $$;

-- Record an explicit analyst value for a model input. Always grade D, always with a rationale, never silent.
create or replace function intel.set_assumption(p_variant uuid, p_parameter_key text, p_revenue_stream uuid, p_value numeric, p_rationale text)
returns intel.financial_parameters
language plpgsql
as $$
declare v intel.financial_parameters; d intel.financial_parameter_definitions;
begin
  select * into d from intel.financial_parameter_definitions where key = p_parameter_key;
  if not found then
    raise exception 'unknown parameter %', p_parameter_key using errcode = 'P0002';
  end if;
  if (d.min_value is not null and p_value < d.min_value) or (d.max_value is not null and p_value > d.max_value) then
    raise exception 'value % is outside the allowed range for %', p_value, p_parameter_key using errcode = '22003';
  end if;
  update intel.financial_parameters set is_current = false, superseded_at = now()
   where business_variant_id = p_variant and is_current and scenario = 'base' and location_id is null
     and parameter_key = p_parameter_key and revenue_stream_id is not distinct from p_revenue_stream;
  insert into intel.financial_parameters (business_variant_id, scenario, parameter_key, revenue_stream_id, value, unit_code, basis,
                                          method, rationale, evidence_grade, location_level, set_by,
                                          data_origin)
  values (p_variant, 'base', p_parameter_key, p_revenue_stream, p_value, d.unit_code, 'assumption', 'manual', p_rationale, 'D',
          'assumed', ops.current_user_id(), (select data_origin from intel.business_variants where id = p_variant))
  returning * into v;
  return v;
end $$;
comment on function intel.set_assumption is 'Analyst override of a model input. Stored as basis = assumption, grade D, with the analyst and rationale recorded; the pipeline never overwrites it.';

revoke execute on all functions in schema intel from public;
grant execute on all functions in schema intel to authenticated, planb_worker;
revoke execute on function intel.review_claim(uuid, text, text), intel.correct_claim(uuid, numeric, text, text, int, text, numeric),
  intel.set_observation_status(text, uuid, text, text), intel.resolve_conflict(uuid, text, text),
  intel.set_assumption(uuid, text, uuid, numeric, text) from planb_worker;
