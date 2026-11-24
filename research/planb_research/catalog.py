"""Sync the version-controlled research catalogue (research/catalog/*.yaml) into the database.

The YAML files are the reviewable source of truth for the source registry and the research backlog;
this loader is idempotent and never overwrites research that has progressed beyond the backlog stage.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import psycopg
import yaml

_REUSE_OK = ("permitted", "permitted_with_attribution")
_TIER_FIT = {"metro": "metro", "tier-2": "tier2", "tier-3": "tier3", "rural": "rural"}


def _load(path: Path) -> list[dict[str, Any]]:
    return yaml.safe_load(path.read_text()) or [] if path.exists() else []


def sync_sources(conn: psycopg.Connection, catalog_dir: Path) -> dict[str, int]:
    entries: dict[str, dict] = {}
    for path in sorted(catalog_dir.glob("sources*.yaml"), reverse=True):  # sources.yaml wins over supplements
        for e in _load(path):
            entries[e["slug"]] = e
    n = enabled = 0
    for e in entries.values():
        robots, licence = e.get("robots_txt") or {}, e.get("licence") or {}
        confidence = e.get("confidence", "unverified")
        # Automated ingestion is switched on only by an explicit `ingestion_enabled: true` in the YAML —
        # a human decision — and only where the recorded terms actually allow it.
        enable = bool(e.get("ingestion_enabled")) and e.get("reuse_status") in _REUSE_OK and confidence == "verified"
        conn.execute(
            """insert into intel.sources
                 (slug, name, publisher, source_type, authority_level, base_url, information_available, geographic_coverage,
                  access_method, accessibility, accessibility_notes, api_available, api_notes, requires_auth, robots_txt_url,
                  robots_txt_status, robots_txt_summary, licence_name, licence_url, licence_quoted_terms, reuse_status,
                  reuse_notes, permission_contact, terms_checked_on, registry_confidence, update_frequency,
                  quality_limitations, adapter_key, recommended_ingestion, ingestion_enabled, evidence_urls, last_checked_at,
                  rate_limit_per_minute, default_revalidation_days)
               values (%(slug)s, %(name)s, %(publisher)s, %(source_type)s, %(authority_level)s, %(base_url)s, %(info)s, %(geo)s,
                       %(access_method)s, %(accessible)s, %(acc_notes)s, %(api)s, %(api_notes)s, %(auth)s, %(robots_url)s,
                       %(robots_status)s, %(robots_summary)s, %(lic_name)s, %(lic_url)s, %(lic_terms)s, %(reuse)s,
                       %(reuse_notes)s, %(contact)s, %(checked)s, %(confidence)s, %(freq)s,
                       %(limits)s, %(adapter)s, %(rec)s, %(enable)s, %(urls)s, now(), %(rate)s, %(reval)s)
               on conflict (slug) do update set
                 name = excluded.name, publisher = excluded.publisher, source_type = excluded.source_type,
                 authority_level = excluded.authority_level, base_url = excluded.base_url,
                 information_available = excluded.information_available, geographic_coverage = excluded.geographic_coverage,
                 access_method = excluded.access_method, accessibility = excluded.accessibility,
                 accessibility_notes = excluded.accessibility_notes, api_available = excluded.api_available,
                 api_notes = excluded.api_notes, requires_auth = excluded.requires_auth, robots_txt_url = excluded.robots_txt_url,
                 robots_txt_status = excluded.robots_txt_status, robots_txt_summary = excluded.robots_txt_summary,
                 licence_name = excluded.licence_name, licence_url = excluded.licence_url,
                 licence_quoted_terms = excluded.licence_quoted_terms, reuse_status = excluded.reuse_status,
                 reuse_notes = excluded.reuse_notes, permission_contact = excluded.permission_contact,
                 terms_checked_on = excluded.terms_checked_on, registry_confidence = excluded.registry_confidence,
                 update_frequency = excluded.update_frequency, quality_limitations = excluded.quality_limitations,
                 adapter_key = excluded.adapter_key, recommended_ingestion = excluded.recommended_ingestion,
                 ingestion_enabled = excluded.ingestion_enabled, evidence_urls = excluded.evidence_urls,
                 last_checked_at = now(), rate_limit_per_minute = excluded.rate_limit_per_minute,
                 default_revalidation_days = excluded.default_revalidation_days""",
            {
                "slug": e["slug"], "name": e["name"], "publisher": e.get("publisher"), "source_type": e["source_type"],
                "authority_level": e["authority_level"], "base_url": e.get("base_url") or None, "info": e.get("information_available"),
                "geo": e.get("geographic_coverage"), "access_method": e["access_method"],
                "accessible": str(e.get("accessible", "untested")).lower(), "acc_notes": e.get("accessibility_notes") or None,
                "api": str(e.get("api_available", "unknown")).lower(), "api_notes": e.get("api_notes") or None,
                "auth": bool(e.get("requires_auth")), "robots_url": robots.get("url") or None,
                "robots_status": robots.get("status") if robots.get("status") in ("fetched", "not_found", "unreachable") else None,
                "robots_summary": robots.get("summary") or None, "lic_name": licence.get("name") or None,
                "lic_url": licence.get("url") or None, "lic_terms": licence.get("quoted_terms") or None,
                "reuse": e.get("reuse_status", "unclear"), "reuse_notes": e.get("reuse_notes") or None,
                "contact": e.get("permission_contact") or None,
                "checked": e.get("checked_on") if confidence != "unverified" else None, "confidence": confidence,
                "freq": e.get("update_frequency"), "limits": list(e.get("quality_limitations") or []),
                "adapter": e.get("candidate_adapter") or None, "rec": e.get("recommended_ingestion", "manual_only"),
                "enable": enable, "urls": list(e.get("evidence_urls") or []),
                "rate": int(e.get("rate_limit_per_minute", 12)), "reval": int(e.get("default_revalidation_days", 365)),
            },
        )
        n += 1
        enabled += enable
    conn.commit()
    return {"sources": n, "ingestion_enabled": enabled}


def sync_backlog(conn: psycopg.Connection, catalog_dir: Path) -> dict[str, int]:
    entries = _load(catalog_dir / "business_backlog.yaml")
    industries = {r["slug"]: r["id"] for r in conn.execute("select id, slug from intel.industries").fetchall()}
    n = codes = rels = 0
    ids: dict[str, Any] = {}
    for e in entries:
        fit = [_TIER_FIT[g] for g in e.get("geography_fit", []) if g in _TIER_FIT]
        notes = "\n".join(filter(None, [
            e.get("notes"),
            "Scales to research: " + "; ".join(e.get("typical_scales", [])) if e.get("typical_scales") else None,
            "Ownership structures: " + "; ".join(e.get("ownership_structures", [])) if e.get("ownership_structures") else None,
            "Regulatory leads (unverified): " + "; ".join(e.get("key_regulations_to_research", [])) if e.get("key_regulations_to_research") else None,
            "Candidate sources: " + "; ".join(e.get("candidate_evidence_sources", [])) if e.get("candidate_evidence_sources") else None,
        ]))
        row = conn.execute(
            """insert into intel.business_models (slug, name, industry_id, family, operating_model, target_customers, revenue_archetype,
                                                  is_pilot, research_priority, capital_tier_hypothesis, geography_fit, backlog_notes)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               on conflict (slug) do update set
                 -- backlog metadata follows the catalogue; research content is only refreshed while still in the backlog
                 is_pilot = excluded.is_pilot, research_priority = excluded.research_priority, family = excluded.family,
                 capital_tier_hypothesis = excluded.capital_tier_hypothesis, geography_fit = excluded.geography_fit,
                 backlog_notes = excluded.backlog_notes,
                 name = case when intel.business_models.lifecycle_status = 'backlog' then excluded.name else intel.business_models.name end,
                 operating_model = case when intel.business_models.lifecycle_status = 'backlog' then excluded.operating_model else intel.business_models.operating_model end,
                 target_customers = case when intel.business_models.lifecycle_status = 'backlog' then excluded.target_customers else intel.business_models.target_customers end
               returning id""",
            (e["slug"], e["name"], industries[e["industry"]], e.get("family"), e.get("operating_model"), e.get("target_customers"),
             e.get("revenue_archetype"), bool(e.get("pilot")), int(e.get("research_priority", 3)), e.get("capital_tier_hypothesis"),
             fit, notes),
        ).fetchone()
        ids[e["slug"]] = row["id"]
        n += 1
        nic = e.get("nic_2008") or {}
        if nic.get("code"):
            code = conn.execute(
                """insert into intel.classification_codes (system_code, code, title, is_verified, verified_against)
                   values ('NIC-2008', %s, %s, %s, %s)
                   on conflict (system_code, code) do update set title = excluded.title, is_verified = excluded.is_verified,
                                                                 verified_against = excluded.verified_against
                   returning id""",
                (str(nic["code"]), nic.get("title") or "", bool(nic.get("verified")),
                 "MoSPI NIC-2008 publication, checked by research agent on 2026-11-24 (sample-audited)" if nic.get("verified") else None),
            ).fetchone()
            conn.execute(
                """insert into intel.business_model_classifications (business_model_id, classification_code_id, is_primary)
                   values (%s, %s, true) on conflict do nothing""",
                (row["id"], code["id"]),
            )
            codes += 1
    for e in entries:
        for other in e.get("distinct_from", []):
            if other in ids and e["slug"] < other:
                conn.execute(
                    """insert into intel.business_relationships (from_business_model_id, to_business_model_id, relationship_type, notes)
                       values (%s, %s, 'distinct_sibling', 'Must not be merged: different operating model.') on conflict do nothing""",
                    (ids[e["slug"]], ids[other]),
                )
                rels += 1
    conn.commit()
    return {"business_models": n, "classification_links": codes, "sibling_relationships": rels}
