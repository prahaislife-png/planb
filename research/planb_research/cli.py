"""`planb` command line: migrations, catalogue sync, research runs, the worker, maintenance."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from . import catalog
from .config import Settings
from .db import connect
from .migrate import migrate

DEV_USERS = [  # local development identities only (plain PostgreSQL with the Supabase shim)
    ("00000000-0000-4000-8000-000000000001", "admin@planb.dev", "Dev Admin", ["admin"]),
    ("00000000-0000-4000-8000-000000000002", "researcher@planb.dev", "Dev Researcher", ["researcher"]),
    ("00000000-0000-4000-8000-000000000003", "reviewer@planb.dev", "Dev Reviewer", ["reviewer"]),
]


def _print(obj) -> None:
    print(json.dumps(obj, indent=2, default=str, ensure_ascii=False))


def cmd_db_migrate(args, settings: Settings) -> int:
    migrate(settings)
    return 0


def cmd_dev_seed_users(args, settings: Settings) -> int:
    with connect(settings, role=None) as conn:
        is_supabase = conn.execute(
            "select exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') as x"
        ).fetchone()["x"]
        if is_supabase:
            print("refusing: this is a real Supabase database; create staff through Supabase Auth and ops.staff_members", file=sys.stderr)
            return 2
        for uid, email, name, roles in DEV_USERS:
            conn.execute("insert into auth.users (id, email) values (%s, %s) on conflict (id) do nothing", (uid, email))
            conn.execute("insert into ops.staff_members (user_id, display_name) values (%s, %s) on conflict (user_id) do nothing", (uid, name))
            for role in roles:
                conn.execute("insert into ops.staff_roles (user_id, role) values (%s, %s) on conflict do nothing", (uid, role))
        conn.commit()
    print(f"seeded {len(DEV_USERS)} development staff users")
    return 0


def cmd_catalog_sync(args, settings: Settings) -> int:
    with connect(settings, role=None) as conn:
        out = {"sources": catalog.sync_sources(conn, settings.catalog_dir), "backlog": catalog.sync_backlog(conn, settings.catalog_dir)}
    _print(out)
    return 0


def _model_id(conn, slug: str):
    row = conn.execute("select id from intel.business_models where slug = %s", (slug,)).fetchone()
    if not row:
        raise SystemExit(f"unknown business model slug: {slug}")
    return row["id"]


def cmd_research_ingest(args, settings: Settings) -> int:
    from .pipeline import Worker, enqueue

    params = {"source_slug": args.source, "title": args.title, "extractor": args.extractor}
    if args.file:
        params["local_path"] = str(Path(args.file).resolve())
    if args.url:
        params["url"] = args.url
    if args.listing_url:
        params["listing_page_url"] = args.listing_url
    if args.variant:
        params["variant_slug"] = args.variant
    with connect(settings) as conn:
        run = enqueue(conn, "document_research", business_model_id=_model_id(conn, args.business), params=params,
                      idempotency_key=args.key or f"doc:{args.business}:{args.url or args.file}", budget_usd=args.budget_usd,
                      max_attempts=args.max_attempts)
        print(f"run {run['id']} {'already existed' if run.get('_already_existed') else 'queued'} (status {run['status']})")
        if args.run:
            final = Worker(conn, settings).run_once()
            _print({"status": final["status"], "error": final["error"], "result": final["result"]} if final else {"status": "nothing to run"})
            return 0 if final and final["status"] == "succeeded" else 1
    return 0


def cmd_research_refresh(args, settings: Settings) -> int:
    from .pipeline import Worker, enqueue

    with connect(settings) as conn:
        run = enqueue(conn, "business_refresh", business_model_id=_model_id(conn, args.business),
                      idempotency_key=f"refresh:{args.business}:{int(time.time())}")
        print(f"run {run['id']} queued")
        if args.run:
            final = Worker(conn, settings).run_once()
            _print({"status": final["status"], "error": final["error"], "result": final["result"]} if final else {})
            return 0 if final and final["status"] == "succeeded" else 1
    return 0


def cmd_worker(args, settings: Settings) -> int:
    from .pipeline import Worker

    with connect(settings) as conn:
        worker = Worker(conn, settings)
        if args.once:
            final = worker.run_once()
            print("queue empty" if final is None else f"run {final['id']} → {final['status']}")
            return 0
        while True:
            final = worker.run_once()
            if final is None:
                if args.until_empty:
                    return 0
                time.sleep(args.poll_seconds)
            else:
                print(f"run {final['id']} → {final['status']}", flush=True)


def cmd_maintenance(args, settings: Settings) -> int:
    from .pipeline import Worker, enqueue

    with connect(settings) as conn:
        enqueue(conn, "freshness_scan", idempotency_key=f"freshness:{time.strftime('%Y-%m-%d')}")
        final = Worker(conn, settings).run_once()
        _print({"status": final["status"], "result": final["result"]} if final else {})
    return 0


def cmd_status(args, settings: Settings) -> int:
    with connect(settings, role=None) as conn:
        _print({
            "business_models_by_status": {r["lifecycle_status"]: r["n"] for r in conn.execute(
                "select lifecycle_status, count(*) as n from intel.business_models group by 1 order by 1").fetchall()},
            "sources_by_reuse_status": {r["reuse_status"]: r["n"] for r in conn.execute(
                "select reuse_status, count(*) as n from intel.sources group by 1 order by 1").fetchall()},
            "documents": conn.execute("select count(*) as n from intel.source_documents").fetchone()["n"],
            "claims_by_status": {r["status"]: r["n"] for r in conn.execute(
                "select status, count(*) as n from intel.evidence_claims group by 1 order by 1").fetchall()},
            "open_research_tasks": conn.execute("select count(*) as n from intel.research_tasks where status in ('open', 'in_progress', 'blocked')").fetchone()["n"],
            "runs_by_status": {r["status"]: r["n"] for r in conn.execute("select status, count(*) as n from ops.research_runs group by 1 order by 1").fetchall()},
            "llm_spend_usd": float(conn.execute("select coalesce(sum(cost_usd), 0) as s from ops.llm_usage").fetchone()["s"]),
        })
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="planb", description=__doc__)
    sub = parser.add_subparsers(dest="group", required=True)

    db = sub.add_parser("db").add_subparsers(dest="cmd", required=True)
    db.add_parser("migrate", help="apply pending migrations (plain PostgreSQL; production uses `supabase db push`)").set_defaults(fn=cmd_db_migrate)

    dev = sub.add_parser("dev").add_subparsers(dest="cmd", required=True)
    dev.add_parser("seed-users", help="create local development staff users").set_defaults(fn=cmd_dev_seed_users)

    cat = sub.add_parser("catalog").add_subparsers(dest="cmd", required=True)
    cat.add_parser("sync", help="load research/catalog/*.yaml (source registry, backlog)").set_defaults(fn=cmd_catalog_sync)

    research = sub.add_parser("research").add_subparsers(dest="cmd", required=True)
    ing = research.add_parser("ingest", help="queue the document_research pipeline for one document")
    ing.add_argument("--business", required=True, help="business model slug")
    ing.add_argument("--source", required=True, help="source registry slug")
    ing.add_argument("--title", required=True)
    grp = ing.add_mutually_exclusive_group(required=True)
    grp.add_argument("--file", help="document a human obtained (manual-upload path)")
    grp.add_argument("--url", help="fetch through the source's adapter (only if the registry enables ingestion)")
    ing.add_argument("--listing-url")
    ing.add_argument("--variant", help="attach to an existing variant slug instead of creating one for this document")
    ing.add_argument("--extractor", choices=["auto", "rules", "llm"], default="auto")
    ing.add_argument("--budget-usd", type=float, default=2.0)
    ing.add_argument("--max-attempts", type=int, default=3)
    ing.add_argument("--key", help="idempotency key (defaults to business + document)")
    ing.add_argument("--run", action="store_true", help="execute immediately in this process")
    ing.set_defaults(fn=cmd_research_ingest)
    ref = research.add_parser("refresh", help="re-derive a business record after review")
    ref.add_argument("--business", required=True)
    ref.add_argument("--run", action="store_true")
    ref.set_defaults(fn=cmd_research_refresh)

    worker = sub.add_parser("worker", help="run the research worker")
    worker.add_argument("--once", action="store_true")
    worker.add_argument("--until-empty", action="store_true")
    worker.add_argument("--poll-seconds", type=float, default=5.0)
    worker.set_defaults(fn=cmd_worker)

    maint = sub.add_parser("maintenance").add_subparsers(dest="cmd", required=True)
    maint.add_parser("freshness", help="scan for stale evidence and raise revalidation tasks").set_defaults(fn=cmd_maintenance)

    sub.add_parser("status", help="summary of the research database").set_defaults(fn=cmd_status)

    args = parser.parse_args(argv)
    return args.fn(args, Settings.load())


if __name__ == "__main__":
    raise SystemExit(main())
