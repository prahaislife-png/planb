-- PlanB · 0012 · Customer-side tables (profiles, assets, capabilities, recommendations, saved businesses, pricing).
-- Schema only at this stage: the profile-analysis and matching engines are Phase 8. Everything here is
-- personal data, owner-only under RLS, with soft-delete + hard-erase support.

create table customer.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  current_role_title text,
  current_industry text,
  years_experience numeric check (years_experience between 0 and 60),
  professional_summary text,
  preferred_location_id uuid references intel.locations (id),
  investable_capital_inr numeric check (investable_capital_inr >= 0),
  reserve_requirement_inr numeric check (reserve_requirement_inr >= 0),
  monthly_income_goal_inr numeric check (monthly_income_goal_inr >= 0),
  current_monthly_income_inr numeric check (current_monthly_income_inr >= 0),
  risk_tolerance text check (risk_tolerance in ('low', 'moderate', 'high')),
  desired_involvement text check (desired_involvement in ('full_time_hands_on', 'full_time_managerial', 'part_time', 'semi_absentee', 'absentee')),
  max_hours_per_week numeric check (max_hours_per_week between 0 and 120),
  weekend_work_ok boolean,
  physical_work_tolerance int check (physical_work_tolerance between 1 and 5),
  transition_timeline_months int check (transition_timeline_months between 0 and 120),
  interests text[] not null default '{}',
  household_mode text not null default 'individual' check (household_mode in ('individual', 'couple')),
  marketing_consent boolean not null default false,
  data_processing_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table customer.user_profiles is 'PERSONAL DATA. A customer''s professional and financial profile used for matching. Owner-only access; staff see it only through explicit support tooling (not yet built).';

create table customer.profile_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_kind text not null check (document_kind in ('cv', 'linkedin_export', 'other')),
  storage_bucket text not null default 'customer-uploads',
  storage_path text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  sha256 text not null,
  parsed_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table customer.profile_documents is 'PERSONAL DATA. CVs and user-provided LinkedIn exports (never scraped). Files live in a private bucket.';

create table customer.user_capabilities (
  user_id uuid not null references auth.users (id) on delete cascade,
  skill_id uuid not null references intel.skills (id),
  proficiency int not null check (proficiency between 1 and 5),
  years_practised numeric check (years_practised >= 0),
  derivation text not null check (derivation in ('self_declared', 'extracted_from_cv', 'extracted_from_linkedin_export', 'inferred')),
  evidence_excerpt text,
  confirmed_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, skill_id)
);
comment on table customer.user_capabilities is 'Transferable capabilities of a customer, mapped to the same skill vocabulary as business requirements. Extracted capabilities stay unconfirmed until the user confirms them.';

create table customer.user_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_type_slug text not null references intel.asset_types (slug),
  description text,
  location_id uuid references intel.locations (id),
  quantity numeric,
  unit_code text references intel.units (code),
  estimated_value_inr numeric check (estimated_value_inr >= 0),
  available_for_business boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table customer.user_assets is 'PERSONAL DATA. Assets the customer already owns (land, shop, vehicle…) that could substitute a business cost.';
create index user_assets_user_idx on customer.user_assets (user_id);

create table customer.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  publication_id uuid not null references pub.publication_versions (id),
  business_model_id uuid not null references intel.business_models (id),
  generated_at timestamptz not null default now(),
  matcher_version text not null,
  profile_hash text not null,
  passed_feasibility boolean not null,
  feasibility_failures jsonb not null default '[]'::jsonb,
  fit_dimensions jsonb not null default '{}'::jsonb,
  trade_offs jsonb not null default '[]'::jsonb,
  missing_prerequisites jsonb not null default '[]'::jsonb,
  research_confidence jsonb not null default '{}'::jsonb,
  rank_position int
);
comment on table customer.recommendations is 'Explainable match results. Suitability (fit_dimensions) and research confidence are stored separately and no single "score" is stored; recommendations only ever reference a published version.';
comment on column customer.recommendations.research_confidence is 'Evidence-quality summary of the publication at match time — kept apart from suitability on purpose.';
create index recommendations_user_idx on customer.recommendations (user_id, generated_at desc);

create table customer.saved_businesses (
  user_id uuid not null references auth.users (id) on delete cascade,
  business_model_id uuid not null references intel.business_models (id),
  note text,
  created_at timestamptz not null default now(),
  primary key (user_id, business_model_id)
);

create table customer.pricing_plans (
  key text primary key,
  name text not null,
  price_inr numeric not null check (price_inr >= 0),
  description text,
  is_active boolean not null default true,
  is_hypothesis boolean not null default true,
  updated_at timestamptz not null default now()
);
comment on table customer.pricing_plans is 'Configurable pricing. Current rows are monetisation HYPOTHESES to validate, not launched products.';

-- Hard erasure of one customer's personal data (DPDP Act right to erasure). Recommendations and saved
-- items cascade from auth.users; this function covers the case where the auth user must be retained.
create or replace function customer.erase_user_data(p_user uuid) returns void
language plpgsql security definer set search_path = customer, pg_temp
as $$
begin
  if auth.uid() is distinct from p_user and not ops.has_role('admin') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  delete from customer.recommendations where user_id = p_user;
  delete from customer.saved_businesses where user_id = p_user;
  delete from customer.user_assets where user_id = p_user;
  delete from customer.user_capabilities where user_id = p_user;
  delete from customer.profile_documents where user_id = p_user;
  delete from customer.user_profiles where user_id = p_user;
end $$;
revoke all on function customer.erase_user_data(uuid) from public;
grant execute on function customer.erase_user_data(uuid) to authenticated;

create trigger user_profiles_updated before update on customer.user_profiles for each row execute function ops.set_updated_at();
create trigger user_assets_updated before update on customer.user_assets for each row execute function ops.set_updated_at();
