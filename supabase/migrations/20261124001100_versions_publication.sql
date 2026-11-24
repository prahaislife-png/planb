-- PlanB · 0011 · Business record versions, human approval, and the publication gate.
--
--   researcher / pipeline ──submit──▶ business_versions(submitted) ──reviewer──▶ approved ──admin──▶ pub.publication_versions
--
-- Invariants enforced by triggers (so they hold for ANY write path, not just these functions):
--   * a version's snapshot is frozen at submission;
--   * the person who submitted a version cannot approve it (four-eyes);
--   * only an approved version can be published, only if it meets ops.publication_policy,
--     and never if any demo/test data is involved.

create table ops.publication_policy (
  singleton boolean primary key default true check (singleton),
  min_completeness_pct numeric not null default 75 check (min_completeness_pct between 0 and 100),
  max_critical_missing int not null default 0 check (max_critical_missing >= 0),
  max_open_conflicts int not null default 0 check (max_open_conflicts >= 0),
  max_pending_claims int not null default 0 check (max_pending_claims >= 0),
  max_stale_observations int not null default 0 check (max_stale_observations >= 0),
  min_parameters_c_or_better_pct numeric not null default 70 check (min_parameters_c_or_better_pct between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
comment on table ops.publication_policy is 'Quality thresholds a business version must meet before it can be published. Single row; changes are audited.';
insert into ops.publication_policy default values;

create table intel.business_versions (
  id uuid primary key default gen_random_uuid(),
  business_model_id uuid not null references intel.business_models (id),
  version_no int not null check (version_no >= 1),
  status text not null default 'submitted' check (status in ('submitted', 'changes_requested', 'approved', 'rejected', 'superseded')),
  change_summary text,
  snapshot jsonb not null,
  snapshot_hash text not null,
  -- quality metrics frozen at submission (the publication gate reads these, not live data)
  completeness_pct numeric not null,
  critical_missing int not null,
  missing_checks text[] not null default '{}',
  evidence_profile jsonb not null default '{}'::jsonb,
  open_conflicts int not null default 0,
  pending_claims int not null default 0,
  stale_observations int not null default 0,
  parameters_c_or_better_pct numeric,
  non_research_rows int not null default 0,
  submitted_by uuid references auth.users (id),
  submitted_by_run uuid,
  submitted_at timestamptz not null default now(),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  decision_comments text,
  data_origin ops.data_origin,
  unique (business_model_id, version_no)
);
comment on table intel.business_versions is 'Immutable, numbered snapshot of a business record submitted for human review. Version history is never rewritten: a newer approved version supersedes, it does not replace.';
comment on column intel.business_versions.snapshot is 'Frozen JSON rendering of the normalised record at submission (built by intel.build_business_snapshot). The working data stays relational; this is the reviewable, diffable artefact.';
comment on column intel.business_versions.non_research_rows is 'Number of demo/test rows feeding this version at submission. Must be 0 for publication.';
create index business_versions_model_idx on intel.business_versions (business_model_id, version_no desc);
create index business_versions_inbox_idx on intel.business_versions (status, submitted_at);

create or replace function intel.guard_business_version() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'submitted' then
      raise exception 'a business version must be created in status "submitted"' using errcode = '23514';
    end if;
    return new;
  end if;

  if (new.business_model_id, new.version_no, new.snapshot, new.snapshot_hash, new.completeness_pct, new.critical_missing,
      new.evidence_profile, new.open_conflicts, new.pending_claims, new.stale_observations, new.non_research_rows,
      new.submitted_by, new.submitted_at, new.data_origin)
     is distinct from
     (old.business_model_id, old.version_no, old.snapshot, old.snapshot_hash, old.completeness_pct, old.critical_missing,
      old.evidence_profile, old.open_conflicts, old.pending_claims, old.stale_observations, old.non_research_rows,
      old.submitted_by, old.submitted_at, old.data_origin) then
    raise exception 'a submitted business version is immutable; submit a new version instead' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'submitted' and new.status in ('approved', 'changes_requested', 'rejected'))
         or (old.status = 'approved' and new.status = 'superseded')) then
      raise exception 'illegal business version transition % → %', old.status, new.status using errcode = 'P0001';
    end if;
    if new.status in ('approved', 'changes_requested', 'rejected') then
      if new.decided_by is null or new.decided_at is null then
        raise exception 'a review decision must record who decided and when' using errcode = '23514';
      end if;
      if new.decided_by = old.submitted_by then
        raise exception 'four-eyes rule: a version cannot be decided by the person who submitted it' using errcode = 'P0001';
      end if;
      if new.status <> 'approved' and coalesce(length(btrim(new.decision_comments)), 0) = 0 then
        raise exception 'rejecting or requesting changes requires comments' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger business_versions_guard before insert or update on intel.business_versions
  for each row execute function intel.guard_business_version();

-- ── Snapshot builder ─────────────────────────────────────────────────────────
-- Renders the normalised record of one business model as JSON. Contains source attribution for every
-- number but none of the private research material (analyst notes, supplier contacts, interview identities).
create or replace function intel.build_business_snapshot(p_model uuid) returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'model', (
      select jsonb_build_object(
        'id', m.id, 'slug', m.slug, 'name', m.name, 'family', m.family,
        'industry', jsonb_build_object('slug', i.slug, 'name', i.name),
        'description', m.description, 'operating_model', m.operating_model,
        'target_customers', m.target_customers, 'revenue_archetype', m.revenue_archetype,
        'data_origin', m.data_origin,
        'classifications', coalesce((
          select jsonb_agg(jsonb_build_object('system', cc.system_code, 'code', cc.code, 'title', cc.title,
                                              'is_primary', x.is_primary, 'is_verified', cc.is_verified) order by cc.system_code, cc.code)
          from intel.business_model_classifications x join intel.classification_codes cc on cc.id = x.classification_code_id
          where x.business_model_id = m.id), '[]'::jsonb))
      from intel.business_models m join intel.industries i on i.id = m.industry_id where m.id = p_model),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'slug', v.slug, 'name', v.name, 'is_reference', v.is_reference,
        'scale_tier', v.scale_tier, 'scale_description', v.scale_description,
        'capacity', jsonb_build_object('value', v.capacity_value, 'unit', v.capacity_unit, 'period', v.capacity_period),
        'geography_config', v.geography_config, 'ownership_structure', v.ownership_structure,
        'financial_template', v.financial_template_key,
        'cost_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'key', ci.key, 'name', ci.name, 'category', cc.slug, 'cost_class', cc.cost_class,
            'quantity', ci.quantity, 'recurrence', ci.recurrence, 'useful_life_years', ci.useful_life_years,
            'resolved', (
              select jsonb_build_object('value', fp.value, 'unit', fp.unit_code, 'basis', fp.basis, 'method', fp.method,
                                        'evidence_grade', fp.evidence_grade, 'rationale', fp.rationale)
              from intel.financial_parameters fp
              where fp.cost_item_id = ci.id and fp.is_current and fp.scenario = 'base' and fp.location_id is null),
            'observations', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', o.id, 'value', o.value, 'value_low', o.value_low, 'value_high', o.value_high, 'currency', o.currency,
                'unit', o.unit_code, 'period', o.period, 'is_line_total', o.is_line_total, 'quantity_covered', o.quantity_covered,
                'observed_on', o.observed_on, 'observed_on_precision', o.observed_on_precision,
                'geographic_scope', o.geographic_scope, 'tax_treatment', o.tax_treatment, 'installation', o.installation,
                'evidence_type', o.evidence_type, 'verification_status', o.verification_status,
                'evidence_grade', o.evidence_grade, 'revalidate_by', o.revalidate_by,
                'source', s.name, 'publisher', s.publisher,
                'document_title', d.title, 'document_url', d.url, 'page_ref', o.page_ref) order by o.observed_on desc, o.id)
              from intel.cost_observations o
              join intel.sources s on s.id = o.source_id
              left join intel.source_documents d on d.id = o.source_document_id
              where o.cost_item_id = ci.id and o.verification_status <> 'rejected'), '[]'::jsonb)
          ) order by cc.sort_order, ci.key)
          from intel.cost_items ci join intel.cost_categories cc on cc.id = ci.cost_category_id
          where ci.business_variant_id = v.id), '[]'::jsonb),
        'revenue_streams', coalesce((
          select jsonb_agg(jsonb_build_object(
            'key', rs.key, 'name', rs.name, 'driver_kind', rs.driver_kind, 'pricing_unit', coalesce(rs.pricing_unit_text, rs.pricing_unit_code),
            'customer_segment', rs.customer_segment, 'payment_terms_days', rs.payment_terms_days,
            'seasonality_profile', rs.seasonality_profile, 'seasonality_basis', rs.seasonality_basis) order by rs.key)
          from intel.revenue_streams rs where rs.business_variant_id = v.id), '[]'::jsonb),
        'parameters', coalesce((
          select jsonb_agg(jsonb_build_object(
            'key', s.parameter_key, 'name', s.parameter_name, 'revenue_stream', s.revenue_stream_name,
            'is_required', s.is_required, 'is_resolved', s.is_resolved, 'value', s.value, 'unit', s.unit_code,
            'basis', s.basis, 'method', s.method, 'evidence_grade', s.evidence_grade,
            'observation_count', s.observation_count) order by s.parameter_key, s.revenue_stream_name)
          from intel.v_variant_parameter_status s where s.business_variant_id = v.id), '[]'::jsonb),
        'operating_requirements', coalesce((
          select jsonb_agg(jsonb_build_object(
            'type', r.requirement_type, 'name', r.name, 'value', r.value_numeric, 'unit', r.unit_code, 'text', r.value_text,
            'is_critical', r.is_critical, 'basis', r.basis, 'evidence_grade', r.evidence_grade,
            'verification_status', r.verification_status) order by r.requirement_type, r.name)
          from intel.operating_requirements r where r.business_variant_id = v.id and r.verification_status <> 'rejected'), '[]'::jsonb),
        'lifestyle', (
          select to_jsonb(lp) - 'business_variant_id' - 'notes' - 'updated_at'
          from intel.lifestyle_profiles lp where lp.business_variant_id = v.id),
        'scenarios', coalesce((
          select jsonb_agg(jsonb_build_object(
            'scenario_key', fs.scenario_key, 'label', fs.label, 'kind', fs.kind, 'engine_version', fs.engine_version,
            'input_hash', fs.input_hash, 'summary', fs.summary, 'warnings', fs.warnings,
            'grade_profile', fs.grade_profile, 'assumption_count', fs.assumption_count,
            'weakest_grade', fs.weakest_grade) order by fs.kind, fs.scenario_key)
          from intel.financial_scenarios fs where fs.business_variant_id = v.id and fs.is_current), '[]'::jsonb)
      ) order by v.is_reference desc, v.slug)
      from intel.business_variants v where v.business_model_id = p_model), '[]'::jsonb),
    'regulations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', r.name, 'type', r.regulation_type, 'authority', r.issuing_authority, 'jurisdiction_level', r.jurisdiction_level,
        'applicability', br.applicability, 'condition', br.condition_text, 'stage', br.stage,
        'mapping_verification', br.verification_status, 'regulation_verification', r.verification_status,
        'last_verified_on', r.last_verified_on, 'evidence_grade', r.evidence_grade, 'portal', r.application_portal_url) order by r.name)
      from intel.business_regulations br join intel.regulations r on r.id = br.regulation_id
      where br.business_model_id = p_model), '[]'::jsonb),
    'schemes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', g.name, 'body', g.administering_body, 'type', g.scheme_type, 'eligibility', e.eligibility,
        'condition', e.condition_text, 'verification', g.verification_status, 'last_verified_on', g.last_verified_on) order by g.name)
      from intel.business_scheme_eligibility e join intel.government_schemes g on g.id = e.scheme_id
      where e.business_model_id = p_model), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object('slug', s.slug, 'name', s.name, 'type', s.skill_type, 'importance', bs.importance,
                                          'acquisition', bs.acquisition, 'basis', bs.basis) order by bs.importance desc, s.slug)
      from intel.business_skill_mapping bs join intel.skills s on s.id = bs.skill_id
      where bs.business_model_id = p_model), '[]'::jsonb),
    'founder_requirements', (
      select to_jsonb(f) - 'business_model_id' - 'notes' - 'updated_at' from intel.founder_requirements f where f.business_model_id = p_model),
    'risks', coalesce((
      select jsonb_agg(jsonb_build_object('type', r.risk_type, 'title', r.title, 'description', r.description, 'severity', r.severity,
                                          'mitigation', r.mitigation, 'exit_notes', r.exit_notes, 'basis', r.basis,
                                          'evidence_grade', r.evidence_grade) order by r.risk_type, r.title)
      from intel.business_risks r where r.business_model_id = p_model), '[]'::jsonb),
    'launch_tasks', coalesce((
      select jsonb_agg(jsonb_build_object('phase', t.phase, 'sequence_no', t.sequence_no, 'title', t.title, 'description', t.description,
                                          'typical_duration_days', t.typical_duration_days, 'basis', t.basis) order by t.phase, t.sequence_no)
      from intel.launch_tasks t where t.business_model_id = p_model), '[]'::jsonb),
    'market_observations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'metric', mo.metric_key, 'subject', mo.subject, 'value', mo.value, 'value_text', mo.value_text, 'unit', mo.unit_code,
        'period', mo.period, 'observed_on', mo.observed_on, 'location', l.name, 'geographic_scope', mo.geographic_scope,
        'evidence_type', mo.evidence_type, 'verification_status', mo.verification_status, 'evidence_grade', mo.evidence_grade,
        'source', s.name) order by mo.metric_key, mo.observed_on desc, mo.id)
      from intel.market_observations mo join intel.sources s on s.id = mo.source_id
      left join intel.locations l on l.id = mo.location_id
      where mo.business_model_id = p_model and mo.verification_status <> 'rejected'), '[]'::jsonb),
    'quality', jsonb_build_object(
      'completeness', (select to_jsonb(c) - 'business_model_id' from intel.v_business_completeness c where c.business_model_id = p_model),
      'completeness_items', (
        select jsonb_agg(jsonb_build_object('check', ci.check_key, 'section', ci.section, 'label', ci.label,
                                            'critical', ci.is_critical, 'satisfied', ci.is_satisfied) order by ci.check_key)
        from intel.v_completeness_items ci where ci.business_model_id = p_model),
      'evidence', (select to_jsonb(q) - 'business_model_id' from intel.v_business_evidence_quality q where q.business_model_id = p_model))
  )
$$;
comment on function intel.build_business_snapshot is 'JSON rendering of one business record with per-number source attribution and quality metrics. Excludes private research notes, supplier contacts and all interview identities.';

-- Rows feeding a business model that are not genuine research (demo/test). Any such row blocks publication.
create or replace function intel.count_non_research_rows(p_model uuid) returns int
language sql stable
as $$
  select (
    (select count(*) from intel.business_models m where m.id = p_model and m.data_origin <> 'research')
    + (select count(*) from intel.business_variants v where v.business_model_id = p_model and v.data_origin <> 'research')
    + (select count(*) from intel.v_observations o where o.business_model_id = p_model and o.data_origin <> 'research')
    + (select count(*) from intel.evidence_claims c where c.business_model_id = p_model and c.data_origin <> 'research' and c.status = 'accepted')
    + (select count(*) from intel.financial_parameters fp join intel.business_variants v on v.id = fp.business_variant_id
        where v.business_model_id = p_model and fp.is_current and fp.data_origin <> 'research')
    + (select count(*) from intel.financial_scenarios fs join intel.business_variants v on v.id = fs.business_variant_id
        where v.business_model_id = p_model and fs.is_current and fs.data_origin <> 'research')
    + (select count(*) from intel.source_documents d
        where d.data_origin <> 'research'
          and d.id in (select o.source_document_id from intel.v_observations o where o.business_model_id = p_model))
  )::int
$$;

-- Submit the current state of a business record for human review.
create or replace function intel.submit_business_version(p_model uuid, p_change_summary text default null, p_run uuid default null)
returns intel.business_versions
language plpgsql
as $$
declare
  v_snapshot jsonb;
  v_c intel.v_business_completeness;
  v_q intel.v_business_evidence_quality;
  v_row intel.business_versions;
  v_origin text;
begin
  select data_origin into v_origin from intel.business_models where id = p_model for update;
  if not found then
    raise exception 'business model % not found', p_model using errcode = 'P0002';
  end if;
  if exists (select 1 from intel.business_versions where business_model_id = p_model and status = 'submitted') then
    raise exception 'business model already has a version awaiting review' using errcode = 'P0001';
  end if;

  v_snapshot := intel.build_business_snapshot(p_model);
  select * into v_c from intel.v_business_completeness where business_model_id = p_model;
  select * into v_q from intel.v_business_evidence_quality where business_model_id = p_model;

  insert into intel.business_versions (
    business_model_id, version_no, status, change_summary, snapshot, snapshot_hash,
    completeness_pct, critical_missing, missing_checks, evidence_profile, open_conflicts, pending_claims,
    stale_observations, parameters_c_or_better_pct, non_research_rows, submitted_by, submitted_by_run, data_origin)
  values (
    p_model,
    coalesce((select max(version_no) from intel.business_versions where business_model_id = p_model), 0) + 1,
    'submitted', p_change_summary, v_snapshot, encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex'),
    v_c.completeness_pct, v_c.critical_missing, v_c.missing_checks,
    jsonb_build_object('A', v_q.grade_a, 'B', v_q.grade_b, 'C', v_q.grade_c, 'D', v_q.grade_d,
                       'verified', v_q.verified_count, 'unverified', v_q.unverified_count,
                       'assumptions', v_q.assumption_count, 'parameters', v_q.parameter_count,
                       'sections', v_q.section_profiles),
    v_q.open_conflicts, v_q.claims_pending_review, v_q.stale_count, v_q.parameters_c_or_better_pct,
    intel.count_non_research_rows(p_model), auth.uid(), p_run, v_origin)
  returning * into v_row;

  update intel.business_models set lifecycle_status = 'in_review' where id = p_model;
  return v_row;
end $$;

-- Record a reviewer's decision on a submitted version.
create or replace function intel.decide_business_version(p_version uuid, p_decision text, p_comments text default null)
returns intel.business_versions
language plpgsql
as $$
declare
  v_row intel.business_versions;
  v_status text;
begin
  v_status := case p_decision when 'approve' then 'approved' when 'request_changes' then 'changes_requested'
                              when 'reject' then 'rejected' end;
  if v_status is null then
    raise exception 'unknown decision %', p_decision using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'a review decision requires an authenticated reviewer' using errcode = '42501';
  end if;

  update intel.business_versions
     set status = v_status, decided_by = auth.uid(), decided_at = now(), decision_comments = p_comments
   where id = p_version
  returning * into v_row;
  if not found then
    raise exception 'business version % not found or not visible', p_version using errcode = 'P0002';
  end if;

  insert into intel.research_reviews (subject_type, subject_id, business_model_id, decision, comments, reviewer)
  values ('business_version', p_version, v_row.business_model_id, p_decision, p_comments, auth.uid());

  update intel.business_models
     set lifecycle_status = case when v_status = 'approved' then 'approved' else 'researching' end
   where id = v_row.business_model_id and lifecycle_status = 'in_review';
  return v_row;
end $$;

-- ── Publication ──────────────────────────────────────────────────────────────
create table pub.publication_versions (
  id uuid primary key default gen_random_uuid(),
  business_model_id uuid not null references intel.business_models (id),
  business_version_id uuid not null unique references intel.business_versions (id),
  publication_no int not null check (publication_no >= 1),
  slug text not null,
  name text not null,
  snapshot jsonb not null,
  completeness_pct numeric not null,
  evidence_profile jsonb not null,
  policy_applied jsonb not null,
  status text not null default 'live' check (status in ('live', 'superseded', 'withdrawn')),
  published_by uuid references auth.users (id),
  published_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_reason text,
  unique (business_model_id, publication_no),
  check (status <> 'withdrawn' or (withdrawn_at is not null and withdrawn_reason is not null))
);
comment on table pub.publication_versions is 'Customer-facing publications. Each row is an approved business version that passed the publication policy at the time (policy_applied). Exactly one live publication per business model; history is kept.';
create unique index publication_versions_one_live_idx on pub.publication_versions (business_model_id) where status = 'live';

-- Why a version cannot be published (empty array = publishable).
create or replace function pub.publication_blockers(p_version uuid) returns text[]
language plpgsql stable
as $$
declare
  v intel.business_versions;
  p ops.publication_policy;
  m_origin text;
  blockers text[] := '{}';
begin
  select * into v from intel.business_versions where id = p_version;
  if not found then
    return array['version not found'];
  end if;
  select * into p from ops.publication_policy;
  select data_origin into m_origin from intel.business_models where id = v.business_model_id;

  if v.status <> 'approved' then
    blockers := blockers || format('version is %s, not approved by a reviewer', v.status);
  end if;
  if m_origin <> 'research' or v.data_origin <> 'research' then
    blockers := blockers || format('business model is %s data, not research', coalesce(m_origin, v.data_origin));
  end if;
  if v.non_research_rows > 0 then
    blockers := blockers || format('%s demo/test rows feed this version', v.non_research_rows);
  end if;
  if v.completeness_pct < p.min_completeness_pct then
    blockers := blockers || format('completeness %s%% is below the required %s%%', v.completeness_pct, p.min_completeness_pct);
  end if;
  if v.critical_missing > p.max_critical_missing then
    blockers := blockers || format('%s critical sections missing: %s', v.critical_missing,
      (select string_agg(x ->> 'check', ', ') from jsonb_array_elements(v.snapshot -> 'quality' -> 'completeness_items') x
        where (x ->> 'critical')::boolean and not (x ->> 'satisfied')::boolean));
  end if;
  if v.open_conflicts > p.max_open_conflicts then
    blockers := blockers || format('%s unresolved conflicts between observations', v.open_conflicts);
  end if;
  if v.pending_claims > p.max_pending_claims then
    blockers := blockers || format('%s extracted claims still awaiting review', v.pending_claims);
  end if;
  if v.stale_observations > p.max_stale_observations then
    blockers := blockers || format('%s observations past their revalidation date', v.stale_observations);
  end if;
  if v.parameters_c_or_better_pct is null or v.parameters_c_or_better_pct < p.min_parameters_c_or_better_pct then
    blockers := blockers || format('only %s%% of model inputs are grade C or better (required %s%%)',
      coalesce(v.parameters_c_or_better_pct::text, '0'), p.min_parameters_c_or_better_pct);
  end if;
  return blockers;
end $$;

create or replace function pub.guard_publication() returns trigger
language plpgsql as $$
declare
  v_blockers text[];
begin
  if tg_op = 'INSERT' then
    v_blockers := pub.publication_blockers(new.business_version_id);
    if array_length(v_blockers, 1) > 0 then
      raise exception 'cannot publish: %', array_to_string(v_blockers, '; ') using errcode = 'P0001';
    end if;
    if new.status <> 'live' then
      raise exception 'a publication must be created live' using errcode = '23514';
    end if;
    return new;
  end if;
  if (new.business_model_id, new.business_version_id, new.publication_no, new.snapshot, new.published_at)
     is distinct from (old.business_model_id, old.business_version_id, old.publication_no, old.snapshot, old.published_at) then
    raise exception 'a publication is immutable; publish a new version instead' using errcode = 'P0001';
  end if;
  if old.status <> 'live' and new.status is distinct from old.status then
    raise exception 'a % publication cannot change status', old.status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger publication_versions_guard before insert or update on pub.publication_versions
  for each row execute function pub.guard_publication();

create or replace function pub.publish_business_version(p_version uuid) returns pub.publication_versions
language plpgsql
as $$
declare
  v intel.business_versions;
  v_row pub.publication_versions;
begin
  select * into v from intel.business_versions where id = p_version for update;
  if not found then
    raise exception 'business version % not found or not visible', p_version using errcode = 'P0002';
  end if;

  update pub.publication_versions set status = 'superseded'
   where business_model_id = v.business_model_id and status = 'live';

  insert into pub.publication_versions (
    business_model_id, business_version_id, publication_no, slug, name, snapshot,
    completeness_pct, evidence_profile, policy_applied, published_by)
  values (
    v.business_model_id, v.id,
    coalesce((select max(publication_no) from pub.publication_versions where business_model_id = v.business_model_id), 0) + 1,
    v.snapshot -> 'model' ->> 'slug', v.snapshot -> 'model' ->> 'name', v.snapshot,
    v.completeness_pct, v.evidence_profile,
    (select to_jsonb(p) - 'singleton' - 'updated_by' from ops.publication_policy p), auth.uid())
  returning * into v_row;

  update intel.business_versions set status = 'superseded'
   where business_model_id = v.business_model_id and status = 'approved' and id <> v.id;
  update intel.business_models set lifecycle_status = 'published' where id = v.business_model_id;
  return v_row;
end $$;

create or replace function pub.withdraw_publication(p_publication uuid, p_reason text) returns pub.publication_versions
language plpgsql
as $$
declare
  v_row pub.publication_versions;
begin
  update pub.publication_versions
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = p_reason
   where id = p_publication and status = 'live'
  returning * into v_row;
  if not found then
    raise exception 'publication % is not live', p_publication using errcode = 'P0001';
  end if;
  update intel.business_models set lifecycle_status = 'needs_revalidation' where id = v_row.business_model_id;
  return v_row;
end $$;

-- Free-discovery teaser of live publications: the only research-derived data reachable by customer roles.
create view pub.catalog
with (security_barrier = true) as
select p.id as publication_id, p.business_model_id, p.slug, p.name, p.publication_no, p.published_at,
       p.snapshot -> 'model' -> 'industry' as industry,
       p.snapshot -> 'model' ->> 'description' as description,
       p.snapshot -> 'model' ->> 'operating_model' as operating_model,
       p.completeness_pct,
       p.evidence_profile - 'sections' as evidence_profile
from pub.publication_versions p
where p.status = 'live';
comment on view pub.catalog is 'Teaser fields of live publications for free discovery. Full snapshots are reachable only through entitlement-checked server code.';
