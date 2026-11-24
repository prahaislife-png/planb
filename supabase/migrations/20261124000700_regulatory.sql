-- PlanB · 0007 · Regulatory database and government schemes.

create table intel.regulations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  regulation_type text not null check (regulation_type in ('registration', 'licence', 'approval', 'certification', 'inspection', 'ongoing_compliance')),
  issuing_authority text not null,
  jurisdiction_location_id uuid references intel.locations (id),
  jurisdiction_level text not null check (jurisdiction_level in ('central', 'state', 'local_body')),
  legal_basis text,
  description text,
  eligibility_notes text,
  application_portal_url text,
  fee_notes text,
  validity_notes text,
  typical_timeline_days numeric check (typical_timeline_days >= 0),
  source_id uuid references intel.sources (id),
  source_document_id uuid references intel.source_documents (id),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'disputed', 'outdated')),
  verified_by uuid references auth.users (id),
  last_verified_on date,
  revalidate_by date,
  evidence_grade char(1) not null default 'D' check (evidence_grade in ('A', 'B', 'C', 'D')),
  notes text,
  data_origin ops.data_origin,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (verification_status <> 'verified' or (last_verified_on is not null and source_id is not null)),
  check (evidence_grade <> 'A' or verification_status = 'verified'),
  check (data_origin <> 'demo' or (evidence_grade = 'D' and verification_status <> 'verified'))
);
comment on table intel.regulations is 'Licences, registrations, approvals, certifications and inspections, each tied to its issuing authority and jurisdiction, with verification date and revalidation deadline. Regulatory facts go stale; unverified entries are leads, not facts.';

create table intel.business_regulations (
  id uuid primary key default gen_random_uuid(),
  business_model_id uuid not null references intel.business_models (id) on delete cascade,
  regulation_id uuid not null references intel.regulations (id),
  applicability text not null check (applicability in ('mandatory', 'conditional', 'optional', 'to_be_determined')),
  condition_text text,
  stage text not null default 'pre_launch' check (stage in ('pre_launch', 'at_launch', 'ongoing')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'disputed')),
  verified_by uuid references auth.users (id),
  verified_at timestamptz,
  notes text,
  research_run_id uuid,
  data_origin ops.data_origin,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_model_id, regulation_id),
  check (applicability <> 'conditional' or condition_text is not null)
);
comment on table intel.business_regulations is 'Which regulations apply to which business model, and under what condition. applicability = to_be_determined marks a research lead that must not be presented as a requirement.';

create table intel.government_schemes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  administering_body text not null,
  scheme_type text not null check (scheme_type in ('capital_subsidy', 'interest_subvention', 'credit_guarantee', 'collateral_free_loan', 'training', 'marketing_support', 'tax_incentive', 'other')),
  jurisdiction_location_id uuid references intel.locations (id),
  benefit_summary text,
  eligibility_summary text,
  application_url text,
  status text not null default 'unknown' check (status in ('active', 'closed', 'unknown')),
  source_id uuid references intel.sources (id),
  source_document_id uuid references intel.source_documents (id),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'disputed', 'outdated')),
  last_verified_on date,
  revalidate_by date,
  evidence_grade char(1) not null default 'D' check (evidence_grade in ('A', 'B', 'C', 'D')),
  notes text,
  data_origin ops.data_origin,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (verification_status <> 'verified' or (last_verified_on is not null and source_id is not null))
);
comment on table intel.government_schemes is 'Government support schemes (subsidy, credit guarantee, interest subvention, training). Scheme terms change frequently; revalidate_by drives freshness monitoring.';

create table intel.business_scheme_eligibility (
  business_model_id uuid not null references intel.business_models (id) on delete cascade,
  scheme_id uuid not null references intel.government_schemes (id) on delete cascade,
  eligibility text not null default 'to_be_determined' check (eligibility in ('eligible', 'conditional', 'not_eligible', 'to_be_determined')),
  condition_text text,
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'disputed')),
  notes text,
  created_at timestamptz not null default now(),
  primary key (business_model_id, scheme_id)
);

create trigger regulations_updated before update on intel.regulations for each row execute function ops.set_updated_at();
create trigger business_regulations_updated before update on intel.business_regulations for each row execute function ops.set_updated_at();
create trigger government_schemes_updated before update on intel.government_schemes for each row execute function ops.set_updated_at();
