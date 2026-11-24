-- PlanB · 0017 · The legal gate on sources is an administrator decision — in the database, not just the UI.
--
-- Until now any researcher or reviewer could update intel.sources, including the fields that decide whether
-- automated collection is allowed and whether derived data may be published. Those fields are now admin-only
-- for signed-in users and never writable by the research worker. Catalogue sync (run by the database owner
-- from the version-controlled YAML, with no signed-in user) is unaffected.

create or replace function intel.guard_source_legal_fields() returns trigger
language plpgsql as $$
declare
  legal_change boolean;
begin
  if tg_op = 'INSERT' then
    legal_change := new.ingestion_enabled or new.permission_granted_on is not null;
  else
    legal_change := (new.ingestion_enabled, new.reuse_status, new.recommended_ingestion, new.permission_granted_on,
                     new.permission_evidence, new.licence_name, new.licence_url, new.licence_quoted_terms, new.terms_checked_on)
                    is distinct from
                    (old.ingestion_enabled, old.reuse_status, old.recommended_ingestion, old.permission_granted_on,
                     old.permission_evidence, old.licence_name, old.licence_url, old.licence_quoted_terms, old.terms_checked_on);
  end if;
  if not legal_change then
    return new;
  end if;
  if ops.is_worker() then
    raise exception 'the research worker cannot change a source''s reuse terms, permission or ingestion setting' using errcode = '42501';
  end if;
  if ops.current_user_id() is not null and not ops.has_role('admin') then
    raise exception 'only an administrator can change a source''s reuse terms, permission or ingestion setting' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger sources_legal_guard before insert or update on intel.sources
  for each row execute function intel.guard_source_legal_fields();

-- A source researched as do-not-ingest can never have automated collection switched on.
alter table intel.sources
  add constraint sources_no_ingestion_when_do_not_ingest
  check (not ingestion_enabled or recommended_ingestion <> 'do_not_ingest');

-- Pricing plans are configuration, not personal data: audit them with values like any other table.
drop trigger zz_audit on customer.pricing_plans;
create trigger zz_audit after insert or update or delete on customer.pricing_plans
  for each row execute function ops.audit_row();
