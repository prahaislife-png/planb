"""Test harness: an isolated, freshly migrated PostgreSQL database (planb_test) per test session."""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from planb_research.config import Settings
from planb_research.migrate import migrate
from planb_research.pipeline import Worker, enqueue
from planb_research.storage import LocalEvidenceStore

from .fixtures import SYNTHETIC_DPR_PAGES

TEST_DB_URL = os.environ.get("PLANB_TEST_DATABASE_URL", "postgresql://planb:planb@127.0.0.1:5432/planb_test")
ADMIN, RESEARCHER, REVIEWER, CUSTOMER = (uuid.UUID(int=i) for i in (1, 2, 3, 4))


@pytest.fixture(scope="session")
def settings(tmp_path_factory) -> Settings:
    base = Settings.load()
    name = TEST_DB_URL.rsplit("/", 1)[1]
    assert "test" in name, "refusing to run tests against a database whose name does not contain 'test'"
    with psycopg.connect(TEST_DB_URL.rsplit("/", 1)[0] + "/postgres", autocommit=True) as admin:
        admin.execute(f'drop database if exists "{name}" with (force)')
        admin.execute(f'create database "{name}"')
    s = replace(base, database_url=TEST_DB_URL, db_role=None, evidence_dir=Path(tmp_path_factory.mktemp("evidence")), anthropic_api_key=None)
    migrate(s, verbose=False)
    with psycopg.connect(TEST_DB_URL, autocommit=True) as c:
        for uid, name_, roles in ((ADMIN, "Admin", ["admin"]), (RESEARCHER, "Researcher", ["researcher"]), (REVIEWER, "Reviewer", ["reviewer"]), (CUSTOMER, "Customer", [])):
            c.execute("insert into auth.users (id, email) values (%s, %s)", (uid, f"{name_.lower()}@test.invalid"))
            if roles:
                c.execute("insert into ops.staff_members (user_id, display_name) values (%s, %s)", (uid, name_))
                for r in roles:
                    c.execute("insert into ops.staff_roles (user_id, role) values (%s, %s)", (uid, r))
    return s


@pytest.fixture()
def conn(settings):
    """Owner connection (bypasses RLS) for arranging and asserting."""
    with psycopg.connect(settings.database_url, row_factory=dict_row) as c:
        yield c
        c.rollback()
        c.execute("update ops.research_runs set status = 'cancelled', finished_at = now(), locked_by = null where status in ('queued', 'waiting_retry', 'running')")
        c.commit()


@contextmanager
def as_user(settings, user_id: uuid.UUID | None, role: str = "authenticated"):
    """A connection that behaves like a Supabase request for the given user (RLS enforced)."""
    with psycopg.connect(settings.database_url, row_factory=dict_row) as c:
        c.execute(f"set role {role}")
        if user_id:
            c.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": str(user_id), "role": role}),))
        c.commit()
        yield c


@contextmanager
def as_worker(settings):
    with psycopg.connect(settings.database_url, row_factory=dict_row) as c:
        c.execute("set role planb_worker")
        c.commit()
        yield c


class Factory:
    def __init__(self, conn, settings):
        self.conn, self.settings = conn, settings

    def source(self, *, reuse_status="permitted_with_attribution", origin="test", **kw) -> dict:
        slug = f"src-{uuid.uuid4().hex[:10]}"
        row = self.conn.execute(
            """insert into intel.sources (slug, name, source_type, authority_level, access_method, reuse_status, terms_checked_on,
                                          registry_confidence, recommended_ingestion, data_origin, default_revalidation_days, rate_limit_per_minute)
               values (%s, %s, 'government_project_report', 'primary_government', 'http_download', %s, current_date, 'verified', %s, %s, %s, 600)
               returning *""",
            (slug, f"Test source {slug}", reuse_status, kw.get("recommended_ingestion", "manual_only"), origin, kw.get("revalidation_days", 3650)),
        ).fetchone()
        self.conn.commit()
        return row

    def model(self, *, origin="test", complete_identity=False) -> dict:
        slug = f"test-model-{uuid.uuid4().hex[:10]}"
        ind = self.conn.execute("select id from intel.industries where slug = 'food-processing'").fetchone()["id"]
        row = self.conn.execute(
            """insert into intel.business_models (slug, name, industry_id, description, operating_model, target_customers, data_origin)
               values (%s, %s, %s, %s, 'Synthetic operating model.', 'Synthetic customers.', %s) returning *""",
            (slug, f"Synthetic model {slug}", ind, "Synthetic description." if complete_identity else None, origin),
        ).fetchone()
        self.conn.commit()
        return row

    def document(self, source: dict, *, origin="test", pages=SYNTHETIC_DPR_PAGES, date="2026-01-01") -> dict:
        sha = hashlib.sha256(uuid.uuid4().bytes).hexdigest()
        doc = self.conn.execute(
            """insert into intel.source_documents (source_id, title, mime_type, byte_size, sha256, storage_path, text_status, page_count,
                                                  document_date, document_date_precision, retrieval_method, data_origin)
               values (%s, 'Synthetic DPR fixture', 'application/pdf', 1000, %s, %s, 'extracted', %s, %s, 'year', 'manual_upload', %s) returning *""",
            (source["id"], sha, f"documents/{sha[:2]}/{sha}.pdf", len(pages), date, origin),
        ).fetchone()
        for no, text in pages:
            self.conn.execute("insert into intel.document_pages (document_id, page_no, text) values (%s, %s, %s)", (doc["id"], no, text))
        self.conn.commit()
        return doc

    def run_document(self, *, origin="test", reuse_status="permitted_with_attribution", model=None, params=None, date="2026-01-01") -> dict:
        """Run the full document_research pipeline on the synthetic fixture. Returns ids and the final run."""
        source = self.source(reuse_status=reuse_status, origin=origin)
        model = model or self.model(origin=origin)
        doc = self.document(source, origin=origin, date=date)
        run = enqueue(self.conn, "document_research", business_model_id=model["id"], source_document_id=doc["id"],
                      params=params or {}, data_origin=origin, idempotency_key=f"t:{uuid.uuid4()}")
        worker = Worker(self.conn, self.settings, store=LocalEvidenceStore(self.settings.evidence_dir))
        final = worker.execute(self._claim(worker, run["id"]))
        variant = self.conn.execute("select * from intel.business_variants where business_model_id = %s", (model["id"],)).fetchone()
        return {"source": source, "model": model, "doc": doc, "run": final, "variant": variant, "worker": worker}

    def _claim(self, worker: Worker, run_id) -> dict:
        self.conn.execute("update ops.research_runs set next_attempt_at = now() - interval '1 second' where id = %s", (run_id,))
        self.conn.commit()
        run = worker.claim()
        assert run is not None and run["id"] == run_id, "another runnable job was left in the queue"
        return run

    def refresh(self, model_id) -> dict:
        run = enqueue(self.conn, "business_refresh", business_model_id=model_id, idempotency_key=f"t:{uuid.uuid4()}")
        worker = Worker(self.conn, self.settings, store=LocalEvidenceStore(self.settings.evidence_dir))
        return worker.execute(self._claim(worker, run["id"]))


@pytest.fixture()
def factory(conn, settings) -> Factory:
    return Factory(conn, settings)


__all__ = ["ADMIN", "CUSTOMER", "RESEARCHER", "REVIEWER", "Jsonb", "as_user", "as_worker"]
