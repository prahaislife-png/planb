-- PlanB · 0008 · PlanB Ground Truth — proprietary owner interviews and actual performance.
--
-- Privacy by construction:
--   gt.interview_subjects  the ONLY place a person/business is identifiable (admin + assigned interviewer).
--   gt.owner_interviews    de-identified interview record (coarse geography, no names).
--   gt.business_actuals    figures from interviews, flagged documented vs self-reported.
--   gt.v_actuals_aggregate k-anonymous aggregates (n ≥ 5) — the only form that may ever leave research.

create table gt.questionnaires (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version int not null check (version >= 1),
  title text not null,
  audience text not null check (audience in ('operating_owner', 'former_owner', 'supplier', 'expert')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (key, version)
);
comment on table gt.questionnaires is 'Versioned structured interview questionnaires. Separate instruments for operating and former (closed/sold) owners so failures are captured, not just survivors.';

create table gt.questionnaire_questions (
  id uuid primary key default gen_random_uuid(),
  questionnaire_id uuid not null references gt.questionnaires (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]+$'),
  section text not null,
  sequence_no int not null,
  prompt text not null,
  answer_type text not null check (answer_type in ('money', 'money_range', 'number', 'number_range', 'percent', 'duration_months', 'text', 'choice', 'boolean')),
  metric_key text references intel.metric_definitions (key),
  choices text[],
  guidance text,
  is_sensitive boolean not null default false,
  unique (questionnaire_id, key)
);
comment on column gt.questionnaire_questions.metric_key is 'When set, a numeric answer is recorded as a gt.business_actuals row under this metric.';

create table gt.interview_subjects (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  business_name text,
  phone text,
  email text,
  address text,
  referral_source text,
  assigned_interviewer uuid references auth.users (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  erased_at timestamptz
);
comment on table gt.interview_subjects is 'PERSONAL DATA. Identity and contact details of interviewees. Visible only to admins and the assigned interviewer; never joined into aggregates or publications.';

create table gt.consents (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references gt.interview_subjects (id) on delete cascade,
  consent_form_version text not null,
  allows_aggregate_use boolean not null,
  allows_anonymised_quotes boolean not null default false,
  allows_document_retention boolean not null default false,
  allows_recontact boolean not null default false,
  given_on date not null,
  collection_method text not null check (collection_method in ('signed_form', 'recorded_verbal', 'email', 'digital_form')),
  evidence_storage_path text,
  withdrawn_on date,
  recorded_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (withdrawn_on is null or withdrawn_on >= given_on)
);
comment on table gt.consents is 'Consent records per interviewee: what they agreed to, when, how, and whether it was withdrawn. No interview data is usable without an active consent.';
create index consents_subject_idx on gt.consents (subject_id);

create table gt.owner_interviews (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid references gt.interview_subjects (id) on delete set null,
  consent_id uuid references gt.consents (id),
  business_model_id uuid not null references intel.business_models (id),
  business_variant_id uuid references intel.business_variants (id),
  location_id uuid references intel.locations (id),
  questionnaire_id uuid references gt.questionnaires (id),
  business_status text not null check (business_status in ('operating', 'closed', 'sold', 'paused')),
  started_year int check (started_year between 1950 and 2100),
  ended_year int,
  years_operated numeric check (years_operated >= 0),
  interview_date date,
  interview_mode text check (interview_mode in ('in_person', 'phone', 'video', 'written')),
  interviewer uuid references auth.users (id),
  transcript_storage_path text,
  analyst_summary text,
  closure_or_success_reasons text,
  advice_for_entrants text,
  status text not null default 'planned' check (status in ('planned', 'scheduled', 'conducted', 'transcribed', 'coded', 'reviewed', 'withdrawn')),
  anonymisation_status text not null default 'pending' check (anonymisation_status in ('pending', 'anonymised', 'not_required')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  data_origin ops.data_origin,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_year is null or ended_year >= started_year),
  -- An interview cannot be recorded as conducted without consent on file.
  check (status in ('planned', 'scheduled', 'withdrawn') or consent_id is not null),
  check (status <> 'reviewed' or anonymisation_status in ('anonymised', 'not_required'))
);
comment on table gt.owner_interviews is 'De-identified interview with an existing or former owner. location_id must be district level or coarser. Closed and sold businesses are first-class to counter survivorship bias.';
create index owner_interviews_model_idx on gt.owner_interviews (business_model_id, status);

create table gt.interview_responses (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references gt.owner_interviews (id) on delete cascade,
  question_id uuid not null references gt.questionnaire_questions (id),
  answer_text text,
  answer_numeric numeric,
  answer_low numeric,
  answer_high numeric,
  unit_code text references intel.units (code),
  analyst_note text,
  created_at timestamptz not null default now(),
  unique (interview_id, question_id)
);

create table gt.business_actuals (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references gt.owner_interviews (id) on delete cascade,
  metric_key text not null references intel.metric_definitions (key),
  value numeric,
  value_low numeric,
  value_high numeric,
  unit_code text references intel.units (code),
  period text check (period in ('one_time', 'per_day', 'per_month', 'per_year', 'point_in_time')),
  reference_year int check (reference_year between 1950 and 2100),
  evidence_level text not null check (evidence_level in ('documented', 'self_reported')),
  supporting_document_path text,
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'disputed', 'rejected')),
  verified_by uuid references auth.users (id),
  evidence_grade char(1) not null default 'C' check (evidence_grade in ('A', 'B', 'C', 'D')),
  analyst_notes text,
  data_origin ops.data_origin,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (value is not null or (value_low is not null and value_high is not null)),
  -- "documented" must point at the document; self-reported figures can never be grade A.
  check (evidence_level <> 'documented' or supporting_document_path is not null),
  check (evidence_level <> 'self_reported' or evidence_grade in ('C', 'D')),
  check (evidence_grade <> 'A' or verification_status = 'verified'),
  check (data_origin <> 'demo' or (evidence_grade = 'D' and verification_status <> 'verified'))
);
comment on table gt.business_actuals is 'Actual figures reported by owners (investment, revenue range, owner income, break-even time, hours…). evidence_level separates documented actuals from self-reported ones.';
create index business_actuals_interview_idx on gt.business_actuals (interview_id);
create index business_actuals_metric_idx on gt.business_actuals (metric_key);

-- k-anonymous aggregate: a cell is released only when at least 5 distinct reviewed, consented interviews
-- contribute to it. Individual confidential records never leave gt.business_actuals.
create view gt.v_actuals_aggregate
with (security_barrier = true) as
select
  i.business_model_id,
  a.metric_key,
  i.business_status,
  count(distinct i.id) as interview_count,
  percentile_cont(0.25) within group (order by coalesce(a.value, (a.value_low + a.value_high) / 2)) as p25,
  percentile_cont(0.50) within group (order by coalesce(a.value, (a.value_low + a.value_high) / 2)) as median,
  percentile_cont(0.75) within group (order by coalesce(a.value, (a.value_low + a.value_high) / 2)) as p75,
  count(*) filter (where a.evidence_level = 'documented') as documented_count
from gt.business_actuals a
join gt.owner_interviews i on i.id = a.interview_id
join gt.consents c on c.id = i.consent_id
where i.status = 'reviewed'
  and i.data_origin = 'research' and a.data_origin = 'research'
  and a.verification_status <> 'rejected'
  and c.allows_aggregate_use and c.withdrawn_on is null
group by i.business_model_id, a.metric_key, i.business_status
having count(distinct i.id) >= 5;
comment on view gt.v_actuals_aggregate is 'Privacy-preserving aggregate of owner actuals (k ≥ 5 interviews per cell, consent active, reviewed). Min/max are deliberately omitted.';

create trigger interview_subjects_updated before update on gt.interview_subjects for each row execute function ops.set_updated_at();
create trigger owner_interviews_updated before update on gt.owner_interviews for each row execute function ops.set_updated_at();
create trigger business_actuals_updated before update on gt.business_actuals for each row execute function ops.set_updated_at();
