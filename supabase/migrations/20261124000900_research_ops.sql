-- PlanB · 0009 · Research operations: tasks, durable runs, logs, LLM spend, reviews.

-- ── Research tasks (the backlog of things humans or the pipeline must do) ────
create table intel.research_tasks (
  id uuid primary key default gen_random_uuid(),
  business_model_id uuid references intel.business_models (id) on delete cascade,
  business_variant_id uuid references intel.business_variants (id) on delete cascade,
  source_id uuid references intel.sources (id),
  task_type text not null check (task_type in (
    'obtain_supplier_quotes', 'confirm_local_rent', 'collect_local_price', 'verify_licence', 'interview_owner',
    'confirm_capacity', 'investigate_margin', 'resolve_conflict', 'revalidate_evidence', 'find_source_document',
    'review_claims', 'verify_source_terms', 'define_assumption', 'complete_record_section', 'ocr_document', 'other')),
  title text not null,
  description text,
  instructions text,
  template_key text,
  target_table text,
  target_id uuid,
  target_key text,
  priority int not null default 3 check (priority between 1 and 4),
  requires_human boolean not null default true,
  status text not null default 'open' check (status in ('open', 'in_progress', 'blocked', 'done', 'cancelled', 'auto_closed')),
  assignee uuid references auth.users (id),
  due_on date,
  generated_by text not null default 'manual',
  dedupe_key text,
  research_run_id uuid,
  resolution_note text,
  completed_at timestamptz,
  completed_by uuid references auth.users (id),
  data_origin ops.data_origin,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('done', 'cancelled', 'auto_closed') or completed_at is not null)
);
comment on table intel.research_tasks is 'Actionable research work: gaps found by the pipeline (quotes to obtain, rents to confirm, licences to verify, owners to interview, conflicts to resolve) and manually raised tasks.';
comment on column intel.research_tasks.dedupe_key is 'Stable key of the gap that produced the task; at most one live task per key, so re-running gap analysis never duplicates work.';
comment on column intel.research_tasks.template_key is 'Key of the enquiry/questionnaire template in research/templates to use for this task.';
create unique index research_tasks_live_dedupe_idx on intel.research_tasks (dedupe_key)
  where dedupe_key is not null and status in ('open', 'in_progress', 'blocked');
create index research_tasks_model_idx on intel.research_tasks (business_model_id, status);
create index research_tasks_status_idx on intel.research_tasks (status, priority, due_on);
create trigger research_tasks_updated before update on intel.research_tasks for each row execute function ops.set_updated_at();

-- ── Durable research runs ────────────────────────────────────────────────────
create table ops.research_runs (
  id uuid primary key default gen_random_uuid(),
  pipeline text not null check (pipeline in ('document_research', 'business_refresh', 'freshness_scan', 'catalog_sync')),
  business_model_id uuid references intel.business_models (id),
  source_document_id uuid references intel.source_documents (id),
  params jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  status text not null default 'queued' check (status in (
    'queued', 'running', 'waiting_retry', 'succeeded', 'failed', 'cancelled', 'budget_exhausted')),
  current_stage text,
  attempt int not null default 0,
  max_attempts int not null default 3 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  locked_by text,
  locked_until timestamptz,
  heartbeat_at timestamptz,
  budget_usd numeric check (budget_usd >= 0),
  budget_tokens bigint check (budget_tokens >= 0),
  spent_usd numeric not null default 0,
  spent_tokens bigint not null default 0,
  result jsonb,
  error text,
  requested_by uuid references auth.users (id),
  data_origin ops.data_origin,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
comment on table ops.research_runs is 'Durable job record for a multi-stage research pipeline. Workers lease a run (locked_until), heartbeat while working, and can crash at any point: an expired lease makes the run claimable again and it resumes from its first unfinished step.';
comment on column ops.research_runs.idempotency_key is 'Enqueueing the same logical job twice returns the existing run instead of duplicating work.';
comment on column ops.research_runs.budget_usd is 'Execution budget. When LLM spend reaches it the run stops with status budget_exhausted instead of continuing to spend.';
create index research_runs_claim_idx on ops.research_runs (status, next_attempt_at);
create index research_runs_model_idx on ops.research_runs (business_model_id, created_at desc);

create table ops.research_run_steps (
  run_id uuid not null references ops.research_runs (id) on delete cascade,
  stage text not null,
  sequence_no int not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  attempt int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms int,
  output jsonb,
  error text,
  primary key (run_id, stage)
);
comment on table ops.research_run_steps is 'One row per pipeline stage of a run. A succeeded step is never re-executed on resume; each stage is written to be idempotent so a re-executed failed step cannot duplicate records.';

create table ops.research_run_logs (
  id bigint generated always as identity primary key,
  run_id uuid not null references ops.research_runs (id) on delete cascade,
  logged_at timestamptz not null default clock_timestamp(),
  level text not null default 'info' check (level in ('debug', 'info', 'warning', 'error')),
  stage text,
  message text not null,
  data jsonb
);
create index research_run_logs_run_idx on ops.research_run_logs (run_id, id);

create table ops.llm_usage (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  run_id uuid references ops.research_runs (id) on delete set null,
  stage text,
  provider text not null,
  model text not null,
  purpose text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cost_usd numeric not null default 0,
  business_model_id uuid references intel.business_models (id),
  source_document_id uuid references intel.source_documents (id)
);
comment on table ops.llm_usage is 'Every LLM call made by research workers with tokens and computed cost — the basis of research cost monitoring and run budgets.';
create index llm_usage_run_idx on ops.llm_usage (run_id);
create index llm_usage_time_idx on ops.llm_usage (occurred_at desc);

-- Lease the next runnable run. SKIP LOCKED makes concurrent workers safe; an expired lease on a
-- 'running' run means its worker died, so the run is handed out again (resume after failure).
create or replace function ops.claim_research_run(p_worker text, p_lease_seconds int default 300)
returns ops.research_runs
language plpgsql
as $$
declare
  v_run ops.research_runs;
begin
  select * into v_run
  from ops.research_runs r
  where (r.status in ('queued', 'waiting_retry') and r.next_attempt_at <= now())
     or (r.status = 'running' and r.locked_until < now())
  order by r.next_attempt_at, r.created_at
  limit 1
  for update skip locked;

  if not found then
    return null;
  end if;

  if v_run.attempt >= v_run.max_attempts then
    update ops.research_runs
       set status = 'failed', finished_at = now(), locked_by = null, locked_until = null,
           error = coalesce(error, 'worker lost') || ' (max attempts reached)'
     where id = v_run.id;
    return null;
  end if;

  update ops.research_runs
     set status = 'running',
         attempt = attempt + 1,
         locked_by = p_worker,
         locked_until = now() + make_interval(secs => p_lease_seconds),
         heartbeat_at = now(),
         started_at = coalesce(started_at, now())
   where id = v_run.id
  returning * into v_run;
  return v_run;
end $$;

create or replace function ops.heartbeat_research_run(p_run_id uuid, p_worker text, p_lease_seconds int default 300)
returns boolean
language plpgsql
as $$
begin
  update ops.research_runs
     set heartbeat_at = now(), locked_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_run_id and locked_by = p_worker and status = 'running';
  return found;
end $$;

-- ── Reviews ──────────────────────────────────────────────────────────────────
create table intel.research_reviews (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in (
    'business_version', 'evidence_claim', 'cost_observation', 'parameter_observation', 'market_observation',
    'location_metric', 'supplier_quote', 'owner_interview', 'regulation', 'source', 'observation_conflict')),
  subject_id uuid not null,
  business_model_id uuid references intel.business_models (id) on delete cascade,
  decision text not null check (decision in ('approve', 'reject', 'request_changes', 'accept', 'correct', 'verify', 'dispute', 'resolve')),
  comments text,
  reviewer uuid references auth.users (id),
  reviewed_at timestamptz not null default now(),
  check (decision not in ('reject', 'request_changes', 'correct', 'dispute') or (comments is not null and length(btrim(comments)) > 0))
);
comment on table intel.research_reviews is 'Append-only log of every human review decision (claim accepted/rejected/corrected, observation verified/disputed, version approved…). Negative decisions must carry a reason.';
create index research_reviews_subject_idx on intel.research_reviews (subject_type, subject_id);
create index research_reviews_model_idx on intel.research_reviews (business_model_id, reviewed_at desc);
create trigger research_reviews_append_only before update or delete on intel.research_reviews
  for each row execute function ops.forbid_mutation();
