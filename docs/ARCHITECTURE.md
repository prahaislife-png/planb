# PlanB architecture

PlanB is a business-intelligence company: a proprietary, continuously maintained, evidence-backed database of
real-world business operating models in India, with an intelligence layer on top. The database is the product.
This document describes how the system is built, why, and what is deliberately left for later.

See also: [`STATUS.md`](STATUS.md) (what works today), [`DATABASE.md`](DATABASE.md), [`DATA_DICTIONARY.md`](DATA_DICTIONARY.md),
[`ERD.md`](ERD.md), [`RESEARCH_METHODOLOGY.md`](RESEARCH_METHODOLOGY.md), [`SECURITY.md`](SECURITY.md), [`ROADMAP.md`](ROADMAP.md).

## 1. Shape of the system

```
                 ┌──────────────────────────── PostgreSQL (Supabase) ────────────────────────────┐
                 │  intel   research records: sources, documents, claims, observations,           │
 research/       │          cost structure, parameters, scenarios, tasks, versions                │       web/
 Python worker ──┤  gt      Ground Truth: interviews, actuals, PII isolated                        ├── Next.js dashboard
 (planb_worker   │  ops     durable runs, steps, logs, LLM spend, staff roles, audit log           │   "PlanB Intelligence"
  DB role)       │  pub     immutable approved publications  ──────────────► customers (Phase 9)   │   (authenticated role,
                 │  customer profiles, assets, recommendations (personal data)                     │    RLS on every query)
                 └────────────────────────────────────────────────────────────────────────────────┘
        │                                         ▲
        │ node packages/finance/dist/cli.mjs      │ import '@planb/finance' (same source, in the browser)
        ▼                                         │
   packages/finance — deterministic financial engine (TypeScript, no I/O, no LLM)

   Evidence files: private object storage (Supabase Storage; local disk in dev), content-addressed by SHA-256.
```

Three deployable pieces and one library, no microservices:

| Piece | Tech | Runs where | Responsibility |
|---|---|---|---|
| Database | PostgreSQL 16 + pgvector | Supabase | All state, all invariants (constraints, triggers, RLS), the job queue |
| Research worker | Python 3.11+ (`research/`) | A container or VM (not Vercel) | Source adapters, ingestion, extraction, normalisation, cross-verification, modelling orchestration, gap analysis |
| Dashboard | Next.js 16 / TypeScript (`web/`) | Vercel | PlanB Intelligence (internal). The customer product will be a second app on the same database |
| Finance engine | TypeScript (`packages/finance`) | Inside the worker (CLI) and the browser | Every financial number. Pure, deterministic, versioned |

## 2. Principles that shape the design

1. **The observation is the atomic unit of IP.** A business record is not a document; it is a structure of cost
   items, revenue streams and parameters, each backed by *observations* — numbers with a full passport (value, unit,
   date, geography, scale, source, document, page, tax and installation treatment, evidence type, verification status,
   grade, revalidation date). Observations are append-only. A newer figure supersedes; a correction supersedes;
   contradictory figures coexist until an analyst resolves them.
2. **Three layers of numbers, never mixed.**
   *Claims* are what a document says (verbatim quote + page). *Observations* are normalised, typed facts.
   *Financial parameters* are what the model uses — each resolved from observations, derived by a stated formula, or
   an explicit assumption with a rationale and grade D. Scenario outputs are a fourth thing: arithmetic on parameters.
3. **Missing stays missing.** A required model input with no observation is not defaulted, estimated or asked of an
   LLM. The scenario is not computed and a research task is raised.
4. **Invariants live in the database.** What a grade may mean, who may verify, four-eyes approval, immutability of
   evidence, the publication gate, the legal gate on automated ingestion — all are constraints and triggers, so they
   hold for the dashboard, the worker, a psql session and any future tool alike. Application code is convenience.
5. **Completeness and evidence quality are separate axes** everywhere: views, snapshots, publication policy, UI.
   There is no blended score, and no suitability or success probability anywhere in the schema.
6. **AI is an extraction tool, not a source.** A model may transcribe a claim from a page. It never supplies a
   number, never computes a financial result, and nothing it emits is trusted until deterministic code has found the
   quote in the document and a human has reviewed it.
7. **Research is centralised and reused.** Customers will read publications; they never trigger research.

## 3. Key decisions

### 3.1 Schemas are the security boundary
`intel`, `gt`, `ops`, `pub`, `customer` — not `public`. Supabase's Data API exposes only `public` by default, so
proprietary research is unreachable from customer clients even before RLS. RLS is then enabled on every table in all
five schemas (a test asserts this), and a table without a policy is closed.

### 3.2 The dashboard talks SQL, as the user
The dashboard uses `postgres.js` from server components and server actions, not PostgREST. Every query runs through
`asUser()`, which opens a transaction, sets `role = authenticated` and `request.jwt.claims` — the same contract Supabase
uses — so RLS applies exactly as it would through the Supabase API. There is no code path that queries as the
connection owner. Reasons: an intelligence terminal needs joins, aggregates and views that PostgREST makes awkward;
transaction-scoped role switching works behind Supabase's pooler; and it let us test RLS on plain PostgreSQL.

### 3.3 One finance engine, two call sites
The engine is TypeScript because the same code must drive interactive calculators in the browser (internal now,
customer-facing later). The Python worker calls it through a small CLI (`node dist/cli.mjs`, JSON in / JSON out).
Scenario rows store the exact input, its SHA-256 and the engine version; re-running reproduces the output (tested).
Alternative considered: a Python engine with a service in front of it. Rejected — two implementations of money
arithmetic, or a network hop for every slider movement.

### 3.4 Durable jobs in PostgreSQL, not a queue service
`ops.research_runs` + `ops.research_run_steps` + `SELECT … FOR UPDATE SKIP LOCKED`. A worker leases a run, heartbeats
per stage, and can die at any point: the lease expires, another worker claims the run, completed stages are skipped,
and every stage is idempotent (natural or dedupe keys). Retries back off exponentially up to `max_attempts`;
non-retryable errors and exhausted budgets stop with explicit statuses. This is enough for research workloads
(minutes per run, tens of runs per hour) and adds no infrastructure. If volume ever demands it, the same step
functions can be driven by a workflow engine without changing the data model.

### 3.5 Typed observation tables with a shared passport
`cost_observations`, `parameter_observations`, `market_observations`, `location_metrics` are separate tables (each has
a different subject) carrying the same passport columns and the same two triggers (`guard_observation`,
`freeze_observation`). `intel.v_observations` unions them for analytics. A single generic fact table was considered;
typed tables give real foreign keys to their subjects and clearer constraints at the cost of some repeated DDL.

### 3.6 Versions are frozen JSON; working data is relational
The working record is fully normalised (60 tables in `intel`). When submitted for review, `build_business_snapshot()`
renders it to JSON, hashes it and freezes it in `business_versions` with its quality metrics. Review, diff and
publication operate on that immutable artefact; the publication gate reads the frozen metrics, not live data.

### 3.7 Local Supabase shim instead of the Supabase stack
`supabase/dev/00_supabase_shim.sql` provides the roles, `auth.users`, `auth.uid()` and the `extensions` schema on plain
PostgreSQL, so the real migrations apply unchanged locally and in CI and RLS is testable without Docker. Migrations
are tracked in `supabase_migrations.schema_migrations`, the table the Supabase CLI uses, so `supabase db push` and our
runner are interchangeable.

### 3.8 Rules before models for extraction
Many Indian government project reports are generated from a handful of templates. Where a template is recognised
(currently the NIFTEM PMFME DPR), a deterministic extractor reads it: zero cost, reproducible, every claim quoting
its line. The LLM extractor handles everything else through the same schema and the same quote verification.

## 4. The research pipeline

`document_research` (one source document → a business record awaiting review):

| # | Stage | What it does | Idempotency key |
|---|---|---|---|
| 3 | `ingest_document` | Adapter fetch or manual upload → validate (PDF by magic bytes, size) → SHA-256 → dedupe → private storage → per-page text, tables, retrieval chunks | document SHA-256; `(document, page)` |
| 4 | `extract_claims` | Rule-based or LLM extractor → schema validation → **quote verification against stored page text** → `evidence_claims` | `(document, dedupe_hash)` |
| 5 | `normalize_claims` | Money scale (lakh/crore → rupees), unit vocabulary, periods; unknown units left for an analyst | claim id |
| — | `structure_record` | Quote-verified claims → variant, revenue streams, cost items, observations, requirements + `evidence_links` | `evidence_links` per claim |
| 6 | `cross_verify` | Compare comparable observations; open conflicts above 15 % spread; grade B when ≥ 2 independent, current sources agree; intra-document consistency (line items vs stated totals) | one open conflict per subject |
| 7 | `build_model` | Resolve parameters (observation / derived / assumption) → build engine input → run scenarios + stress tests + source reconciliation | `(variant, scenario, input_hash, engine_version)` |
| 8 | `analyze_gaps` | Completeness checks + rules → research tasks; closes tasks whose gap has gone | task `dedupe_key` |
| 9 | `submit_for_review` | Freeze a version with its quality metrics; report publication blockers | one pending version per model |

`business_refresh` re-runs normalise → structure → cross-verify → model → gaps after analysts review or correct
evidence. `freshness_scan` (stage 11) expires quotations, flags published records with stale evidence and raises
revalidation tasks. Stages 1–2 (opportunity and evidence discovery) are currently human-driven through the catalogue
YAML and the source registry; stage 10 (publication) is a human action behind the gate.

## 5. Repository layout

```
supabase/migrations/     17 SQL migrations — the schema, RLS, triggers, workflow functions, reference vocabularies
supabase/dev/            local-only Supabase shim
research/planb_research/ Python worker: adapters/, extract/, pipeline/, ingest, storage, catalog, cli
research/catalog/        version-controlled source registry, 137-model backlog, pilot document list (YAML)
research/templates/      supplier enquiry, owner interview, rent enquiry, regulatory checklist
research/tests/          pytest suite (unit + PostgreSQL integration, mapped to the acceptance criteria)
packages/finance/        deterministic financial engine + CLI + tests
web/                     PlanB Intelligence dashboard (Next.js)
scripts/                 dev-reset.sh, gen_db_docs.py
docs/                    this documentation
```

## 6. Known limits and deliberate omissions

- **No embeddings yet.** `document_chunks.embedding` exists (pgvector, HNSW index) but is NULL: no embedding provider
  is configured. Evidence search uses PostgreSQL full-text search, which works today.
- **No OCR.** Scanned PDFs are detected (`text_status = needs_ocr`) and stopped with a clear error.
- **PDF only.** Other formats are refused at ingestion.
- **Tax** is a flat rate or none; Indian slab taxation and GST cash-flow timing are not modelled. Results are pre-tax
  unless a rate is supplied, and say so.
- **Location overlays** are modelled in the schema (`financial_parameters.location_id`, the fallback resolver) but the
  pipeline currently resolves national parameters only; no local evidence exists yet to overlay.
- **Customer product, matching engine, payments** are schema-only (Phases 8–10).
- Worker deployment, scheduled maintenance runs, error monitoring and backups are documented in
  [`RUNBOOK.md`](RUNBOOK.md) but not provisioned — there is no production environment yet.
