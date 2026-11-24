-- PlanB · 0010 · Data-quality views: unified observations, completeness, evidence quality, freshness.
--
-- Two deliberately separate questions about every business record:
--   COMPLETENESS      how much of the record exists?            (v_business_completeness)
--   EVIDENCE QUALITY  how good is the evidence behind what exists? (v_business_evidence_quality)
-- A record can be complete and weak, or thin and excellent. They are never merged into one score.

create view intel.v_observations as
select 'cost'::text as observation_kind, o.id, bv.business_model_id, ci.business_variant_id,
       ci.id as cost_item_id, null::text as parameter_key, ci.name as subject, cc.cost_class as section,
       o.value, o.value_low, o.value_high, o.currency, o.unit_code, o.period, o.observed_on, o.location_id, o.geographic_scope,
       o.source_id, o.source_document_id, o.page_ref, o.evidence_type, o.verification_status, o.evidence_grade,
       o.valid_until, o.revalidate_by, o.supersedes_id, o.data_origin, o.created_at,
       exists (select 1 from intel.cost_observations n where n.supersedes_id = o.id) as is_superseded
from intel.cost_observations o
join intel.cost_items ci on ci.id = o.cost_item_id
join intel.cost_categories cc on cc.id = ci.cost_category_id
join intel.business_variants bv on bv.id = ci.business_variant_id
union all
select 'parameter', o.id, bv.business_model_id, o.business_variant_id,
       null::uuid, o.parameter_key, pd.name, 'revenue_and_operations',
       o.value, o.value_low, o.value_high, o.currency, o.unit_code, o.period, o.observed_on, o.location_id, o.geographic_scope,
       o.source_id, o.source_document_id, o.page_ref, o.evidence_type, o.verification_status, o.evidence_grade,
       o.valid_until, o.revalidate_by, o.supersedes_id, o.data_origin, o.created_at,
       exists (select 1 from intel.parameter_observations n where n.supersedes_id = o.id)
from intel.parameter_observations o
join intel.business_variants bv on bv.id = o.business_variant_id
join intel.financial_parameter_definitions pd on pd.key = o.parameter_key
union all
select 'market', o.id, o.business_model_id, null::uuid,
       null::uuid, o.metric_key, coalesce(o.subject, md.name), 'market',
       o.value, o.value_low, o.value_high, o.currency, o.unit_code, o.period, o.observed_on, o.location_id, o.geographic_scope,
       o.source_id, o.source_document_id, o.page_ref, o.evidence_type, o.verification_status, o.evidence_grade,
       o.valid_until, o.revalidate_by, o.supersedes_id, o.data_origin, o.created_at,
       exists (select 1 from intel.market_observations n where n.supersedes_id = o.id)
from intel.market_observations o
join intel.metric_definitions md on md.key = o.metric_key
where o.business_model_id is not null;
comment on view intel.v_observations is 'All business-linked observations (cost, parameter, market) in one shape for evidence exploration, quality analytics and freshness monitoring.';

-- An observation is "usable" when it has not been rejected or superseded.
create view intel.v_usable_observations as
select * from intel.v_observations where verification_status <> 'rejected' and not is_superseded;

-- Which model parameters each variant needs, and whether each is resolved (base scenario, national overlay).
create view intel.v_variant_parameter_status as
select bv.business_model_id, bv.id as business_variant_id, pd.key as parameter_key, pd.name as parameter_name,
       pd.is_required, pd.scope, null::uuid as revenue_stream_id, null::text as revenue_stream_name,
       fp.id as financial_parameter_id, fp.value, fp.unit_code, fp.basis, fp.method, fp.evidence_grade,
       fp.id is not null as is_resolved,
       (select count(*) from intel.parameter_observations o
         where o.business_variant_id = bv.id and o.parameter_key = pd.key and o.revenue_stream_id is null
           and o.verification_status <> 'rejected') as observation_count
from intel.business_variants bv
join intel.financial_parameter_definitions pd on pd.scope = 'variant'
left join intel.financial_parameters fp
  on fp.business_variant_id = bv.id and fp.parameter_key = pd.key and fp.revenue_stream_id is null
 and fp.is_current and fp.scenario = 'base' and fp.location_id is null
union all
select bv.business_model_id, bv.id, pd.key, pd.name,
       pd.is_required, pd.scope, rs.id, rs.name,
       fp.id, fp.value, fp.unit_code, fp.basis, fp.method, fp.evidence_grade,
       fp.id is not null,
       (select count(*) from intel.parameter_observations o
         where o.business_variant_id = bv.id and o.parameter_key = pd.key and o.revenue_stream_id = rs.id
           and o.verification_status <> 'rejected')
from intel.revenue_streams rs
join intel.business_variants bv on bv.id = rs.business_variant_id
join intel.financial_parameter_definitions pd on pd.scope = 'revenue_stream' and pd.template_key = rs.driver_kind
left join intel.financial_parameters fp
  on fp.business_variant_id = bv.id and fp.parameter_key = pd.key and fp.revenue_stream_id = rs.id
 and fp.is_current and fp.scenario = 'base' and fp.location_id is null;
comment on view intel.v_variant_parameter_status is 'For every variant: each model parameter it needs (common ones, plus the driver parameters of each revenue stream) and whether a current base value exists. Unresolved required parameters are research gaps; they are never auto-filled.';

-- ── Completeness ─────────────────────────────────────────────────────────────
create view intel.v_completeness_items as
with checks (check_key, section, label, weight, is_critical) as (
  values
    ('identity.description',        'identity',       'Description, operating model and target customers written', 3, true),
    ('identity.classification',     'identity',       'Primary industry classification code assigned', 1, false),
    ('identity.variant',            'identity',       'At least one costed variant defined', 3, true),
    ('capital.items',               'capital',        'Capital cost items identified', 5, true),
    ('capital.observed',            'capital',        'Every capital cost item has a usable price observation', 6, true),
    ('capital.quotes',              'capital',        'Machinery prices backed by at least one supplier quotation', 5, false),
    ('operations.fixed_costs',      'operations',     'Recurring operating costs observed (rent, utilities…)', 5, true),
    ('operations.staffing',         'operations',     'Staffing and wages observed', 4, true),
    ('operations.variable_costs',   'operations',     'Variable / raw-material costs observed', 4, true),
    ('revenue.streams',             'revenue',        'Revenue streams defined', 5, true),
    ('revenue.drivers',             'revenue',        'Price and volume drivers observed', 6, true),
    ('financial.parameters',        'financial',      'All required model parameters resolved', 6, true),
    ('financial.scenario',          'financial',      'Base scenario computed by the deterministic engine', 5, true),
    ('infrastructure.requirements', 'infrastructure', 'Space, power and water requirements recorded', 3, false),
    ('founder.skills',              'founder',        'Founder capability mapping recorded', 3, false),
    ('founder.requirements',        'founder',        'Qualification and training requirements recorded', 2, false),
    ('lifestyle.profile',           'lifestyle',      'Owner lifestyle profile recorded', 3, false),
    ('market.observations',         'market',         'At least one market observation (price, demand, competition)', 4, false),
    ('regulatory.mapping',          'regulatory',     'Applicable regulations mapped', 4, true),
    ('regulatory.verified',         'regulatory',     'All mapped mandatory regulations verified', 4, false),
    ('execution.launch_tasks',      'execution',      'Launch checklist recorded (5+ tasks)', 3, false),
    ('risk.register',               'risk',           'Risk register recorded (3+ risks incl. a capital-loss scenario)', 3, false),
    ('geography.overlay',           'geography',      'Location overlay exists for a pilot location', 4, false),
    ('ground_truth.interviews',     'ground_truth',   'At least one reviewed owner interview', 5, false),
    ('ground_truth.failures',       'ground_truth',   'At least one interview with a closed or sold business', 3, false)
),
-- Each fact about a record is computed once for all models (set-based), then the checks read those facts.
obs as (
  select business_model_id,
         bool_or(section = 'fixed_opex') as has_fixed_opex,
         bool_or(section = 'staff') as has_staff,
         bool_or(section = 'variable') as has_variable,
         bool_or(observation_kind = 'parameter') as has_parameter,
         bool_or(observation_kind = 'market') as has_market,
         bool_or(section = 'capex' and evidence_type = 'supplier_quote') as has_capex_quote
  from intel.v_usable_observations group by business_model_id),
capex as (
  select bv.business_model_id, count(*) as items,
         count(*) filter (where not ci.is_optional and not exists (
           select 1 from intel.cost_observations o
           where o.cost_item_id = ci.id and o.verification_status <> 'rejected'
             and not exists (select 1 from intel.cost_observations n where n.supersedes_id = o.id))) as unobserved
  from intel.cost_items ci
  join intel.business_variants bv on bv.id = ci.business_variant_id
  join intel.cost_categories cc on cc.id = ci.cost_category_id
  where cc.cost_class = 'capex' group by bv.business_model_id),
variants as (select business_model_id, count(*) as n from intel.business_variants group by business_model_id),
streams as (
  select bv.business_model_id, count(*) as n
  from intel.revenue_streams rs join intel.business_variants bv on bv.id = rs.business_variant_id group by bv.business_model_id),
params as (
  select business_model_id, count(*) as n, count(*) filter (where is_required and not is_resolved) as unresolved
  from intel.v_variant_parameter_status group by business_model_id),
scenarios as (
  select bv.business_model_id, count(*) as n
  from intel.financial_scenarios fs join intel.business_variants bv on bv.id = fs.business_variant_id
  where fs.is_current and fs.kind = 'base' group by bv.business_model_id),
reqs as (
  select bv.business_model_id, bool_or(r.requirement_type in ('built_up_space', 'land')) as has_space,
         bool_or(r.requirement_type = 'power_load') as has_power
  from intel.operating_requirements r join intel.business_variants bv on bv.id = r.business_variant_id
  where r.verification_status <> 'rejected' group by bv.business_model_id),
skills as (select business_model_id, count(*) as n from intel.business_skill_mapping group by business_model_id),
lifestyle as (
  select bv.business_model_id, count(*) as n
  from intel.lifestyle_profiles lp join intel.business_variants bv on bv.id = lp.business_variant_id group by bv.business_model_id),
regs as (
  select br.business_model_id,
         count(*) filter (where br.applicability <> 'to_be_determined') as mapped,
         count(*) filter (where br.applicability = 'mandatory') as mandatory,
         count(*) filter (where br.applicability = 'mandatory'
                            and (br.verification_status <> 'verified' or r.verification_status <> 'verified')) as mandatory_unverified
  from intel.business_regulations br join intel.regulations r on r.id = br.regulation_id group by br.business_model_id),
launch as (select business_model_id, count(*) as n from intel.launch_tasks group by business_model_id),
risks as (
  select business_model_id, count(*) as n, bool_or(risk_type = 'capital_loss') as has_capital_loss
  from intel.business_risks group by business_model_id),
geo as (
  select business_model_id, count(*) as n from (
    select bv.business_model_id
    from intel.financial_parameters fp join intel.business_variants bv on bv.id = fp.business_variant_id
    join intel.locations l on l.id = fp.location_id where fp.is_current and l.is_pilot
    union all
    select mo.business_model_id
    from intel.market_observations mo join intel.locations l on l.id = mo.location_id
    where l.is_pilot and mo.verification_status <> 'rejected' and mo.business_model_id is not null) x
  group by business_model_id),
interviews as (
  select business_model_id, count(*) filter (where status = 'reviewed') as reviewed,
         count(*) filter (where status = 'reviewed' and business_status in ('closed', 'sold')) as failures
  from gt.owner_interviews group by business_model_id),
classified as (
  select business_model_id, count(*) as n from intel.business_model_classifications where is_primary group by business_model_id)
select
  m.id as business_model_id,
  c.check_key, c.section, c.label, c.weight, c.is_critical,
  coalesce(case c.check_key
    when 'identity.description' then
      coalesce(length(btrim(m.description)), 0) > 0 and coalesce(length(btrim(m.operating_model)), 0) > 0
      and coalesce(length(btrim(m.target_customers)), 0) > 0
    when 'identity.classification' then classified.n > 0
    when 'identity.variant' then variants.n > 0
    when 'capital.items' then capex.items > 0
    when 'capital.observed' then capex.items > 0 and capex.unobserved = 0
    when 'capital.quotes' then obs.has_capex_quote
    when 'operations.fixed_costs' then obs.has_fixed_opex
    when 'operations.staffing' then obs.has_staff
    when 'operations.variable_costs' then obs.has_variable
    when 'revenue.streams' then streams.n > 0
    when 'revenue.drivers' then obs.has_parameter
    when 'financial.parameters' then params.n > 0 and params.unresolved = 0
    when 'financial.scenario' then scenarios.n > 0
    when 'infrastructure.requirements' then reqs.has_space and reqs.has_power
    when 'founder.skills' then skills.n > 0
    when 'founder.requirements' then fr.business_model_id is not null
    when 'lifestyle.profile' then lifestyle.n > 0
    when 'market.observations' then obs.has_market
    when 'regulatory.mapping' then regs.mapped > 0
    when 'regulatory.verified' then regs.mandatory > 0 and regs.mandatory_unverified = 0
    when 'execution.launch_tasks' then launch.n >= 5
    when 'risk.register' then risks.n >= 3 and risks.has_capital_loss
    when 'geography.overlay' then geo.n > 0
    when 'ground_truth.interviews' then interviews.reviewed > 0
    when 'ground_truth.failures' then interviews.failures > 0
  end, false) as is_satisfied
from intel.business_models m
cross join checks c
left join obs on obs.business_model_id = m.id
left join capex on capex.business_model_id = m.id
left join variants on variants.business_model_id = m.id
left join streams on streams.business_model_id = m.id
left join params on params.business_model_id = m.id
left join scenarios on scenarios.business_model_id = m.id
left join reqs on reqs.business_model_id = m.id
left join skills on skills.business_model_id = m.id
left join intel.founder_requirements fr on fr.business_model_id = m.id
left join lifestyle on lifestyle.business_model_id = m.id
left join regs on regs.business_model_id = m.id
left join launch on launch.business_model_id = m.id
left join risks on risks.business_model_id = m.id
left join geo on geo.business_model_id = m.id
left join interviews on interviews.business_model_id = m.id
left join classified on classified.business_model_id = m.id;
comment on view intel.v_completeness_items is 'One row per (business model, completeness check): is that part of the record present? Says nothing about how good the evidence is.';

create view intel.v_business_completeness as
select
  business_model_id,
  round(100.0 * coalesce(sum(weight) filter (where is_satisfied), 0) / sum(weight), 1) as completeness_pct,
  count(*) filter (where is_satisfied) as checks_passed,
  count(*) as checks_total,
  count(*) filter (where is_critical and not is_satisfied) as critical_missing,
  coalesce(array_agg(check_key order by check_key) filter (where not is_satisfied), '{}') as missing_checks,
  coalesce(array_agg(check_key order by check_key) filter (where is_critical and not is_satisfied), '{}') as critical_missing_checks
from intel.v_completeness_items
group by business_model_id;
comment on view intel.v_business_completeness is 'Research completeness per business model: weighted share of completeness checks satisfied, and which critical parts are missing.';

-- ── Evidence quality ─────────────────────────────────────────────────────────
create view intel.v_business_evidence_quality as
with obs as (
  select business_model_id,
         count(*) as observation_count,
         count(*) filter (where evidence_grade = 'A') as grade_a,
         count(*) filter (where evidence_grade = 'B') as grade_b,
         count(*) filter (where evidence_grade = 'C') as grade_c,
         count(*) filter (where evidence_grade = 'D') as grade_d,
         count(*) filter (where verification_status = 'verified') as verified_count,
         count(*) filter (where verification_status = 'unverified') as unverified_count,
         count(*) filter (where verification_status = 'disputed') as disputed_count,
         count(*) filter (where revalidate_by < current_date or valid_until < current_date) as stale_count,
         count(distinct source_id) as distinct_sources,
         jsonb_object_agg(section, section_profile) as section_profiles
  from (
    select o.*, jsonb_build_object(
             'A', count(*) filter (where evidence_grade = 'A') over w,
             'B', count(*) filter (where evidence_grade = 'B') over w,
             'C', count(*) filter (where evidence_grade = 'C') over w,
             'D', count(*) filter (where evidence_grade = 'D') over w) as section_profile
    from intel.v_usable_observations o
    window w as (partition by business_model_id, section)
  ) x
  group by business_model_id
),
params as (
  select bv.business_model_id,
         count(*) as parameter_count,
         count(*) filter (where fp.basis = 'assumption') as assumption_count,
         count(*) filter (where fp.evidence_grade in ('A', 'B', 'C')) as graded_c_or_better
  from intel.financial_parameters fp
  join intel.business_variants bv on bv.id = fp.business_variant_id
  where fp.is_current and fp.scenario = 'base'
  group by bv.business_model_id
),
conflicts as (
  select bv.business_model_id, count(*) as open_conflicts
  from intel.observation_conflicts c
  join intel.business_variants bv on bv.id = c.business_variant_id
  where c.status = 'open'
  group by bv.business_model_id
),
claims as (
  select business_model_id,
         count(*) filter (where status = 'extracted') as claims_pending_review,
         count(*) filter (where status = 'accepted') as claims_accepted,
         count(*) filter (where status = 'rejected') as claims_rejected,
         count(*) filter (where not quote_verified) as claims_quote_unverified
  from intel.evidence_claims
  where business_model_id is not null
  group by business_model_id
)
select
  m.id as business_model_id,
  coalesce(o.observation_count, 0) as observation_count,
  coalesce(o.grade_a, 0) as grade_a, coalesce(o.grade_b, 0) as grade_b,
  coalesce(o.grade_c, 0) as grade_c, coalesce(o.grade_d, 0) as grade_d,
  coalesce(o.verified_count, 0) as verified_count,
  coalesce(o.unverified_count, 0) as unverified_count,
  coalesce(o.disputed_count, 0) as disputed_count,
  coalesce(o.stale_count, 0) as stale_count,
  coalesce(o.distinct_sources, 0) as distinct_sources,
  coalesce(o.section_profiles, '{}'::jsonb) as section_profiles,
  coalesce(p.parameter_count, 0) as parameter_count,
  coalesce(p.assumption_count, 0) as assumption_count,
  case when coalesce(p.parameter_count, 0) = 0 then null
       else round(100.0 * p.graded_c_or_better / p.parameter_count, 1) end as parameters_c_or_better_pct,
  coalesce(c.open_conflicts, 0) as open_conflicts,
  coalesce(cl.claims_pending_review, 0) as claims_pending_review,
  coalesce(cl.claims_accepted, 0) as claims_accepted,
  coalesce(cl.claims_rejected, 0) as claims_rejected,
  coalesce(cl.claims_quote_unverified, 0) as claims_quote_unverified
from intel.business_models m
left join obs o on o.business_model_id = m.id
left join params p on p.business_model_id = m.id
left join conflicts c on c.business_model_id = m.id
left join claims cl on cl.business_model_id = m.id;
comment on view intel.v_business_evidence_quality is 'Evidence quality per business model: grade distribution overall and per section (capital can be strong while revenue is weak), verification state, staleness, open conflicts and the share of model inputs that are assumptions.';

-- ── Freshness / revalidation queue ───────────────────────────────────────────
create view intel.v_freshness_queue as
select 'observation:' || o.observation_kind as item_kind, o.id as item_id, o.business_model_id,
       o.subject as label, least(o.revalidate_by, o.valid_until) as due_on,
       current_date - least(o.revalidate_by, o.valid_until) as days_overdue
from intel.v_usable_observations o
where least(o.revalidate_by, o.valid_until) is not null
union all
select 'location_metric', lm.id, null, lm.metric_key || ' @ ' || l.name, least(lm.revalidate_by, lm.valid_until),
       current_date - least(lm.revalidate_by, lm.valid_until)
from intel.location_metrics lm join intel.locations l on l.id = lm.location_id
where lm.verification_status <> 'rejected' and least(lm.revalidate_by, lm.valid_until) is not null
  and not exists (select 1 from intel.location_metrics n where n.supersedes_id = lm.id)
union all
select 'supplier_quote', q.id, bv.business_model_id, q.item_description, q.valid_until, current_date - q.valid_until
from intel.supplier_quotes q left join intel.business_variants bv on bv.id = q.business_variant_id
where q.status in ('received', 'verified') and q.valid_until is not null
union all
select 'regulation', r.id, null, r.name, r.revalidate_by, current_date - r.revalidate_by
from intel.regulations r where r.revalidate_by is not null
union all
select 'government_scheme', g.id, null, g.name, g.revalidate_by, current_date - g.revalidate_by
from intel.government_schemes g where g.revalidate_by is not null
union all
select 'source_terms', s.id, null, s.name, s.terms_checked_on + s.default_revalidation_days,
       current_date - (s.terms_checked_on + s.default_revalidation_days)
from intel.sources s where s.terms_checked_on is not null;
comment on view intel.v_freshness_queue is 'Everything with a revalidation or expiry date (observations, quotations, regulations, schemes, source terms). days_overdue > 0 means stale; drives continuous-maintenance tasks.';
