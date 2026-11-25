# PlanB runbook

Operating procedures. Sections marked **(not provisioned)** describe what must be set up for production; nothing
production-facing exists yet.

## Local development

Prerequisites: PostgreSQL 16 with the `vector` extension, Node 22 + pnpm 10, Python 3.11+ with `uv`, `poppler-utils`.

```bash
# database (once): a local superuser role and databases
createuser -s planb && psql -c "alter role planb password 'planb'" && createdb -O planb planb_dev

# install
pnpm install                                   # web + finance engine
pnpm --filter @planb/finance build             # builds packages/finance/dist/cli.mjs (the worker calls it)
cd research && uv venv .venv && uv pip install -p .venv/bin/python -e ".[dev]" && cd ..

# schema + dev users + catalogue (drops and rebuilds planb_dev; refuses non-local databases)
./scripts/dev-reset.sh

# ingest a document you obtained legitimately, as the restricted worker role
PLANB_DB_ROLE=planb_worker research/.venv/bin/planb research ingest \
  --business spice-grinding-processing-unit --source niftem-pmfme-dpr \
  --title "Detailed Project Report: Red Chilli Powder Unit under PMFME Scheme" \
  --file /path/to/chillipowderdpr.pdf --run

# dashboard
cp web/.env.example web/.env.local && pnpm dev          # http://localhost:3000, dev identities in the header
```

Worker commands (`research/.venv/bin/planb …`): `db migrate`, `catalog sync`, `research ingest`, `research refresh
--business <slug> --run`, `research eval-extractor --document <id|sha prefix>`, `worker [--once|--until-empty]`,
`maintenance freshness`, `status`.

**First use of the LLM extractor.** Before running it on unseen documents, measure it on the three NIFTEM reports the
rule-based extractor already handles: `ANTHROPIC_API_KEY=… planb research eval-extractor --document <sha prefix>
--budget-usd 1`. It reports how many reference claims the model found, how often it mapped them to the same place in
the record, how many of its quotes verify against the page, and what it added. Read the "extras" and
"mapped_differently" lists before trusting it at volume.

Tests: `pnpm --filter @planb/finance test` · `cd research && .venv/bin/python -m pytest` (creates and migrates
`planb_test`; refuses a database whose name lacks "test").

After any migration: `research/.venv/bin/python scripts/gen_db_docs.py` to regenerate the data dictionary and ERD.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | web, worker | PostgreSQL connection (Supabase pooled connection string in production) |
| `PLANB_DB_ROLE` | worker | Role to `SET ROLE` to after connecting — `planb_worker` |
| `PLANB_AUTH_MODE` | web | `supabase` (default) or `dev` (refused in production builds) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | Supabase Auth |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | worker, web server | Storage access for the private evidence bucket. Server-side only |
| `PLANB_EVIDENCE_BACKEND`, `PLANB_EVIDENCE_DIR` | web, worker | `local` (shared directory) or `supabase` |
| `ANTHROPIC_API_KEY`, `PLANB_EXTRACTION_MODEL` | worker | LLM extraction for documents no rule-based extractor recognises |
| `PLANB_FINANCE_CLI` | worker | Path to `packages/finance/dist/cli.mjs` if not at the default location |
| `PLANB_USER_AGENT` | worker | Identifies the research crawler to source sites |

## First production deployment (not provisioned)

1. Create the Supabase project (region: Mumbai). Enable the `vector` extension.
2. `supabase link` then `supabase db push` — applies `supabase/migrations`. **Do not** apply `supabase/dev/`.
3. Create a private Storage bucket `evidence` (and `customer-uploads` later). No public access; no anon policies.
4. Create a login role for the worker: `create role planb_worker_login login password '…' in role planb_worker noinherit;`
   and set `PLANB_DB_ROLE=planb_worker` so the session drops to the restricted role.
5. Create staff users in Supabase Auth, then insert them into `ops.staff_members` / `ops.staff_roles`. Require MFA.
6. Deploy `web/` to Vercel with `PLANB_AUTH_MODE=supabase`. Restrict access (Vercel deployment protection or SSO).
7. Run the worker as a long-lived container (image needs Python, Node 22, poppler) with `planb worker`.
8. Schedule `planb maintenance freshness` daily.
9. `planb catalog sync` to load the source registry and backlog.
10. Verify: sign in as each role; upload a document; watch a run complete; confirm a customer-role session sees nothing.

## Migrations

- Add a new file `supabase/migrations/<UTC timestamp>_<name>.sql`. Never edit a migration that has been applied to
  production. Write `COMMENT ON` for every new table and non-obvious column.
- Locally: `planb db migrate`; run the Python suite; regenerate the database docs.
- Production: `supabase db push` from CI or a maintainer's machine after review. Take a manual backup first for any
  migration that rewrites data.

## Backup and recovery (not provisioned)

- **Database.** Supabase daily backups plus point-in-time recovery (enable PITR on the project before real research
  data exists). Target: RPO ≤ 5 minutes, RTO ≤ 2 hours. Additionally a weekly `pg_dump` of schemas `intel`, `gt`,
  `ops`, `pub` to encrypted off-platform storage — the database is the company's IP and must survive the loss of the
  provider account.
- **Evidence files.** Content-addressed and immutable; replicate the `evidence` bucket to a second provider weekly.
  A lost file can be detected (SHA-256 in `intel.source_documents`) and, for public sources, re-fetched from its URL.
- **Restore drill.** Quarterly: restore the latest backup into a scratch project, run `planb status`, re-run one
  scenario from its stored input and confirm the stored output is reproduced.
- **Code and catalogue.** Git. The source registry and backlog are YAML in the repository.

## Operations

**A run is stuck in `running`.** Its worker died. Nothing to do: when `locked_until` passes, the next worker reclaims
it and resumes from the first unfinished stage. If attempts are exhausted it becomes `failed`; read
`ops.research_run_logs` (dashboard → Job queue → run), fix the cause, enqueue again.

**A run is `budget_exhausted`.** LLM spend reached the run's budget. Review the spend (Research costs), then enqueue
with a higher `--budget-usd` if justified.

**Extraction produced unverifiable quotes.** They are flagged on the claim and never used. Open the document viewer
on the cited page; correct the claim with a real quote or reject it.

**A source changes its terms.** Update the YAML entry (status, quoted terms, `checked_on`), `planb catalog sync`.
If reuse is no longer permitted, ingestion is disabled by the sync and affected records gain a publication blocker
on their next version.

**An interviewee withdraws consent.** Admin: record `withdrawn_on` on the consent, then `select gt.erase_subject(id)`.

**A published record is found to be wrong.** Admin: Publication → withdraw with a reason. The record moves to
`needs_revalidation`; fix the evidence, submit and approve a new version, publish.

## Monitoring (not provisioned)

Minimum before production: error tracking on the web app and worker (Sentry or equivalent); alerts on
`ops.research_runs` failures and on runs older than one hour in `running`; a daily digest of the freshness queue and
unreviewed claims; database CPU/connections/storage alerts from Supabase; uptime check on the dashboard.
