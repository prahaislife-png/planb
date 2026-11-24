# PlanB

An intelligence platform that helps salaried professionals in India discover, evaluate and plan real-world businesses
and alternative careers — built on a proprietary, evidence-backed database of business operating models, not on
generated text.

**The database is the product.** Every material number in it carries a passport: value, unit, date, geography,
scale, source, document, page, tax and installation treatment, evidence type, verification status, an evidence grade
(A–D) and a revalidation date. AI extracts and organises; it never supplies a number, and nothing it extracts is
trusted until deterministic code has found the quote in the source document and a human has reviewed it.

This repository contains **PlanB Intelligence** — the internal research operating system — and the foundations for
the customer product that will sit on top of it.

## What works today

- **Database** — 16 PostgreSQL migrations: 77 tables in five schemas, row-level security on every table, an
  append-only audit trail, evidence-grade rules, four-eyes review and a publication gate, all enforced in the database.
- **Research pipeline** (`research/`, Python) — a durable, resumable eight-stage pipeline: ingest a document → extract
  claims → verify each quote against the page → normalise → structure into a business record → cross-verify →
  financial scenarios → gap analysis → submit for human review. Run end to end on three real government project reports.
- **Finance engine** (`packages/finance`, TypeScript) — deterministic monthly model: seven revenue archetypes,
  scenarios, stress tests, sensitivity, failure/closure. The same code runs in the worker and in the browser.
- **Dashboard** (`web/`, Next.js) — research overview, catalogue, and a business record showing every cost with all of
  its observations, the model with its assumptions counted, evidence review, gaps, versions and publication.
- **Research catalogue** (`research/catalog/`) — 71 sources with their reuse terms, a 137-model research backlog with
  NIC-2008 codes, 27 verified pilot documents.
- **Tests** — 107 Python tests against a real PostgreSQL database (mapped to the milestone acceptance criteria, RLS
  and privacy), 865 finance-engine tests.

What does **not** exist yet, what is unverified, and what blocks the first publication: [`docs/STATUS.md`](docs/STATUS.md).
Read it before relying on anything here.

## Documentation

| | |
|---|---|
| [`docs/STATUS.md`](docs/STATUS.md) | Implemented vs unverified vs not built; blockers; acceptance-criteria evidence |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System shape, principles, key decisions, pipeline stages |
| [`docs/DATABASE.md`](docs/DATABASE.md) · [`DATA_DICTIONARY.md`](docs/DATA_DICTIONARY.md) · [`ERD.md`](docs/ERD.md) | Schema overview, generated dictionary, generated ER diagrams |
| [`docs/RESEARCH_METHODOLOGY.md`](docs/RESEARCH_METHODOLOGY.md) | Sources, evidence grades, review, modelling rules, publication standard |
| [`docs/PILOT.md`](docs/PILOT.md) | The ten pilot models, verified documents, and the human research required next |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Roles, controls, what is tested, what is missing |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Local setup, deployment, migrations, backup and recovery, operations |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Ten phases, next 30/90/180 days, risks |
| [`packages/finance/docs/FINANCE_ENGINE.md`](packages/finance/docs/FINANCE_ENGINE.md) | Exact definition of every financial metric |
| [`research/templates/`](research/templates) | Supplier enquiry, owner interview, rent enquiry, regulatory checklist |

## Quick start

```bash
pnpm install && pnpm --filter @planb/finance build
cd research && uv venv .venv && uv pip install -p .venv/bin/python -e ".[dev]" && cd ..
./scripts/dev-reset.sh                                   # local PostgreSQL 16 + pgvector; see docs/RUNBOOK.md
cp web/.env.example web/.env.local && pnpm dev           # http://localhost:3000
```

Tests: `pnpm --filter @planb/finance test` and `cd research && .venv/bin/python -m pytest`.

## Ground rules for contributors

1. Never add a business fact, price or market figure that did not come from an obtained source. Missing stays missing.
2. Financial numbers come only from the deterministic engine.
3. Rules that protect evidence belong in the database (constraints, triggers, RLS), with a test.
4. Demo and test data carry `data_origin`; they can never be verified or published.
5. Read a source's terms before collecting from it, and record them in the source registry.
