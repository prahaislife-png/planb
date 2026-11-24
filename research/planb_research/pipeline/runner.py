"""Durable, resumable execution of research pipelines.

Design
  * A run (ops.research_runs) is leased by a worker for a bounded time and heart-beaten per stage.
    If the worker dies the lease expires and any worker can claim the run again.
  * Each stage has a row in ops.research_run_steps. A succeeded stage is never executed again, so a
    resumed run continues from its first unfinished stage.
  * Every stage is idempotent (upserts keyed on natural or dedupe keys), so re-executing a stage that
    failed half-way cannot duplicate records.
  * Failures are retried with exponential backoff up to max_attempts; non-retryable errors and
    exhausted budgets stop the run with an explicit status instead of looping.
  * Enqueueing is idempotent on idempotency_key.
"""

from __future__ import annotations

import json
import os
import socket
import time
import traceback
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import psycopg
import psycopg.sql
from psycopg.types.json import Jsonb

from ..config import Settings
from ..storage import EvidenceStore, default_store


class NonRetryableError(Exception):
    """The run cannot succeed by retrying (missing input, refused source, no extractor…)."""


class BudgetExceeded(Exception):
    """The run's execution budget is spent."""


@dataclass
class RunContext:
    conn: psycopg.Connection
    settings: Settings
    store: EvidenceStore
    run: dict[str, Any]
    worker_id: str
    stage: str = ""
    carried: dict[str, Any] = field(default_factory=dict)  # outputs of earlier stages, by stage name
    log_conn: psycopg.Connection | None = None

    @property
    def run_id(self) -> str:
        return str(self.run["id"])

    @property
    def params(self) -> dict[str, Any]:
        return self.run["params"] or {}

    @property
    def data_origin(self) -> str:
        return self.run["data_origin"]

    def log(self, message: str, level: str = "info", **data: Any) -> None:
        """Write a run-log line. Logs go through a dedicated autocommit connection, so they can be written from
        inside a stage's transaction and survive that transaction being rolled back."""
        target = self.log_conn or self.conn
        target.execute(
            "insert into ops.research_run_logs (run_id, level, stage, message, data) values (%s, %s, %s, %s, %s)",
            (self.run_id, level, self.stage, message, Jsonb(json.loads(json.dumps(data, default=str))) if data else None),
        )
        if self.log_conn is None:
            self.conn.commit()

    def tag_audit(self) -> None:
        """Make audit rows written in the current transaction reference this run."""
        self.conn.execute("select set_config('planb.run_id', %s, true)", (self.run_id,))

    def record_llm_usage(self, *, provider: str, model: str, purpose: str, input_tokens: int, output_tokens: int,
                         cost_usd: float, cache_read_tokens: int = 0) -> None:
        self.conn.execute(
            """insert into ops.llm_usage (run_id, stage, provider, model, purpose, input_tokens, output_tokens,
                                          cache_read_tokens, cost_usd, business_model_id, source_document_id)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (self.run_id, self.stage, provider, model, purpose, input_tokens, output_tokens, cache_read_tokens, cost_usd,
             self.run.get("business_model_id"), self.run.get("source_document_id")),
        )
        row = self.conn.execute(
            """update ops.research_runs set spent_usd = spent_usd + %s, spent_tokens = spent_tokens + %s
               where id = %s returning spent_usd, spent_tokens, budget_usd, budget_tokens""",
            (cost_usd, input_tokens + output_tokens, self.run_id),
        ).fetchone()
        self.conn.commit()
        self.run.update(row)

    def check_budget(self, *, next_call_estimate_usd: float = 0.0) -> None:
        """Called BEFORE spending: refuses to start a call the budget cannot cover."""
        budget, spent = self.run.get("budget_usd"), float(self.run.get("spent_usd") or 0)
        if budget is not None and spent + next_call_estimate_usd > float(budget):
            raise BudgetExceeded(f"budget ${float(budget):.2f} would be exceeded (spent ${spent:.4f}, next ≈ ${next_call_estimate_usd:.4f})")
        tb, ts = self.run.get("budget_tokens"), int(self.run.get("spent_tokens") or 0)
        if tb is not None and ts >= int(tb):
            raise BudgetExceeded(f"token budget {tb} exhausted")


StageFn = Callable[[RunContext], dict[str, Any] | None]
PIPELINES: dict[str, list[tuple[str, StageFn]]] = {}


def register_pipeline(name: str, stages: list[tuple[str, StageFn]]) -> None:
    PIPELINES[name] = stages


def enqueue(
    conn: psycopg.Connection,
    pipeline: str,
    *,
    business_model_id: str | None = None,
    source_document_id: str | None = None,
    params: dict[str, Any] | None = None,
    idempotency_key: str | None = None,
    budget_usd: float | None = None,
    budget_tokens: int | None = None,
    max_attempts: int = 3,
    requested_by: str | None = None,
    data_origin: str | None = None,
) -> dict[str, Any]:
    """Queue a run. With an idempotency key, a repeated call returns the existing run.

    A run inherits the data origin of its business model unless told otherwise, so that everything
    derived for a demo/test record is itself marked demo/test.
    """
    if pipeline not in PIPELINES:
        raise ValueError(f"unknown pipeline {pipeline!r}")
    if data_origin is None:
        row = conn.execute("select data_origin from intel.business_models where id = %s", (business_model_id,)).fetchone() if business_model_id else None
        data_origin = row["data_origin"] if row else "research"
    row = conn.execute(
        """insert into ops.research_runs (pipeline, business_model_id, source_document_id, params, idempotency_key,
                                          budget_usd, budget_tokens, max_attempts, requested_by, data_origin)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           on conflict (idempotency_key) do nothing
           returning *""",
        (pipeline, business_model_id, source_document_id, Jsonb(params or {}), idempotency_key, budget_usd, budget_tokens,
         max_attempts, requested_by, data_origin),
    ).fetchone()
    if row is None:
        row = conn.execute("select * from ops.research_runs where idempotency_key = %s", (idempotency_key,)).fetchone()
        row["_already_existed"] = True
    conn.commit()
    return row


def backoff_seconds(attempt: int) -> int:
    return min(900, 15 * (2 ** max(attempt - 1, 0)))


class Worker:
    def __init__(self, conn: psycopg.Connection, settings: Settings | None = None, *, worker_id: str | None = None,
                 lease_seconds: int = 300, store: EvidenceStore | None = None) -> None:
        self.conn = conn
        self.settings = settings or Settings.load()
        self.store = store or default_store(self.settings.evidence_dir)
        self.worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}"
        self.lease_seconds = lease_seconds
        self._log_conn: psycopg.Connection | None = None

    def _logging_connection(self) -> psycopg.Connection:
        """A second, autocommit session with the same role as the work connection, used only for run logs."""
        if self._log_conn is None or self._log_conn.closed:
            role = self.conn.execute("select current_user as r").fetchone()["r"]
            self.conn.commit()
            log_conn = psycopg.connect(self.settings.database_url, autocommit=True)
            log_conn.execute(psycopg.sql.SQL("set role {}").format(psycopg.sql.Identifier(role)))
            self._log_conn = log_conn
        return self._log_conn

    # ── queue ────────────────────────────────────────────────────────────────
    def claim(self) -> dict[str, Any] | None:
        row = self.conn.execute(
            "select (r).* from (select ops.claim_research_run(%s, %s) as r) x where (r).id is not null",
            (self.worker_id, self.lease_seconds),
        ).fetchone()
        self.conn.commit()
        return row

    def run_once(self) -> dict[str, Any] | None:
        """Claim and execute one run. Returns the final run row, or None when the queue is empty."""
        run = self.claim()
        if run is None:
            return None
        return self.execute(run)

    def run_until_empty(self, max_runs: int = 100) -> int:
        n = 0
        while n < max_runs and self.run_once() is not None:
            n += 1
        return n

    # ── execution ────────────────────────────────────────────────────────────
    def _finish(self, run_id: str, status: str, *, error: str | None = None, result: dict | None = None,
                retry_in: int | None = None) -> dict[str, Any]:
        row = self.conn.execute(
            """update ops.research_runs
                  set status = %s, error = %s, result = coalesce(%s, result), locked_by = null, locked_until = null,
                      finished_at = case when %s in ('succeeded', 'failed', 'cancelled', 'budget_exhausted') then now() else null end,
                      next_attempt_at = case when %s::int is null then next_attempt_at else now() + make_interval(secs => %s::int) end
                where id = %s returning *""",
            (status, error, Jsonb(json.loads(json.dumps(result, default=str))) if result is not None else None, status, retry_in, retry_in, run_id),
        ).fetchone()
        self.conn.commit()
        return row

    def execute(self, run: dict[str, Any]) -> dict[str, Any]:
        stages = PIPELINES[run["pipeline"]]
        ctx = RunContext(self.conn, self.settings, self.store, run, self.worker_id, log_conn=self._logging_connection())
        ctx.log(f"run claimed by {self.worker_id} (attempt {run['attempt']}/{run['max_attempts']})")

        for seq, (name, fn) in enumerate(stages, start=1):
            ctx.stage = name
            step = self.conn.execute(
                """insert into ops.research_run_steps (run_id, stage, sequence_no) values (%s, %s, %s)
                   on conflict (run_id, stage) do update set sequence_no = excluded.sequence_no
                   returning status, output""",
                (ctx.run_id, name, seq),
            ).fetchone()
            self.conn.commit()
            if step["status"] in ("succeeded", "skipped"):
                ctx.carried[name] = step["output"] or {}
                ctx.log("stage already complete — skipped on resume")
                continue

            if not self.conn.execute("select ops.heartbeat_research_run(%s, %s, %s)", (ctx.run_id, self.worker_id, self.lease_seconds)).fetchone()["heartbeat_research_run"]:
                self.conn.commit()
                ctx.log("lease lost to another worker — stopping", level="warning")
                return self.conn.execute("select * from ops.research_runs where id = %s", (ctx.run_id,)).fetchone()
            self.conn.execute(
                "update ops.research_run_steps set status = 'running', attempt = attempt + 1, started_at = now(), error = null where run_id = %s and stage = %s",
                (ctx.run_id, name),
            )
            self.conn.execute("update ops.research_runs set current_stage = %s where id = %s", (name, ctx.run_id))
            self.conn.commit()

            started = time.monotonic()
            try:
                output = fn(ctx) or {}
                self.conn.commit()
            except Exception as exc:  # noqa: BLE001 - every failure is recorded and classified below
                self.conn.rollback()
                detail = f"{type(exc).__name__}: {exc}"
                self.conn.execute(
                    "update ops.research_run_steps set status = 'failed', finished_at = now(), duration_ms = %s, error = %s where run_id = %s and stage = %s",
                    (int((time.monotonic() - started) * 1000), detail[:4000], ctx.run_id, name),
                )
                self.conn.commit()
                ctx.log(f"stage failed: {detail}", level="error", traceback=traceback.format_exc()[-3000:])
                if isinstance(exc, BudgetExceeded):
                    return self._finish(ctx.run_id, "budget_exhausted", error=detail)
                if isinstance(exc, NonRetryableError) or run["attempt"] >= run["max_attempts"]:
                    return self._finish(ctx.run_id, "failed", error=detail)
                return self._finish(ctx.run_id, "waiting_retry", error=detail, retry_in=backoff_seconds(run["attempt"]))

            self.conn.execute(
                "update ops.research_run_steps set status = 'succeeded', finished_at = now(), duration_ms = %s, output = %s where run_id = %s and stage = %s",
                (int((time.monotonic() - started) * 1000), Jsonb(json.loads(json.dumps(output, default=str))), ctx.run_id, name),
            )
            self.conn.commit()
            ctx.carried[name] = output
            ctx.log("stage succeeded", **{k: v for k, v in output.items() if isinstance(v, (int, float, str, bool))})

        ctx.stage = ""
        ctx.log("run succeeded")
        return self._finish(ctx.run_id, "succeeded", result={k: v for k, v in ctx.carried.items()})
