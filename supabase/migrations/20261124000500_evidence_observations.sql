-- PlanB · 0005 · Evidence claims and observations — "every material number has a passport".
--
--   source → source_document(page) → evidence_claim(quote) ─evidence_link→ observation → financial_parameter
--
-- * evidence_claims  : atomic statements extracted from a document, each with a verbatim quote + page.
-- * observations     : typed, normalised numbers (cost / operating parameter / market / location), each
--                      carrying the full passport. Observations are APPEND-ONLY: a newer or corrected
--                      figure is a new row (supersedes_id), never an overwrite. Contradictory
--                      observations for the same subject coexist by design.
-- * Evidence grade is a property of each observation (field-level), never of a whole business.

-- ── Shared guards ────────────────────────────────────────────────────────────

-- Enforces what a grade is allowed to mean. Applied to every observation table.
create or replace function intel.guard_observation() returns trigger
language plpgsql as $$
begin
  -- Estimates can never be dressed up as evidence.
  if new.evidence_type in ('analyst_estimate', 'llm_estimate') then
    if new.evidence_grade <> 'D' then
      raise exception 'an % can only carry evidence grade D (got %)', new.evidence_type, new.evidence_grade using errcode = '23514';
    end if;
    if new.verification_status = 'verified' then
      raise exception 'an % cannot be marked verified', new.evidence_type using errcode = '23514';
    end if;
  end if;
  -- Demonstration data can never look like verified research.
  if new.data_origin = 'demo' and (new.evidence_grade <> 'D' or new.verification_status = 'verified') then
    raise exception 'demo data must stay grade D and unverified' using errcode = '23514';
  end if;
  -- Grade A = current, documented, primary/authoritative evidence that a human has verified.
  if new.evidence_grade = 'A' then
    if new.verification_status <> 'verified' then
      raise exception 'grade A requires verification_status = verified' using errcode = '23514';
    end if;
    if new.evidence_type not in ('supplier_quote', 'owner_documented', 'government_tariff_or_notification', 'regulatory_fee_schedule') then
      raise exception 'grade A requires primary documented evidence or an authoritative regulatory source (got %)', new.evidence_type using errcode = '23514';
    end if;
    if new.source_document_id is null then
      raise exception 'grade A requires a source document' using errcode = '23514';
    end if;
  end if;
  if new.verification_status = 'verified' and new.verified_by is null and new.data_origin = 'research' then
    raise exception 'verified observations must record verified_by' using errcode = '23514';
  end if;
  return new;
end $$;

-- Observations are historical facts about what a source said at a point in time.
-- Only review metadata may change after insert; the number and its passport are frozen.
create or replace function intel.freeze_observation() returns trigger
language plpgsql as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  k text;
  mutable constant text[] := array['verification_status', 'verified_by', 'verified_at', 'evidence_grade', 'grade_basis',
                                   'analyst_notes', 'valid_until', 'revalidate_by', 'updated_at'];
begin
  for k in select jsonb_object_keys(v_new) loop
    if k <> all (mutable) and (v_new -> k) is distinct from (v_old -> k) then
      raise exception 'observation field "%" is immutable; record a new observation that supersedes this one', k using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $$;

-- ── Evidence claims ──────────────────────────────────────────────────────────
create table intel.evidence_claims (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references intel.source_documents (id),
  page_no int check (page_no >= 1),
  section_ref text,
  quote text not null check (length(btrim(quote)) > 0),
  quote_verified boolean not null default false,
  quote_match_score numeric check (quote_match_score between 0 and 1),
  business_model_id uuid references intel.business_models (id),
  business_variant_id uuid references intel.business_variants (id),
  claim_type text not null check (claim_type in (
    'cost', 'price', 'capacity', 'yield', 'utilization', 'consumption', 'staffing', 'wage', 'requirement',
    'regulatory', 'scheme', 'market', 'process', 'risk', 'financial_summary', 'other')),
  subject text not null,
  attribute text,
  value_numeric numeric,
  value_low numeric,
  value_high numeric,
  value_text text,
  unit_raw text,
  currency text,
  period_raw text,
  quantity numeric,
  -- normalised (stage 5)
  value_normalized numeric,
  unit_code text references intel.units (code),
  period text check (period in ('one_time', 'per_day', 'per_month', 'per_year', 'per_cycle', 'per_unit')),
  normalization_notes text,
  qualifiers jsonb not null default '{}'::jsonb,
  -- proposed mapping into the business record
  target_kind text check (target_kind in (
    'cost_item', 'parameter', 'revenue_stream', 'operating_requirement', 'regulation', 'scheme', 'market', 'risk', 'launch_task', 'context')),
  cost_category_slug text,
  parameter_key text,
  -- extraction provenance
  extraction_method text not null check (extraction_method in ('llm', 'rule_based', 'manual', 'import')),
  extractor text not null,
  extractor_confidence numeric check (extractor_confidence between 0 and 1),
  research_run_id uuid,
  dedupe_hash text not null,
  -- review
  status text not null default 'extracted' check (status in ('extracted', 'accepted', 'rejected', 'superseded')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text,
  corrected_from_id uuid references intel.evidence_claims (id),
  data_origin ops.data_origin,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_document_id, dedupe_hash),
  -- Numerical and regulatory claims must point at where in the document they come from.
  constraint claims_numeric_needs_page check (
    (value_numeric is null and claim_type not in ('regulatory', 'scheme')) or page_no is not null),
  -- An unverifiable quote can never be accepted: acceptance requires the quote to exist in the document text.
  constraint claims_accept_requires_verified_quote check (status <> 'accepted' or quote_verified),
  constraint claims_review_metadata check (status in ('extracted', 'superseded') or reviewed_at is not null)
);
comment on table intel.evidence_claims is 'Atomic statements extracted from source documents, each with a verbatim quote and page. A claim is raw evidence awaiting review; only accepted claims materialise into observations.';
comment on column intel.evidence_claims.quote_verified is 'Set by a deterministic check that the quote text actually occurs on the cited page — the guard against hallucinated or injected extractions. LLMs never set this.';
comment on column intel.evidence_claims.extractor_confidence is 'Extractor self-reported confidence. Diagnostic only; never an evidence grade and never shown to customers.';
comment on column intel.evidence_claims.dedupe_hash is 'Hash of (page, subject, attribute, value, unit) so re-running extraction on the same document is idempotent.';
comment on column intel.evidence_claims.corrected_from_id is 'When an analyst corrects an extraction, the original is marked superseded and a new manual claim points back to it here.';
create index evidence_claims_doc_idx on intel.evidence_claims (source_document_id, page_no);
create index evidence_claims_model_idx on intel.evidence_claims (business_model_id, status);
create index evidence_claims_run_idx on intel.evidence_claims (research_run_id);
create trigger evidence_claims_updated before update on intel.evidence_claims for each row execute function ops.set_updated_at();

-- A claim's evidential content is frozen once extracted; corrections are new rows.
create or replace function intel.freeze_claim() returns trigger
language plpgsql as $$
begin
  if (new.source_document_id, new.page_no, new.quote, new.value_numeric, new.value_low, new.value_high, new.value_text,
      new.unit_raw, new.currency, new.extraction_method, new.extractor)
     is distinct from
     (old.source_document_id, old.page_no, old.quote, old.value_numeric, old.value_low, old.value_high, old.value_text,
      old.unit_raw, old.currency, old.extraction_method, old.extractor) then
    raise exception 'the extracted content of a claim is immutable; create a corrected claim instead' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger evidence_claims_freeze before update on intel.evidence_claims for each row execute function intel.freeze_claim();

create table intel.evidence_links (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references intel.evidence_claims (id),
  target_table text not null check (target_table in (
    'cost_observations', 'parameter_observations', 'market_observations', 'location_metrics', 'supplier_quotes',
    'operating_requirements', 'revenue_streams', 'business_regulations', 'regulations', 'government_schemes',
    'business_risks', 'launch_tasks', 'equipment_specifications', 'business_models', 'business_variants', 'cost_items',
    'founder_requirements', 'lifestyle_profiles', 'business_actuals')),
  target_id uuid not null,
  target_field text,
  relation text not null default 'supports' check (relation in ('supports', 'contradicts', 'context')),
  created_by uuid references auth.users (id),
  research_run_id uuid,
  created_at timestamptz not null default now()
);
comment on table intel.evidence_links is 'Links a claim to the record (and optionally the field) it supports or contradicts. Polymorphic by (target_table, target_id); the passport trail of any record is its evidence_links.';
create unique index evidence_links_unique_idx on intel.evidence_links (claim_id, target_table, target_id, coalesce(target_field, ''), relation);
create index evidence_links_target_idx on intel.evidence_links (target_table, target_id);

-- ── Cost items & cost observations ───────────────────────────────────────────
create table intel.cost_items (
  id uuid primary key default gen_random_uuid(),
  business_variant_id uuid not null references intel.business_variants (id) on delete cascade,
  cost_category_id uuid not null references intel.cost_categories (id),
  key text not null check (key ~ '^[a-z0-9_]+$'),
  name text not null,
  description text,
  equipment_id uuid references intel.equipment (id),
  raw_material_id uuid references intel.raw_materials (id),
  revenue_stream_id uuid references intel.revenue_streams (id),
  quantity numeric not null default 1 check (quantity > 0),
  quantity_unit_code text references intel.units (code),
  pricing_basis text not null default 'per_unit' check (pricing_basis in ('per_unit', 'stated_total')),
  recurrence text not null check (recurrence in ('one_time', 'monthly', 'annual', 'per_unit_output', 'pct_of_revenue')),
  useful_life_years numeric check (useful_life_years > 0),
  is_optional boolean not null default false,
  notes text,
  research_run_id uuid,
  data_origin ops.data_origin,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_variant_id, key)
);
comment on table intel.cost_items is 'A line in a variant''s cost structure (a machine, the rent, a staff role, a raw material). Holds NO price: prices are cost_observations, and several contradictory ones may exist.';
comment on column intel.cost_items.pricing_basis is 'per_unit: observations price one unit and the model multiplies by quantity. stated_total: the source only states a total for the line (e.g. an annual P&L amount).';
comment on column intel.cost_items.quantity is 'Units required by the variant (machines, head-count, sq ft…). Observations price ONE unit unless flagged is_line_total.';
create index cost_items_variant_idx on intel.cost_items (business_variant_id);
create trigger cost_items_updated before update on intel.cost_items for each row execute function ops.set_updated_at();

create table intel.cost_observations (
  id uuid primary key default gen_random_uuid(),
  cost_item_id uuid not null references intel.cost_items (id),
  -- the number
  value numeric not null check (value >= 0),
  value_low numeric,
  value_high numeric,
  currency char(3) not null default 'INR',
  unit_code text references intel.units (code),
  period text not null check (period in ('one_time', 'per_day', 'per_month', 'per_year', 'per_cycle', 'per_unit')),
  is_line_total boolean not null default false,
  quantity_covered numeric check (quantity_covered > 0),
  -- when / where / at what scale
  observed_on date not null,
  observed_on_precision text not null default 'day' check (observed_on_precision in ('day', 'month', 'year', 'unknown')),
  location_id uuid references intel.locations (id),
  geographic_scope text not null default 'unspecified' check (geographic_scope in ('locality', 'city', 'district', 'state', 'national', 'unspecified')),
  scale_note text,
  projection_year int check (projection_year between 1 and 30),
  capacity_value numeric,
  capacity_unit text,
  -- provenance
  source_id uuid not null references intel.sources (id),
  source_document_id uuid references intel.source_documents (id),
  page_ref text,
  section_ref text,
  supplier_quote_id uuid,
  -- commercial terms
  tax_treatment text not null default 'unknown' check (tax_treatment in ('inclusive', 'exclusive', 'unknown', 'not_applicable')),
  tax_rate_pct numeric check (tax_rate_pct between 0 and 100),
  installation text not null default 'unknown' check (installation in ('included', 'excluded', 'unknown', 'not_applicable')),
  -- evidence
  evidence_type text not null check (evidence_type in (
    'government_project_report', 'government_tariff_or_notification', 'regulatory_fee_schedule', 'supplier_quote',
    'manufacturer_catalogue', 'owner_documented', 'owner_reported', 'market_report', 'listing_observation',
    'analyst_estimate', 'llm_estimate')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'disputed', 'rejected')),
  verified_by uuid references auth.users (id),
  verified_at timestamptz,
  evidence_grade char(1) not null default 'D' check (evidence_grade in ('A', 'B', 'C', 'D')),
  grade_basis text,
  analyst_notes text,
  valid_until date,
  revalidate_by date,
  supersedes_id uuid references intel.cost_observations (id),
  research_run_id uuid,
  data_origin ops.data_origin,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (value_low is null or value_high is null or value_low <= value_high),
  check (not is_line_total or quantity_covered is not null)
);
comment on table intel.cost_observations is 'The passport of a cost figure: value, unit, date, geography, scale, source, document, page, tax and installation treatment, evidence type, verification status, grade and revalidation date. Append-only; contradictory observations coexist.';
comment on column intel.cost_observations.value is 'Amount in `currency`, in absolute units (rupees, never lakh), for one `unit_code` per `period` — or for quantity_covered units when is_line_total.';
comment on column intel.cost_observations.evidence_grade is 'A current documented primary/authoritative evidence, verified · B corroborated by independent reasonably-current sources · C single source / older benchmark / self-reported · D estimate or assumption.';
comment on column intel.cost_observations.supersedes_id is 'Points at the observation this one replaces (newer quotation, correction). The old row is retained as history.';
create index cost_observations_item_idx on intel.cost_observations (cost_item_id, observed_on desc);
create index cost_observations_source_idx on intel.cost_observations (source_id);
create index cost_observations_doc_idx on intel.cost_observations (source_document_id);
create index cost_observations_revalidate_idx on intel.cost_observations (revalidate_by) where verification_status <> 'rejected';
create trigger cost_observations_guard before insert or update on intel.cost_observations for each row execute function intel.guard_observation();
create trigger cost_observations_freeze before update on intel.cost_observations for each row execute function intel.freeze_observation();
create trigger cost_observations_updated before update on intel.cost_observations for each row execute function ops.set_updated_at();

-- ── Operating / revenue parameter observations ───────────────────────────────
create table intel.parameter_observations (
  id uuid primary key default gen_random_uuid(),
  business_variant_id uuid not null references intel.business_variants (id),
  parameter_key text not null,
  revenue_stream_id uuid references intel.revenue_streams (id),
  value numeric not null,
  value_low numeric,
  value_high numeric,
  currency char(3),
  unit_code text references intel.units (code),
  period text check (period in ('one_time', 'per_day', 'per_month', 'per_year', 'per_cycle', 'per_unit')),
  observed_on date not null,
  observed_on_precision text not null default 'day' check (observed_on_precision in ('day', 'month', 'year', 'unknown')),
  location_id uuid references intel.locations (id),
  geographic_scope text not null default 'unspecified' check (geographic_scope in ('locality', 'city', 'district', 'state', 'national', 'unspecified')),
  scale_note text,
  projection_year int check (projection_year between 1 and 30),
  source_id uuid not null references intel.sources (id),
  source_document_id uuid references intel.source_documents (id),
  page_ref text,
  section_ref text,
  tax_treatment text not null default 'unknown' check (tax_treatment in ('inclusive', 'exclusive', 'unknown', 'not_applicable')),
  evidence_type text not null check (evidence_type in (
    'government_project_report', 'government_tariff_or_notification', 'regulatory_fee_schedule', 'supplier_quote',
    'manufacturer_catalogue', 'owner_documented', 'owner_reported', 'market_report', 'listing_observation',
    'analyst_estimate', 'llm_estimate')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'disputed', 'rejected')),
  verified_by uuid references auth.users (id),
  verified_at timestamptz,
  evidence_grade char(1) not null default 'D' check (evidence_grade in ('A', 'B', 'C', 'D')),
  grade_basis text,
  analyst_notes text,
  valid_until date,
  revalidate_by date,
  supersedes_id uuid references intel.parameter_observations (id),
  research_run_id uuid,
  data_origin ops.data_origin,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (value_low is null or value_high is null or value_low <= value_high)
);
comment on table intel.parameter_observations is 'Observed values of operating and revenue parameters (selling price, capacity, utilisation, yield, transactions/day, working days…) with the same passport as cost observations. Append-only.';
comment on column intel.parameter_observations.projection_year is 'When the source gives a multi-year projection, the projection year this value belongs to (1 = first operating year).';
comment on column intel.parameter_observations.parameter_key is 'Key in intel.financial_parameter_definitions (FK added in migration 0006).';
create index parameter_observations_subject_idx on intel.parameter_observations (business_variant_id, parameter_key, observed_on desc);
create index parameter_observations_doc_idx on intel.parameter_observations (source_document_id);
create trigger parameter_observations_guard before insert or update on intel.parameter_observations for each row execute function intel.guard_observation();
create trigger parameter_observations_freeze before update on intel.parameter_observations for each row execute function intel.freeze_observation();
create trigger parameter_observations_updated before update on intel.parameter_observations for each row execute function ops.set_updated_at();

-- ── Market observations ──────────────────────────────────────────────────────
create table intel.market_observations (
  id uuid primary key default gen_random_uuid(),
  business_model_id uuid references intel.business_models (id),
  location_id uuid references intel.locations (id),
  metric_key text not null references intel.metric_definitions (key),
  subject text,
  value numeric,
  value_low numeric,
  value_high numeric,
  value_text text,
  currency char(3),
  unit_code text references intel.units (code),
  period text check (period in ('one_time', 'per_day', 'per_month', 'per_year', 'per_cycle', 'per_unit', 'point_in_time')),
  observed_on date not null,
  observed_on_precision text not null default 'day' check (observed_on_precision in ('day', 'month', 'year', 'unknown')),
  geographic_scope text not null default 'unspecified' check (geographic_scope in ('locality', 'city', 'district', 'state', 'national', 'unspecified')),
  source_id uuid not null references intel.sources (id),
  source_document_id uuid references intel.source_documents (id),
  page_ref text,
  section_ref text,
  tax_treatment text not null default 'unknown' check (tax_treatment in ('inclusive', 'exclusive', 'unknown', 'not_applicable')),
  evidence_type text not null check (evidence_type in (
    'government_project_report', 'government_tariff_or_notification', 'regulatory_fee_schedule', 'supplier_quote',
    'manufacturer_catalogue', 'owner_documented', 'owner_reported', 'market_report', 'listing_observation',
    'analyst_estimate', 'llm_estimate')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'disputed', 'rejected')),
  verified_by uuid references auth.users (id),
  verified_at timestamptz,
  evidence_grade char(1) not null default 'D' check (evidence_grade in ('A', 'B', 'C', 'D')),
  grade_basis text,
  analyst_notes text,
  valid_until date,
  revalidate_by date,
  supersedes_id uuid references intel.market_observations (id),
  research_run_id uuid,
  data_origin ops.data_origin,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (value is not null or value_text is not null),
  check (business_model_id is not null or location_id is not null)
);
comment on table intel.market_observations is 'Market intelligence datapoints: local selling prices, competitor counts, demand indicators, distribution margins. A competitor count or population figure is an indicator, never a demand estimate.';
create index market_observations_model_idx on intel.market_observations (business_model_id, metric_key);
create index market_observations_location_idx on intel.market_observations (location_id, metric_key);
create trigger market_observations_guard before insert or update on intel.market_observations for each row execute function intel.guard_observation();
create trigger market_observations_freeze before update on intel.market_observations for each row execute function intel.freeze_observation();
create trigger market_observations_updated before update on intel.market_observations for each row execute function ops.set_updated_at();

-- ── Location metrics ─────────────────────────────────────────────────────────
create table intel.location_metrics (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references intel.locations (id),
  metric_key text not null references intel.metric_definitions (key),
  segment text,
  value numeric not null,
  value_low numeric,
  value_high numeric,
  currency char(3),
  unit_code text references intel.units (code),
  period text check (period in ('one_time', 'per_day', 'per_month', 'per_year', 'per_cycle', 'per_unit', 'point_in_time')),
  observed_on date not null,
  observed_on_precision text not null default 'day' check (observed_on_precision in ('day', 'month', 'year', 'unknown')),
  geographic_scope text not null default 'unspecified' check (geographic_scope in ('locality', 'city', 'district', 'state', 'national', 'unspecified')),
  source_id uuid not null references intel.sources (id),
  source_document_id uuid references intel.source_documents (id),
  page_ref text,
  section_ref text,
  tax_treatment text not null default 'unknown' check (tax_treatment in ('inclusive', 'exclusive', 'unknown', 'not_applicable')),
  evidence_type text not null check (evidence_type in (
    'government_project_report', 'government_tariff_or_notification', 'regulatory_fee_schedule', 'supplier_quote',
    'manufacturer_catalogue', 'owner_documented', 'owner_reported', 'market_report', 'listing_observation',
    'analyst_estimate', 'llm_estimate')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'disputed', 'rejected')),
  verified_by uuid references auth.users (id),
  verified_at timestamptz,
  evidence_grade char(1) not null default 'D' check (evidence_grade in ('A', 'B', 'C', 'D')),
  grade_basis text,
  analyst_notes text,
  valid_until date,
  revalidate_by date,
  supersedes_id uuid references intel.location_metrics (id),
  research_run_id uuid,
  data_origin ops.data_origin,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table intel.location_metrics is 'Location-specific overlay values (commercial rent, wages, tariffs, population…) attached to exactly one node of the geography tree. City and district values are separate rows on separate nodes.';
comment on column intel.location_metrics.segment is 'Optional sub-segment of the metric (e.g. "high street ground floor", "MIDC industrial shed", "unskilled").';
create index location_metrics_lookup_idx on intel.location_metrics (location_id, metric_key, observed_on desc);
create trigger location_metrics_guard before insert or update on intel.location_metrics for each row execute function intel.guard_observation();
create trigger location_metrics_freeze before update on intel.location_metrics for each row execute function intel.freeze_observation();
create trigger location_metrics_updated before update on intel.location_metrics for each row execute function ops.set_updated_at();

-- Fallback hierarchy: nearest ancestor that has a usable value for the metric, and at which level it
-- was found, so every consumer can state "city-specific", "district", "state-level" or "national".
create or replace function intel.resolve_location_metric(p_location_id uuid, p_metric_key text, p_segment text default null)
returns table (location_metric_id uuid, value numeric, unit_code text, period text, observed_on date, evidence_grade char(1),
               resolved_location_id uuid, resolved_level text, fallback_depth int, is_fallback boolean)
language sql stable
as $$
  select m.id, m.value, m.unit_code, m.period, m.observed_on, m.evidence_grade,
         a.location_id, a.location_type, a.depth, a.depth > 0
  from intel.location_ancestry(p_location_id) a
  join intel.location_metrics m on m.location_id = a.location_id
  where m.metric_key = p_metric_key
    and (p_segment is null or m.segment = p_segment)
    and m.verification_status <> 'rejected'
    and not exists (select 1 from intel.location_metrics n where n.supersedes_id = m.id)
  order by a.depth, m.evidence_grade, m.observed_on desc
  limit 1
$$;
comment on function intel.resolve_location_metric is 'Resolves a location metric through the geography fallback hierarchy. Returns no row when nothing is known at any level — missing stays missing.';

-- ── Supplier quotations ──────────────────────────────────────────────────────
create table intel.supplier_quotes (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references intel.suppliers (id),
  business_variant_id uuid references intel.business_variants (id),
  cost_item_id uuid references intel.cost_items (id),
  equipment_id uuid references intel.equipment (id),
  raw_material_id uuid references intel.raw_materials (id),
  item_description text not null,
  model_or_spec text,
  capacity_value numeric,
  capacity_unit text,
  quoted_price numeric not null check (quoted_price >= 0),
  currency char(3) not null default 'INR',
  unit_code text references intel.units (code),
  quantity numeric not null default 1 check (quantity > 0),
  tax_treatment text not null default 'unknown' check (tax_treatment in ('inclusive', 'exclusive', 'unknown', 'not_applicable')),
  tax_rate_pct numeric check (tax_rate_pct between 0 and 100),
  installation text not null default 'unknown' check (installation in ('included', 'excluded', 'unknown', 'not_applicable')),
  freight_terms text,
  warranty_months int,
  lead_time_days int,
  payment_terms text,
  quoted_on date not null,
  valid_until date,
  delivery_location_id uuid references intel.locations (id),
  collection_method text not null check (collection_method in ('email', 'phone', 'in_person', 'supplier_portal', 'written_quotation')),
  source_document_id uuid references intel.source_documents (id),
  consent_to_use boolean not null default false,
  consent_notes text,
  collected_by uuid references auth.users (id),
  research_task_id uuid,
  status text not null default 'received' check (status in ('requested', 'received', 'verified', 'expired', 'rejected')),
  verified_by uuid references auth.users (id),
  verified_at timestamptz,
  analyst_notes text,
  data_origin ops.data_origin,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= quoted_on),
  -- A quotation may only feed the database when the supplier agreed to that use.
  check (status <> 'verified' or consent_to_use)
);
comment on table intel.supplier_quotes is 'Consented supplier quotations collected by PlanB researchers. A verified quote is turned into a cost_observation (evidence_type = supplier_quote) referencing this row.';
create index supplier_quotes_supplier_idx on intel.supplier_quotes (supplier_id);
create index supplier_quotes_item_idx on intel.supplier_quotes (cost_item_id);
create index supplier_quotes_expiry_idx on intel.supplier_quotes (valid_until) where status in ('received', 'verified');
create trigger supplier_quotes_updated before update on intel.supplier_quotes for each row execute function ops.set_updated_at();

alter table intel.cost_observations
  add constraint cost_observations_supplier_quote_fk foreign key (supplier_quote_id) references intel.supplier_quotes (id);

-- ── Raw material usage ───────────────────────────────────────────────────────
create table intel.business_raw_materials (
  id uuid primary key default gen_random_uuid(),
  business_variant_id uuid not null references intel.business_variants (id) on delete cascade,
  raw_material_id uuid not null references intel.raw_materials (id),
  revenue_stream_id uuid references intel.revenue_streams (id),
  consumption_per_output_unit numeric check (consumption_per_output_unit >= 0),
  consumption_unit_code text references intel.units (code),
  output_unit_text text,
  wastage_pct numeric check (wastage_pct between 0 and 100),
  basis text not null default 'unverified' check (basis in ('evidence', 'owner_interviews', 'analyst_judgement', 'unverified')),
  evidence_grade char(1) not null default 'D' check (evidence_grade in ('A', 'B', 'C', 'D')),
  notes text,
  created_at timestamptz not null default now(),
  unique (business_variant_id, raw_material_id, revenue_stream_id)
);
comment on table intel.business_raw_materials is 'Bill of materials: consumption norm of each raw material per unit of output for a variant.';

-- ── Conflicts between observations ───────────────────────────────────────────
create table intel.observation_conflicts (
  id uuid primary key default gen_random_uuid(),
  business_variant_id uuid not null references intel.business_variants (id) on delete cascade,
  cost_item_id uuid references intel.cost_items (id) on delete cascade,
  parameter_key text,
  observation_count int not null,
  min_value numeric not null,
  max_value numeric not null,
  spread_pct numeric not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'accepted_as_range')),
  resolution_note text,
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  research_run_id uuid,
  check ((cost_item_id is null) <> (parameter_key is null)),
  check (status = 'open' or (resolved_at is not null and resolution_note is not null))
);
comment on table intel.observation_conflicts is 'Detected disagreement between comparable observations of the same subject (spread above tolerance). Analysts resolve by verifying/rejecting observations or accepting a range; the observations themselves are never deleted.';
create unique index observation_conflicts_open_cost_idx on intel.observation_conflicts (cost_item_id) where status = 'open' and cost_item_id is not null;
create unique index observation_conflicts_open_param_idx on intel.observation_conflicts (business_variant_id, parameter_key) where status = 'open' and parameter_key is not null;
