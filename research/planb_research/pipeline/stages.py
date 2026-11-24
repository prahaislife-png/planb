"""Stages 3–5 of the research pipeline plus record structuring: ingest → extract → normalise → structure.

Every stage is idempotent: it can be re-run after a crash without duplicating rows.
"""

from __future__ import annotations

import datetime as dt
import io
import re
from pathlib import Path
from typing import Any

import pdfplumber
from psycopg.types.json import Jsonb

from ..adapters.base import DocumentRef, IngestionRefused, ManualUploadAdapter
from ..adapters.registry import adapter_for
from ..extract import niftem_rules
from ..extract.schemas import ExtractionResult
from ..extract.verify import verify_quote
from ..ingest import store_document_text
from ..textnorm import money_multiplier, normalize_period, normalize_unit, slugify
from .runner import NonRetryableError, RunContext

EVIDENCE_TYPE_BY_SOURCE_TYPE = {
    "government_project_report": "government_project_report",
    "regulatory_portal": "regulatory_fee_schedule",
    "manufacturer_catalogue": "manufacturer_catalogue",
    "commercial_report": "market_report",
    "property_listing": "listing_observation",
    "b2b_marketplace": "listing_observation",
}


# ── Stage 3: document ingestion ──────────────────────────────────────────────
def _pdf_creation_year(data: bytes) -> int | None:
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            raw = str((pdf.metadata or {}).get("CreationDate") or "")
    except Exception:  # noqa: BLE001 - metadata is optional
        return None
    m = re.search(r"(19|20)\d{2}", raw)
    return int(m.group(0)) if m else None


def ingest_document(ctx: RunContext) -> dict[str, Any]:
    p = ctx.params
    document_id = ctx.run.get("source_document_id") or p.get("document_id")
    was_duplicate = False

    if not document_id:
        source_slug = p.get("source_slug")
        if not source_slug:
            raise NonRetryableError("run needs source_document_id, or source_slug with local_path/url")
        ref = DocumentRef(url=p.get("url"), title=p.get("title") or "Untitled document", doc_type=p.get("doc_type", "project_report"),
                          listing_page_url=p.get("listing_page_url"), expected_sha256=p.get("expected_sha256"),
                          notes=p.get("notes"), data_origin=ctx.data_origin)
        try:
            if p.get("local_path"):
                adapter = ManualUploadAdapter(ctx.conn, ctx.store, source_slug, settings=ctx.settings, run_id=ctx.run_id)
                doc = adapter.ingest_file(Path(p["local_path"]), ref)
            else:
                adapter = adapter_for(source_slug)(ctx.conn, ctx.store, settings=ctx.settings, run_id=ctx.run_id)
                doc = adapter.ingest(ref)
        except IngestionRefused as exc:
            raise NonRetryableError(str(exc)) from exc
        document_id, was_duplicate = doc.document_id, doc.was_duplicate
        ctx.conn.execute("update ops.research_runs set source_document_id = %s where id = %s", (document_id, ctx.run_id))
        ctx.run["source_document_id"] = document_id
        ctx.conn.commit()

    doc_row = ctx.conn.execute("select * from intel.source_documents where id = %s", (document_id,)).fetchone()
    if doc_row is None:
        raise NonRetryableError(f"document {document_id} not found")
    pages = ctx.conn.execute("select count(*) as n from intel.document_pages where document_id = %s", (document_id,)).fetchone()["n"]
    stats: dict[str, Any] = {"pages": pages, "needs_ocr": doc_row["text_status"] == "needs_ocr"}
    if doc_row["text_status"] not in ("extracted", "needs_ocr") or pages == 0:
        data = ctx.store.get(doc_row["storage_path"])
        stats = store_document_text(ctx.conn, document_id, data)
        if doc_row["document_date"] is None:
            year = _pdf_creation_year(data)
            if year:
                ctx.conn.execute(
                    """update intel.source_documents set document_date = make_date(%s, 1, 1), document_date_precision = 'year',
                              notes = concat_ws(' ', notes, 'Document date taken from PDF creation metadata; the document prints no date.')
                       where id = %s and document_date is null""",
                    (year, document_id),
                )
        ctx.conn.commit()
        ctx.conn.execute(
            "insert into ops.ingestion_log (source_id, adapter_key, research_run_id, action, outcome, document_id, detail) values (%s, %s, %s, 'text_extract', 'ok', %s, %s)",
            (doc_row["source_id"], "text", ctx.run_id, document_id, f"{stats['pages']} pages, {stats['chars']} chars"),
        )
        ctx.conn.commit()
    if stats.get("needs_ocr"):
        raise NonRetryableError("document has no extractable text layer (scanned); OCR is required before extraction")
    return {"document_id": str(document_id), "was_duplicate": was_duplicate, **stats}


# ── Stage 4: structured extraction ───────────────────────────────────────────
def _load_pages(ctx: RunContext, document_id: str) -> list[tuple[int, str]]:
    rows = ctx.conn.execute(
        "select page_no, text from intel.document_pages where document_id = %s order by page_no", (document_id,)
    ).fetchall()
    return [(r["page_no"], r["text"]) for r in rows]


def _run_extractor(ctx: RunContext, pages: list[tuple[int, str]]) -> ExtractionResult:
    choice = ctx.params.get("extractor", "auto")
    if choice in ("auto", "rules") and niftem_rules.applies(pages):
        return niftem_rules.extract(pages)
    if choice == "rules":
        raise NonRetryableError("no rule-based extractor recognises this document's template")
    if choice in ("auto", "llm"):
        from ..extract import llm  # imported lazily: the anthropic SDK is an optional dependency

        if not ctx.settings.anthropic_api_key:
            raise NonRetryableError(
                "no rule-based extractor recognises this document and LLM extraction is not configured "
                "(ANTHROPIC_API_KEY is not set)"
            )
        model = ctx.conn.execute("select name, operating_model from intel.business_models where id = %s",
                                 (ctx.run.get("business_model_id"),)).fetchone()
        return llm.extract(ctx, pages, business_name=model["name"] if model else None)
    raise NonRetryableError(f"unknown extractor {choice!r}")


def extract_claims(ctx: RunContext) -> dict[str, Any]:
    document_id = ctx.run["source_document_id"]
    pages = _load_pages(ctx, document_id)
    page_text = dict(pages)
    result = _run_extractor(ctx, pages)

    inserted = verified = 0
    with ctx.conn.transaction():
        ctx.tag_audit()
        for claim in result.claims:
            check = verify_quote(claim.quote, page_text.get(claim.page_no, ""), claim.value_numeric)
            row = ctx.conn.execute(
                """insert into intel.evidence_claims
                     (source_document_id, page_no, section_ref, quote, quote_verified, quote_match_score, business_model_id,
                      claim_type, subject, attribute, value_numeric, value_low, value_high, value_text, unit_raw, currency,
                      period_raw, quantity, qualifiers, target_kind, cost_category_slug, parameter_key, extraction_method,
                      extractor, extractor_confidence, research_run_id, dedupe_hash, data_origin)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (source_document_id, dedupe_hash) do nothing
                   returning id""",
                (document_id, claim.page_no, claim.section_ref, claim.quote, check.verified, check.score,
                 ctx.run.get("business_model_id"), claim.claim_type, claim.subject, claim.attribute, claim.value_numeric,
                 claim.value_low, claim.value_high, claim.value_text, claim.unit_raw, claim.currency, claim.period_raw,
                 claim.quantity, Jsonb(claim.qualifiers.model_dump(exclude_none=True)), claim.target_kind,
                 claim.cost_category_slug, claim.parameter_key, result.method, result.extractor, claim.confidence,
                 ctx.run_id, claim.dedupe_hash(), ctx.data_origin),
            ).fetchone()
            if row:
                inserted += 1
                verified += check.verified
    total = ctx.conn.execute(
        "select count(*) as n, count(*) filter (where quote_verified) as v from intel.evidence_claims where source_document_id = %s",
        (document_id,),
    ).fetchone()
    for note in result.notes:
        ctx.log(f"extractor note: {note}", level="warning")
    return {"extractor": result.extractor, "method": result.method, "claims_emitted": len(result.claims),
            "claims_inserted": inserted, "inserted_quote_verified": verified, "document_claims_total": total["n"],
            "document_claims_quote_verified": total["v"], "facts": result.facts.model_dump(exclude_none=True)}


# ── Stage 5: normalisation ───────────────────────────────────────────────────
def normalize_claims(ctx: RunContext) -> dict[str, Any]:
    # one document on ingestion; the whole business record on refresh (picks up analyst corrections)
    rows = ctx.conn.execute(
        """select id, value_numeric, value_low, value_high, unit_raw, period_raw, qualifiers
           from intel.evidence_claims
           where normalization_notes is null
             and (source_document_id = %s::uuid or (%s::uuid is null and business_model_id = %s::uuid))""",
        (ctx.run.get("source_document_id"), ctx.run.get("source_document_id"), ctx.run.get("business_model_id")),
    ).fetchall()
    known_units = {r["code"] for r in ctx.conn.execute("select code from intel.units").fetchall()}
    normalized = unresolved = 0
    with ctx.conn.transaction():
        ctx.tag_audit()
        for r in rows:
            value, unit_code, notes = r["value_numeric"], None, []
            mult = money_multiplier(r["unit_raw"])
            if mult is not None:
                unit_code = "inr"
                if value is not None:
                    value = round(float(value) * mult, 2)
                notes.append(f"money: printed × {mult:g}" if mult != 1 else "money: printed in rupees")
            else:
                unit_code = normalize_unit(r["unit_raw"])
                if r["unit_raw"] and unit_code is None:
                    notes.append(f"unit {r['unit_raw']!r} not recognised — left for analyst")
                    unresolved += 1
                elif unit_code:
                    notes.append(f"unit {r['unit_raw']!r} → {unit_code}")
            if unit_code not in known_units:
                unit_code = None
            period = normalize_period(r["period_raw"])
            if r["period_raw"] and period is None:
                notes.append(f"period {r['period_raw']!r} not recognised")
            ctx.conn.execute(
                """update intel.evidence_claims set value_normalized = %s, unit_code = %s, period = %s, normalization_notes = %s
                   where id = %s""",
                (value, unit_code, period, "; ".join(notes) or "no unit conversion required", r["id"]),
            )
            normalized += 1
    return {"claims_normalized": normalized, "units_unresolved": unresolved}


# ── Structuring: claims → business record (cost items, streams, observations) ─
def _money_scale(unit_raw: str | None) -> float:
    return money_multiplier(unit_raw) or 1.0


def _observed_on(doc: dict) -> tuple[dt.date, str, str | None]:
    if doc["document_date"]:
        return doc["document_date"], doc["document_date_precision"], None
    return doc["retrieved_at"].date(), "unknown", "The document prints no date; the retrieval date is recorded instead."


def _initial_grade(evidence_type: str, observed_on: dt.date, precision: str) -> tuple[str, str]:
    """Automatic grade for a freshly extracted, unverified observation. Never better than C:
    A requires human verification of primary evidence; B requires independent corroboration (cross-verify)."""
    if evidence_type in ("analyst_estimate", "llm_estimate"):
        return "D", "estimate"
    age_years = (dt.date.today() - observed_on).days / 365.25
    if precision == "unknown":
        return "C", "single source; document undated"
    if age_years > 3:
        return "C", f"single source; older benchmark (~{age_years:.0f} years old)"
    return "C", "single source, unverified"


def structure_record(ctx: RunContext) -> dict[str, Any]:
    """Map quote-verified claims onto the normalised business record. Claims whose quote could not be
    verified, or that a reviewer rejected, are never materialised."""
    model_id = ctx.run.get("business_model_id")
    if not model_id:
        raise NonRetryableError("structuring needs a business model")
    conn = ctx.conn
    doc_filter = ctx.run.get("source_document_id")
    claims = conn.execute(
        """select c.*, d.source_id, d.document_date, d.document_date_precision, d.retrieved_at, d.sha256, d.title as doc_title,
                  s.source_type, s.default_revalidation_days
           from intel.evidence_claims c
           join intel.source_documents d on d.id = c.source_document_id
           join intel.sources s on s.id = d.source_id
           where c.business_model_id = %s and c.quote_verified and c.status in ('extracted', 'accepted')
             and (%s::uuid is null or c.source_document_id = %s::uuid)
             and c.target_kind in ('cost_item', 'parameter', 'operating_requirement')
             and not exists (select 1 from intel.evidence_links l where l.claim_id = c.id
                               and l.target_table in ('cost_observations', 'parameter_observations', 'operating_requirements'))
           order by c.page_no, c.created_at""",
        (model_id, doc_filter, doc_filter),
    ).fetchall()
    if not claims:
        return {"claims_structured": 0}

    categories = {r["slug"]: r for r in conn.execute("select id, slug, cost_class from intel.cost_categories").fetchall()}
    param_defs = {r["key"]: r for r in conn.execute("select key, scope, value_kind from intel.financial_parameter_definitions").fetchall()}
    counts = {"cost_items": 0, "cost_observations": 0, "parameter_observations": 0, "requirements": 0, "revenue_streams": 0, "skipped": 0}

    with conn.transaction():
        ctx.tag_audit()
        variants: dict[str, dict] = {}
        streams: dict[tuple[str, str], str] = {}

        def variant_for(claim: dict) -> dict:
            slug = ctx.params.get("variant_slug") or f"doc-{claim['sha256'][:8]}"
            if slug in variants:
                return variants[slug]
            driver = next((c["qualifiers"].get("driver_kind") for c in claims
                           if c["source_document_id"] == claim["source_document_id"] and c["qualifiers"].get("driver_kind")), None)
            has_ref = conn.execute("select 1 from intel.business_variants where business_model_id = %s and is_reference", (model_id,)).fetchone()
            row = conn.execute(
                """insert into intel.business_variants (business_model_id, slug, name, is_reference, scale_description,
                                                        ownership_structure, financial_template_key, notes, data_origin)
                   values (%s, %s, %s, %s, %s, 'unspecified', %s, %s, %s)
                   on conflict (business_model_id, slug) do update set updated_at = now()
                   returning *""",
                (model_id, slug, ctx.params.get("variant_name") or f"As described in: {claim['doc_title']}"[:200], has_ref is None,
                 ctx.carried.get("extract_claims", {}).get("facts", {}).get("capacity_description"), driver,
                 f"Configuration taken from source document {claim['doc_title']!r}.", ctx.data_origin),
            ).fetchone()
            variants[slug] = row
            return row

        def stream_for(variant: dict, q: dict) -> str | None:
            key = q.get("stream_key")
            if not key:
                return None
            ident = (str(variant["id"]), key)
            if ident in streams:
                return streams[ident]
            row = conn.execute(
                """insert into intel.revenue_streams (business_variant_id, key, name, driver_kind, pricing_unit_text, research_run_id, data_origin)
                   values (%s, %s, %s, %s, %s, %s, %s)
                   on conflict (business_variant_id, key) do update
                     set pricing_unit_text = coalesce(intel.revenue_streams.pricing_unit_text, excluded.pricing_unit_text)
                   returning id, (xmax = 0) as inserted""",
                (variant["id"], key, q.get("stream_name") or key.replace("_", " ").title(),
                 q.get("driver_kind") or variant["financial_template_key"] or "capacity_utilization",
                 q.get("pricing_unit"), ctx.run_id, ctx.data_origin),
            ).fetchone()
            counts["revenue_streams"] += row["inserted"]
            streams[ident] = row["id"]
            return row["id"]

        def link(claim_id, table: str, target_id, field: str | None = None) -> None:
            conn.execute(
                """insert into intel.evidence_links (claim_id, target_table, target_id, target_field, research_run_id)
                   values (%s, %s, %s, %s, %s) on conflict do nothing""",
                (claim_id, table, target_id, field, ctx.run_id),
            )

        # streams first so that stream-scoped parameters and variable costs can attach to them
        for c in claims:
            if c["qualifiers"].get("stream_key") and c["qualifiers"].get("driver_kind"):
                stream_for(variant_for(c), c["qualifiers"])

        for c in claims:
            q = c["qualifiers"]
            variant = variant_for(c)
            observed_on, precision, date_note = _observed_on(c)
            evidence_type = EVIDENCE_TYPE_BY_SOURCE_TYPE.get(c["source_type"], "market_report")
            grade, grade_basis = _initial_grade(evidence_type, observed_on, precision)
            if ctx.data_origin == "demo":
                grade, grade_basis = "D", "demonstration data — not research"
            revalidate_by = observed_on + dt.timedelta(days=c["default_revalidation_days"])
            page_ref = f"p. {c['page_no']}" if c["page_no"] else None
            passport = {"observed_on": observed_on, "precision": precision, "source_id": c["source_id"],
                        "doc": c["source_document_id"], "page_ref": page_ref, "section": c["section_ref"],
                        "evidence_type": evidence_type, "grade": grade, "grade_basis": grade_basis,
                        "revalidate_by": revalidate_by, "notes": date_note}

            if c["target_kind"] == "cost_item":
                cat = categories.get(c["cost_category_slug"] or "")
                if cat is None or c["value_normalized"] is None:
                    counts["skipped"] += 1
                    continue
                is_pct = c["unit_code"] == "percent"
                recurrence = q.get("recurrence") or {"capex": "one_time", "pre_operative": "one_time", "deposit": "one_time",
                                                     "staff": "monthly", "fixed_opex": "monthly", "variable": "per_unit_output"}.get(cat["cost_class"], "one_time")
                is_total = bool(q.get("is_line_total"))
                stream_id = stream_for(variant, q) if cat["cost_class"] == "variable" else None
                item = conn.execute(
                    """insert into intel.cost_items (business_variant_id, cost_category_id, key, name, quantity, recurrence, pricing_basis,
                                                     revenue_stream_id, useful_life_years, research_run_id, data_origin)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       on conflict (business_variant_id, key) do update set updated_at = now()
                       returning id, (xmax = 0) as inserted""",
                    (variant["id"], cat["id"], slugify(c["subject"], "_")[:60], c["subject"],
                     1 if is_total else (c["quantity"] or 1), recurrence, "stated_total" if is_total else "per_unit",
                     stream_id, q.get("useful_life_years"), ctx.run_id, ctx.data_origin),
                ).fetchone()
                counts["cost_items"] += item["inserted"]
                period = "per_unit" if is_pct else (c["period"] or {"monthly": "per_month", "annual": "per_year"}.get(recurrence, "one_time"))
                obs = conn.execute(
                    """insert into intel.cost_observations
                         (cost_item_id, value, currency, unit_code, period, is_line_total, quantity_covered, observed_on,
                          observed_on_precision, geographic_scope, scale_note, projection_year, source_id, source_document_id,
                          page_ref, section_ref, tax_treatment, installation, evidence_type, evidence_grade, grade_basis,
                          analyst_notes, revalidate_by, research_run_id, data_origin)
                       values (%s, %s, 'INR', %s, %s, %s, %s, %s, %s, 'national', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       returning id""",
                    (item["id"], c["value_normalized"], "percent" if is_pct else "inr", period, is_total, 1 if is_total else None,
                     passport["observed_on"], passport["precision"], q.get("capacity_note"), q.get("year_index"),
                     passport["source_id"], passport["doc"], passport["page_ref"], passport["section"],
                     q.get("tax_treatment") or ("not_applicable" if cat["cost_class"] == "staff" else "unknown"),
                     q.get("installation") or ("unknown" if cat["cost_class"] == "capex" else "not_applicable"),
                     passport["evidence_type"], passport["grade"], passport["grade_basis"], passport["notes"],
                     passport["revalidate_by"], ctx.run_id, ctx.data_origin),
                ).fetchone()
                link(c["id"], "cost_observations", obs["id"], "value")
                link(c["id"], "cost_items", item["id"], "quantity" if c["quantity"] else None)
                counts["cost_observations"] += 1

            elif c["target_kind"] == "parameter":
                definition = param_defs.get(c["parameter_key"] or "")
                if definition is None or c["value_normalized"] is None:
                    counts["skipped"] += 1
                    continue
                value, period, note = float(c["value_normalized"]), c["period"], date_note
                if c["parameter_key"].endswith("_per_month") and period == "per_year":
                    value, period = value / 12.0, "per_month"
                    note = " ".join(filter(None, [note, f"Source states {c['value_normalized']:g} per annum; divided by 12."]))
                stream_id = stream_for(variant, q) if definition["scope"] == "revenue_stream" else None
                if definition["scope"] == "revenue_stream" and stream_id is None:
                    stream_id = next((sid for (vid, _k), sid in streams.items() if vid == str(variant["id"])), None)
                    if stream_id is None:
                        counts["skipped"] += 1
                        continue
                obs = conn.execute(
                    """insert into intel.parameter_observations
                         (business_variant_id, parameter_key, revenue_stream_id, value, currency, unit_code, period, observed_on,
                          observed_on_precision, geographic_scope, projection_year, source_id, source_document_id, page_ref,
                          section_ref, evidence_type, evidence_grade, grade_basis, analyst_notes, revalidate_by,
                          research_run_id, data_origin)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'national', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       returning id""",
                    (variant["id"], c["parameter_key"], stream_id, value, "INR" if c["unit_code"] == "inr" else None, c["unit_code"],
                     period, passport["observed_on"], passport["precision"], q.get("year_index"), passport["source_id"],
                     passport["doc"], passport["page_ref"], passport["section"], passport["evidence_type"], passport["grade"],
                     passport["grade_basis"], note, passport["revalidate_by"], ctx.run_id, ctx.data_origin),
                ).fetchone()
                link(c["id"], "parameter_observations", obs["id"], "value")
                counts["parameter_observations"] += 1

            elif c["target_kind"] == "operating_requirement":
                rtype = q.get("requirement_type") or "other"
                text = None
                if c["value_low"] is not None and c["value_high"] is not None:
                    text = f"{c['value_low']:g}–{c['value_high']:g} {c['unit_raw'] or ''}".strip()
                req = conn.execute(
                    """insert into intel.operating_requirements (business_variant_id, requirement_type, name, value_numeric, unit_code,
                                                                 value_text, basis, evidence_grade, research_run_id, data_origin)
                       values (%s, %s, %s, %s, %s, %s, 'evidence', 'C', %s, %s) returning id""",
                    (variant["id"], rtype if rtype in ("built_up_space", "land", "power_load", "water", "ventilation", "connectivity",
                                                       "transport_access", "storage", "environmental", "zoning", "working_hours") else "other",
                     c["subject"], c["value_normalized"] if c["value_normalized"] is not None else c["value_high"], c["unit_code"],
                     text or c["value_text"], ctx.run_id, ctx.data_origin),
                ).fetchone()
                link(c["id"], "operating_requirements", req["id"])
                counts["requirements"] += 1

        conn.execute(
            """update intel.business_models
                  set lifecycle_status = case when lifecycle_status = 'backlog' then 'researching' else lifecycle_status end
                where id = %s""",
            (model_id,),
        )
    return {"claims_structured": len(claims), **counts, "variants": [str(v["id"]) for v in variants.values()]}
