# PlanB database

PostgreSQL 16 (Supabase) with `pgcrypto`, `pg_trgm` and `pgvector`. 77 tables and 9 views in five schemas.

- **Every column, constraint, trigger and function:** [`DATA_DICTIONARY.md`](DATA_DICTIONARY.md) (generated from the catalogue)
- **Entity-relationship diagrams:** [`ERD.md`](ERD.md) (generated, nine domain diagrams)
- **Source of truth:** `supabase/migrations/*.sql`. Regenerate the two documents with `scripts/gen_db_docs.py`.

## Schemas

| Schema | Holds | Who can reach it |
|---|---|---|
| `intel` | The research database: taxonomy, sources, documents, claims, observations, cost structure, parameters, scenarios, regulations, tasks, versions | Staff (by role) and the research worker |
| `gt` | PlanB Ground Truth: interview subjects (PII), consents, de-identified interviews, actuals, questionnaires | Staff; subjects only admin + assigned interviewer; never the worker |
| `ops` | Durable runs, steps, logs, LLM usage, ingestion log, staff roles, publication policy, audit log | Staff read; worker writes its own run data |
| `pub` | Immutable approved publications; `pub.catalog` teaser view | Staff; `pub.catalog` readable by customers and anonymous users |
| `customer` | Profiles, assets, capabilities, recommendations, saved businesses, pricing hypotheses | The owning user only |

## How a number travels

```
intel.sources ─► intel.source_documents ─► intel.document_pages
                         │
                         ▼
               intel.evidence_claims            verbatim quote + page; quote_verified by deterministic code
                         │  intel.evidence_links (claim → any record)
                         ▼
   cost_observations · parameter_observations · market_observations · location_metrics
        (append-only passports; contradictory rows coexist; observation_conflicts flags disagreement)
                         │  intel.financial_parameter_sources
                         ▼
               intel.financial_parameters        basis = observation | derived | assumption (grade D, rationale)
                         │
                         ▼
               intel.financial_scenarios         engine input + sha256 + engine version → reproducible outputs
                         │
                         ▼
               intel.business_versions           frozen snapshot + quality metrics, four-eyes review
                         │  pub.guard_publication (policy gate)
                         ▼
               pub.publication_versions          the only research-derived data customers can ever read
```

## Invariants enforced by the database

| Rule | Mechanism |
|---|---|
| An estimate (`analyst_estimate`, `llm_estimate`) is always grade D and never verified | `intel.guard_observation()` on all four observation tables |
| Grade A requires human verification, a primary/regulatory evidence type and a source document | `intel.guard_observation()` |
| Demo data stays grade D and unverified; demo/test data is never publishable | `guard_observation()`, `ops.data_origin`, `pub.publication_blockers()` |
| Observation values and passports cannot be edited after insert | `intel.freeze_observation()`; no DELETE policy or grant |
| A claim's extracted content cannot be edited; a claim cannot be accepted unless its quote was found in the document | `intel.freeze_claim()`, constraint `claims_accept_requires_verified_quote` |
| Only reviewers/admins can mark evidence verified; workers can never verify, accept or reject | `intel.guard_verification_role()`, `intel.guard_claim_review()` |
| A version is immutable once submitted; the submitter cannot decide it; negative decisions need comments | `intel.guard_business_version()` |
| Publication requires approval, the quality policy, zero demo/test rows, zero rows from sources without reuse rights | `pub.guard_publication()` → `pub.publication_blockers()` |
| Automated ingestion can only be enabled where reuse terms permit, or written permission is recorded | constraint `sources_ingestion_requires_reuse_right` |
| An assumption is grade D and carries a rationale | constraint on `intel.financial_parameters` |
| An interview cannot be recorded as conducted without consent; self-reported figures cannot be grade A/B | constraints on `gt.owner_interviews`, `gt.business_actuals` |
| Aggregates of owner actuals are released only for ≥ 5 interviews | `gt.v_actuals_aggregate` (`having count(distinct …) >= 5`) |
| The audit log is append-only and never stores personal data values | `ops.forbid_mutation()`, `ops.audit_row('redact')` |

## Quality views

- `intel.v_completeness_items` / `v_business_completeness` — 25 weighted checks per business: is that part of the record present?
- `intel.v_business_evidence_quality` — grade distribution overall and per section, verification state, staleness, conflicts, share of model inputs that are assumptions.
- `intel.v_variant_parameter_status` — every model input a variant needs and whether it is resolved.
- `intel.v_freshness_queue` — everything with a revalidation or expiry date.
- `intel.v_observations` / `v_usable_observations` — all observations in one shape.

## Geography fallback

`intel.resolve_location_metric(location_id, metric_key)` walks city → district → state → country and returns the
nearest value **and the level it came from**, or no row. Consumers must show the level; a state value is never
presented as city-specific, and nothing is returned when nothing is known.

## Migrations

`supabase/migrations/2026112400NNNN_*.sql`, applied in production with `supabase db push` and locally/CI with
`planb db migrate` (which first applies `supabase/dev/00_supabase_shim.sql` on a non-Supabase database). Both record
versions in `supabase_migrations.schema_migrations`. The schema has not shipped to any production database, so the
initial migrations were edited in place during development; **from the first deployment onward, migrations are
append-only.**
