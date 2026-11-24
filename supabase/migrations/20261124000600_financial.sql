-- PlanB · 0006 · Financial model templates, resolved parameters, computed scenarios.
--
-- Observations (0005) are what sources SAID. Financial parameters are what the model USES:
-- each is resolved from observations (basis = observation), computed from other parameters
-- (derived), or an explicitly labelled analyst assumption (always grade D). Scenarios are the
-- reproducible outputs of the deterministic engine (packages/finance) for a frozen input.

create table intel.financial_model_templates (
  key text primary key check (key ~ '^[a-z_]+$'),
  name text not null,
  formula text not null,
  description text,
  example_businesses text
);
comment on table intel.financial_model_templates is 'Revenue archetypes supported by the deterministic finance engine (driver kinds). Seeded from the engine''s ARCHETYPES metadata.';

create table intel.financial_parameter_definitions (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  template_key text references intel.financial_model_templates (key),
  name text not null,
  unit_code text references intel.units (code),
  value_kind text not null default 'number' check (value_kind in ('number', 'percent', 'money', 'days', 'months', 'count')),
  scope text not null default 'variant' check (scope in ('variant', 'revenue_stream')),
  is_required boolean not null default false,
  min_value numeric,
  max_value numeric,
  default_value numeric,
  default_rationale text,
  description text,
  sort_order int not null default 0,
  check ((default_value is null) = (default_rationale is null))
);
comment on column intel.financial_parameter_definitions.default_value is 'PlanB default ASSUMPTION used when no observation exists. When applied it becomes a financial_parameter with basis = assumption, grade D and default_rationale as its rationale — visible, counted and replaceable, never silent.';
comment on table intel.financial_parameter_definitions is 'Vocabulary of model parameters. template_key NULL = common to every archetype. is_required parameters must be resolved before a scenario can be computed; unresolved ones surface as research gaps.';

alter table intel.business_variants
  add constraint business_variants_template_fk foreign key (financial_template_key) references intel.financial_model_templates (key);
alter table intel.parameter_observations
  add constraint parameter_observations_key_fk foreign key (parameter_key) references intel.financial_parameter_definitions (key);
alter table intel.observation_conflicts
  add constraint observation_conflicts_key_fk foreign key (parameter_key) references intel.financial_parameter_definitions (key);

create table intel.financial_parameters (
  id uuid primary key default gen_random_uuid(),
  business_variant_id uuid not null references intel.business_variants (id) on delete cascade,
  location_id uuid references intel.locations (id),
  scenario text not null default 'base' check (scenario in ('conservative', 'base', 'optimistic')),
  parameter_key text references intel.financial_parameter_definitions (key),
  cost_item_id uuid references intel.cost_items (id) on delete cascade,
  revenue_stream_id uuid references intel.revenue_streams (id) on delete cascade,
  value numeric not null,
  unit_code text references intel.units (code),
  basis text not null check (basis in ('observation', 'derived', 'assumption')),
  method text not null check (method in ('single_observation', 'median', 'mean', 'min', 'max', 'latest', 'analyst_selected', 'formula', 'manual')),
  rationale text,
  evidence_grade char(1) not null check (evidence_grade in ('A', 'B', 'C', 'D')),
  location_level text check (location_level in ('locality', 'city', 'district', 'state', 'national', 'unspecified', 'assumed')),
  is_current boolean not null default true,
  set_by uuid references auth.users (id),
  set_at timestamptz not null default now(),
  superseded_at timestamptz,
  research_run_id uuid,
  data_origin ops.data_origin,
  -- exactly one subject: a named parameter (optionally per revenue stream) or a cost item
  check ((parameter_key is not null) <> (cost_item_id is not null)),
  -- an assumption is never better than grade D and must say why it was chosen
  check (basis <> 'assumption' or (evidence_grade = 'D' and rationale is not null and length(btrim(rationale)) > 0)),
  check (method not in ('manual', 'analyst_selected') or rationale is not null),
  check (is_current = (superseded_at is null))
);
comment on table intel.financial_parameters is 'The value the financial model actually uses for a parameter or cost item, per scenario and optional location overlay, with its basis (observation / derived / assumption), resolution method and inherited grade. History is retained: a changed value supersedes the previous row.';
comment on column intel.financial_parameters.location_level is 'Geographic level of the evidence behind this value after the fallback hierarchy (city-specific, district, state, national or assumed).';
create unique index financial_parameters_current_idx on intel.financial_parameters (
  business_variant_id,
  coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
  scenario,
  coalesce(parameter_key, ''),
  coalesce(cost_item_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(revenue_stream_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where is_current;
create index financial_parameters_variant_idx on intel.financial_parameters (business_variant_id, is_current);

create table intel.financial_parameter_sources (
  id uuid primary key default gen_random_uuid(),
  financial_parameter_id uuid not null references intel.financial_parameters (id) on delete cascade,
  cost_observation_id uuid references intel.cost_observations (id),
  parameter_observation_id uuid references intel.parameter_observations (id),
  market_observation_id uuid references intel.market_observations (id),
  location_metric_id uuid references intel.location_metrics (id),
  check (num_nonnulls(cost_observation_id, parameter_observation_id, market_observation_id, location_metric_id) = 1)
);
comment on table intel.financial_parameter_sources is 'Which observations a resolved parameter value was computed from — the join that makes every model input traceable to its passports.';
create index financial_parameter_sources_param_idx on intel.financial_parameter_sources (financial_parameter_id);

create table intel.financial_scenarios (
  id uuid primary key default gen_random_uuid(),
  business_variant_id uuid not null references intel.business_variants (id) on delete cascade,
  location_id uuid references intel.locations (id),
  scenario_key text not null,
  label text not null,
  kind text not null check (kind in ('conservative', 'base', 'optimistic', 'stress', 'failure', 'custom')),
  engine_version text not null,
  input jsonb not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  summary jsonb not null,
  monthly jsonb,
  annual jsonb,
  warnings jsonb not null default '[]'::jsonb,
  parameter_count int not null default 0,
  assumption_count int not null default 0,
  grade_profile jsonb not null default '{}'::jsonb,
  weakest_grade char(1) check (weakest_grade in ('A', 'B', 'C', 'D')),
  is_current boolean not null default true,
  computed_at timestamptz not null default now(),
  computed_by uuid references auth.users (id),
  research_run_id uuid,
  data_origin ops.data_origin
);
comment on table intel.financial_scenarios is 'A computed run of the deterministic finance engine: the exact input, its hash, the engine version and the outputs. Re-running the same engine version on `input` must reproduce `summary` exactly.';
comment on column intel.financial_scenarios.grade_profile is 'Count of model inputs by evidence grade plus explicit assumptions, so a scenario''s arithmetic is never mistaken for the quality of its inputs.';
create unique index financial_scenarios_identity_idx on intel.financial_scenarios (
  business_variant_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), scenario_key, input_hash, engine_version);
create index financial_scenarios_current_idx on intel.financial_scenarios (business_variant_id, is_current);
