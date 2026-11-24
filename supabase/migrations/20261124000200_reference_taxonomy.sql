-- PlanB · 0002 · Reference vocabularies and the business taxonomy.

-- ── Units ────────────────────────────────────────────────────────────────────
create table intel.units (
  code text primary key,
  name text not null,
  dimension text not null check (dimension in ('count', 'mass', 'volume', 'area', 'length', 'power', 'energy', 'time', 'currency', 'ratio', 'other')),
  base_unit text references intel.units (code),
  to_base_factor numeric,
  constraint units_base_consistency check ((base_unit is null) = (to_base_factor is null))
);
comment on table intel.units is 'Controlled unit vocabulary. Normalisation converts raw document units to these codes; to_base_factor converts to the dimension''s base unit.';

-- ── Industry taxonomy ────────────────────────────────────────────────────────
create table intel.industries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  parent_id uuid references intel.industries (id),
  description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table intel.industries is 'Hierarchical industry taxonomy (sector → sub-sector). Business operating models hang off the leaves; an industry is never itself a business model.';
create index industries_parent_idx on intel.industries (parent_id);

create table intel.classification_systems (
  code text primary key,
  name text not null,
  authority text,
  reference_url text,
  notes text
);
comment on table intel.classification_systems is 'External classification schemes (NIC-2008, HSN, NCO-2015, …) used to anchor our taxonomy to official codes.';

create table intel.classification_codes (
  id uuid primary key default gen_random_uuid(),
  system_code text not null references intel.classification_systems (code),
  code text not null,
  title text not null,
  parent_code text,
  is_verified boolean not null default false,
  verified_against text,
  created_at timestamptz not null default now(),
  unique (system_code, code)
);
comment on column intel.classification_codes.is_verified is 'True only when the code/title pair was checked against the official publication (verified_against records which).';

-- ── Geography ────────────────────────────────────────────────────────────────
create table intel.locations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  location_type text not null check (location_type in ('country', 'state', 'division', 'district', 'city', 'locality')),
  parent_id uuid references intel.locations (id),
  tier text check (tier in ('metro', 'tier1', 'tier2', 'tier3', 'rural')),
  iso_code text,
  lgd_code text,
  census_2011_code text,
  is_pilot boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_root_is_country check (parent_id is not null or location_type = 'country')
);
comment on table intel.locations is 'Administrative geography tree (country → state → district → city → locality). City-level and district-level data are kept on separate nodes. Official codes are left NULL until verified.';
create index locations_parent_idx on intel.locations (parent_id);

-- Ancestors of a location, nearest first (depth 0 = the location itself). Basis of the fallback hierarchy.
create or replace function intel.location_ancestry(p_location_id uuid)
returns table (location_id uuid, depth int, location_type text, name text)
language sql stable
as $$
  with recursive chain as (
    select l.id, 0 as depth, l.location_type, l.name, l.parent_id
    from intel.locations l where l.id = p_location_id
    union all
    select p.id, c.depth + 1, p.location_type, p.name, p.parent_id
    from chain c join intel.locations p on p.id = c.parent_id
  )
  select id, depth, location_type, name from chain order by depth
$$;

-- ── Cost categories ──────────────────────────────────────────────────────────
create table intel.cost_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z_]+(\.[a-z_]+)*$'),
  name text not null,
  parent_id uuid references intel.cost_categories (id),
  cost_class text not null check (cost_class in ('capex', 'pre_operative', 'deposit', 'working_capital', 'fixed_opex', 'staff', 'variable', 'financing')),
  engine_category text,
  default_useful_life_years numeric check (default_useful_life_years > 0),
  description text,
  sort_order int not null default 0
);
comment on column intel.cost_categories.default_useful_life_years is 'Depreciation life used when a cost item has no evidenced useful life. Applying it is recorded as a model assumption.';
comment on table intel.cost_categories is 'Chart of cost categories. cost_class decides how the deterministic finance engine treats items in the category; engine_category is the engine''s sub-bucket (e.g. machinery, rent).';

-- ── Skills, assets, metric vocabulary ────────────────────────────────────────
create table intel.skills (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  skill_type text not null check (skill_type in ('transferable', 'technical', 'regulatory', 'domain')),
  description text,
  created_at timestamptz not null default now()
);
comment on table intel.skills is 'Capability vocabulary shared by business requirements and customer profiles. Transferable capabilities (operations, sales, procurement…) matter more than job titles.';

create table intel.asset_types (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  description text
);
comment on table intel.asset_types is 'Kinds of assets a business may need and a customer may already own (land, shop, vehicle, rooftop…). Joins intel.business_assets to customer.user_assets.';

create table intel.metric_definitions (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  name text not null,
  applies_to text not null check (applies_to in ('location', 'market', 'actuals')),
  unit_code text references intel.units (code),
  period text check (period in ('one_time', 'per_day', 'per_month', 'per_year', 'per_unit', 'point_in_time')),
  description text
);
comment on table intel.metric_definitions is 'Controlled vocabulary of metric keys for location_metrics, market_observations and business_actuals.';
