"""Apply supabase/migrations to a plain PostgreSQL database (local dev and CI).

Production uses the Supabase CLI (`supabase db push`), which records applied versions in
`supabase_migrations.schema_migrations`. This runner writes to the same table with the same
shape, so a database migrated here can be continued by the Supabase CLI and vice versa.
On a non-Supabase database it first applies supabase/dev/00_supabase_shim.sql.
"""

from __future__ import annotations

import re
from pathlib import Path

import psycopg

from .config import Settings

_VERSION = re.compile(r"^(\d{14})_(.+)\.sql$")


def migrate(settings: Settings | None = None, *, verbose: bool = True) -> list[str]:
    settings = settings or Settings.load()
    applied: list[str] = []
    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        has_auth = conn.execute("select to_regnamespace('auth') is not null").fetchone()[0]
        if not has_auth:
            shim = settings.migrations_dir.parent / "dev" / "00_supabase_shim.sql"
            conn.execute(shim.read_text())
            if verbose:
                print(f"applied local Supabase shim ({shim.name})")
        conn.execute("create schema if not exists supabase_migrations")
        conn.execute(
            "create table if not exists supabase_migrations.schema_migrations "
            "(version text primary key, statements text[], name text)"
        )
        done = {r[0] for r in conn.execute("select version from supabase_migrations.schema_migrations")}

    for path in sorted(Path(settings.migrations_dir).glob("*.sql")):
        m = _VERSION.match(path.name)
        if not m:
            raise RuntimeError(f"migration file name must be <14-digit version>_<name>.sql: {path.name}")
        version, name = m.groups()
        if version in done:
            continue
        # Fresh connection per migration so the database-level search_path set by the shim applies.
        with psycopg.connect(settings.database_url) as conn:
            with conn.transaction():
                conn.execute(path.read_text())
                conn.execute(
                    "insert into supabase_migrations.schema_migrations (version, name) values (%s, %s)",
                    (version, name),
                )
        applied.append(path.name)
        if verbose:
            print(f"applied {path.name}")
    if verbose and not applied:
        print("database is up to date")
    return applied
