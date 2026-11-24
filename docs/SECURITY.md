# PlanB security model

PlanB holds two things worth protecting: the research database (the company's IP) and personal data (interviewees'
identities and, later, customers' financial profiles). This document states what protects each, what is tested, and
what is not yet in place.

## Roles

| Role | Who | Can |
|---|---|---|
| `anon` | Anyone | Read `pub.catalog` (teaser of live publications) and active pricing plans. Nothing else |
| `authenticated`, no staff role | Customers | Their own `customer.*` rows; `pub.catalog` |
| staff: `researcher` | Research analysts | Create and edit research records, add observations, upload documents, submit versions, enqueue runs |
| staff: `reviewer` | Senior analysts | Everything a researcher reads; verify evidence; accept/reject/correct claims; approve or reject versions; read the audit log |
| staff: `admin` | Founders | All of the above; publish and withdraw; edit publication policy; manage staff; record source permissions; erase interview subjects |
| `planb_worker` | The Python research worker | Read/insert/update research and run tables. **Cannot** verify evidence, accept or reject claims, decide versions, publish, or read customer data, interview data or the audit log |
| `service_role` | Supabase platform | Not used by any application code path |

Staff roles are rows in `ops.staff_roles`, checked by `ops.has_role()` inside RLS policies and guard triggers. The
dashboard never trusts a role sent by the browser.

## Controls

**Row-level security on every table** in `intel`, `gt`, `pub`, `customer`, `ops` (a test fails if any table lacks it).
The dashboard runs every query as the signed-in user inside a transaction that sets the role and JWT claims, so RLS is
the enforcement layer for the UI too; the application has no "query as owner" helper.

**Research data never reaches customer clients.** It lives in schemas the Supabase Data API does not expose, behind
staff-only policies. Customers will read only `pub.publication_versions` content, through server code that checks
entitlement (Phase 9/10 — not built).

**Service credentials stay server-side.** `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` are read
only in server modules (`import 'server-only'`) and the Python worker. No `NEXT_PUBLIC_` variable carries a secret.

**Evidence documents are private.** Files are content-addressed in a private bucket (local disk in development) and
served only through `/documents/[id]/file` after a staff check, as attachments with `no-store`.

**Uploads are validated.** Type is decided from the file's magic bytes (PDF only), size is capped at 40 MB, the file
name is discarded (storage path is the SHA-256), and the source must be in the registry and not `do_not_ingest`.

**Input validation.** Every server action validates with zod before touching the database; the database re-validates
with CHECK constraints. Queries are parameterised (postgres.js tagged templates; psycopg parameters). Redirect targets
are restricted to same-origin paths.

**External documents are untrusted data.** Extraction treats document text as data, never instructions:
- the LLM extractor has no tools and no database access; document text is fenced and cannot close its own fence;
- its output is schema-validated, claims citing pages it was not given are dropped;
- every claim's quote must be found on the cited page by deterministic code, and its number must be inside the quote;
- nothing extracted is used as verified, and a human reviews every claim beside the page.
A prompt-injected document can at worst produce claims that quote real text from that document and then sit in a
human review queue. Stored page text is rendered only as text in the dashboard.

**Worker isolation.** The worker connects with a role that has no grants on customer data, interview data, staff
tables or the audit log, and guard triggers refuse it the human-only actions regardless of grants.

**Audit trail.** `ops.audit_log` records every insert, update and delete on research, Ground Truth, publication,
customer and staff tables: who (user id and database role), when, which fields changed, old and new values, and the
research run. It is append-only (trigger) and readable by reviewers and admins. For tables holding personal data the
log records *that* a change happened and which fields, not the values.

**Personal data.**
- Interviewees: identity in `gt.interview_subjects` only (admin + assigned interviewer); consent recorded per
  permission; `gt.erase_subject()` blanks identity and withdraws interviews whose consent does not allow retention;
  aggregates suppressed below five interviews.
- Customers: owner-only RLS; `customer.erase_user_data()`; uploads capped and typed; no LinkedIn scraping — only
  user-provided exports.
- India's Digital Personal Data Protection Act applies. A privacy notice, consent wording review, retention schedule
  and breach process must be completed with counsel before any customer or interviewee data is collected in production.

**Function privileges.** `EXECUTE` is revoked from `PUBLIC` on all functions in PlanB schemas and granted per role.
The few `SECURITY DEFINER` functions pin `search_path`.

**HTTP headers.** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
`X-Robots-Tag: noindex` on the internal dashboard.

## Tested

`research/tests/test_security.py` and `test_acceptance.py` exercise against a real PostgreSQL database: RLS enabled
everywhere; customers and anonymous users see no research data; customer rows are owner-only; researchers cannot
verify; workers cannot verify, accept, decide or publish; nobody can delete evidence; the audit log is append-only and
free of personal data; interview identity visibility; consent and grading rules; k-anonymity; erasure; the publication
gate from every path; four-eyes; the ingestion legal gate; robots.txt; upload type checks; the LLM extractor's fence,
schema, page and budget guards.

## Not yet in place

- **Supabase Auth has not been exercised against a live project.** The code path exists (`web/lib/auth.ts`); the
  development identity switcher is refused in production builds. Verify sign-in, session refresh and MFA for staff
  before deploying.
- No rate limiting or bot protection on the dashboard (it should sit behind SSO/IP allow-listing at first).
- No Content-Security-Policy header yet.
- No error monitoring, alerting or log shipping.
- No secret rotation procedure; no dependency or secret scanning in CI beyond what GitHub provides by default.
- Backups and restore are documented in [`RUNBOOK.md`](RUNBOOK.md) but untested — there is no production database.
- No penetration test or independent review has been done.
