# PlanB implementation roadmap

Ten phases, in the order they must happen. Each phase ships a working vertical slice; nothing later is started on a
foundation that is not real. Status as of 2026-11-24 — details in [`STATUS.md`](STATUS.md).

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture, ontology, database schema, evidence framework | **Done** — 19 migrations, 77 tables, RLS, audit, evidence grades, publication gate, generated dictionary + ERD |
| 2 | Internal dashboard and source registry | **Core done** — business record, catalogue, overview; 71-source registry with reuse terms. Remaining screens in progress |
| 3 | Document ingestion and structured research pipeline | **Done for the first slice** — durable 8-stage pipeline; rule-based extractor; LLM extractor written, untested live |
| 4 | Financial modelling engine | **Done** — 7 archetypes, scenarios, stress tests, sensitivity, closure; 865 tests |
| 5 | Supplier, geographic and regulatory intelligence | **Schema + data-entry workspaces**; no data — needs human research |
| 6 | Real business research pilot | **Started** — 27 documents verified, 3 processed end to end; blocked on permissions and primary research |
| 7 | Owner interviews and actual-performance intelligence | **Schema, privacy model, questionnaires, workspace**; no interviews yet |
| 8 | Professional profile analysis and recommendation engine | Schema only |
| 9 | Customer-facing discovery platform | Not started |
| 10 | Monetisation, testing, optimisation, production readiness | Pricing table only; no production environment |

## Next 30 days — make the pilot real

The software can now do more than the evidence allows. The constraint is primary research and legal clearance.

1. **Legal clearance** (founder): permission requests to NIFTEM and NIFTEM-T; read and record terms for the four
   unverified pilot publishers; re-check DC-MSME, KVIC, NABARD and data.gov.in from an India-based network.
   Engage counsel on the DPDP Act before any interview is recorded.
2. **Provision production**: Supabase project (Mumbai), private evidence bucket, staff accounts with MFA, Vercel
   deployment behind access protection, worker container, daily freshness run, backups with PITR, error monitoring.
   Verify Supabase Auth and Storage paths, which are written but untested live.
3. **First primary evidence** for the three processed records: 18 machinery lines × three quotations; twelve owner
   interviews; Pune and Nanded rents, wages, tariffs; regulatory verification.
4. **Review** the 169 extracted claims; resolve; submit; approve. First record through the full gate.
5. **LLM extraction live**: API key, run on five non-NIFTEM documents with a budget, measure quote-verification and
   human-acceptance rates per document, tune the prompt, then process the remaining 19.

Exit criterion: one pilot record published internally with grade A/B evidence for its capital costs, at least three
reviewed owner interviews, verified regulation for Pune and Nanded, and no assumption among its revenue drivers.

## 30–90 days — complete the pilot and build the consumer of the data

6. Remaining seven pilot models to the same standard. Coffee kiosk and retail bakery built from primary research.
7. ~~Location overlays in the pipeline~~ — **done** (per-city base scenarios through the fallback hierarchy). Remaining:
   city-level stress tests, and local selling-price evidence feeding revenue drivers.
8. Second and third rule-based extractors (NIFTEM-T, NSTFDC templates) where volume justifies them.
9. Embeddings for semantic evidence retrieval (choose provider; backfill `document_chunks`).
10. OCR path for scanned documents.
11. **Phase 8**: profile intake (CV and user-provided LinkedIn export parsing into `customer.user_capabilities`,
    confirmed by the user), deterministic feasibility filters, explainable matching over published records only,
    with suitability and research confidence reported separately.

## 90–180 days — customer product

12. **Phase 9**: discovery, capital-based exploration, comparison, business intelligence pages, calculators (the same
    engine), city feasibility, salary-replacement and reality-check tools, execution roadmap. Server-side entitlement
    checks on publication content.
13. **Phase 10**: validate the pricing hypotheses (free / ₹499 / ₹1,499 / ₹4,999) with a manual concierge offer before
    integrating a payment provider; privacy notice and consent flows reviewed by counsel; security review; load test.
14. Scale research to the next 30 models, prioritised by what early users search for.

## Standing work

- Freshness: every observation revalidated on schedule; quotations renewed before expiry.
- Outcome loop: with consent, follow customers who start a business and record their actuals — the dataset no
  competitor can copy.

## Risks to the plan

| Risk | Consequence | Mitigation |
|---|---|---|
| Publishers refuse or ignore permission requests | Records cannot rest on government reports | Treat reports as internal scaffolding only; publish on quotations, tariffs, interviews — evidence PlanB owns |
| Owner interviews are slow or owners will not share income | Revenue evidence stays weak | Budget interviewer time and incentives; partner with associations; accept ranges; keep revenue grade visible |
| Government reports are systematically optimistic | Misleading base cases | Never publish a base case resting on report utilisation alone; conservative and stress cases always shown |
| LLM extraction error rate on messy documents | Reviewer load | Quote verification removes fabrications; rule extractors for common templates; measure acceptance rate per source |
| Single-founder bus factor on research standards | Quality drift | The standard is enforced in the database and written in `RESEARCH_METHODOLOGY.md` |
