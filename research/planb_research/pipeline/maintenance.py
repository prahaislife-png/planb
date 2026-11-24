"""Stage 11: continuous maintenance — find evidence that has gone stale and raise the work to renew it."""

from __future__ import annotations

from typing import Any

from . import analysis
from .runner import RunContext


def freshness_scan(ctx: RunContext) -> dict[str, Any]:
    conn = ctx.conn
    with conn.transaction():
        ctx.tag_audit()
        expired = conn.execute(
            "update intel.supplier_quotes set status = 'expired' where status in ('received', 'verified') and valid_until < current_date returning id"
        ).fetchall()
        flagged = conn.execute(
            """update intel.business_models m set lifecycle_status = 'needs_revalidation'
               where m.lifecycle_status = 'published'
                 and exists (select 1 from intel.v_freshness_queue f where f.business_model_id = m.id and f.days_overdue > 0)
               returning m.id"""
        ).fetchall()
    models = conn.execute(
        "select distinct business_model_id from intel.v_freshness_queue where days_overdue > 0 and business_model_id is not null"
    ).fetchall()
    tasks = 0
    for m in models:
        ctx.run["business_model_id"] = m["business_model_id"]
        tasks += analysis.analyze_gaps(ctx)["tasks_created"]
    ctx.run["business_model_id"] = None
    overdue = conn.execute("select item_kind, count(*) as n from intel.v_freshness_queue where days_overdue > 0 group by 1 order by 1").fetchall()
    return {"quotes_expired": len(expired), "publications_flagged_for_revalidation": len(flagged), "models_with_stale_evidence": len(models),
            "tasks_created": tasks, "overdue_by_kind": {r["item_kind"]: r["n"] for r in overdue}}
