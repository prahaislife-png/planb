"""Database access helpers (psycopg 3)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from .config import Settings


def connect(settings: Settings | None = None, *, role: str | None = "__from_settings__", autocommit: bool = False) -> psycopg.Connection:
    """Open a connection. If a role is configured the session drops to it immediately."""
    settings = settings or Settings.load()
    conn = psycopg.connect(settings.database_url, row_factory=dict_row, autocommit=autocommit)
    effective_role = settings.db_role if role == "__from_settings__" else role
    if effective_role:
        with conn.cursor() as cur:
            cur.execute(sql.SQL("set role {}").format(sql.Identifier(effective_role)))
        if not autocommit:
            conn.commit()
    return conn


@contextmanager
def transaction(conn: psycopg.Connection, *, run_id: str | None = None) -> Iterator[psycopg.Cursor]:
    """One transaction; tags audit rows with the research run when given."""
    with conn.transaction():
        with conn.cursor() as cur:
            if run_id:
                cur.execute("select set_config('planb.run_id', %s, true)", (str(run_id),))
            yield cur
