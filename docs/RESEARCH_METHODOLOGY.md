# PlanB research methodology

How a fact gets into the PlanB database, how much it is trusted, and when it may be shown to a customer.
This is the standard analysts, the pipeline and reviewers are held to. Where the software enforces a rule, the
mechanism is named.

## 1. What we research

The unit of research is a **business operating model**: one distinct way of making money ("takeaway coffee kiosk"),
never a category ("coffee"). Models with different customers, production methods, capital structures or owner
lifestyles are separate records, linked as *distinct siblings* so they are never merged. Each model has one or more
**variants** — costed configurations (scale × geography × ownership). The backlog (`research/catalog/business_backlog.yaml`)
holds 137 models across 21 industries, with NIC-2008 codes; ten are pilots.

A record is complete when it covers: identity, capital requirements, infrastructure, equipment and materials,
operating economics, revenue mechanics, financial performance, founder requirements, lifestyle, market intelligence,
regulation, execution, risks — and the evidence for each. `intel.v_completeness_items` defines the 25 checks.

## 2. Sources and what we may do with them

Every source is registered before it is used (`research/catalog/sources*.yaml` → `intel.sources`): what it offers,
how it is accessed, its robots.txt, its licence with the operative terms quoted, and a **reuse status**:

| Reuse status | Meaning | Automated collection | Publication of derived data |
|---|---|---|---|
| permitted / permitted_with_attribution | Terms read and allow commercial reuse | May be enabled by an admin | Allowed |
| permission_required | Terms reserve rights or require prior approval | Only after written permission is recorded | Blocked until permission is recorded |
| unclear | Terms not found or not yet read | No | Blocked |
| prohibited | Terms forbid collection or reuse | No — `do_not_ingest` | Blocked |

Rules:
- "Publicly visible" is not a licence. A source is `unclear` until someone has read its terms and recorded the date.
- We never bypass logins, captchas, rate limits or robots.txt, and never scrape marketplaces or listing sites whose
  terms prohibit it. Prices from such sites enter only as consented quotations a researcher obtained directly.
- Adapters are per source and refuse URLs outside that source's hosts and paths. An adapter cannot fetch unless the
  registry enables ingestion, and the database refuses to enable it without reuse rights
  (`sources_ingestion_requires_reuse_right`).
- A document a person obtained legitimately may be registered by manual upload for internal research even when
  automated collection is not permitted; data derived from it still cannot be published until the source's reuse
  status allows (`restricted_source_rows` blocker).

**Current position (2026-11-24):** of 71 registered sources, 11 are cleared for commercial reuse. Almost no
foundational project-report publisher is: NIFTEM states "All rights reserved" with no reuse policy; DC-MSME, KVIC and
NABARD could not be reached from the research environment and are unverified. Obtaining written permissions is on the
critical path — see [`STATUS.md`](STATUS.md).

## 3. Evidence types and what each can prove

| Evidence type | Typical use | Best grade attainable |
|---|---|---|
| Supplier quotation (written, consented) | Machinery and material prices | A when verified and current |
| Owner-documented actual (bill, statement, loan letter seen) | Investment, revenue, income | A when verified |
| Government tariff or notification; regulatory fee schedule | Wages, tariffs, licence fees | A when verified |
| Government project report | Cost structure, capacity, assumptions | C alone; B when corroborated |
| Manufacturer catalogue; market report; listing observation | Prices, market context | C alone; B when corroborated |
| Owner-reported (no document) | Income, hours, break-even time | C |
| Analyst estimate; LLM estimate | Placeholder pending evidence | D, always |

Government project reports are where a record starts, not where it ends. They are template-driven, often years old,
optimistic about utilisation and silent about failure. They give us the cost *structure* and a benchmark; quotations
and owner interviews give us the truth.

## 4. Evidence grades

Grades attach to each observation and each model input — never to a whole business.

- **A** — current, documented primary evidence or authoritative regulatory information, verified by a reviewer.
- **B** — at least two independent, reasonably current (≤ 3 years) sources agreeing within 15 %.
- **C** — a single source, an older benchmark, or unverified owner-reported information.
- **D** — an unverified estimate or assumption.

How grades are set: the pipeline assigns C to freshly extracted document figures; cross-verification upgrades to B
when the corroboration rule is met; A requires a reviewer to verify a primary evidence type with a document attached.
The database rejects anything else (`intel.guard_observation`). A model input inherits the weakest grade among the
observations it is resolved from; an assumption is always D.

Verifying a figure from a project report confirms it was transcribed correctly. It does not make the figure primary
evidence, and its grade stays C.

## 5. From document to record

1. **Ingest.** The original file is hashed (SHA-256), stored privately and never modified. Text is extracted per page.
2. **Extract claims.** Each claim carries the page number and a **verbatim quote**. Numbers are recorded exactly as
   printed with their printed unit ("2.80", "Rs. in lacs").
3. **Verify the quote.** Deterministic code checks that the quote occurs on the cited page and that the number occurs
   in the quote. A claim that fails is kept, flagged, never used, and cannot be accepted.
4. **Normalise.** Lakh/crore to rupees, units to the controlled vocabulary, periods to per-month/per-year. Anything
   ambiguous is left for an analyst, with a note. The printed value is always retained beside the normalised one.
5. **Structure.** Verified claims become cost items, revenue streams, requirements and observations, each linked back
   to its claim.
6. **Cross-verify.** Comparable observations are compared; disagreement above 15 % opens a conflict; line items are
   checked against the document's own stated totals.
7. **Model.** Inputs are resolved, the engine runs, and the result is reconciled against the figures the source states.
8. **Find gaps.** Everything missing, stale, conflicting or unreviewed becomes a task.
9. **Human review.** An analyst reads each claim beside its page and accepts, corrects or rejects it. A correction is
   a new claim; the original stays on record as superseded.

What is automated: steps 1–8, and nothing that requires judgement about truth. What always needs a person: accepting
claims, verifying observations, resolving conflicts, recording assumptions, approving versions, publishing.

## 6. Conflicting evidence

Contradictory observations are kept side by side. The analyst checks whether they are actually comparable (capacity,
date, GST basis, installation, location), then verifies or rejects individual observations, or accepts the range.
Until resolved, the model uses the median and says so in the parameter's rationale. Nothing is deleted.

## 7. Financial modelling rules

- Every financial figure is computed by the deterministic engine (`packages/finance`). No LLM computes or adjusts a number.
- A model input is resolved from observations, derived by a recorded formula, or an explicit assumption. Required
  inputs with none of these block the scenario.
- PlanB default assumptions (ramp-up, set-up period, working-capital days, contingency, owner draw) are stored as
  assumptions with their rationale, counted on every scenario, and each raises a task to replace it with evidence.
- A subsidy assumed by a source document is **not** modelled until the scheme's status and eligibility are verified.
- Scenarios (conservative/base/optimistic) and stress tests apply generic, labelled shocks. They are not forecasts.
- Revenue, operating profit, net profit, cash flow and owner income are reported separately and never substituted
  for one another. We state no probability of success and promise no profitability.
- Each base scenario is reconciled against the source's own stated sales: a large gap indicates an extraction error.

## 8. Geography

National records carry location overlays. City and district data are separate. When local evidence is missing the
resolver falls back to district, state, then national, and every consumer must show which level a figure came from.
Population and competitor counts are indicators; they are never converted into a demand estimate.

## 9. Ground Truth (owner interviews)

Primary research with existing **and former** owners is the evidence that matters most and the hardest to copy.
- No interview without recorded consent, with four separate permissions (aggregate use, anonymised quotes, document
  retention, recontact). Consent can be withdrawn; identities are then erased.
- Identities are stored apart from interview content and are visible only to the interviewer and administrators.
- Figures are *documented* (a document was seen and referenced) or *self-reported*; self-reported can never exceed C.
- Closed and sold businesses are actively sought to counter survivorship bias.
- Only aggregates of five or more interviews leave the research database.
Guides: `research/templates/owner_interview.md`; questionnaires are in `gt.questionnaires`.

## 10. Freshness

Every observation carries a revalidation date (default: one year from its observation date; quotations expire on
their validity date; regulations six months after verification). The freshness scan flags overdue items, raises
revalidation tasks and marks published records `needs_revalidation`. Stale observations block publication.

## 11. Publication standard

A version may be published only if: a reviewer other than the submitter approved it; completeness ≥ 75 % with no
critical section missing; no open conflicts; no unreviewed claims; no stale observations; ≥ 70 % of model inputs at
grade C or better; no demo or test data; no observation from a source without reuse rights. The thresholds live in
`ops.publication_policy`; the checks in `pub.publication_blockers()`. Publications are immutable and versioned.

## 12. What we will not do

Fabricate or "typical-value" a missing figure; present an AI estimate as a fact; upgrade a grade because a number
looks plausible; publish from a source we have no right to reuse; state a suitability score or success probability;
quote a licence fee or legal threshold from memory.
