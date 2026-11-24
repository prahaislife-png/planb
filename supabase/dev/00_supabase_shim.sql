-- ─────────────────────────────────────────────────────────────────────────────
-- LOCAL / CI ONLY. Never run against a Supabase project.
--
-- Minimal stand-in for the parts of the Supabase platform our migrations depend
-- on (roles, the `auth` schema, auth.uid()/auth.jwt(), the `extensions` schema),
-- so the real migrations in supabase/migrations/ apply unchanged to a plain
-- PostgreSQL 16 instance and RLS can be tested without the Supabase stack.
-- `planb db migrate` applies this automatically when schema `auth` is absent.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Same contract as Supabase: identity comes from the per-transaction JWT claims GUC.
create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(auth.jwt() ->> 'role', current_user::text)
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt(), auth.role() to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

do $$
begin
  execute format('alter database %I set search_path = public, extensions', current_database());
end $$;
set search_path = public, extensions;
