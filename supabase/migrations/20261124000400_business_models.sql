-- PlanB · 0004 · Business operating models and their qualitative structure.
--
-- A business_model is ONE distinct operating model ("takeaway coffee kiosk"), never a category ("coffee").
-- A business_variant is a costed configuration of that model (scale × geography × ownership).
-- Numbers never live on these rows: they live in observation tables (0005) and resolve into
-- financial parameters (0006). Qualitative records carry their own evidence basis + grade.

create table intel.business_models (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  industry_id uuid not null references intel.industries (id),
  family text,
  description text,
  operating_model text,
  target_customers text,
  revenue_archetype text,
  lifecycle_status text not null default 'backlog' check (lifecycle_status in (
    'backlog', 'researching', 'in_review', 'approved', 'published', 'needs_revalidation', 'retired')),
  is_pilot boolean not null default false,
  research_priority int not null default 3 check (research_priority between 1 and 3),
  capital_tier_hypothesis text check (capital_tier_hypothesis in ('<5L', '5-25L', '25L-1Cr', '>1Cr')),
  geography_fit text[] not null default '{}',
  backlog_notes text,
  data_origin ops.data_origin,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table intel.business_models is 'A distinct business operating model — the atomic unit of the PlanB database. Categories are intel.industries; siblings such as kiosk/café/cart are separate rows linked by family + business_relationships.';
comment on column intel.business_models.capital_tier_hypothesis is 'UNVERIFIED triage guess used only to prioritise the research backlog. Never shown to customers; real capital requirements come from cost observations.';
comment on column intel.business_models.lifecycle_status is 'backlog → researching → in_review → approved → published; needs_revalidation when evidence goes stale. Changed only by workflow functions.';
create index business_models_industry_idx on intel.business_models (industry_id);
create index business_models_status_idx on intel.business_models (lifecycle_status);
create index business_models_name_trgm_idx on intel.business_models using gin (name extensions.gin_trgm_ops);

create table intel.business_model_classifications (
  business_model_id uuid not null references intel.business_models (id) on delete cascade,
  classification_code_id uuid not null references intel.classification_codes (id),
  is_primary boolean not null default false,
  primary key (business_model_id, classification_code_id)
);

create table intel.business_variants (
  id uuid primary key default gen_random_uuid(),
  business_model_id uuid not null references intel.business_models (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  is_reference boolean not null default false,
  scale_tier text check (scale_tier in ('micro', 'small', 'medium', 'large')),
  scale_description text,
  capacity_value numeric check (capacity_value > 0),
  capacity_unit text,
  capacity_period text check (capacity_period in ('per_day', 'per_month', 'per_year', 'per_cycle', 'installed')),
  geography_config text check (geography_config in ('metro', 'tier2', 'tier3', 'rural', 'any')),
  ownership_structure text check (ownership_structure in (
    'sole_proprietorship', 'partnership', 'llp', 'private_limited', 'opc', 'franchisee', 'cooperative_fpo', 'unspecified')),
  financial_template_key text,
  notes text,
  data_origin ops.data_origin,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_model_id, slug)
);
comment on table intel.business_variants is 'A costed configuration of a business model: operating scale × geographical configuration × ownership structure. Cost items, revenue streams and financial parameters attach here.';
comment on column intel.business_variants.is_reference is 'The reference variant is the configuration described by the principal source document; other variants are scaled or localised from it.';
create index business_variants_model_idx on intel.business_variants (business_model_id);

create table intel.business_relationships (
  id uuid primary key default gen_random_uuid(),
  from_business_model_id uuid not null references intel.business_models (id) on delete cascade,
  to_business_model_id uuid not null references intel.business_models (id) on delete cascade,
  relationship_type text not null check (relationship_type in (
    'distinct_sibling', 'upstream_supplier', 'downstream_customer', 'complementary', 'substitute', 'upgrade_path', 'shares_skills', 'franchise_of')),
  notes text,
  created_at timestamptz not null default now(),
  unique (from_business_model_id, to_business_model_id, relationship_type),
  check (from_business_model_id <> to_business_model_id)
);
comment on table intel.business_relationships is 'Typed edges between business models: siblings that must not be merged, value-chain links, upgrade paths. Feeds deduplication and "also consider" discovery.';

create table intel.business_assets (
  id uuid primary key default gen_random_uuid(),
  business_variant_id uuid not null references intel.business_variants (id) on delete cascade,
  asset_type_slug text not null references intel.asset_types (slug),
  requirement_level text not null check (requirement_level in ('required', 'advantage', 'substitutes_cost')),
  quantity numeric,
  unit_code text references intel.units (code),
  substitutes_cost_category_id uuid references intel.cost_categories (id),
  notes text,
  evidence_grade char(1) not null default 'D' check (evidence_grade in ('A', 'B', 'C', 'D')),
  created_at timestamptz not null default now(),
  unique (business_variant_id, asset_type_slug)
);
comment on table intel.business_assets is 'Assets a variant needs or benefits from. Matched against customer.user_assets: an asset the customer already owns can replace a cost (substitutes_cost_category_id) — the basis of asset-monetisation recommendations.';

-- ── Equipment, suppliers, raw materials ──────────────────────────────────────
create table intel.equipment (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  equipment_class text,
  description text,
  hsn_code text,
  typical_useful_life_years numeric check (typical_useful_life_years > 0),
  maintenance_notes text,
  data_origin ops.data_origin,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table intel.equipment is 'Catalogue of machine/equipment types, shared across business models (a planetary mixer is one row however many models use it).';
create index equipment_name_trgm_idx on intel.equipment using gin (name extensions.gin_trgm_ops);

create table intel.equipment_specifications (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references intel.equipment (id) on delete cascade,
  spec_key text not null,
  value_numeric numeric,
  value_text text,
  unit_code text references intel.units (code),
  evidence_grade char(1) not null default 'D' check (evidence_grade in ('A', 'B', 'C', 'D')),
  source_document_id uuid references intel.source_documents (id),
  created_at timestamptz not null default now(),
  check (value_numeric is not null or value_text is not null)
);
comment on table intel.equipment_specifications is 'Key/value technical specifications of an equipment type (capacity, connected load, footprint…).';
create index equipment_specifications_equipment_idx on intel.equipment_specifications (equipment_id);

create table intel.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  supplier_type text not null check (supplier_type in ('manufacturer', 'authorised_dealer', 'trader', 'importer', 'service_provider', 'raw_material_supplier')),
  location_id uuid references intel.locations (id),
  city_text text,
  website text,
  contact_name text,
  contact_phone text,
  contact_email text,
  gstin text,
  categories text[] not null default '{}',
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'contact_verified', 'gst_verified', 'site_verified', 'rejected')),
  consent_to_list boolean not null default false,
  consent_recorded_on date,
  first_contacted_on date,
  notes text,
  data_origin ops.data_origin,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table intel.suppliers is 'Supplier intelligence. Contact fields are private research data; a supplier is only ever shown to customers when consent_to_list is true.';
create index suppliers_name_trgm_idx on intel.suppliers using gin (name extensions.gin_trgm_ops);

create table intel.raw_materials (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  default_unit_code text references intel.units (code),
  hsn_code text,
  description text,
  data_origin ops.data_origin,
  created_at timestamptz not null default now()
);
comment on table intel.raw_materials is 'Raw material / consumable catalogue shared across models. Prices are observations (cost_observations / market_observations), never columns here.';

-- ── Operating requirements & revenue mechanics ───────────────────────────────
create table intel.operating_requirements (
  id uuid primary key default gen_random_uuid(),
  business_variant_id uuid not null references intel.business_variants (id) on delete cascade,
  requirement_type text not null check (requirement_type in (
    'built_up_space', 'land', 'power_load', 'water', 'ventilation', 'connectivity', 'transport_access', 'storage',
    'environmental', 'zoning', 'working_hours', 'other')),
  name text not null,
  value_numeric numeric,
  unit_code text references intel.units (code),
  value_text text,
  is_critical boolean not null default false,
  basis text not null default 'unverified' check (basis in ('evidence', 'analyst_judgement', 'unverified')),
  evidence_grade char(1) not null default 'D' check (evidence_grade in ('A', 'B', 'C', 'D')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'disputed', 'rejected')),
  notes text,
  research_run_id uuid,
  data_origin ops.data_origin,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (value_numeric is not null or value_text is not null)
);
comment on table intel.operating_requirements is 'Infrastructure and operating prerequisites of a variant: space, land, electricity, water, ventilation, connectivity, transport, environmental.';
create index operating_requirements_variant_idx on intel.operating_requirements (business_variant_id);

create table intel.revenue_streams (
  id uuid primary key default gen_random_uuid(),
  business_variant_id uuid not null references intel.business_variants (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]+$'),
  name text not null,
  driver_kind text not null check (driver_kind in (
    'transactions', 'capacity_utilization', 'area_yield', 'enrolment', 'occupancy', 'fleet_utilization', 'engagements')),
  pricing_unit_code text references intel.units (code),
  pricing_unit_text text,
  customer_segment text,
  payment_terms_days int check (payment_terms_days >= 0),
  seasonality_profile numeric[] check (seasonality_profile is null or array_length(seasonality_profile, 1) = 12),
  seasonality_basis text check (seasonality_basis in ('evidence', 'analyst_judgement', 'unverified')),
  share_of_revenue_note text,
  notes text,
  research_run_id uuid,
  data_origin ops.data_origin,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_variant_id, key)
);
comment on table intel.revenue_streams is 'How a variant earns: pricing unit, volume driver (finance-engine driver kind), payment cycle and seasonality. Price/volume values are parameter observations.';

-- ── Founder requirements, lifestyle, skills, training ────────────────────────
create table intel.business_skill_mapping (
  business_model_id uuid not null references intel.business_models (id) on delete cascade,
  skill_id uuid not null references intel.skills (id),
  importance int not null check (importance between 1 and 5),
  acquisition text not null check (acquisition in ('needed_at_start', 'learnable', 'hireable')),
  basis text not null default 'unverified' check (basis in ('evidence', 'owner_interviews', 'analyst_judgement', 'unverified')),
  notes text,
  created_at timestamptz not null default now(),
  primary key (business_model_id, skill_id)
);
comment on table intel.business_skill_mapping is 'Which capabilities a business model demands of its founder, how important each is, and whether it can be learned or hired.';

create table intel.founder_requirements (
  business_model_id uuid primary key references intel.business_models (id) on delete cascade,
  mandatory_qualifications text,
  certifications text,
  industry_experience text,
  training_duration_weeks numeric check (training_duration_weeks >= 0),
  learning_difficulty int check (learning_difficulty between 1 and 5),
  management_capabilities text,
  basis text not null default 'unverified' check (basis in ('evidence', 'owner_interviews', 'analyst_judgement', 'unverified')),
  evidence_grade char(1) not null default 'D' check (evidence_grade in ('A', 'B', 'C', 'D')),
  notes text,
  updated_at timestamptz not null default now()
);

create table intel.lifestyle_profiles (
  business_variant_id uuid primary key references intel.business_variants (id) on delete cascade,
  owner_involvement text check (owner_involvement in ('full_time_hands_on', 'full_time_managerial', 'part_time', 'semi_absentee', 'absentee')),
  owner_hours_per_week_low numeric check (owner_hours_per_week_low >= 0),
  owner_hours_per_week_high numeric,
  weekend_work text check (weekend_work in ('none', 'occasional', 'regular', 'peak_days')),
  physical_demand int check (physical_demand between 1 and 5),
  employee_dependence int check (employee_dependence between 1 and 5),
  remote_manageability int check (remote_manageability between 1 and 5),
  operational_complexity int check (operational_complexity between 1 and 5),
  basis text not null default 'unverified' check (basis in ('evidence', 'owner_interviews', 'analyst_judgement', 'unverified')),
  evidence_grade char(1) not null default 'D' check (evidence_grade in ('A', 'B', 'C', 'D')),
  notes text,
  updated_at timestamptz not null default now(),
  check (owner_hours_per_week_high is null or owner_hours_per_week_high >= owner_hours_per_week_low)
);
comment on table intel.lifestyle_profiles is 'What running the variant is like for the owner. These are judgements unless basis = owner_interviews; the grade says how far to trust them.';

create table intel.training_programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null,
  provider_type text check (provider_type in ('government_institute', 'agricultural_university', 'kvk', 'rseti', 'industry_body', 'private', 'manufacturer')),
  location_id uuid references intel.locations (id),
  mode text check (mode in ('in_person', 'online', 'hybrid')),
  duration_days numeric,
  fee_inr numeric check (fee_inr >= 0),
  url text,
  last_verified_on date,
  source_document_id uuid references intel.source_documents (id),
  notes text,
  data_origin ops.data_origin,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table intel.training_program_businesses (
  training_program_id uuid not null references intel.training_programs (id) on delete cascade,
  business_model_id uuid not null references intel.business_models (id) on delete cascade,
  primary key (training_program_id, business_model_id)
);

-- ── Risks & execution ────────────────────────────────────────────────────────
create table intel.business_risks (
  id uuid primary key default gen_random_uuid(),
  business_model_id uuid not null references intel.business_models (id) on delete cascade,
  risk_type text not null check (risk_type in (
    'failure_mode', 'capital_loss', 'operational', 'customer_concentration', 'seasonality', 'regulatory', 'supply', 'market', 'exit')),
  title text not null,
  description text not null,
  severity text check (severity in ('low', 'medium', 'high')),
  mitigation text,
  exit_notes text,
  basis text not null default 'unverified' check (basis in ('evidence', 'owner_interviews', 'analyst_judgement', 'unverified')),
  evidence_grade char(1) not null default 'D' check (evidence_grade in ('A', 'B', 'C', 'D')),
  research_run_id uuid,
  data_origin ops.data_origin,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table intel.business_risks is 'Failure modes, capital-loss scenarios and exit possibilities. Deliberately has no probability column: we do not invent success/failure probabilities.';
create index business_risks_model_idx on intel.business_risks (business_model_id);

create table intel.launch_tasks (
  id uuid primary key default gen_random_uuid(),
  business_model_id uuid not null references intel.business_models (id) on delete cascade,
  phase text not null check (phase in ('validate', 'plan', 'register_and_license', 'site_and_setup', 'procure', 'hire_and_train', 'launch', 'stabilise')),
  sequence_no int not null,
  title text not null,
  description text,
  typical_duration_days numeric check (typical_duration_days >= 0),
  depends_on uuid references intel.launch_tasks (id),
  basis text not null default 'unverified' check (basis in ('evidence', 'owner_interviews', 'analyst_judgement', 'unverified')),
  research_run_id uuid,
  data_origin ops.data_origin,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_model_id, phase, sequence_no)
);
comment on table intel.launch_tasks is 'Establishment process / launch checklist for a business model, ordered by phase and sequence.';

do $$
declare t text;
begin
  foreach t in array array['business_models', 'business_variants', 'equipment', 'suppliers', 'operating_requirements',
                           'revenue_streams', 'founder_requirements', 'lifestyle_profiles', 'training_programs',
                           'business_risks', 'launch_tasks']
  loop
    execute format('create trigger %I before update on intel.%I for each row execute function ops.set_updated_at()', t || '_updated', t);
  end loop;
end $$;
