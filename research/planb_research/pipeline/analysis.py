"""Stages 6–9: cross-verification, financial modelling, gap analysis, submission for review.

Modelling rule (never relaxed): a model input is either resolved from observations, derived by a stated
formula from observations, or an explicitly recorded assumption with a rationale and grade D. A
required input with none of these stays missing, the scenario is not computed, and a research task is
raised. The arithmetic itself is done only by the deterministic engine in packages/finance.
"""

from __future__ import annotations

import datetime as dt
import json
import statistics
import subprocess
from typing import Any

from psycopg.types.json import Jsonb

from .runner import NonRetryableError, RunContext

CONFLICT_TOLERANCE_PCT = 15.0  # spread between comparable observations above which analysts must look
CORROBORATION_MAX_AGE_YEARS = 3.0
GRADE_ORDER = "ABCD"


def _weakest(grades: list[str]) -> str:
    return max(grades, key=GRADE_ORDER.index) if grades else "D"


def _variants(ctx: RunContext) -> list[dict]:
    return ctx.conn.execute(
        "select * from intel.business_variants where business_model_id = %s order by is_reference desc, slug",
        (ctx.run["business_model_id"],),
    ).fetchall()


def _usable_cost_obs(ctx: RunContext, variant_id) -> list[dict]:
    return ctx.conn.execute(
        """select o.*, ci.key as item_key, ci.name as item_name, ci.quantity as item_quantity, ci.recurrence, ci.pricing_basis,
                  ci.revenue_stream_id, ci.useful_life_years, cc.slug as category_slug, cc.cost_class, cc.engine_category,
                  cc.default_useful_life_years
           from intel.cost_observations o
           join intel.cost_items ci on ci.id = o.cost_item_id
           join intel.cost_categories cc on cc.id = ci.cost_category_id
           where ci.business_variant_id = %s and o.verification_status <> 'rejected'
             and not exists (select 1 from intel.cost_observations n where n.supersedes_id = o.id)
           order by ci.key, o.observed_on desc, o.created_at""",
        (variant_id,),
    ).fetchall()


def _usable_param_obs(ctx: RunContext, variant_id) -> list[dict]:
    return ctx.conn.execute(
        """select o.* from intel.parameter_observations o
           where o.business_variant_id = %s and o.verification_status <> 'rejected'
             and not exists (select 1 from intel.parameter_observations n where n.supersedes_id = o.id)
           order by o.parameter_key, o.observed_on desc, o.created_at""",
        (variant_id,),
    ).fetchall()


def _comparable_value(o: dict) -> tuple[float, str] | None:
    """Value of a cost observation on the basis the model uses for its item, plus that basis label."""
    v = float(o["value"])
    cls = o["cost_class"]
    if o["unit_code"] == "percent":
        return v, "pct_of_revenue"
    if cls in ("capex", "pre_operative", "deposit", "working_capital"):
        return (v / float(o["quantity_covered"]) if o["is_line_total"] and o["quantity_covered"] else v), "unit_price"
    if cls in ("staff", "fixed_opex"):
        if o["period"] == "per_month":
            return v, "per_month"
        if o["period"] == "per_year":
            return v / 12.0, "per_month"
        return None
    if cls == "variable":
        if o["period"] == "per_unit":
            return v, "per_unit"
        if o["period"] == "per_year":
            return v, f"annual_total_y{o['projection_year'] or 0}"
    return None


# ── Stage 6: cross-verification ──────────────────────────────────────────────
def cross_verify(ctx: RunContext) -> dict[str, Any]:
    conn = ctx.conn
    opened = corroborated = auto_resolved = 0
    notes: list[str] = []
    mismatches: list[dict[str, float]] = []
    today = dt.date.today()

    with conn.transaction():
        ctx.tag_audit()
        for variant in _variants(ctx):
            groups: dict[tuple, list[tuple[float, dict]]] = {}
            for o in _usable_cost_obs(ctx, variant["id"]):
                cv = _comparable_value(o)
                if cv:
                    groups.setdefault(("cost", o["cost_item_id"], cv[1]), []).append((cv[0], o))
            for o in _usable_param_obs(ctx, variant["id"]):
                groups.setdefault(("param", o["parameter_key"], o["revenue_stream_id"], o["projection_year"]), []).append((float(o["value"]), o))

            live_conflicts: set[tuple] = set()
            for key, members in groups.items():
                if len(members) < 2:
                    continue
                values = [v for v, _ in members]
                lo, hi, mid = min(values), max(values), statistics.median(values)
                spread = 0.0 if mid == 0 else (hi - lo) / abs(mid) * 100.0
                is_cost = key[0] == "cost"
                subject = {"cost_item_id": key[1], "parameter_key": None} if is_cost else {"cost_item_id": None, "parameter_key": key[1]}
                if spread > CONFLICT_TOLERANCE_PCT:
                    live_conflicts.add((subject["cost_item_id"], subject["parameter_key"]))
                    existing = conn.execute(
                        """select id from intel.observation_conflicts
                           where status = 'open' and business_variant_id = %s
                             and cost_item_id is not distinct from %s and parameter_key is not distinct from %s""",
                        (variant["id"], subject["cost_item_id"], subject["parameter_key"]),
                    ).fetchone()
                    if existing:
                        conn.execute(
                            "update intel.observation_conflicts set observation_count = %s, min_value = %s, max_value = %s, spread_pct = %s, last_seen_at = now() where id = %s",
                            (len(members), lo, hi, round(spread, 2), existing["id"]),
                        )
                    else:
                        conn.execute(
                            """insert into intel.observation_conflicts (business_variant_id, cost_item_id, parameter_key, observation_count,
                                                                        min_value, max_value, spread_pct, research_run_id)
                               values (%s, %s, %s, %s, %s, %s, %s, %s)""",
                            (variant["id"], subject["cost_item_id"], subject["parameter_key"], len(members), lo, hi, round(spread, 2), ctx.run_id),
                        )
                        opened += 1
                    continue
                # Agreement: grade B needs independent sources that are reasonably current. Estimates never qualify.
                fresh = [(v, o) for v, o in members
                         if o["evidence_type"] not in ("analyst_estimate", "llm_estimate") and o["data_origin"] != "demo"
                         and (today - o["observed_on"]).days / 365.25 <= CORROBORATION_MAX_AGE_YEARS]
                if len({o["source_id"] for _, o in fresh}) >= 2:
                    table = "cost_observations" if is_cost else "parameter_observations"
                    for _, o in fresh:
                        if o["evidence_grade"] == "C":
                            conn.execute(
                                f"update intel.{table} set evidence_grade = 'B', grade_basis = %s where id = %s",  # noqa: S608 - fixed table names
                                (f"corroborated by {len({x['source_id'] for _, x in fresh})} independent sources within {CONFLICT_TOLERANCE_PCT:g}% (spread {spread:.1f}%)", o["id"]),
                            )
                            corroborated += 1

            # a conflict whose observations no longer disagree (rejected / superseded) closes itself
            for c in conn.execute("select id, cost_item_id, parameter_key from intel.observation_conflicts where status = 'open' and business_variant_id = %s", (variant["id"],)).fetchall():
                if (c["cost_item_id"], c["parameter_key"]) not in live_conflicts:
                    conn.execute(
                        """update intel.observation_conflicts set status = 'resolved', resolved_at = now(),
                                  resolution_note = 'Closed automatically: remaining usable observations agree within tolerance.'
                           where id = %s""",
                        (c["id"],),
                    )
                    auto_resolved += 1

            # intra-document consistency: stated plant & machinery total vs the sum of extracted machinery lines
            stated = conn.execute(
                """select c.value_normalized, c.source_document_id from intel.evidence_claims c
                   where c.business_model_id = %s and c.subject = 'Plant and machinery (stated total)' and c.quote_verified
                     and c.status <> 'rejected'""",
                (ctx.run["business_model_id"],),
            ).fetchall()
            for s in stated:
                total = conn.execute(
                    """select coalesce(sum(o.value * ci.quantity), 0) as total
                       from intel.cost_observations o join intel.cost_items ci on ci.id = o.cost_item_id
                       join intel.cost_categories cc on cc.id = ci.cost_category_id
                       where ci.business_variant_id = %s and cc.slug = 'capex.machinery' and o.source_document_id = %s
                         and o.verification_status <> 'rejected'""",
                    (variant["id"], s["source_document_id"]),
                ).fetchone()["total"]
                if total and s["value_normalized"]:
                    diff = (float(total) - float(s["value_normalized"])) / float(s["value_normalized"]) * 100
                    notes.append(f"machinery lines sum to ₹{float(total):,.0f} vs stated total ₹{float(s['value_normalized']):,.0f} ({diff:+.1f}%)")
                    if abs(diff) > 1.0:
                        mismatches.append({"lines_total": float(total), "stated_total": float(s["value_normalized"])})
    # logged after the transaction: run logs are committed independently of stage work
    for m in mismatches:
        ctx.log("usable machinery lines do not add up to the document's stated total — a line is missing, rejected or misread",
                level="warning", **m)
    return {"conflicts_opened": opened, "conflicts_auto_resolved": auto_resolved, "observations_corroborated": corroborated,
            "consistency_checks": notes, "consistency_mismatches": len(mismatches)}


# ── Stage 7: financial modelling ─────────────────────────────────────────────
def _set_parameter(ctx: RunContext, variant_id, *, parameter_key=None, cost_item_id=None, stream_id=None, value: float,
                   unit: str | None, basis: str, method: str, rationale: str | None, grade: str,
                   sources: list[tuple[str, Any]] | None = None, location_level: str | None = "national",
                   location_id=None) -> bool:
    """Create or supersede the current base parameter (national, or the overlay for one location).
    Analyst-set values are never overwritten by the pipeline."""
    conn = ctx.conn
    cur = conn.execute(
        """select * from intel.financial_parameters
           where business_variant_id = %s and is_current and scenario = 'base' and location_id is not distinct from %s
             and parameter_key is not distinct from %s and cost_item_id is not distinct from %s
             and revenue_stream_id is not distinct from %s""",
        (variant_id, location_id, parameter_key, cost_item_id, stream_id),
    ).fetchone()
    if cur:
        if cur["method"] in ("manual", "analyst_selected") and cur["set_by"] is not None:
            return False
        if (abs(float(cur["value"]) - value) <= 1e-9 * max(1.0, abs(value)) and cur["basis"] == basis and cur["method"] == method
                and cur["evidence_grade"] == grade and (cur["rationale"] or "") == (rationale or "")
                and cur["location_level"] == (location_level if basis != "assumption" else "assumed")):
            return False
        conn.execute("update intel.financial_parameters set is_current = false, superseded_at = now() where id = %s", (cur["id"],))
    row = conn.execute(
        """insert into intel.financial_parameters (business_variant_id, location_id, scenario, parameter_key, cost_item_id, revenue_stream_id,
                                                   value, unit_code, basis, method, rationale, evidence_grade, location_level, research_run_id,
                                                   data_origin)
           values (%s, %s, 'base', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id""",
        (variant_id, location_id, parameter_key, cost_item_id, stream_id, value, unit, basis, method, rationale, grade,
         location_level if basis != "assumption" else "assumed", ctx.run_id, ctx.data_origin),
    ).fetchone()
    for kind, obs_id in sources or []:
        conn.execute(
            f"insert into intel.financial_parameter_sources (financial_parameter_id, {kind}_id) values (%s, %s)",  # noqa: S608 - fixed column names
            (row["id"], obs_id),
        )
    return True


def _production_value(param_obs: list[dict], stream_id, year: int | None) -> tuple[float, str, list[dict]] | None:
    """Value of what the source says is PRODUCED in a projection year: capacity × that year's utilisation × price.
    Returns (rupees, description, the observations used), or None when the source does not give all three."""
    if year != 1:
        return None

    def first(key: str) -> dict | None:
        candidates = [o for o in param_obs if o["parameter_key"] == key and (stream_id is None or o["revenue_stream_id"] == stream_id)]
        return candidates[0] if len(candidates) == 1 else None  # ambiguous or absent → do not guess

    capacity, utilisation, price = first("capacity_units_per_month"), first("utilization_year1_pct"), first("unit_price")
    if not (capacity and utilisation and price):
        return None
    value = float(capacity["value"]) * 12.0 * float(utilisation["value"]) / 100.0 * float(price["value"])
    if value <= 0:
        return None
    text = (f"production value of ₹{value:,.0f} ({float(capacity['value']) * 12:,.0f} units a year × "
            f"{float(utilisation['value']):g}% utilisation × ₹{float(price['value']):,.2f})")
    return value, text, [capacity, utilisation, price]


def _resolve(values: list[tuple[float, dict]], *, has_open_conflict: bool) -> tuple[float, str, str | None, str]:
    grades = [o["evidence_grade"] for _, o in values]
    if len(values) == 1:
        return values[0][0], "single_observation", None, grades[0]
    med = statistics.median(v for v, _ in values)
    why = (f"{len(values)} observations disagree; the median is used until an analyst resolves the conflict."
           if has_open_conflict else f"Median of {len(values)} agreeing observations.")
    return med, "median", why, _weakest(grades)


def resolve_parameters(ctx: RunContext, variant: dict) -> dict[str, Any]:
    conn = ctx.conn
    changed = 0
    touched: set[tuple] = set()

    def setp(*, parameter_key=None, cost_item_id=None, stream_id=None, **kw) -> bool:
        touched.add((parameter_key, cost_item_id, stream_id))
        return _set_parameter(ctx, variant["id"], parameter_key=parameter_key, cost_item_id=cost_item_id, stream_id=stream_id, **kw)

    cost_obs = _usable_cost_obs(ctx, variant["id"])
    param_obs = _usable_param_obs(ctx, variant["id"])
    open_conflicts = {(c["cost_item_id"], c["parameter_key"]) for c in conn.execute(
        "select cost_item_id, parameter_key from intel.observation_conflicts where status = 'open' and business_variant_id = %s",
        (variant["id"],)).fetchall()}
    stated_revenue = {o["projection_year"]: o for o in param_obs if o["parameter_key"] == "stated_annual_revenue"}

    # cost items
    by_item: dict[Any, list[dict]] = {}
    for o in cost_obs:
        by_item.setdefault(o["cost_item_id"], []).append(o)
    for item_id, obs in by_item.items():
        comparable: dict[str, list[tuple[float, dict]]] = {}
        for o in obs:
            cv = _comparable_value(o)
            if cv:
                comparable.setdefault(cv[1], []).append((cv[0], o))
        if not comparable:
            continue
        basis_label, values = max(comparable.items(), key=lambda kv: len(kv[1]))
        sources = [("cost_observation", o["id"]) for _, o in values]
        first = values[0][1]
        if basis_label.startswith("annual_total_y"):
            year = first["projection_year"]
            amount = float(values[0][0])
            # A cost incurred on PRODUCTION must be expressed against the value of that production. The source's
            # stated sales are net of finished-goods stock build-up, so dividing by them overstates the ratio
            # (enough to turn a thin-margin business into a loss). Stated sales are only the fallback.
            production = _production_value(param_obs, first["revenue_stream_id"], year)
            if production:
                denominator, basis_text, denom_sources = production
            else:
                rev = stated_revenue.get(year)
                if rev is None or float(rev["value"]) <= 0:
                    continue  # cannot be expressed per unit of revenue: stays unresolved
                denominator, denom_sources = float(rev["value"]), [rev]
                basis_text = f"stated sales of ₹{denominator:,.0f} (production value could not be computed from the source)"
            pct = amount / denominator * 100.0
            rationale = f"Derived: source states ₹{amount:,.0f} for projection year {year} against {basis_text} → {pct:.2f}% of revenue."
            changed += setp(cost_item_id=item_id, value=round(pct, 4), unit="percent", basis="derived",
                                      method="formula", rationale=rationale,
                                      grade=_weakest([first["evidence_grade"], *[o["evidence_grade"] for o in denom_sources]]),
                                      sources=[*sources[:1], *[("parameter_observation", o["id"]) for o in denom_sources]])
            continue
        value, method, why, grade = _resolve(values, has_open_conflict=(item_id, None) in open_conflicts)
        unit = "percent" if basis_label == "pct_of_revenue" else "inr"
        changed += setp(cost_item_id=item_id, value=round(value, 4), unit=unit, basis="observation",
                                  method=method, rationale=why, grade=grade, sources=sources)

    # named parameters
    defs = conn.execute("select * from intel.financial_parameter_definitions order by sort_order").fetchall()
    streams = conn.execute("select * from intel.revenue_streams where business_variant_id = %s order by key", (variant["id"],)).fetchall()
    obs_index: dict[tuple, list[dict]] = {}
    for o in param_obs:
        obs_index.setdefault((o["parameter_key"], o["revenue_stream_id"]), []).append(o)

    def resolve_named(d: dict, stream_id) -> None:
        nonlocal changed
        obs = obs_index.get((d["key"], stream_id), [])
        if obs:
            # when a source gives several projection years, the latest is the value the parameter is defined on
            values = [(float(o["value"]), o) for o in obs]
            value, method, why, grade = _resolve(values, has_open_conflict=(None, d["key"]) in open_conflicts)
            changed += setp(parameter_key=d["key"], stream_id=stream_id, value=value, unit=d["unit_code"],
                                      basis="observation", method=method, rationale=why, grade=grade,
                                      sources=[("parameter_observation", o["id"]) for _, o in values])
        elif d["default_value"] is not None and d["key"] not in derived_keys:
            changed += setp(parameter_key=d["key"], stream_id=stream_id, value=float(d["default_value"]),
                                      unit=d["unit_code"], basis="assumption", method="manual", rationale=d["default_rationale"], grade="D")

    # ramp-up derived from the source's own multi-year utilisation projection, when it gives one
    derived_keys: set[str] = set()
    if len(streams) == 1:
        sid = streams[0]["id"]
        y1 = (obs_index.get(("utilization_year1_pct", sid)) or [None])[0]
        steady = (obs_index.get(("utilization_pct", sid)) or [None])[0]
        if y1 and steady and steady["projection_year"] and steady["projection_year"] > 1 and float(steady["value"]) > 0 \
                and not obs_index.get(("ramp_start_pct", None)) and not obs_index.get(("ramp_months_to_steady_state", None)):
            start = min(100.0, float(y1["value"]) / float(steady["value"]) * 100.0)
            months = (int(steady["projection_year"]) - 1) * 12
            grade = _weakest([y1["evidence_grade"], steady["evidence_grade"]])
            src = [("parameter_observation", y1["id"]), ("parameter_observation", steady["id"])]
            why = (f"Derived from the source's projection: utilisation {float(y1['value']):g}% in year 1 rising to "
                   f"{float(steady['value']):g}% in year {steady['projection_year']}, linearised month by month.")
            changed += setp(parameter_key="ramp_start_pct", value=round(start, 4), unit="percent",
                                      basis="derived", method="formula", rationale=why, grade=grade, sources=src)
            changed += setp(parameter_key="ramp_months_to_steady_state", value=float(months), unit="month",
                                      basis="derived", method="formula", rationale=why, grade=grade, sources=src)
            derived_keys |= {"ramp_start_pct", "ramp_months_to_steady_state"}

    for d in defs:
        if d["scope"] == "variant":
            resolve_named(d, None)
        else:
            for s in streams:
                if d["template_key"] == s["driver_kind"]:
                    resolve_named(d, s["id"])
    # A model input whose evidence is gone (every observation rejected or superseded) must stop feeding the model.
    # Pipeline-resolved inputs that were not re-resolved in this pass are retired; analyst-set values are left alone.
    retired = 0
    for p in conn.execute(
        """select id, parameter_key, cost_item_id, revenue_stream_id from intel.financial_parameters
           where business_variant_id = %s and is_current and scenario = 'base' and location_id is null and set_by is null""",
        (variant["id"],),
    ).fetchall():
        if (p["parameter_key"], p["cost_item_id"], p["revenue_stream_id"]) not in touched:
            conn.execute("update intel.financial_parameters set is_current = false, superseded_at = now() where id = %s", (p["id"],))
            retired += 1
    return {"parameters_changed": changed, "parameters_retired": retired}


def pilot_locations(ctx: RunContext) -> list[dict]:
    return ctx.conn.execute(
        "select id, name, slug, location_type from intel.locations where is_pilot and location_type = 'city' order by name"
    ).fetchall()


def resolve_location_overlays(ctx: RunContext, variant: dict, location: dict) -> dict[str, Any]:
    """Resolve the model inputs that have LOCAL evidence for one location, as overlay parameters.

    Two kinds of local evidence, nearest geography first (city → district → state → country):
      1. cost or parameter observations recorded for a place (a quotation delivered to Pune, a local selling price);
      2. a cost item an analyst has tied to a location metric (rent = local rate × floor area), resolved through
         intel.resolve_location_metric so the level the figure came from is always known.
    Inputs with no local evidence get no overlay: the location scenario inherits the national value and says so.
    """
    conn = ctx.conn
    touched: set[tuple] = set()
    overlays: list[dict[str, Any]] = []
    ancestry = {a["location_id"]: a for a in conn.execute(
        "select location_id, depth, location_type, name from intel.location_ancestry(%s)", (location["id"],)).fetchall()}

    def setp(*, label: str, level: str, parameter_key=None, cost_item_id=None, stream_id=None, **kw) -> None:
        touched.add((parameter_key, cost_item_id, stream_id))
        _set_parameter(ctx, variant["id"], parameter_key=parameter_key, cost_item_id=cost_item_id, stream_id=stream_id,
                       location_id=location["id"], location_level=level, **kw)
        overlays.append({"input": label, "level": level})

    def nearest(observations: list[dict]) -> list[dict]:
        depth = min(ancestry[o["location_id"]]["depth"] for o in observations)
        return [o for o in observations if ancestry[o["location_id"]]["depth"] == depth]

    # 1a. location-specific cost observations
    by_item: dict[Any, list[dict]] = {}
    for o in _usable_cost_obs(ctx, variant["id"]):
        if o["location_id"] in ancestry:
            by_item.setdefault(o["cost_item_id"], []).append(o)
    for item_id, obs in by_item.items():
        local = nearest(obs)
        values = [(cv[0], o) for o in local if (cv := _comparable_value(o)) and not cv[1].startswith("annual_total")]
        if not values:
            continue
        value, method, why, grade = _resolve(values, has_open_conflict=False)
        place = ancestry[local[0]["location_id"]]
        setp(label=local[0]["item_name"], level=place["location_type"], cost_item_id=item_id, value=round(value, 4),
             unit="percent" if local[0]["unit_code"] == "percent" else "inr", basis="observation", method=method,
             rationale=" ".join(filter(None, [why, f"Observed for {place['name']}."])), grade=grade,
             sources=[("cost_observation", o["id"]) for _, o in values])

    # 1b. location-specific parameter observations
    by_param: dict[tuple, list[dict]] = {}
    for o in _usable_param_obs(ctx, variant["id"]):
        if o["location_id"] in ancestry:
            by_param.setdefault((o["parameter_key"], o["revenue_stream_id"]), []).append(o)
    for (key, stream_id), obs in by_param.items():
        local = nearest(obs)
        value, method, why, grade = _resolve([(float(o["value"]), o) for o in local], has_open_conflict=False)
        place = ancestry[local[0]["location_id"]]
        setp(label=key, level=place["location_type"], parameter_key=key, stream_id=stream_id, value=value, unit=local[0]["unit_code"],
             basis="observation", method=method, rationale=" ".join(filter(None, [why, f"Observed for {place['name']}."])),
             grade=grade, sources=[("parameter_observation", o["id"]) for o in local])

    # 2. cost items tied to a location metric
    for item in conn.execute(
        """select ci.id, ci.name, ci.location_metric_key, ci.location_metric_segment, ci.location_metric_multiplier,
                  ci.location_metric_basis, md.name as metric_name
           from intel.cost_items ci join intel.metric_definitions md on md.key = ci.location_metric_key
           where ci.business_variant_id = %s""", (variant["id"],)).fetchall():
        if (None, item["id"], None) in touched:
            continue  # a figure observed directly for this place beats one derived from a general local rate
        m = conn.execute("select * from intel.resolve_location_metric(%s, %s, %s)",
                         (location["id"], item["location_metric_key"], item["location_metric_segment"])).fetchone()
        if m is None or m["period"] not in ("per_month", "per_year"):
            continue  # nothing known at any level (or not a recurring rate): no overlay, the national value stands
        monthly_rate = float(m["value"]) / (12.0 if m["period"] == "per_year" else 1.0)
        value = monthly_rate * float(item["location_metric_multiplier"])
        place = ancestry[m["resolved_location_id"]]
        inherited = f" (no {location['name']} figure; inherited from {place['name']})" if m["is_fallback"] else ""
        setp(label=item["name"], level=m["resolved_level"], cost_item_id=item["id"], value=round(value, 2), unit="inr",
             basis="derived", method="formula", grade=m["evidence_grade"], sources=[("location_metric", m["location_metric_id"])],
             rationale=(f"Derived: {item['metric_name']} ₹{monthly_rate:,.2f} for {place['name']}{inherited} × "
                        f"{float(item['location_metric_multiplier']):g} ({item['location_metric_basis']})."))

    retired = 0
    for p in conn.execute(
        """select id, parameter_key, cost_item_id, revenue_stream_id from intel.financial_parameters
           where business_variant_id = %s and is_current and scenario = 'base' and location_id = %s and set_by is null""",
        (variant["id"], location["id"])).fetchall():
        if (p["parameter_key"], p["cost_item_id"], p["revenue_stream_id"]) not in touched:
            conn.execute("update intel.financial_parameters set is_current = false, superseded_at = now() where id = %s", (p["id"],))
            retired += 1
    return {"location": location["name"], "overlaid": len(touched), "retired": retired, "overlays": overlays}


def build_engine_input(ctx: RunContext, variant: dict, location_id=None) -> tuple[dict | None, dict[str, Any]]:
    """Assemble the finance-engine input from CURRENT parameters only. Returns (input | None, report).
    With a location, that location's overlay parameters replace the national ones for the same input."""
    conn = ctx.conn
    params = conn.execute(
        """select fp.*, ci.key as item_key, ci.name as item_name, ci.quantity, ci.recurrence, ci.useful_life_years,
                  ci.revenue_stream_id as item_stream_id, cc.slug as category_slug, cc.cost_class, cc.engine_category,
                  cc.default_useful_life_years
           from intel.financial_parameters fp
           left join intel.cost_items ci on ci.id = fp.cost_item_id
           left join intel.cost_categories cc on cc.id = ci.cost_category_id
           where fp.business_variant_id = %s and fp.is_current and fp.scenario = 'base'
             and (fp.location_id is null or fp.location_id = %s)
           order by (fp.location_id is not null)""",
        (variant["id"], location_id),
    ).fetchall()
    # one row per input: an overlay row (sorted last) replaces the national row for the same subject
    by_subject = {(p["parameter_key"], p["cost_item_id"], p["revenue_stream_id"]): p for p in params}
    national_count = len({(p["parameter_key"], p["cost_item_id"], p["revenue_stream_id"]) for p in params if p["location_id"] is None})
    params = list(by_subject.values())
    missing = conn.execute(
        """select parameter_key, parameter_name, revenue_stream_name from intel.v_variant_parameter_status
           where business_variant_id = %s and is_required and not is_resolved""",
        (variant["id"],),
    ).fetchall()
    streams = conn.execute("select * from intel.revenue_streams where business_variant_id = %s order by key", (variant["id"],)).fetchall()
    report: dict[str, Any] = {"missing_required": [f"{m['parameter_key']}" + (f" ({m['revenue_stream_name']})" if m["revenue_stream_name"] else "") for m in missing],
                              "model_notes": []}
    if not streams:
        report["missing_required"].append("revenue stream")
    if report["missing_required"]:
        return None, report

    named = {(p["parameter_key"], p["revenue_stream_id"]): float(p["value"]) for p in params if p["parameter_key"]}

    def g(key: str, stream_id=None, default: float | None = None) -> float | None:
        return named.get((key, stream_id), default)

    capex, preop, deposits, fixed, staff = [], [], [], [], []
    variable_by_stream: dict[Any, list[dict]] = {}
    for p in params:
        if not p["cost_item_id"]:
            continue
        cls, value, qty = p["cost_class"], float(p["value"]), float(p["quantity"] or 1)
        if cls == "capex":
            life = p["useful_life_years"] or p["default_useful_life_years"]
            if p["useful_life_years"] is None and life is not None:
                report["model_notes"].append(f"Useful life of '{p['item_name']}' not evidenced; category default of {float(life):g} years assumed.")
            item = {"key": p["item_key"], "label": p["item_name"], "amount": round(value * qty, 2), "category": p["engine_category"] or "other"}
            if life is not None and item["category"] != "land":
                item["usefulLifeYears"] = float(life)
            capex.append(item)
        elif cls == "pre_operative":
            preop.append({"key": p["item_key"], "label": p["item_name"], "amount": round(value * qty, 2)})
        elif cls == "deposit":
            deposits.append({"key": p["item_key"], "label": p["item_name"], "amount": round(value * qty, 2), "refundable": p["category_slug"] != "deposit.franchise"})
        elif cls == "fixed_opex":
            fixed.append({"key": p["item_key"], "label": p["item_name"], "category": p["engine_category"] or "other",
                          "monthlyAmount": round(value * qty, 2), "classification": "operating"})
        elif cls == "staff":
            staff.append({"key": p["item_key"], "role": p["item_name"], "count": qty, "monthlySalary": round(value, 2),
                          "classification": p["engine_category"] or "operating"})
        elif cls == "variable":
            stream_id = p["item_stream_id"] or streams[0]["id"]
            variable_by_stream.setdefault(stream_id, []).append({
                "key": p["item_key"], "label": p["item_name"],
                "basis": "pct_of_revenue" if p["unit_code"] == "percent" else "per_unit",
                "value": round(value, 4), "classification": p["engine_category"] or "operating"})

    revenue_streams = []
    for s in streams:
        sid, kind = s["id"], s["driver_kind"]
        if kind == "transactions":
            driver = {"kind": kind, "transactionsPerDay": g("transactions_per_day", sid), "operatingDaysPerMonth": g("operating_days_per_month"), "averageTicket": g("average_ticket", sid)}
        elif kind == "capacity_utilization":
            driver = {"kind": kind, "capacityUnitsPerMonth": g("capacity_units_per_month", sid), "utilization": g("utilization_pct", sid) / 100.0, "unitPrice": g("unit_price", sid)}
        elif kind == "area_yield":
            cycles = int(g("cycles_per_year", sid))
            driver = {"kind": kind, "area": g("cultivated_area", sid), "yieldPerAreaPerCycle": g("yield_per_area_per_cycle", sid), "pricePerUnit": g("price_per_unit", sid),
                      "harvestCalendarMonths": sorted({((i * 12) // max(cycles, 1)) % 12 + 1 for i in range(cycles)})}
            report["model_notes"].append("Harvest months are spread evenly across the year; the source does not state a crop calendar.")
        elif kind == "enrolment":
            driver = {"kind": kind, "capacityStudents": g("capacity_students", sid), "enrolmentRate": g("enrolment_rate_pct", sid) / 100.0, "feePerStudentPerMonth": g("fee_per_student_per_month", sid)}
        elif kind == "occupancy":
            driver = {"kind": kind, "rentableArea": g("rentable_area", sid), "occupancy": g("occupancy_pct", sid) / 100.0, "ratePerAreaPerMonth": g("rate_per_area_per_month", sid)}
        elif kind == "fleet_utilization":
            driver = {"kind": kind, "unitCount": g("unit_count", sid), "billableDaysPerMonth": g("billable_days_per_month", sid), "utilization": g("fleet_utilization_pct", sid) / 100.0, "ratePerUnitPerDay": g("rate_per_unit_per_day", sid)}
        else:
            driver = {"kind": "engagements", "engagementsPerMonth": g("engagements_per_month", sid), "realizedFee": g("realized_fee", sid)}
        stream = {"key": s["key"], "label": s["name"], "driver": driver, "variableCosts": variable_by_stream.get(sid, [])}
        if s["payment_terms_days"] is not None:
            stream["paymentTermsDays"] = s["payment_terms_days"]
        revenue_streams.append(stream)

    model: dict[str, Any] = {
        "horizonMonths": 60,
        "preOperatingMonths": int(g("pre_operating_months", default=0)),
        "capex": capex, "preOperativeExpenses": preop, "deposits": deposits,
        "contingencyPct": g("contingency_pct", default=0),
        "revenueStreams": revenue_streams,
        "rampUp": {"startPct": g("ramp_start_pct", default=100), "monthsToSteadyState": int(g("ramp_months_to_steady_state", default=0))},
        "fixedCosts": fixed, "staff": staff,
        "owner": {"monthlyCompensation": g("owner_monthly_compensation", default=0), "treatment": "drawings"},
        "priceEscalationPctAnnual": g("price_escalation_pct", default=0),
        "costInflationPctAnnual": g("cost_inflation_pct", default=0),
        "workingCapital": {"inventoryDays": g("raw_material_stock_days", default=0) + g("finished_goods_stock_days", default=0),
                           "receivableDays": g("receivable_days", default=0), "payableDays": g("payable_days", default=0)},
        "tax": {"kind": "flat_rate", "ratePct": g("tax_rate_pct")} if g("tax_rate_pct", default=0) else {"kind": "none"},
    }
    loan, rate, tenure = g("term_loan_amount", default=0), g("loan_interest_pct"), g("loan_tenure_months")
    financing: dict[str, Any] = {}
    if loan and loan > 0:
        if rate is None or tenure is None:
            report["model_notes"].append("A term loan is evidenced but its interest rate or tenure is not; the loan is left out of the model.")
        else:
            financing["loan"] = {"principal": loan, "annualInterestPct": rate, "tenureMonths": int(tenure),
                                 "moratoriumMonths": int(g("loan_moratorium_months", default=0))}
    subsidy = g("subsidy_amount", default=0)
    if subsidy and subsidy > 0:
        financing["subsidy"] = {"amount": subsidy, "receivedOperatingMonth": 12,
                                "treatment": "reduces_loan_principal" if "loan" in financing else "cash_inflow"}
    stated_subsidy = g("stated_subsidy_amount")
    if stated_subsidy and not subsidy:
        report["model_notes"].append(f"The source assumes a capital subsidy of ₹{stated_subsidy:,.0f}; it is NOT modelled until scheme eligibility is verified.")
    if financing:
        model["financing"] = financing
    if not capex:
        report["model_notes"].append("No capital cost item is resolved: initial investment will be understated.")

    grades = [p["evidence_grade"] for p in params]
    report["grade_profile"] = {gr: grades.count(gr) for gr in GRADE_ORDER} | {
        "assumptions": sum(1 for p in params if p["basis"] == "assumption"),
        "derived": sum(1 for p in params if p["basis"] == "derived"),
        "observed": sum(1 for p in params if p["basis"] == "observation")}
    report["parameter_count"] = len(params)
    report["weakest_grade"] = _weakest(grades)
    if location_id is not None:
        local = [p for p in params if p["location_id"] is not None]
        levels: dict[str, int] = {}
        for p in local:
            levels[p["location_level"] or "unspecified"] = levels.get(p["location_level"] or "unspecified", 0) + 1
        report["location_coverage"] = {
            "local_inputs": len(local), "inherited_national_inputs": len(params) - len(local), "national_inputs_total": national_count,
            "by_level": levels,
            "inputs": [{"input": p["item_name"] or p["parameter_key"], "level": p["location_level"], "value": float(p["value"]),
                        "basis": p["basis"], "grade": p["evidence_grade"]} for p in local]}
    return model, report


def run_engine(ctx: RunContext, request: dict) -> dict:
    cli = ctx.settings.finance_cli
    if not cli.exists():
        raise NonRetryableError(f"finance engine CLI not built at {cli} (run: pnpm --filter @planb/finance build)")
    proc = subprocess.run(["node", str(cli)], input=json.dumps(request).encode(), capture_output=True, timeout=120, check=False)
    if proc.returncode != 0:
        raise NonRetryableError(f"finance engine rejected the input: {proc.stderr.decode()[:1500]}")
    return json.loads(proc.stdout)


def build_model(ctx: RunContext) -> dict[str, Any]:
    conn = ctx.conn
    out: dict[str, Any] = {"variants": []}
    for variant in _variants(ctx):
        with conn.transaction():
            ctx.tag_audit()
            resolved = resolve_parameters(ctx, variant)
        model, report = build_engine_input(ctx, variant)
        entry: dict[str, Any] = {"variant": variant["slug"], **resolved, "missing_required": report["missing_required"],
                                 "model_notes": report["model_notes"], "scenarios": 0}
        if model is None:
            ctx.log(f"scenarios not computed for {variant['slug']}: required inputs missing", level="warning", missing=report["missing_required"])
            with conn.transaction():
                conn.execute("update intel.financial_scenarios set is_current = false where business_variant_id = %s and is_current", (variant["id"],))
            out["variants"].append(entry)
            continue

        response = run_engine(ctx, {"op": "scenarios", "input": model, "scenarios": "all"})
        checks = _source_reconciliation(ctx, variant, model)
        with conn.transaction():
            ctx.tag_audit()
            conn.execute("update intel.financial_scenarios set is_current = false where business_variant_id = %s and is_current", (variant["id"],))
            for sc in response["scenarios"]:
                if sc["status"] != "ok" or not sc["result"]:
                    ctx.log(f"scenario {sc['key']} could not be computed", level="warning", error=sc.get("error"))
                    continue
                res = sc["result"]
                summary = {"initialInvestment": res["initialInvestment"], "funding": res["funding"], "summary": res["summary"],
                           "closure": res.get("closure"), "description": sc.get("description"), "notes": sc.get("notes"),
                           "modelNotes": report["model_notes"]}
                if sc["kind"] == "base" and checks:
                    summary["sourceReconciliation"] = checks
                conn.execute(
                    """insert into intel.financial_scenarios
                         (business_variant_id, scenario_key, label, kind, engine_version, input, input_hash, summary, monthly, annual,
                          warnings, parameter_count, assumption_count, grade_profile, weakest_grade, research_run_id, data_origin)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       on conflict (business_variant_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), scenario_key, input_hash, engine_version)
                       do update set is_current = true, summary = excluded.summary, computed_at = now(), research_run_id = excluded.research_run_id""",
                    (variant["id"], sc["key"], sc["label"], sc["kind"], res["engineVersion"],
                     Jsonb({"input": model, "scenario": {"key": sc["key"], "kind": sc["kind"], "adjustments": sc["adjustments"]}}),
                     res["inputHash"], Jsonb(summary), Jsonb(res["monthly"]) if sc["kind"] == "base" else None, Jsonb(res["annual"]),
                     Jsonb(res["warnings"]), report["parameter_count"], report["grade_profile"]["assumptions"],
                     Jsonb(report["grade_profile"]), report["weakest_grade"], ctx.run_id, ctx.data_origin),
                )
                entry["scenarios"] += 1
        entry["grade_profile"] = report["grade_profile"]
        entry["source_reconciliation"] = checks
        entry["locations"] = _location_scenarios(ctx, variant)
        out["variants"].append(entry)
    return out


def _location_scenarios(ctx: RunContext, variant: dict) -> list[dict[str, Any]]:
    """One base scenario per pilot city that has ANY local evidence. A city with none gets no scenario of its own:
    presenting the national case under a city's name would claim local knowledge that does not exist."""
    conn = ctx.conn
    results = []
    for location in pilot_locations(ctx):
        with conn.transaction():
            ctx.tag_audit()
            overlay = resolve_location_overlays(ctx, variant, location)
        if overlay["overlaid"] == 0:
            results.append({"location": location["name"], "scenario": False, "reason": "no local evidence"})
            continue
        model, report = build_engine_input(ctx, variant, location["id"])
        if model is None:
            results.append({"location": location["name"], "scenario": False, "reason": "required inputs missing"})
            continue
        res = run_engine(ctx, {"op": "run", "input": model})
        coverage = report["location_coverage"]
        summary = {"initialInvestment": res["initialInvestment"], "funding": res["funding"], "summary": res["summary"], "closure": None,
                   "description": (f"Base case with {coverage['local_inputs']} of {report['parameter_count']} inputs taken from evidence for "
                                   f"{location['name']} or its district/state; the remaining {coverage['inherited_national_inputs']} are national figures."),
                   "notes": [], "modelNotes": report["model_notes"], "locationCoverage": coverage}
        with conn.transaction():
            ctx.tag_audit()
            conn.execute(
                """insert into intel.financial_scenarios
                     (business_variant_id, location_id, scenario_key, label, kind, engine_version, input, input_hash, summary, monthly, annual,
                      warnings, parameter_count, assumption_count, grade_profile, weakest_grade, research_run_id, data_origin)
                   values (%s, %s, 'base', %s, 'base', %s, %s, %s, %s, null, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (business_variant_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), scenario_key, input_hash, engine_version)
                   do update set is_current = true, summary = excluded.summary, computed_at = now(), research_run_id = excluded.research_run_id""",
                (variant["id"], location["id"], f"Base case — {location['name']}", res["engineVersion"],
                 Jsonb({"input": model, "scenario": {"key": "base", "kind": "base", "adjustments": []}}), res["inputHash"], Jsonb(summary),
                 Jsonb(res["annual"]), Jsonb(res["warnings"]), report["parameter_count"], report["grade_profile"]["assumptions"],
                 Jsonb(report["grade_profile"]), report["weakest_grade"], ctx.run_id, ctx.data_origin),
            )
        results.append({"location": location["name"], "scenario": True, **coverage})
    return results


def _source_reconciliation(ctx: RunContext, variant: dict, model: dict) -> dict[str, Any] | None:
    """Re-run the engine pinned to the source's own year-1 assumptions and compare with the figures the
    source states. A large gap means an extraction or structuring error, not a business insight."""
    stated = {r["parameter_key"]: float(r["value"]) for r in ctx.conn.execute(
        """select parameter_key, value from intel.parameter_observations
           where business_variant_id = %s and parameter_key in ('stated_annual_revenue', 'stated_annual_net_profit', 'utilization_year1_pct')
             and coalesce(projection_year, 1) = 1 and verification_status <> 'rejected'""",
        (variant["id"],)).fetchall()}
    if "stated_annual_revenue" not in stated:
        return None
    pinned = json.loads(json.dumps(model))
    pinned["preOperatingMonths"] = 0
    pinned["rampUp"] = {"startPct": 100, "monthsToSteadyState": 0}
    pinned["contingencyPct"] = 0  # the source's own figures carry no PlanB contingency
    pinned.get("financing", {}).pop("subsidy", None)
    if "utilization_year1_pct" in stated:
        for s in pinned["revenueStreams"]:
            if s["driver"]["kind"] == "capacity_utilization":
                s["driver"]["utilization"] = stated["utilization_year1_pct"] / 100.0
    result = run_engine(ctx, {"op": "run", "input": pinned})
    year1 = next((a for a in result["annual"] if a["year"] == 1), None)
    if not year1:
        return None
    out = {"basis": "engine pinned to the source's year-1 utilisation, no ramp-up, no pre-operating period, no contingency",
           "statedRevenue": stated["stated_annual_revenue"], "modelledRevenue": year1["revenue"],
           "revenueDeltaPct": round((year1["revenue"] - stated["stated_annual_revenue"]) / stated["stated_annual_revenue"] * 100, 2)}
    if "stated_annual_net_profit" in stated:
        out |= {"statedNetProfit": stated["stated_annual_net_profit"], "modelledNetProfit": year1["netProfit"],
                "note": "Profit differs by construction: the engine sells all production in the year, charges no interest on "
                        "working-capital borrowing and depreciates straight-line, while the source holds back closing stock, pays "
                        "working-capital interest and uses written-down-value depreciation."}
    return out


# ── Stage 8: research gap analysis ───────────────────────────────────────────
COMPLETENESS_TASKS: dict[str, tuple[str, str, int, str | None, str]] = {
    # check_key: (task_type, title, priority, template_key, instructions)
    "identity.description": ("complete_record_section", "Write the description, operating model and target customers", 2, None,
                             "Summarise from the evidence already ingested; do not add unsourced claims."),
    "identity.classification": ("complete_record_section", "Assign and verify the primary NIC-2008 code", 4, None, "Check the code and title against the official MoSPI publication."),
    "capital.items": ("find_source_document", "Find a project report or cost schedule listing the capital items", 1, None, "Start from the source registry; government project reports first."),
    "capital.observed": ("obtain_supplier_quotes", "Obtain prices for capital items that have no observation", 1, "supplier_enquiry", "Request written quotations; record GST, freight and installation treatment."),
    "capital.quotes": ("obtain_supplier_quotes", "Obtain three machinery quotations", 1, "supplier_enquiry",
                       "Get written quotations from three independent suppliers for each machine, for delivery to Pune and to Nanded. Record GST, freight, installation, warranty and validity."),
    "operations.fixed_costs": ("confirm_local_rent", "Confirm recurring operating costs", 2, "rent_enquiry", "Collect rent, power and other fixed costs for the required premises."),
    "operations.staffing": ("collect_local_price", "Confirm staffing needs and prevailing wages", 2, None, "Compare with notified minimum wages and three local employers."),
    "operations.variable_costs": ("investigate_margin", "Establish raw-material and other variable costs", 2, None, "Collect current input prices and consumption norms."),
    "revenue.streams": ("complete_record_section", "Define the revenue streams", 1, None, "Identify what is sold, the pricing unit and the customer segment."),
    "revenue.drivers": ("collect_local_price", "Collect selling-price and volume evidence", 1, None, "Observe actual selling prices and realistic volumes; owner interviews are the best source."),
    "financial.parameters": ("define_assumption", "Resolve the model's missing required inputs", 1, None, "Each missing input needs an observation; if none can be obtained, record an explicit assumption with rationale."),
    "financial.scenario": ("complete_record_section", "Compute the base scenario", 2, None, "Runs automatically once every required input is resolved."),
    "infrastructure.requirements": ("confirm_capacity", "Record space, power and water requirements", 3, None, "Confirm against equipment specifications and an operating unit."),
    "founder.skills": ("complete_record_section", "Map the founder capabilities this business demands", 3, None, "Base on owner interviews where possible; label analyst judgement as such."),
    "founder.requirements": ("complete_record_section", "Record qualification and training requirements", 3, None, "Include training providers near Pune and Nanded."),
    "lifestyle.profile": ("interview_owner", "Establish the owner's working pattern", 2, "owner_interview", "Hours, weekends, physical demands and how far the business runs without the owner."),
    "market.observations": ("collect_local_price", "Collect local market observations", 2, None, "Selling prices and competitor counts in Pune and Nanded. A competitor count is an indicator, not demand."),
    "regulatory.mapping": ("verify_licence", "Identify and verify the applicable licences and registrations", 1, "regulatory_checklist",
                           "Confirm each requirement on the issuing authority's own portal; record fee, validity and the date checked."),
    "regulatory.verified": ("verify_licence", "Verify every mandatory regulation against its authority", 2, "regulatory_checklist", "A regulation is verified only when checked at source and dated."),
    "execution.launch_tasks": ("complete_record_section", "Document the establishment process and launch checklist", 3, None, "Sequence from validation through licensing, procurement, hiring and launch."),
    "risk.register": ("complete_record_section", "Build the risk register including a capital-loss scenario", 2, None, "Cover failure modes and exit; do not assign probabilities."),
    "geography.overlay": ("confirm_local_rent", "Confirm local commercial rental costs for Pune and Nanded", 2, "rent_enquiry",
                          "Collect at least three rent observations per city for premises matching the space requirement."),
    "ground_truth.interviews": ("interview_owner", "Interview existing business owners", 1, "owner_interview", "At least three operating owners, with recorded consent, using the owner_operating questionnaire."),
    "ground_truth.failures": ("interview_owner", "Interview an owner whose business closed or was sold", 2, "owner_interview", "Use the owner_former questionnaire; failures counter survivorship bias."),
}


def analyze_gaps(ctx: RunContext) -> dict[str, Any]:
    conn = ctx.conn
    model_id = ctx.run["business_model_id"]
    model = conn.execute("select name, slug from intel.business_models where id = %s", (model_id,)).fetchone()
    wanted: dict[str, dict[str, Any]] = {}

    def want(key: str, **task: Any) -> None:
        wanted[f"{model['slug']}:{key}"] = task

    for item in conn.execute("select * from intel.v_completeness_items where business_model_id = %s and not is_satisfied", (model_id,)).fetchall():
        spec = COMPLETENESS_TASKS.get(item["check_key"])
        if spec:
            ttype, title, priority, template, instructions = spec
            want(f"completeness:{item['check_key']}", task_type=ttype, title=f"{title} — {model['name']}", priority=priority,
                 template_key=template, instructions=instructions, description=f"Completeness check not satisfied: {item['label']}.",
                 target_key=item["check_key"], generated_by=f"completeness:{item['check_key']}")

    for v in _variants(ctx):
        for r in conn.execute(
            """select ci.id, ci.name from intel.cost_items ci join intel.cost_categories cc on cc.id = ci.cost_category_id
               where ci.business_variant_id = %s and cc.slug in ('capex.machinery', 'capex.equipment')
                 and not exists (select 1 from intel.cost_observations o where o.cost_item_id = ci.id and o.evidence_type = 'supplier_quote'
                                   and o.verification_status <> 'rejected')""",
            (v["id"],)).fetchall():
            want(f"quotes:{r['id']}", task_type="obtain_supplier_quotes", title=f"Obtain three quotations: {r['name']}", priority=2,
                 template_key="supplier_enquiry", target_table="cost_items", target_id=r["id"], business_variant_id=v["id"],
                 description="The only price for this machine comes from a project report. Current supplier quotations are needed.",
                 instructions="Three independent suppliers; specify capacity, GST, freight to Pune and Nanded, installation, warranty, validity.",
                 generated_by="rule:machinery_without_quote")
        for r in conn.execute(
            """select parameter_key, parameter_name, revenue_stream_name from intel.v_variant_parameter_status
               where business_variant_id = %s and is_required and not is_resolved""", (v["id"],)).fetchall():
            want(f"param:{v['id']}:{r['parameter_key']}:{r['revenue_stream_name']}", task_type="confirm_capacity" if "capacity" in r["parameter_key"] else "collect_local_price",
                 title=f"Find evidence for: {r['parameter_name']}", priority=1, business_variant_id=v["id"], target_key=r["parameter_key"],
                 description="A required model input has no observation. The financial scenario cannot be computed without it.",
                 generated_by="rule:required_parameter_missing")
        for r in conn.execute(
            """select fp.id, coalesce(pd.name, fp.parameter_key) as name, fp.value, fp.rationale
               from intel.financial_parameters fp left join intel.financial_parameter_definitions pd on pd.key = fp.parameter_key
               where fp.business_variant_id = %s and fp.is_current and fp.basis = 'assumption'
                 and fp.parameter_key in ('ramp_start_pct', 'ramp_months_to_steady_state', 'pre_operating_months', 'owner_monthly_compensation',
                                          'raw_material_stock_days', 'finished_goods_stock_days', 'receivable_days')""",
            (v["id"],)).fetchall():
            want(f"assumption:{v['id']}:{r['name']}", task_type="define_assumption", title=f"Replace default assumption with evidence: {r['name']}",
                 priority=3, business_variant_id=v["id"], template_key="owner_interview",
                 description=f"The model currently uses a PlanB default ({float(r['value']):g}). {r['rationale']}", generated_by="rule:default_assumption")
        for r in conn.execute(
            """select c.id, coalesce(ci.name, pd.name) as subject, c.spread_pct, c.observation_count
               from intel.observation_conflicts c left join intel.cost_items ci on ci.id = c.cost_item_id
               left join intel.financial_parameter_definitions pd on pd.key = c.parameter_key
               where c.business_variant_id = %s and c.status = 'open'""", (v["id"],)).fetchall():
            want(f"conflict:{r['id']}", task_type="resolve_conflict", title=f"Resolve conflicting observations: {r['subject']}", priority=1,
                 business_variant_id=v["id"], target_table="observation_conflicts", target_id=r["id"],
                 description=f"{r['observation_count']} observations disagree by {float(r['spread_pct']):.0f}%.",
                 instructions="Check scale, date, tax and installation treatment of each; verify or reject, or accept the range.",
                 generated_by="rule:open_conflict")
        for r in conn.execute(
            """select ci.id, ci.name from intel.cost_items ci join intel.cost_categories cc on cc.id = ci.cost_category_id
               where ci.business_variant_id = %s and cc.slug = 'opex.rent' and ci.location_metric_key is null""", (v["id"],)).fetchall():
            want(f"local-rent:{r['id']}", task_type="confirm_local_rent", title=f"Tie '{r['name']}' to a local rent rate and floor area", priority=3,
                 business_variant_id=v["id"], target_table="cost_items", target_id=r["id"], template_key="rent_enquiry",
                 description="The rent in the model is a single national figure from the source. Rent is the most location-dependent cost.",
                 instructions="Costs → the rent line → 'Derive this cost locally': choose the rent metric, enter the floor area as the multiplier and "
                              "say where the area comes from. Then record rent observations for Pune and Nanded under Geography.",
                 generated_by="rule:rent_not_localised")
        if conn.execute("select 1 from intel.financial_parameters where business_variant_id = %s and is_current and parameter_key = 'stated_subsidy_amount'", (v["id"],)).fetchone():
            want(f"scheme:{v['id']}", task_type="verify_licence", title="Verify the subsidy scheme assumed by the source (status, eligibility, ceiling)", priority=2,
                 business_variant_id=v["id"], template_key="regulatory_checklist",
                 description="The source document assumes a credit-linked capital subsidy. It is excluded from the model until verified.",
                 generated_by="rule:unverified_subsidy")

    for r in conn.execute(
        """select d.id, d.title, count(*) as n, min(o.observed_on) as oldest
           from intel.v_usable_observations o join intel.source_documents d on d.id = o.source_document_id
           where o.business_model_id = %s and (o.revalidate_by < current_date or o.valid_until < current_date)
           group by d.id, d.title""", (model_id,)).fetchall():
        want(f"stale:{r['id']}", task_type="revalidate_evidence", title=f"Revalidate {r['n']} stale observations from: {r['title']}"[:240], priority=2,
             target_table="source_documents", target_id=r["id"],
             description=f"Observations dated {r['oldest']} are past their revalidation date. Prices must be re-confirmed against current evidence.",
             instructions="Obtain current quotations / prices; record them as new observations that supersede these.", generated_by="rule:stale_evidence")
    for r in conn.execute(
        """select d.id, d.title, count(*) filter (where c.status = 'extracted') as pending, count(*) filter (where not c.quote_verified) as unverifiable
           from intel.evidence_claims c join intel.source_documents d on d.id = c.source_document_id
           where c.business_model_id = %s group by d.id, d.title
           having count(*) filter (where c.status = 'extracted') > 0""", (model_id,)).fetchall():
        want(f"review:{r['id']}", task_type="review_claims", title=f"Review {r['pending']} extracted claims from: {r['title']}"[:240], priority=1,
             target_table="source_documents", target_id=r["id"],
             description=f"{r['pending']} claims await human review" + (f"; {r['unverifiable']} could not be matched to the page text" if r["unverifiable"] else "") + ".",
             instructions="Open each claim beside the cited page; accept, correct or reject.", generated_by="rule:claims_pending_review")

    created = closed = 0
    with conn.transaction():
        ctx.tag_audit()
        for dedupe, t in wanted.items():
            row = conn.execute(
                """insert into intel.research_tasks (business_model_id, business_variant_id, task_type, title, description, instructions,
                                                     template_key, target_table, target_id, target_key, priority, generated_by,
                                                     dedupe_key, research_run_id, data_origin)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (dedupe_key) where dedupe_key is not null and status in ('open', 'in_progress', 'blocked') do nothing
                   returning id""",
                (model_id, t.get("business_variant_id"), t["task_type"], t["title"], t.get("description"), t.get("instructions"),
                 t.get("template_key"), t.get("target_table"), t.get("target_id"), t.get("target_key"), t["priority"],
                 t["generated_by"], dedupe, ctx.run_id, ctx.data_origin),
            ).fetchone()
            created += row is not None
        # a pipeline-generated task whose gap has disappeared is closed, never left to rot
        for r in conn.execute(
            """select id, dedupe_key from intel.research_tasks
               where business_model_id = %s and status = 'open' and generated_by <> 'manual' and dedupe_key is not null""",
            (model_id,)).fetchall():
            if r["dedupe_key"] not in wanted:
                conn.execute(
                    """update intel.research_tasks set status = 'auto_closed', completed_at = now(),
                              resolution_note = 'Closed automatically: the gap that raised this task no longer exists.' where id = %s""",
                    (r["id"],))
                closed += 1
    open_now = conn.execute("select count(*) as n from intel.research_tasks where business_model_id = %s and status in ('open', 'in_progress', 'blocked')", (model_id,)).fetchone()["n"]
    return {"gaps_identified": len(wanted), "tasks_created": created, "tasks_auto_closed": closed, "open_tasks": open_now}


# ── Stage 9: hand over to human review ───────────────────────────────────────
def submit_for_review(ctx: RunContext) -> dict[str, Any]:
    conn = ctx.conn
    model_id = ctx.run["business_model_id"]
    pending = conn.execute("select id, version_no from intel.business_versions where business_model_id = %s and status = 'submitted'", (model_id,)).fetchone()
    if pending:
        return {"submitted": False, "reason": f"version {pending['version_no']} is already awaiting review", "version_id": str(pending["id"])}
    with conn.transaction():
        ctx.tag_audit()
        row = conn.execute(
            "select (v).id, (v).version_no, (v).completeness_pct, (v).critical_missing from (select intel.submit_business_version(%s, %s, %s) as v) x",
            (model_id, ctx.params.get("change_summary") or "Submitted by the research pipeline after document ingestion.", ctx.run_id),
        ).fetchone()
        blockers = conn.execute("select pub.publication_blockers(%s) as b", (row["id"],)).fetchone()["b"]
    return {"submitted": True, "version_id": str(row["id"]), "version_no": row["version_no"],
            "completeness_pct": float(row["completeness_pct"]), "critical_missing": row["critical_missing"],
            "publication_blockers": blockers}
