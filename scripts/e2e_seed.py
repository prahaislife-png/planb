#!/usr/bin/env python3
"""Build an isolated database for the dashboard end-to-end test and print the test record's slug.

Creates/replaces the database named in E2E_DATABASE_URL (its name must contain "e2e"), applies every migration, seeds the
development staff users, and runs the real document_research pipeline on the SYNTHETIC fixture document, marked
data_origin = 'test' so nothing in it can ever be verified-as-research or published.

    cd research && .venv/bin/python ../scripts/e2e_seed.py
"""

from __future__ import annotations

import os
import sys
from dataclasses import replace
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "research"))

from planb_research.cli import DEV_USERS  # noqa: E402
from planb_research.config import Settings  # noqa: E402
from planb_research.migrate import migrate  # noqa: E402
from tests.conftest import Factory  # noqa: E402

URL = os.environ.get("E2E_DATABASE_URL", "postgresql://planb:planb@127.0.0.1:5432/planb_e2e")


def main() -> int:
    name = URL.rsplit("/", 1)[1]
    if "e2e" not in name:
        print("refusing: database name must contain 'e2e'", file=sys.stderr)
        return 2
    with psycopg.connect(URL.rsplit("/", 1)[0] + "/postgres", autocommit=True) as admin:
        admin.execute(f'drop database if exists "{name}" with (force)')
        admin.execute(f'create database "{name}"')
    settings = replace(Settings.load(), database_url=URL, db_role=None, evidence_dir=Path(os.environ.get("E2E_EVIDENCE_DIR", "/tmp/planb-e2e-evidence")))
    migrate(settings, verbose=False)
    with psycopg.connect(URL, row_factory=dict_row) as conn:
        for uid, email, display, roles in DEV_USERS:
            conn.execute("insert into auth.users (id, email) values (%s, %s)", (uid, email))
            conn.execute("insert into ops.staff_members (user_id, display_name) values (%s, %s)", (uid, display))
            for role in roles:
                conn.execute("insert into ops.staff_roles (user_id, role) values (%s, %s)", (uid, role))
        conn.commit()
        result = Factory(conn, settings).run_document(origin="test")
        if result["run"]["status"] != "succeeded":
            print(f"pipeline failed: {result['run']['error']}", file=sys.stderr)
            return 1
        # a second registry source the test can attribute a manual observation to
        conn.execute(
            """insert into intel.sources (slug, name, source_type, authority_level, access_method, reuse_status, data_origin)
               values ('e2e-second-source', 'E2E second source (synthetic)', 'manufacturer_catalogue', 'commercial', 'manual_download', 'unclear', 'test')""")
        # one synthetic local rent figure, so the test can derive a cost locally through the dashboard
        conn.execute(
            """insert into intel.location_metrics (location_id, metric_key, value, unit_code, period, observed_on, geographic_scope, source_id,
                                                   evidence_type, evidence_grade, data_origin)
               select l.id, 'commercial_rent_per_sqft_month', 80, 'inr', 'per_month', current_date, 'city', s.id, 'listing_observation', 'C', 'test'
               from intel.locations l, intel.sources s where l.slug = 'pune-city' and s.slug = 'e2e-second-source'""")
        conn.commit()
        print(result["model"]["slug"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
