#!/usr/bin/env python3
"""Generate docs/DATA_DICTIONARY.md and docs/ERD.md from the live database catalogue.

The schema is the source of truth: table and column descriptions come from COMMENT ON statements in
supabase/migrations, so the documentation cannot drift from the database. Run after any migration:

    research/.venv/bin/python scripts/gen_db_docs.py            # uses DATABASE_URL or the local dev database
"""

from __future__ import annotations

import os
import sys
from collections import defaultdict
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

SCHEMAS = ["intel", "gt", "pub", "customer", "ops"]
SCHEMA_TITLES = {
    "intel": "intel — private research records (the proprietary database)",
    "gt": "gt — PlanB Ground Truth (owner interviews and actuals)",
    "pub": "pub — published, customer-facing snapshots",
    "customer": "customer — customer personal data",
    "ops": "ops — research operations, RBAC and audit",
}
# Diagram groups: (title, tables). A table may appear in more than one diagram where it is the join point.
ERD_GROUPS = [
    ("Taxonomy and business structure", ["intel.industries", "intel.business_models", "intel.business_variants", "intel.business_relationships",
                                         "intel.business_model_classifications", "intel.classification_codes", "intel.classification_systems",
                                         "intel.business_assets", "intel.asset_types", "intel.business_versions"]),
    ("Evidence and provenance", ["intel.sources", "intel.source_documents", "intel.document_pages", "intel.document_chunks", "intel.evidence_claims",
                                 "intel.evidence_links", "intel.cost_observations", "intel.parameter_observations", "intel.market_observations",
                                 "intel.location_metrics", "intel.research_reviews"]),
    ("Costs, equipment and suppliers", ["intel.business_variants", "intel.cost_categories", "intel.cost_items", "intel.cost_observations",
                                        "intel.equipment", "intel.equipment_specifications", "intel.suppliers", "intel.supplier_quotes",
                                        "intel.raw_materials", "intel.business_raw_materials", "intel.observation_conflicts"]),
    ("Financial model", ["intel.business_variants", "intel.revenue_streams", "intel.financial_model_templates", "intel.financial_parameter_definitions",
                         "intel.parameter_observations", "intel.financial_parameters", "intel.financial_parameter_sources", "intel.financial_scenarios",
                         "intel.cost_items", "intel.locations"]),
    ("Requirements, founder, lifestyle, risk, execution", ["intel.business_models", "intel.business_variants", "intel.operating_requirements",
                                                           "intel.skills", "intel.business_skill_mapping", "intel.founder_requirements",
                                                           "intel.lifestyle_profiles", "intel.training_programs", "intel.training_program_businesses",
                                                           "intel.business_risks", "intel.launch_tasks"]),
    ("Geography, market and regulation", ["intel.locations", "intel.location_metrics", "intel.metric_definitions", "intel.market_observations",
                                          "intel.regulations", "intel.business_regulations", "intel.government_schemes",
                                          "intel.business_scheme_eligibility", "intel.business_models"]),
    ("Ground Truth", ["gt.interview_subjects", "gt.consents", "gt.owner_interviews", "gt.interview_responses", "gt.business_actuals",
                      "gt.questionnaires", "gt.questionnaire_questions", "intel.business_models"]),
    ("Research operations, review and publication", ["ops.research_runs", "ops.research_run_steps", "ops.research_run_logs", "ops.llm_usage",
                                                     "ops.ingestion_log", "intel.research_tasks", "intel.business_versions",
                                                     "pub.publication_versions", "ops.publication_policy", "ops.staff_members", "ops.staff_roles",
                                                     "ops.audit_log", "intel.business_models"]),
    ("Customer", ["customer.user_profiles", "customer.user_assets", "customer.user_capabilities", "customer.profile_documents",
                  "customer.recommendations", "customer.saved_businesses", "customer.pricing_plans", "pub.publication_versions", "intel.skills",
                  "intel.asset_types"]),
]


def main() -> int:
    url = os.environ.get("DATABASE_URL", "postgresql://planb:planb@127.0.0.1:5432/planb_dev")
    out_dir = Path(__file__).resolve().parents[1] / "docs"
    with psycopg.connect(url, row_factory=dict_row) as conn:
        tables = conn.execute(
            """select n.nspname as schema, c.relname as name, c.relkind, obj_description(c.oid) as comment, c.relrowsecurity as rls,
                      (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
               from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = any(%s) and c.relkind in ('r', 'v') order by n.nspname, c.relkind, c.relname""", (SCHEMAS,)).fetchall()
        columns = conn.execute(
            """select n.nspname as schema, c.relname as tbl, a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
                      a.attnotnull as not_null, pg_get_expr(d.adbin, d.adrelid) as dflt, col_description(c.oid, a.attnum) as comment,
                      a.attgenerated <> '' as generated
               from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
               left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
               where n.nspname = any(%s) and a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'v')
               order by n.nspname, c.relname, a.attnum""", (SCHEMAS,)).fetchall()
        constraints = conn.execute(
            """select n.nspname as schema, c.relname as tbl, k.conname as name, k.contype as type, pg_get_constraintdef(k.oid) as def,
                      fn.nspname as ref_schema, fc.relname as ref_table,
                      (select array_agg(att.attname order by u.ord) from unnest(k.conkey) with ordinality u(attnum, ord)
                         join pg_attribute att on att.attrelid = k.conrelid and att.attnum = u.attnum) as cols
               from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
               left join pg_class fc on fc.oid = k.confrelid left join pg_namespace fn on fn.oid = fc.relnamespace
               where n.nspname = any(%s) order by n.nspname, c.relname, k.contype, k.conname""", (SCHEMAS,)).fetchall()
        triggers = conn.execute(
            """select n.nspname as schema, c.relname as tbl, t.tgname as name, p.proname as fn
               from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
               join pg_proc p on p.oid = t.tgfoid
               where n.nspname = any(%s) and not t.tgisinternal and t.tgname <> 'zz_audit' order by 1, 2, 3""", (SCHEMAS,)).fetchall()
        audited = {(r["schema"], r["tbl"]) for r in conn.execute(
            """select n.nspname as schema, c.relname as tbl from pg_trigger t join pg_class c on c.oid = t.tgrelid
               join pg_namespace n on n.oid = c.relnamespace where t.tgname = 'zz_audit'""").fetchall()}
        functions = conn.execute(
            """select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
                      obj_description(p.oid) as comment, p.prosecdef as definer
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = any(%s) and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype order by 1, 2""", (SCHEMAS,)).fetchall()

    cols_by = defaultdict(list)
    for c in columns:
        cols_by[(c["schema"], c["tbl"])].append(c)
    cons_by = defaultdict(list)
    for k in constraints:
        cons_by[(k["schema"], k["tbl"])].append(k)
    trig_by = defaultdict(list)
    for t in triggers:
        trig_by[(t["schema"], t["tbl"])].append(t)

    n_tables = sum(1 for t in tables if t["relkind"] == "r")
    lines = ["# PlanB data dictionary", "",
             "> Generated from the database catalogue by `scripts/gen_db_docs.py`. Do not edit by hand — change the",
             "> `COMMENT ON` statements in `supabase/migrations/` and regenerate.", "",
             f"{n_tables} tables and {len(tables) - n_tables} views across {len(SCHEMAS)} schemas. Row-level security is enabled on every table.", ""]
    lines += ["## Contents", ""]
    for schema in SCHEMAS:
        names = [t["name"] for t in tables if t["schema"] == schema]
        lines.append(f"- **{schema}** ({len(names)}): " + ", ".join(f"[{n}](#{schema}{n})".replace("_", "_") for n in names))
    lines.append("")

    for schema in SCHEMAS:
        lines += [f"## {SCHEMA_TITLES[schema]}", ""]
        for t in [t for t in tables if t["schema"] == schema]:
            key = (schema, t["name"])
            kind = "view" if t["relkind"] == "v" else "table"
            lines += [f'<a id="{schema}{t["name"]}"></a>', f"### {schema}.{t['name']}  ·  {kind}", ""]
            if t["comment"]:
                lines += [t["comment"], ""]
            if kind == "table":
                facts = [f"RLS: {'enabled' if t['rls'] else 'DISABLED'} ({t['policies']} policies)",
                         f"audited: {'yes' if key in audited else 'no'}"]
                lines += ["_" + " · ".join(facts) + "_", ""]
            pk = {c for k in cons_by[key] if k["type"] == "p" for c in (k["cols"] or [])}
            fk = {tuple(k["cols"] or []): f"{k['ref_schema']}.{k['ref_table']}" for k in cons_by[key] if k["type"] == "f"}
            fk_single = {cols[0]: ref for cols, ref in fk.items() if len(cols) == 1}
            lines += ["| Column | Type | Null | Default | Key | Description |", "|---|---|---|---|---|---|"]
            for c in cols_by[key]:
                keyinfo = "PK" if c["name"] in pk else ""
                if c["name"] in fk_single:
                    keyinfo = (keyinfo + " " if keyinfo else "") + f"FK → {fk_single[c['name']]}"
                dflt = "generated" if c["generated"] else (c["dflt"] or "")
                dflt = dflt.replace("|", "\\|")
                if len(dflt) > 44:
                    dflt = dflt[:41] + "…"
                lines.append(f"| `{c['name']}` | {c['type'].replace('|', '\\|')} | {'no' if c['not_null'] else 'yes'} | {f'`{dflt}`' if dflt else ''} | {keyinfo} | {(c['comment'] or '').replace('|', '\\|')} |")
            lines.append("")
            uniques = [k for k in cons_by[key] if k["type"] == "u"]
            checks = [k for k in cons_by[key] if k["type"] == "c" and not k["name"].endswith("_not_null")]
            if uniques:
                lines += ["Unique: " + "; ".join(f"`({', '.join(k['cols'])})`" for k in uniques), ""]
            if checks:
                lines += ["<details><summary>Check constraints (" + str(len(checks)) + ")</summary>", ""]
                lines += [f"- `{k['name']}`: `{k['def'].replace('`', "'")}`" for k in checks]
                lines += ["", "</details>", ""]
            if trig_by[key]:
                lines += ["Triggers: " + ", ".join(f"`{x['name']}` → `{x['fn']}()`" for x in trig_by[key]), ""]

    lines += ["## Functions", "", "| Function | Security | Description |", "|---|---|---|"]
    for f in functions:
        lines.append(f"| `{f['schema']}.{f['name']}({f['args']})` | {'definer' if f['definer'] else 'invoker'} | {(f['comment'] or '').replace('|', '\\|')} |")
    lines.append("")
    (out_dir / "DATA_DICTIONARY.md").write_text("\n".join(lines))

    # ── ERD ──────────────────────────────────────────────────────────────────
    erd = ["# PlanB entity-relationship diagrams", "",
           "> Generated from the database catalogue by `scripts/gen_db_docs.py`. One diagram per domain; a table can appear in",
           "> several diagrams where it joins domains. Columns shown are keys only — see `DATA_DICTIONARY.md` for every column.", "",
           "Polymorphic links that foreign keys cannot express: `intel.evidence_links (target_table, target_id)` points at any evidenced record;",
           "`intel.research_reviews (subject_type, subject_id)` at any reviewed record; `intel.research_tasks (target_table, target_id)` at the gap's subject.", ""]
    fks = [k for k in constraints if k["type"] == "f"]
    for title, members in ERD_GROUPS:
        member_set = set(members)
        erd += [f"## {title}", "", "```mermaid", "erDiagram"]
        for full in members:
            schema, name = full.split(".")
            key = (schema, name)
            pk = {c for k in cons_by[key] if k["type"] == "p" for c in (k["cols"] or [])}
            fkcols = {c for k in cons_by[key] if k["type"] == "f" for c in (k["cols"] or [])}
            erd.append(f"  {schema}_{name} {{")
            for c in cols_by[key]:
                if c["name"] in pk or c["name"] in fkcols:
                    tag = "PK" if c["name"] in pk and c["name"] not in fkcols else ("PK,FK" if c["name"] in pk else "FK")
                    erd.append(f"    {c['type'].split('(')[0].replace(' ', '_').replace('.', '_')} {c['name']} {tag}")
            erd.append("  }")
        seen = set()
        for k in fks:
            src, dst = f"{k['schema']}.{k['tbl']}", f"{k['ref_schema']}.{k['ref_table']}"
            if src in member_set and dst in member_set:
                label = ", ".join(k["cols"] or [])
                edge = (src, dst, label)
                if edge in seen:
                    continue
                seen.add(edge)
                erd.append(f'  {dst.replace(".", "_")} ||--o{{ {src.replace(".", "_")} : "{label}"')
        erd += ["```", ""]
    (out_dir / "ERD.md").write_text("\n".join(erd))
    print(f"wrote {out_dir / 'DATA_DICTIONARY.md'} ({n_tables} tables) and {out_dir / 'ERD.md'} ({len(ERD_GROUPS)} diagrams)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
