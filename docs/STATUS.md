# PlanB status

**As of 2026-11-24.** What is implemented and verified, what is implemented but unverified, what holds no data, and
what blocks progress. Nothing in this repository is production-ready: there is no production environment.

Legend: ✅ implemented and exercised by tests or a real run · 🟡 implemented, not verified against the real
dependency · ⬜ schema or workspace exists, no data · ❌ not built

## 1. First-milestone acceptance criteria

Evidence for each criterion. "Tests" are in `research/tests/` and run against a real PostgreSQL database; the "real
run" is three NIFTEM project reports processed end to end as the restricted `planb_worker` role.

| Criterion | Status | Evidence |
|---|---|---|
| Real permitted source documents can be ingested | ✅ with a caveat | Real run: 3 documents hashed, stored, text-extracted. `TestIngestion`: dedupe, type sniffing, robots.txt, retries, the legal gate. **Caveat:** the documents were obtained by direct download and registered through the manual path; their publisher (NIFTEM) reserves all rights, so they are usable for internal research but nothing derived from them is publishable — see §5 |
| Extracted claims are linked to supporting evidence | ✅ | 169 claims in the real run, every quote found on its cited page; every observation links to its claim, document and page. `TestEvidenceLinks`; an unverifiable claim is never materialised and cannot be accepted |
| Business records are stored in a structured relational database | ✅ | 77 tables; real run produced 55 cost items, 109 observations, 3 revenue streams and 130 resolved model inputs (15 of them explicit assumptions) across 3 records |
| Conflicting cost observations can coexist | ✅ | `TestConflicts`: both rows kept, conflict opened, median used with rationale, history retained; values immutable. Dashboard end-to-end test adds a conflicting observation through the UI |
| Financial calculations are reproducible | ✅ | `TestReproducibility`: stored input re-run through the engine reproduces hash and outputs; hand-checked inputs. 865 engine tests |
| Missing data is visible | ✅ | `TestGaps`: a missing required input blocks the scenario, shows as unresolved, fails the completeness check and raises a task. Nothing is defaulted silently |
| Research tasks can be generated | ✅ | Real run raised 72 tasks; generation is idempotent and closes tasks whose gap has gone |
| Analysts can review and correct extracted information | ✅ | `TestReview` (database) and the dashboard end-to-end test (reject, correct, assumption, conflict resolution through the UI) |
| Unapproved business models cannot be published | ✅ | `TestPublication`: refused via the function and via direct insert by the table owner; four-eyes; role rules; explicit blockers |
| Approved records maintain version history | ✅ | `TestPublication`: three versions, two publications, supersession, immutability, diff in the dashboard |
| Research jobs can resume after failure | ✅ | `TestDurability`: failed stage retried with backoff, completed stages not re-run, dead worker's lease reclaimed, bounded attempts, budget stop. Also observed for real during development |
| Demonstration data cannot be mistaken for verified research | ✅ | `TestDemoData`: demo rows forced to grade D and unverified; estimates always D; demo/test records unpublishable; loud badges in the UI |
| The entire workflow functions end to end | ✅ | `TestEndToEnd`; the real run; the browser-driven workflow test (`web/e2e/run.sh`, 48 checks: production build, real browser, real worker, isolated database) |

## 2. Component status

### Database — ✅
18 migrations; RLS on every table; audit trail; evidence-grade, review, versioning and publication rules in
triggers and constraints; generated data dictionary and ERD. Applied and tested on PostgreSQL 16 with a local shim
for Supabase's roles and `auth` schema. 🟡 **Never applied to an actual Supabase project.**

### Research pipeline — ✅ / 🟡
| Part | Status |
|---|---|
| Durable job runner (leases, resume, backoff, budgets, logs) | ✅ |
| Source adapter framework (legal gate, robots.txt, rate limit, retries, hashing, dedupe, ingestion log) | ✅ tested with mocked HTTP |
| Per-source adapters (NIFTEM, NSTFDC, UP MSME) | 🟡 written; **none is enabled** — no pilot source permits automated collection |
| Manual document upload path (CLI and dashboard) | ✅ |
| PDF text and table extraction | ✅ (text PDFs). ❌ OCR for scans |
| Rule-based extractor — NIFTEM (Kundli) PMFME DPR template | ✅ run on 4 real documents, 55–60 claims each, all quotes verified |
| LLM extractor (Claude, structured outputs) | 🟡 implemented and unit-tested with a fake client; **never run against the live API** (no key was available). Needed for 24 of the 27 pilot documents |
| Quote verification, normalisation, structuring, cross-verification, parameter resolution, gap analysis, submission | ✅ |
| Freshness scan | ✅ implemented; lightly tested |
| Supabase Storage backend | 🟡 written, unverified. Local-disk backend ✅ |
| Embeddings / semantic retrieval | ❌ column and index exist; no provider. Full-text search ✅ |
| Automated opportunity and evidence discovery (stages 1–2) | ❌ human-driven via the catalogue YAML |
| Location overlays in parameter resolution | ❌ schema and resolver exist; pipeline resolves national values only |

### Finance engine — ✅
Seven archetypes; capex, pre-operative costs, deposits, contingency, working capital, staff, owner compensation,
loan with moratorium, subsidy, flat tax, seasonality, ramp-up, equipment replacement, scenarios, stress tests,
sensitivity, closure. 865 tests. Limits: flat tax only; no GST cash-flow timing; one loan.

### Dashboard (PlanB Intelligence) — see §3

### Research content
| Asset | Status |
|---|---|
| Source registry — 71 sources with terms, robots.txt, reuse status | ✅ researched 2026-11-24; 34 verified by reading the policy page, 14 partially verified, 23 unverified (hosts unreachable from the research environment, or terms not yet read) |
| Research backlog — 137 operating models, 21 industries | ✅ no financial figures; NIC-2008 codes checked against the MoSPI publication by a research agent, sample-audited only |
| Pilot documents — 27 located and verified | ✅ 9 of 10 pilot models have at least one; commercial laundry has none |
| Pilot records processed | 3 of 10 (one filed under a different, correct operating model) — all "in review", none publishable |
| Supplier quotations | ⬜ none |
| Owner interviews | ⬜ none |
| Pune / Nanded local data | ⬜ none |
| Verified regulations | ⬜ none (leads only, in the backlog) |

### Not built
❌ Customer profile intake and capability extraction · ❌ matching engine · ❌ customer-facing product ·
❌ payments · ❌ production infrastructure, monitoring, backups · ❌ scheduled maintenance.
The `customer` schema and pricing table exist so these can be built without schema surgery.

## 3. Dashboard screens

All screens read live data through row-level security as the signed-in staff user. Screens for primary research
show honest empty states — no demonstration rows are seeded.

| Screen | Status |
|---|---|
| Research overview | ✅ |
| Business model catalogue | ✅ |
| Business record: identity editor, completeness vs evidence quality, variants, documents, upload | ✅ |
| — Costs & observations (every observation with its passport; add observation; conflicts) | ✅ |
| — Revenue & parameters (model inputs with basis and grade; explicit assumptions) | ✅ |
| — Financial model (scenarios, stress tests, source reconciliation, in-browser scenario calculator) | ✅ |
| — Evidence & review (accept / reject / correct claims) | ✅ |
| — Gaps & tasks | ✅ |
| — Versions (submit, four-eyes decision, diff, publication blockers) | ✅ |
| Review & approval inbox | ✅ |
| Publication management and policy | ✅ |
| Evidence explorer and document viewer (controlled download) | ✅ |
| Research tasks | ✅ |
| Research job queue and run detail | ✅ |
| Source registry (permissions, ingestion gate) | ✅ |
| Data quality dashboard | ✅ |
| Research cost monitoring | ✅ (no LLM spend recorded yet) |
| Audit history | ✅ |
| Suppliers & quotation collection | ✅ workspace · ⬜ data |
| Ground Truth interview workspace | ✅ workspace · ⬜ data |
| Geographic data management and fallback resolver | ✅ workspace · ⬜ data |
| Regulatory database | ✅ workspace · ⬜ data |

Authentication: ✅ development identity switcher (refused in production builds). 🟡 Supabase Auth path written,
never exercised against a live project.

### Test suites
| Suite | Count | Where it runs |
|---|---|---|
| Python unit + PostgreSQL integration (`research/tests`) | 111 | Locally and in CI (`.github/workflows/ci.yml`) |
| Finance engine (`packages/finance/test`) | 865 | Locally and in CI |
| Dashboard end-to-end (`web/e2e/run.sh`) | 48 checks | Locally only — not yet wired into CI |
| Dashboard typecheck and production build | — | Locally and in CI |

The CI workflow itself has not run yet (no pull request has been opened); treat it as unverified until its first run.

## 4. What the real run found

Three NIFTEM PMFME detailed project reports (red chilli powder, bread, honey processing), rule-based extraction, zero
LLM cost:

- 55, 55 and 59 claims; every quote located on its cited page.
- Machinery line items sum exactly to each document's stated plant-and-machinery total.
- The engine, pinned to each source's year-1 assumptions, reproduces the source's stated sales within 1.0–3.5 % (the
  gap is the source's closing-stock hold-back). Year-1 net profit comes out ₹1.0–1.8 lakh above the source's, for
  stated reasons: the engine sells all production, charges no working-capital interest and depreciates straight-line.
- **The reconciliation caught a modelling error during development.** Variable-cost ratios were first derived against
  the source's net sales; applied to full production revenue this overstated raw-material cost by the stock
  build-up and showed the honey unit — a thin-margin business — making a loss where the source states a profit. The
  ratios are now derived against production value, with a regression test. This is the purpose of reconciling every
  model against its source.
- The reports contain template leftovers (one states a term loan and project cost belonging to a different product;
  wage rows are labelled "in thousand rupees" beside full-rupee figures). These are why every claim needs review.
- Every record: 54 % complete, two critical sections missing, all evidence grade C, unverified and stale (documents
  date from 2021–22), five model inputs are PlanB default assumptions, and the source's assumed subsidy is excluded.

A government report yields a costed skeleton and a list of 21–26 things to find out. It does not yield a finding.

### Defects found by testing against real behaviour

Recorded because each one would have produced a wrong number or a silent failure, and because they show which
checks are doing real work:

| Found by | Defect | Fix |
|---|---|---|
| Source reconciliation on the honey report | Variable-cost ratios derived against net sales overstated raw-material cost; a profitable unit showed a loss | Ratios derived against production value; regression test |
| Browser end-to-end test | After a reviewer rejected a claim, the model **kept using the rejected figure** (a cost item with no remaining usable observation was skipped, not retired) | Model inputs whose evidence is gone are retired on every refresh; regression test |
| Browser end-to-end test | Refresh failed when extracted machinery lines stopped adding up to the stated total — the very case the check exists for | Run logs moved to a dedicated connection; regression test |
| Unit test on the extractor | "Excluding GST" note was read before the machinery rows on the same page, leaving tax treatment "unknown" | Ordering fixed |
| Integration test | Completeness was NULL instead of 0 % for an empty record | Fixed in the view |
| Dashboard build-out | An update blocked by row-level security was reported as success | Zero-row updates are now refusals |
| Dashboard build-out | The legal gate on sources, and reviewer-only verification of quotations, regulations and interviews, were enforced only in the UI | Database triggers (migrations 0017, 0018) with tests |

## 5. Blockers — things only a person can resolve

1. **Reuse rights (critical path).** NIFTEM and NIFTEM-T reserve all rights and publish no reuse policy. Four other
   pilot publishers' terms have not been read. Until written permission is recorded, or records are rebuilt on
   evidence PlanB owns (quotations, interviews) and public tariffs, **no pilot record can be published**. The system
   enforces this. Action: request permission; record terms.
2. **Unreachable foundational sources.** DC-MSME, KVIC (PMEGP), NABARD, MoFPI and data.gov.in could not be reached
   from the research environment (TLS or proxy failures; `kvic.gov.in` disallows all crawling). Their registry entries
   are unverified. Action: check from an India-based network.
3. **Primary research.** Quotations, owner interviews, local rents and wages, regulatory verification. The exact
   tasks are in the dashboard; templates are in `research/templates/`; the plan is in [`PILOT.md`](PILOT.md).
4. **Human review.** 169 extracted claims await a reviewer.
5. **Anthropic API key** for LLM extraction of the 24 pilot documents outside the NIFTEM-Kundli template, with a
   budget and a measured acceptance rate before use at volume.
6. **Supabase project and Vercel deployment.** Then verify the three unverified integration paths: Supabase Auth,
   Supabase Storage, and the migrations on a real project.
7. **Legal.** DPDP Act review of interview consent and (later) customer data handling before collecting personal data.

## 6. Known weaknesses

- The LLM extractor is the least-proven component. Its safety rests on quote verification and human review, both of
  which are tested; its accuracy on messy documents is unmeasured.
- The data dictionary is generated and complete for tables, keys and constraints, but many columns carry no prose
  description yet.
- NIC-2008 codes were verified by an automated research agent, not a person; treat as sample-audited.
- Completeness weights and publication thresholds are first judgements; revisit after the first records are completed.
- The 15 % conflict tolerance and 3-year corroboration window are single global values; they should become per-category.
- The dashboard's data-entry workspaces (suppliers, Ground Truth, geography, regulatory) were exercised end to end
  in a browser with artificial entries that were then deleted; they have never held real research data.
- Grade A for a supplier quotation needs an attached document; the quotation form does not capture one yet.
- There is no action to verify a government scheme, and scheme status is not yet connected to the modelled subsidy.
- No load, security or accessibility testing has been done.
