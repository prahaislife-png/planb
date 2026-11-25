# PlanB matching engine — specification (`@planb/matching` 0.1.0)

Compares **one person's profile** with **business records** and says, per business: whether it is feasible for
them, how it fits along seven named dimensions, what the trade-offs and missing prerequisites are — and,
separately, how far the research behind the record can be trusted.

People will make livelihood decisions from this. The rules below are therefore few, explicit and conservative.

## 1. Rules the engine is built around

1. **No number grades a business for a person.** There is no suitability score, percentage, star rating or
   probability of success in any type, any result or any sort key. Outcomes are categories with reasons.
   `test/guard.test.ts` fails if a property named like one appears (`/score|percent|pct|probab|rating|likelihood|stars/i`);
   the single allowed exception is `researchConfidence.completenessPct`, which describes the research record.
2. **Suitability and research confidence are separate and never combined.** Research confidence is computed from
   the record alone (the profile is not an input), does not affect any check, level or the ordering, and is
   returned in its own block.
3. **Unknown stays unknown.** When the record lacks what a rule needs, or the person has not given the answer, the
   outcome is `unknown` with a sentence saying what is missing — never a guess, a default pass or a fail.
   `unknownCause` says which side the gap is on (`not_researched` | `not_stated_by_person`; a record-side gap wins).
4. **Pure.** No LLM, no randomness, no clock, no I/O. Same input → same output, byte for byte. Text is built
   without `Intl`, so it does not vary by runtime.
5. **Every outcome carries a plain-English reason citing the figures used.**
6. **Wording.** Financial figures are "model outputs on the recorded inputs", not forecasts. The engine never says
   a business is guaranteed, safe, recommended or profitable.

## 2. Inputs

### 2.1 Person profile (`PersonProfileSchema`, zod, strict)

Mirrors `customer.user_profiles`, `user_capabilities`, `user_assets`. **Every scalar is required but nullable**:
`null` means "not said" and is never replaced by a default. Unknown keys are rejected.

| Field | Type | Meaning |
|---|---|---|
| `investableCapitalInr` | number ≥ 0 \| null | Money the person could put in, including the reserve |
| `reserveRequirementInr` | number ≥ 0 \| null | Part of it that must stay untouched (0 is an answer; null is not) |
| `monthlyIncomeGoalInr`, `currentMonthlyIncomeInr` | number ≥ 0 \| null | |
| `riskTolerance` | `low` \| `moderate` \| `high` \| null | |
| `desiredInvolvement` | `full_time_hands_on` \| `full_time_managerial` \| `part_time` \| `semi_absentee` \| `absentee` \| null | |
| `maxHoursPerWeek` | 0–120 \| null | |
| `weekendWorkOk` | boolean \| null | |
| `physicalWorkTolerance` | integer 1–5 \| null | |
| `transitionTimelineMonths` | integer 0–120 \| null | **Defined here as:** months the person has given themselves for the move from salary to the business, counted from the first rupee spent |
| `preferredLocationSlug` | slug \| null | `intel.locations.slug` |
| `preferredLocationName` | string \| null (optional) | `intel.locations.name`; needed because the snapshot labels location scenarios by name only |
| `interests` | string[] | free text |
| `capabilities` | `{ skillSlug, proficiency 1–5 }[]` | no slug twice |
| `assets` | `{ assetTypeSlug }[]` | |
| `qualificationsHeld` | string[] | free text |
| `willingToTakeLoan` | boolean \| null | |

`parseProfile` throws `ProfileValidationError` (`issues: {path, message}[]`); `validateProfile` returns them.
`matchBusiness` / `matchBusinesses` validate the profile and refuse an invalid one.

### 2.2 Business record (`BusinessSnapshot`)

A narrow, all-optional view of the JSON built by `intel.build_business_snapshot`: only the fields listed in
`src/snapshot.ts` are read. `narrowSnapshot(raw)` reduces a full snapshot to exactly those fields (use it before
sending records to a browser); matching the narrowed and the full snapshot gives identical results. A value of
the wrong type is treated as missing, never coerced.

**Which figures are used**

* **Variant:** the one with `is_reference = true`. If none is flagged, there is no costed case and every
  financial rule is `unknown`; the engine never falls back to another variant.
* **National base scenario:** `kind = 'base'` without `summary.locationCoverage` (`scenario_key = 'base'` preferred).
* **Local scenario:** a `kind = 'base'` scenario with `summary.locationCoverage` whose label ("Base case — <location
  name>") names the person's preferred location (compared with `preferredLocationName`, or with the slug's words,
  ignoring case and punctuation). When it exists, capital, runway and income are evaluated on **both** cases, both
  are told in the reason, and **the worse outcome decides**.
* **Closure scenarios:** `kind = 'failure'` with a `closure` block; the one with the largest `ownerCapitalLost` is used.
* **Stress scenario:** `kind = 'stress'`, `scenario_key = 'stress_revenue_minus_20'`.
* **Set-up period:** `summary.preOperatingMonths` if a snapshot carries it, otherwise the reference variant's
  resolved `pre_operating_months` parameter. If that parameter's basis is `assumption`, the reason says so.

## 3. Feasibility — mandatory checks

Always four checks, in this order, each `{ key, label, status: pass | fail | unknown, reason, unknownCause?, shortfall? }`.

**Overall `feasible`:** `no` if any check fails; otherwise `cannot_assess` if any is unknown; otherwise `yes`.

### 3.1 `capital_affordability`

*Deployable capital* = `max(0, investableCapitalInr − reserveRequirementInr)`.
*Required* = the scenario's `summary.totalOwnerCashRequired` (owner equity before opening + deepest cash trough).

| Situation | Status |
|---|---|
| No reference variant / no base scenario / the scenario has no `totalOwnerCashRequired` | `unknown` (not researched) |
| Capital or reserve not stated | `unknown` (not stated); the requirement is still told |
| Scenario includes a loan and even the with-loan requirement exceeds deployable capital (person will not borrow, or has not said) | `fail` — without the loan the owner must find more, never less, so the answer is already known; the shortfall is stated as "at least" |
| Scenario includes a loan (`funding.loan > 0`) the with-loan requirement is within reach, and the person **will not borrow** | `unknown` (not researched): the all-equity requirement cannot be assessed from this scenario; the loan amount and the with-loan figures are stated |
| Scenario includes a loan and the person has **not said** whether they would borrow | `unknown` (not stated) — a pass is never given on an assumed loan |
| Scenario does not state whether it has a loan, and the person has not said they would borrow | `unknown` (not researched) |
| Required ≤ deployable (no loan in the scenario, or the person would borrow) | `pass` |
| Required > deployable | `fail`, `shortfall = { kind: 'money', amountInr: required − deployable }` |

When the loan is part of a pass or fail, the reason names it and says that a lender's approval is not assessed.

### 3.2 `financial_runway`

*Months from first spend* = set-up months + `summary.breakEven.firstOperatingMonthNetCashPositive` — the first
month, counted from the first rupee spent, in which the business brings in more cash than it spends.

| Situation | Status |
|---|---|
| `firstOperatingMonthNetCashPositive` is `null` (never within the modelled period) | **`fail`** — not unknown — whatever the timeline, even when no timeline is given |
| The field is absent from the scenario | `unknown` (not researched) |
| Set-up period not recorded, and trading months alone exceed the timeline | `fail`, shortfall in months |
| Set-up period not recorded otherwise | `unknown` (not researched) |
| Transition timeline not stated | `unknown` (not stated); the month is still told |
| Months from first spend ≤ `transitionTimelineMonths` | `pass` |
| Months from first spend > `transitionTimelineMonths` | `fail`, `shortfall = { kind: 'time', months: difference }` |

A cash-positive month is not an income; the reason says so and points to income potential.

### 3.3 `required_qualifications`

Reads `founder_requirements.mandatory_qualifications` and `.certifications` (free text). Each field is one of:
*not recorded* (null/blank), *none required* (text such as "None", "Not required", "No formal qualification
required"), or a *list* (one requirement per line, or separated by `;` or `•`).

A requirement is **held** when one of `qualificationsHeld`, compared without case or punctuation, is the same
text or contains the whole requirement as a phrase. Holding less ("Diploma") never satisfies more ("Diploma in
pharmacy").

| Situation | Status |
|---|---|
| `founder_requirements` is null | `unknown` (not researched) |
| A listed requirement is not held (an empty `qualificationsHeld` holds nothing) | `fail`, `shortfall = { kind: 'items', items }` |
| Nothing listed is missing, but a field is *not recorded* | `unknown` — blank is never read as "nothing required" |
| Both fields are lists and/or "none required", and everything listed is held | `pass` |

### 3.4 `required_assets`

The snapshot does not carry asset requirements today, so this is **`unknown` — "asset requirements have not been
researched"** on every current record; any `operating_requirements` (space, power…) are quoted in the reason but
not judged. The engine reads an optional `variants[].assets` array shaped like `intel.business_assets`
(`asset_type_slug`, `requirement_level`) so the check works once the snapshot builder emits it:

| Situation | Status |
|---|---|
| `assets` absent or empty | `unknown` (not researched) |
| A row with `requirement_level = 'required'` whose slug is not in the person's `assets` | `fail`, `shortfall = { kind: 'items', items }` |
| Rows exist and every required one is listed (or none is required) | `pass` |

## 4. Fit — named dimensions

Always seven, in this order, each `{ key, label, level: strong | moderate | weak | unknown, reason, unknownCause? }`.

### 4.1 `transferable_capabilities`

A skill is **held** at proficiency ≥ `CAPABILITY_HELD_MIN_PROFICIENCY` (3). A **key** skill has importance ≥
`CAPABILITY_KEY_MIN_IMPORTANCE` (4).

* `unknown` — the record has no `skills` (not researched); or the person lists no capabilities (not stated — an
  empty list is not read as "has none").
* `weak` — a `needed_at_start` skill is not held, **or** none of the record's skills is held.
* `moderate` — every `needed_at_start` skill is held, but a key skill that is learnable/hireable is not.
* `strong` — every `needed_at_start` skill and every key skill is held.

Each `needed_at_start` skill not held becomes a missing prerequisite.

### 4.2 `personal_interests`

A plain word match, and the reason says so. An interest matches a text when every word of the interest (lower
case, ≥ 3 letters, stop words and a trailing "s" removed) occurs as a word in it.

* `unknown` — no interests listed (not stated); or the record has no name, industry or description.
* `strong` — an interest matches the business **name, family or industry**.
* `moderate` — an interest matches only the description, operating model, target customers or classification titles.
* `weak` — no listed interest matches anything.

### 4.3 `income_potential` (salary replacement)

Uses `ownerIncome.year1/2/3AvgMonthly` — what the model leaves for the owner each month after all costs and loan
repayments. Benchmarks are whichever of `monthlyIncomeGoalInr` and `currentMonthlyIncomeInr` were given.

* `unknown` — no base scenario or no year-3 figure (not researched); or neither benchmark given (not stated).
* `weak` — year 3 is negative, or below `INCOME_WEAK_BELOW_FRACTION` (0.5) × the lower benchmark.
* `strong` — year 3 ≥ every benchmark given.
* `moderate` — otherwise.

The reason states all three years, which years fall short of the goal, and — as salary replacement — how year 3
compares with current income and which years replace it. It says when the figures are before income tax.
With a local scenario, the weaker of the two readings decides.

### 4.4 `lifestyle_compatibility`

Four aspects, each *fits*, *stretch*, *conflict* or *not comparable*:

| Aspect | Fits | Stretch | Conflict |
|---|---|---|---|
| Hours (`owner_hours_per_week_low/high` vs `maxHoursPerWeek`) | high ≤ max | low ≤ max < high | low > max |
| Weekends (`weekend_work` vs `weekendWorkOk`) | `none`, or the person accepts weekends | `occasional` / `peak_days`, not accepted | `regular`, not accepted |
| Involvement (ordered absentee < semi-absentee < part-time < full-time managerial < full-time hands-on) | business asks no more than wanted | one step more | two or more steps more (`LIFESTYLE_CONFLICT_MIN_STEPS`) |
| Physical demand (1–5) vs `physicalWorkTolerance` | demand ≤ tolerance | one above | two or more above |

* `unknown` — no lifestyle profile (not researched); or no conflict and at least one aspect not comparable.
* `weak` — any conflict (definite even when other aspects are missing).
* `moderate` — all four compared, at least one stretch, no conflict.
* `strong` — all four compared, all fit.

### 4.5 `complexity_and_learning`

Three aspects: learning difficulty (`founder_requirements.learning_difficulty`, 1–5), operational complexity
(`lifestyle.operational_complexity`, 1–5) and training time (`training_duration_weeks`, converted at 52/12 weeks
per month, vs `transitionTimelineMonths`).

* 1–5 scales: ≤ `COMPLEXITY_LOW_MAX` (2) low → fits; 3 medium → stretch; ≥ `COMPLEXITY_HIGH_MIN` (4) high → conflict.
* Training: longer than the timeline → conflict; more than `TRAINING_STRETCH_ABOVE_FRACTION_OF_TIMELINE` (½) of
  it → stretch; otherwise (or 0 weeks) fits.

Levels are reached exactly as in 4.4 (any conflict → `weak`; all three compared → `moderate` / `strong`;
otherwise `unknown`). Recorded training time is also listed as a prerequisite.

### 4.6 `risk_exposure`

Three signals, each *low*, *elevated* or *high* concern:

1. **Worst modelled closure** — `ownerCapitalLost` vs deployable capital and the stated tolerance
   (`RISK_CLOSURE_LOSS_BANDS`):

   | Tolerance | Low concern up to | High concern above |
   |---|---|---|
   | low | 1/10 of deployable capital | 1/4 |
   | moderate | 1/4 | 1/2 |
   | high | 1/2 | all of it |

   In between is *elevated*.
2. **Deepest cash trough of the base case** — `totalOwnerCashRequired` > deployable capital → *high*; otherwise *low*.
3. **Revenue −20% stress case** — year-3 owner income negative → *high* for low/moderate tolerance, *elevated*
   for high tolerance; otherwise *low*.

* `weak` — any signal is *high*.
* `unknown` — no *high* signal and a signal cannot be graded: no closure scenario, no stress case or no base total
  (not researched); or no risk tolerance / capital / reserve (not stated). The figures are still told.
* `moderate` — all three graded, at least one *elevated*.
* `strong` — all three graded, all *low*.

The record's risk register is reported (count, those rated high) but never graded. The reason ends by saying
these are illustrative model cases, not a forecast and not the chance of anything happening.

### 4.7 `geographic_fit`

* `unknown` — no preferred location (not stated); or no local scenario for it (not researched). The national case
  is never presented as local.
* With a local scenario, by the fraction of its inputs taken from local evidence
  (`local_inputs / (local_inputs + inherited_national_inputs)`): ≥ `GEOGRAPHIC_STRONG_MIN_LOCAL_FRACTION` (½) →
  `strong`; ≥ `GEOGRAPHIC_MODERATE_MIN_LOCAL_FRACTION` (1/10) → `moderate`; below → `weak`. The reason gives the counts.

## 5. Trade-offs, prerequisites, reasons against

* `tradeOffs: string[]` — plain sentences of what the person would be accepting: reliance on a loan; a year in
  which cash does not cover loan repayments (`minDscr < 1`); when (or whether) the money put in is returned;
  years below the income goal; the closure loss; the stress-case income; lifestyle and complexity strains; skills
  to learn or hire; mandatory licences mapped to the record. If the person will not borrow but the scenario is
  loan-financed, a sentence says that every financial figure comes from the loan-financed case.
* `missingPrerequisites: { kind, description }[]` — `capital` (the shortfall), `time` (runway beyond the timeline),
  `qualification`, `asset`, `skill` (needed from the start and not held), `training` (recorded training time).
  Nothing is listed from a section that has not been researched.
* `whyNotSuitable?: string[]` — **present only** when `feasible` is `no` or a dimension is `weak`: the failing
  checks' and weak dimensions' reasons. Thin evidence is never a reason here; it is said in research confidence.
* `notResearched: string[]` — the sections the record lacks.
* `basis` — the variant and scenario(s) the financial comparisons were made on.

## 6. Research confidence

`{ level, reasons[], gradeProfile, assumptionsAmongInputs, inputsTotal, verifiedObservations, staleObservations,
openConflicts, claimsPendingReview, completenessPct, criticalMissing, criticalMissingSections }` — from
`quality.evidence`, `quality.completeness`, the base scenario's input profile and the cost observations' dates,
types and sources. Counts that are not recorded are `null`.

Thresholds are the exported constant `CONFIDENCE_THRESHOLDS`.

**`thinly_evidenced`** — ANY ONE of:

* the record carries no evidence profile, or no graded figure;
* no figure is grade A or B;
* completeness below 50;
* 3 or more critical sections missing;
* at least half of the observations are stale;
* at least one third of the model's inputs are assumptions.

**`well_evidenced`** — not thin, and ALL of (each must be recorded; an unrecorded fact never counts as met):

* at least half of the graded figures are grade A or B;
* at least half of the observations are verified;
* at most one tenth of the model's inputs are assumptions;
* no stale observation, no open conflict, no claim awaiting review;
* completeness ≥ 75 and no critical section missing.

**`partly_evidenced`** — everything else. The last reason always says which rule set the level.

The first reason describes the evidence in a sentence, e.g. *"All 35 figures behind this record are grade C and
come from a single source (…); its cost observations are dated 2021 and are of the type government project
report. None has been verified by a reviewer."*

## 7. Ordering (`compareMatchResults`)

`matchBusinesses(profile, snapshots)` returns one result per record, sorted by a lexicographic rule — not a number:

1. `feasible`: `yes`, then `cannot_assess`, then `no`;
2. fewer `weak` fit dimensions first;
3. more `strong` fit dimensions first;
4. business name A–Z (case-insensitive), then slug.

`moderate` and `unknown` dimensions and research confidence take no part. The counts used in steps 2–3 are not
stored on the result.

## 8. `explainChange(before, after)`

For two results of the **same business** (it throws otherwise): the checks whose status changed, the dimensions
whose level changed, the overall feasibility if it changed, the research-confidence level if it changed (only
possible when the record differs), and one sentence per change. A change of wording alone is not listed.

## 9. What the engine deliberately does not do

* It does not rate, score, rank by merit, or estimate the chance that a business succeeds or suits someone.
* It does not weigh dimensions against each other or net a strength against a weakness.
* It does not fill gaps: no default for an unstated answer, no inference from a missing section, no fallback to a
  non-reference variant, no national scenario presented as local.
* It does not compute an all-equity case when the scenario has a loan (that needs the finance engine and the
  model input, which are not in the snapshot) — it reports `unknown`.
* It does not assess whether a lender would lend, whether a qualification text match is the right certificate,
  whether an asset could be rented instead, or the person's tax position (figures are before income tax when the
  scenario says so).
* It does not read free-text founder notes (industry experience, management capabilities), regulations beyond
  listing the mandatory ones, market observations or launch tasks.
* It does not use research confidence to change suitability, nor suitability to change research confidence.
* It does not decide which records a customer may see. Customers must only ever be matched against published
  records; that gate belongs to the caller.

## 10. Known limits to confirm before customer use

* `transitionTimelineMonths` has no definition in the schema; §2.1 fixes one. If the product means something else
  (e.g. months until resignation), the runway rule must change.
* Location scenarios are recognised by their label because the snapshot has no location id or slug.
* A person who will not borrow gets `unknown` on capital even when the with-loan requirement already exceeds
  their capital, because the all-equity figure is unknown; the with-loan figures are shown in the reason.
* The cut-offs in `src/thresholds.ts` (risk bands, income fraction, geographic fractions, confidence thresholds)
  are engineering defaults, not researched values.
