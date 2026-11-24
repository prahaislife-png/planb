-- PlanB · 0001 · Foundation: extensions, schemas, roles, staff/RBAC helpers, audit log.
--
-- Schema layout (the security boundary of the whole product):
--   intel     private research records — the proprietary database. Staff + research worker only.
--   gt        "Ground Truth": owner interviews & actuals. PII is isolated in gt.interview_subjects.
--   pub       immutable, approved, customer-facing publication snapshots.
--   customer  customer profiles, assets, recommendations (personal data; owner-only RLS).
--   ops       research operations: runs, steps, logs, LLM spend, staff roles, audit log.
-- Nothing proprietary lives in `public` (the only schema Supabase's Data API exposes by default).

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists vector with schema extensions;

create schema if not exists intel;
create schema if not exists gt;
create schema if not exists pub;
create schema if not exists customer;
create schema if not exists ops;

comment on schema intel is 'Private research records: business models, observations, evidence, sources. Never exposed to customer clients.';
comment on schema gt is 'PlanB Ground Truth: owner interviews and actual performance. PII isolated in gt.interview_subjects.';
comment on schema pub is 'Published, approved, immutable customer-facing snapshots.';
comment on schema customer is 'Customer personal data: profiles, assets, recommendations, saved businesses.';
comment on schema ops is 'Research operations: job queue, run logs, LLM spend, staff RBAC, audit log.';

-- ── Roles ────────────────────────────────────────────────────────────────────
-- planb_worker: the Python research worker. Deliberately NOT service_role: it can
-- write research + ops records but has no access to customer data or interview PII.
do $$
begin
  if not exists (select from pg_roles where rolname = 'planb_worker') then
    create role planb_worker nologin noinherit;
  end if;
end $$;

grant usage on schema intel, ops, gt, pub to authenticated, planb_worker;
grant usage on schema customer to authenticated;
grant usage on schema pub to anon;

-- ── Generic helpers ──────────────────────────────────────────────────────────
create or replace function ops.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── Staff & RBAC ─────────────────────────────────────────────────────────────
create table ops.staff_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table ops.staff_members is 'Internal PlanB Intelligence users. Anyone authenticated who is not listed here is a customer.';

create table ops.staff_roles (
  user_id uuid not null references ops.staff_members (user_id) on delete cascade,
  role text not null check (role in ('admin', 'researcher', 'reviewer')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id),
  primary key (user_id, role)
);
comment on table ops.staff_roles is 'Role grants. admin: everything incl. publication & staff. researcher: create/edit research records. reviewer: verify claims, approve versions.';

create or replace function ops.has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = ops, pg_temp
as $$
  select exists (
    select 1
    from ops.staff_roles r
    join ops.staff_members m on m.user_id = r.user_id and m.is_active
    where r.user_id = auth.uid() and r.role = any (roles)
  )
$$;
comment on function ops.has_role is 'True when the current JWT subject holds any of the given staff roles. SECURITY DEFINER so RLS policies can call it without recursive policy checks.';

create or replace function ops.is_staff() returns boolean
language sql stable security definer set search_path = ops, pg_temp
as $$
  select exists (
    select 1 from ops.staff_members m
    where m.user_id = auth.uid() and m.is_active
      and exists (select 1 from ops.staff_roles r where r.user_id = m.user_id)
  )
$$;

create or replace function ops.is_worker() returns boolean
language sql stable
as $$ select current_user = 'planb_worker' $$;

revoke all on function ops.has_role(text[]), ops.is_staff() from public;
grant execute on function ops.has_role(text[]), ops.is_staff(), ops.is_worker() to authenticated, planb_worker, anon;

-- ── Audit log (append-only) ──────────────────────────────────────────────────
create table ops.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  schema_name text not null,
  table_name text not null,
  row_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_user_id uuid,
  actor_db_role text not null default current_user,
  research_run_id uuid,
  changed_fields text[],
  old_row jsonb,
  new_row jsonb
);
comment on table ops.audit_log is 'Append-only row-level audit trail for research, ground-truth, publication and customer tables. Written by ops.audit_row() triggers.';
create index audit_log_row_idx on ops.audit_log (schema_name, table_name, row_id, occurred_at desc);
create index audit_log_time_idx on ops.audit_log (occurred_at desc);
create index audit_log_actor_idx on ops.audit_log (actor_user_id, occurred_at desc);

create or replace function ops.audit_row() returns trigger
language plpgsql security definer set search_path = ops, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_run uuid;
  v_row_id text;
begin
  v_run := nullif(current_setting('planb.run_id', true), '')::uuid;
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_row_id := v_old ->> 'id';
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_row_id := v_new ->> 'id';
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row_id := v_new ->> 'id';
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n
    where n.key <> 'updated_at' and n.value is distinct from v_old -> n.key;
    if v_changed is null then
      return new; -- no-op update: nothing to record
    end if;
  end if;
  -- Tables holding personal data pass 'redact': we record that a change happened and which
  -- fields changed, but never copy the personal data itself into the audit trail.
  if tg_nargs > 0 and tg_argv[0] = 'redact' then
    v_old := null;
    v_new := null;
  end if;
  insert into ops.audit_log (schema_name, table_name, row_id, action, actor_user_id, actor_db_role, research_run_id, changed_fields, old_row, new_row)
  values (tg_table_schema, tg_table_name, v_row_id, tg_op, auth.uid(),
          coalesce(nullif(current_setting('role', true), 'none'), session_user::text), v_run, v_changed, v_old, v_new);
  return coalesce(new, old);
end $$;

create or replace function ops.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% on %.% is not permitted: this table is append-only', tg_op, tg_table_schema, tg_table_name
    using errcode = 'P0001';
end $$;

create trigger audit_log_append_only before update or delete on ops.audit_log
  for each row execute function ops.forbid_mutation();

-- Shared vocabulary for provenance of a record itself (not of a number).
-- 'research' = genuine research output. 'demo' = illustrative data for UI walkthroughs.
-- 'test' = automated-test fixtures. Demo/test rows can never be verified or published
-- (enforced by triggers in later migrations).
create domain ops.data_origin as text
  not null default 'research'
  check (value in ('research', 'demo', 'test'));
