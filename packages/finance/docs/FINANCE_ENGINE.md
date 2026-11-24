# PlanB finance engine — specification

`@planb/finance`, engine version `1.0.0`.

This document defines every number the engine produces, the order in which it is
calculated, and what the engine deliberately does **not** model. The code in
`src/engine.ts` follows the section numbers used here.

People make livelihood decisions from these numbers. Three rules follow from that:

1. **Nothing is hidden.** Every figure is a plain arithmetic function of the input. There is
   no LLM, no randomness, no clock, no network, no locale-dependent formatting.
2. **Nothing is promised.** The engine never outputs a probability of success, a score or a
   rating. Scenarios and stress tests are mechanical what-ifs on the user's own inputs.
3. **Revenue, operating profit, cash flow and owner income are four different things** and are
   always reported as separate, separately defined fields (see §15.4).

---

## 1. Conventions

| Topic | Convention |
|---|---|
| Currency | INR, plain JS numbers. |
| Precision | All arithmetic is done in full double precision. Rounding happens **only** when a figure is written into the result, through one helper, `round2` (2 decimals, half away from zero). Ramp/seasonality multipliers are reported with 6 decimals. |
| Consequence of rounding | Reported figures are rounded independently, so a sum of reported figures can differ from the reported sum by up to half a paisa per term. Annual rows are `round2(Σ unrounded monthly)`, not `Σ round2(monthly)`. |
| Rates | Fields ending in `Pct` are percentages (`12` = 12 %). |
| Ratios | `utilization`, `enrolmentRate`, `occupancy` are **fractions** in `[0, 1]`. A value above 1 is rejected (it is almost always a percentage typed by mistake). |
| Month length | Working-capital days use a 30-day month. |
| Timing | Every flow of a month happens at month end. There is no discounting anywhere (no NPV / IRR). |
| Unknown keys | Rejected everywhere, so a misspelt field can never be silently ignored. |
| GST | Not modelled. Enter prices and costs net of GST. |

## 2. Timeline

* `preOperatingMonths` = P (0–24) setup months, `monthIndex` −P … −1, `phase: "pre_operating"`.
* `horizonMonths` = H (12–120, default 60) operating months, `monthIndex` 1 … H. There is no month 0.
* `operatingYear` = 0 for the pre-operating period, otherwise `ceil(monthIndex / 12)`.
  Operating years are 12-month blocks counted from opening; they are **not** April–March financial years.
* `startCalendarMonth` (1 = January … 12, default 1) is the calendar month of operating month 1;
  calendar months run consecutively through the pre-operating and operating periods.
* Year index `y(m) = floor((m − 1) / 12)`. Escalations are stepwise:
  `factor(pct, m) = (1 + pct/100) ^ y(m)` — the first step happens in operating month 13.

## 3. Initial investment and funding

```
capex                = Σ capex[].amount
contingency          = capex × contingencyPct / 100
preOperativeExpenses = Σ preOperativeExpenses[].amount
deposits             = Σ deposits[].amount            (refundable and non-refundable)
preOperatingCosts    = Σ over pre-operating months of (flagged fixed costs + early staff + loan interest)   (§4)
total                = capex + contingency + preOperativeExpenses + deposits + preOperatingCosts

funding.loan               = financing.loan.principal (0 if none)
funding.subsidy            = financing.subsidy.amount (information only — subsidies are back-ended)
funding.ownerEquityUpfront = total − loan
```

* The contingency is assumed to be **fully spent**.
* A subsidy never reduces `ownerEquityUpfront`: it arrives later (§8).
* If the loan exceeds the total, `ownerEquityUpfront` is negative, the surplus is opening cash and
  the warning `LOAN_EXCEEDS_INITIAL_INVESTMENT` is raised.

`cumulativeCash` starts at `−ownerEquityUpfront`. All day-0 items above are therefore **not**
repeated in any monthly row; `capexOutflow` in monthly rows is replacement capex only.

## 4. Pre-operating months

No revenue, no owner compensation, no depreciation, no tax. In each pre-operating month:

```
fixedCosts = Σ monthlyAmount of fixed costs with accruesDuringPreOperating = true      (no escalation)
staffCosts = Σ count × monthlySalary of roles with
             monthsBeforeOpening ≤ min(startsPreOperatingMonthsBefore, P)              (no escalation)
interest   = loan principal × annualInterestPct / 1200                                 (interest only)
operatingProfitBeforeOwnerComp = −(fixedCosts + staffCosts)
profitBeforeTax = netProfit    = operatingProfitBeforeOwnerComp − interest
preOperatingFunding            = fixedCosts + staffCosts + interest
netCashFlow                    = 0
```

These costs are part of `initialInvestment.preOperatingCosts`, i.e. they are already inside the
opening position. `preOperatingFunding` shows that they are paid out of the initial investment, which
is why `netCashFlow` is 0 and `cumulativeCash` stays at `−ownerEquityUpfront` until opening.
They are expensed when incurred (they form a tax loss, §9) and are **not** amortised again.

## 5. Revenue and operating costs (each operating month m)

### 5.1 Volume multipliers

```
ramp(m)        = 1                                             if m > N
               = startPct/100 + (1 − startPct/100) × (m − 1)/N if m ≤ N        (N = rampUp.monthsToSteadyState)
seasonality(m) = seasonality.multipliers[calendarMonth(m) − 1], or 1 without a seasonality block
```

Month 1 is at `startPct`; month N + 1 is the first month at 100 %. With N = 0 there is no ramp.

### 5.2 Drivers — every stream is `units × price`

| `driver.kind` | units in month m | base price |
|---|---|---|
| `transactions` | `transactionsPerDay × operatingDaysPerMonth × ramp × seasonality` | `averageTicket` |
| `capacity_utilization` | `capacityUnitsPerMonth × min(1, utilization × ramp × seasonality)` | `unitPrice` |
| `enrolment` | `capacityStudents × min(1, enrolmentRate × ramp × seasonality)` | `feePerStudentPerMonth` |
| `occupancy` | `rentableArea × min(1, occupancy × ramp × seasonality)` | `ratePerAreaPerMonth` |
| `fleet_utilization` | `unitCount × billableDaysPerMonth × min(1, utilization × ramp × seasonality)` | `ratePerUnitPerDay` |
| `engagements` | `engagementsPerMonth × ramp × seasonality` | `realizedFee` |
| `area_yield` | `area × yieldPerAreaPerCycle` if `calendarMonth(m) ∈ harvestCalendarMonths`, else 0 | `pricePerUnit` |

* Capacity-bound drivers are **capped at 100 % of capacity**; if the cap binds in any month the
  warning `VOLUME_CAPPED_AT_CAPACITY` is raised.
* `area_yield`: one full cycle is sold in each listed calendar month. Seasonality multipliers never
  apply to it. The ramp applies only when `rampUp.applyToAreaYield` is true.

```
price(m)          = base price × factor(priceEscalationPctAnnual, m)
stream revenue    = units × price(m)
per_unit cost     = value × factor(costInflationPctAnnual, m) × units
pct_of_revenue    = value/100 × stream revenue
```

### 5.3 Fixed costs, staff, owner

```
fixed cost item   = monthlyAmount × factor(item.annualEscalationPct ?? costInflationPctAnnual, m)
staff role        = count × monthlySalary × factor(role.annualEscalationPct ?? costInflationPctAnnual, m)
ownerCompensation = owner.monthlyCompensation × factor(owner.annualEscalationPct, m)     (default 0 %, NOT linked to cost inflation)
```

Owner compensation is paid in operating months only.

### 5.4 Profit lines of a monthly row

```
revenue                        = Σ stream revenue
variableCogs                   = Σ variable costs classified 'cogs'
otherVariableCosts             = Σ variable costs classified 'operating'
totalVariableCosts             = variableCogs + otherVariableCosts
fixedCogs                      = fixed costs and staff classified 'cogs'
cogs                           = variableCogs + fixedCogs
grossProfit                    = revenue − cogs                      (accounting view: includes direct labour etc.)
contribution                   = revenue − totalVariableCosts        (cost-behaviour view: variable costs only)
fixedCosts                     = Σ all fixed cost items (both classifications)
staffCosts                     = Σ all staff roles (both classifications)
operatingProfitBeforeOwnerComp = contribution − fixedCosts − staffCosts          ← this is EBITDA
operatingProfitAfterOwnerComp  = operatingProfitBeforeOwnerComp − ownerCompensation
```

Note that `grossProfit − otherVariableCosts ≠ contribution` whenever some fixed cost or staff role is
classified `cogs`; the two margins answer different questions and are both reported.

**Profit before and after owner compensation** is reported under either owner treatment:
`operatingProfitBeforeOwnerComp` / `operatingProfitAfterOwnerComp` at operating level and
`netProfit` / `netProfitAfterOwnerComp` at net level (§9).

## 6. Depreciation and replacement capex

For each capex item with `depreciable = true` (default: everything except land) **and** a `usefulLifeYears`:

```
lifeMonths          = usefulLifeYears × 12                      (must be a whole number of months)
monthly depreciation = cost × (1 − salvagePct/100) / lifeMonths, charged in operating months 1 … lifeMonths
book value           = cost − monthly depreciation × months charged
```

Straight line, to salvage value, starting in operating month 1.

**Replacement** (`replaceAtEndOfLife`, default true for depreciable items with a useful life): at the end
of the month in which the life ends — provided at least one later month with operations exists
(`k × lifeMonths < H`, or `< closure month`) —

```
assetSaleProceeds += old cost × salvagePct/100                      (old unit sold at its salvage value)
capexOutflow      += original amount × factor(costInflationPctAnnual, m)
```

and the new unit is depreciated over a fresh life from the next month. An asset whose life ends in the
final modelled month is not replaced (no modelled month would use it).

Land and depreciable items **without** `usefulLifeYears` are never depreciated or replaced; the latter
raise `ASSET_WITHOUT_USEFUL_LIFE` because long-run costs are then understated.

## 7. Amortisation

```
amortisation per month = (preOperativeExpenses + contingency) / min(60, H)     for operating months 1 … min(60, H)
```

Deposits are never expensed (refundable ones are an asset; non-refundable ones are simply not deducted —
conservative for tax). Pre-operating running costs are expensed in §4, not amortised.

## 8. Loan and subsidy

The loan is disbursed in full at the start of the timeline. Monthly rate `r = annualInterestPct / 1200`.

* **Pre-operating months**: interest only, on the full principal (part of the initial investment).
* **`tenureMonths` and `moratoriumMonths` are counted in operating months from operating month 1**, and
  `tenureMonths` *includes* the moratorium.
* Operating month m with opening balance B:

```
interest  = B × r
principal = 0                                    if m ≤ moratoriumMonths
          = B × r / (1 − (1 + r)^−n) − interest  if moratoriumMonths < m ≤ tenureMonths, n = tenureMonths − m + 1
          = B                                    in the last instalment (n = 1)           (B/n when r = 0)
balance   = B − principal
```

  Recomputing the level payment on the current balance each month gives the ordinary constant EMI when
  nothing else changes, and automatically re-spreads the instalments if the balance is reduced by a subsidy.
  The balance is exactly 0 at the end of the tenure. If the tenure extends beyond the horizon, the
  remaining balance is reported (`summary.loanBalanceAtHorizonEnd`, warning `LOAN_OUTSTANDING_AT_HORIZON_END`)
  and is **not** deducted from `cumulativeCash`.

**Subsidy** (credit-linked, back-ended), received at the end of `receivedOperatingMonth`, after that
month's instalment:

* `reduces_loan_principal`: `subsidyAppliedToLoan = min(amount, balance)` reduces the loan balance
  (non-cash for the business); any excess is `subsidyInflow` (cash). Tenure end is unchanged; later
  instalments are lower.
* `cash_inflow`: the full amount is `subsidyInflow`.

A subsidy is a capital receipt in this model: it is not revenue and not taxed. No lock-in period or
claw-back is modelled.

## 9. Profit before tax, tax, net profit

```
profitBeforeTax = operatingProfitBeforeOwnerComp
                  − ownerCompensation          (only if owner.treatment = 'salary_expense')
                  − depreciation − amortisation − interest
```

`tax.kind = 'none'` (default): tax is 0 everywhere and the warning `RESULTS_ARE_PRE_TAX` states that
every figure is before income tax.

`tax.kind = 'flat_rate'`: one flat percentage on taxable profit, assessed per operating year and accrued
month by month on a year-to-date basis:

```
taxDueYTD(m) = ratePct/100 × max(0, Σ profitBeforeTax of the year so far − lossPool)
tax(m)       = taxDueYTD(m) − taxDueYTD(m − 1)
```

* Losses early in a year are offset by profits later in the same year, and vice-versa — so `tax(m)` can be
  **negative** (a reversal of tax accrued earlier in the same year). Annual tax is always
  `rate × max(0, annual profit − lossPool)`.
* `carryForwardLosses = true` (default): `lossPool` starts with the pre-operating loss; a year's loss is
  added to it, a year's profit uses it up. No expiry is modelled. With `false` the pool is always 0.
* Tax is assumed paid in the month it accrues (no advance-tax calendar).

```
netProfit               = profitBeforeTax − tax
netProfitAfterOwnerComp = netProfit − ownerCompensation     (if 'drawings';  = netProfit if 'salary_expense')
```

**Out of scope:** slab-based personal income tax, presumptive taxation (44AD/44ADA), surcharge/cess,
MAT, GST, TDS, tax depreciation (WDV) rates, tax on asset sales. For a proprietorship (`drawings`) a flat
rate is only a rough stand-in for the owner's personal tax on business profit. **Unless a flat rate is
supplied, all results are pre-personal-tax.**

## 10. Working capital

```
inventory   = variableCogs       × inventoryDays / 30
receivables = Σ stream revenue   × (stream.paymentTermsDays ?? receivableDays) / 30
payables    = totalVariableCosts × payableDays / 30
netWorkingCapital    = inventory + receivables − payables            (balance at month end)
workingCapitalChange = netWorkingCapital(m) − netWorkingCapital(m − 1)     (positive = cash absorbed; opening balance 0)
```

Balances are computed from the same month's flows, also for day counts above 30 (a simplification).

## 11. Net cash flow and cumulative cash

```
netCashFlow = operatingProfitBeforeOwnerComp
            − ownerCompensation            (cash outflow under BOTH owner treatments)
            − interest − tax
            − workingCapitalChange
            − capexOutflow + assetSaleProceeds
            − loanPrincipalRepayment
            + subsidyInflow
            + preOperatingFunding          (pre-operating months only; offsets that month's costs, §4)
            + closureCashFlow              (closure month only, §12)

cumulativeCash(t) = −ownerEquityUpfront + Σ netCashFlow up to and including month t
```

`cumulativeCash` is the owner's cumulative cash position in the venture **after paying themselves the
stated compensation**: negative = money still sunk in, ≥ 0 = upfront equity recovered.

## 12. Closure (business-failure scenario)

With `closure.atOperatingMonth = c`: operations run normally through month c (assets due for replacement
in month c are not replaced). At the end of month c:

```
assetBookValue          = Σ book value of all capex items (land and items without a life at cost)
assetSaleProceeds       = assetBookValue × assetRecoveryPct / 100            (% of DEPRECIATED book value)
depositsRecovered       = refundable deposits × refundableDepositRecoveryPct / 100
workingCapitalRecovered = (inventory + receivables) × workingCapitalRecoveryPct / 100 − payables     (default 100 %)
loanRepaidAtClosure     = loan balance after month c's instalment
netClosureCashFlow      = assetSaleProceeds + depositsRecovered + workingCapitalRecovered
                          − closureCosts − loanRepaidAtClosure

cumulativeCashAfterClosure = cumulativeCash(c)        (which includes netClosureCashFlow)
ownerCapitalLost           = max(0, −cumulativeCashAfterClosure)
ownerCompensationDrawn     = Σ ownerCompensation paid up to month c
ownerNetPositionIncludingCompensation = cumulativeCashAfterClosure + ownerCompensationDrawn
```

* **`ownerCapitalLost`** is the owner's money (upfront equity plus any later top-ups) that never came
  back. Compensation the owner drew is pay for work, not a return of capital, so it does not reduce the
  loss; `ownerNetPositionIncludingCompensation` shows the picture if one does count it.
* The owner is assumed to be **personally liable for the full outstanding loan** (true for
  proprietorships and for the personal guarantees usual in small-business lending).
* A subsidy due after month c is never received (`subsidyNotReceived`, warning). No claw-back of a
  subsidy already received.
* Months after c have `phase: "closed"` and all-zero flows; `cumulativeCash` stays at the final position.
* The closure month's profit lines show normal operations only: write-offs and gains/losses on
  liquidation are not put through profit or tax. The closure-month row reports `loanBalance` and
  `netWorkingCapital` after liquidation (0), while `workingCapitalChange` shows the operating movement.

## 13. Annual rows and DSCR

`annual[]` has one row per operating year (plus year 0 for the pre-operating period if P > 0). Every flow
field is the sum of the monthly values; `cumulativeCashEnd`, `loanBalanceEnd`, `netWorkingCapitalEnd` are
year-end balances; the last year may be partial (`months` < 12).

Debt-service coverage ratio, per operating year with debt service > 0:

```
debtService         = Σ interest + Σ loanPrincipalRepayment              (scheduled only)
dscr                = (Σ operatingProfitBeforeOwnerComp − Σ ownerCompensation − Σ tax) / debtService
dscrBeforeOwnerComp = (Σ operatingProfitBeforeOwnerComp − Σ tax) / debtService

summary.minDscr = lowest annual dscr
summary.avgDscr = Σ numerators over those years / Σ debtService over those years
```

Working-capital changes and capex are not deducted (lender convention). The headline DSCR deducts owner
compensation under both treatments, which is stricter than the common bank formula for proprietorships;
the `…BeforeOwnerComp` variants are provided for comparison. `DSCR_BELOW_1` fires when `minDscr < 1`.

## 14. Steady state and break-even

### 14.1 Steady-state month (`summary.steadyState`)

A **hypothetical month** defined as follows — it is not read from the monthly rows:

* price and cost levels of operating month `referenceOperatingMonth = monthsToSteadyState + 1`
  (the first month after ramp-up), i.e. escalation factors of year index `floor(monthsToSteadyState / 12)`;
* ramp = 100 %, **seasonality ignored** (multiplier 1);
* `area_yield` streams are averaged over the year: `units = area × yield × (number of harvest months) / 12`.

For a model without seasonality and without `area_yield` streams these figures equal the actual row of
the reference month. If the reference month lies beyond the horizon, `reachedWithinHorizon` is false and
`STEADY_STATE_NOT_REACHED_IN_HORIZON` is raised.

```
grossMarginPct        = grossProfit / revenue × 100
contributionMarginPct = contribution / revenue × 100
monthlyFixedCostBase  = fixedCosts + staffCosts          (no owner pay, interest or depreciation)
ebitda                = contribution − monthlyFixedCostBase
ebitdaMarginPct       = ebitda / revenue × 100
```

Percentages are `null` when revenue is 0.

### 14.2 Break-even revenue (`summary.breakEven`)

```
monthlyRevenueRequired = fixedCostBase ÷ (steady-state contribution / steady-state revenue)
pctOfSteadyStateRevenue = monthlyRevenueRequired / steady-state revenue × 100
```

computed at three explicitly different levels of `fixedCostBase`:

| Level | `fixedCostBase` includes |
|---|---|
| `beforeOwnerCompensation` | fixed costs + staff + loan interest |
| `afterOwnerCompensation` (**headline** `breakEven.monthlyRevenueRequired`) | fixed costs + staff + loan interest + stated owner compensation |
| `afterOwnerCompensationAndLoanEmi` | fixed costs + staff + stated owner compensation + full loan EMI |

* fixed costs, staff, owner compensation: steady-state month values (§14.1);
* loan interest: one month's interest on the **full original principal** (`principal × r`, the highest
  monthly interest the loan ever carries — conservative and independent of timing);
* loan EMI: level payment on the full original principal over `tenureMonths − moratoriumMonths` months;
* **not** included at any level: depreciation, amortisation, tax, working-capital build-up, replacement capex.

`null` when the contribution margin is ≤ 0 (`NEGATIVE_CONTRIBUTION_MARGIN`): no revenue level breaks even
(except that a `fixedCostBase` of 0 always gives a requirement of 0).
`BREAK_EVEN_ABOVE_STEADY_STATE_REVENUE` fires when the headline figure exceeds steady-state revenue.

Also reported: `firstOperatingMonthEbitdaPositive` (first month with EBITDA > 0),
`firstOperatingMonthProfitAfterOwnerCompPositive`, `firstOperatingMonthNetCashPositive`
(first month with `netCashFlow > 0`) — each `null` if it never happens.

## 15. Capital recovery, funding need, owner income

### 15.1 Payback (`summary.capitalRecovery`)

`paybackOperatingMonth` = the **first** operating month in which `cumulativeCash ≥ 0`, else `null`
(`withinHorizon = false`, warning `PAYBACK_NOT_WITHIN_HORIZON`). It is undiscounted, counted in operating
months (the pre-operating period is extra), and measured **after** the owner has drawn the stated
compensation. The position can fall below zero again later (seasonal businesses, replacement capex) —
check `cumulativeCashAtHorizonEnd` and the monthly path.

`paybackOperatingMonthIncludingOwnerComp` applies the same test to
`cumulativeCash + cumulative owner compensation paid` (i.e. counting owner pay as recovery).

### 15.2 Peak funding need (`summary.peakFundingNeed`)

```
business cash(t) = cumulativeCash(t) + max(ownerEquityUpfront, 0)
peakFundingNeed  = max(0, −min over all months of business cash(t))
totalOwnerCashRequired = max(ownerEquityUpfront, 0) + peakFundingNeed
```

This is the extra money, beyond the upfront equity, that the owner must have in reserve to get through
the cumulative cash deficit of the early months (ramp-up losses, working-capital build-up, debt service,
**and the stated owner compensation**). The engine never assumes an overdraft: when the figure is positive
the critical warning `CASH_SHORTFALL` is raised with the amount and the month of the trough
(`peakFundingNeedMonthIndex`).

### 15.3 Owner income (`summary.ownerIncome`)

For operating year n = 1, 2, 3 (only if all 12 months are inside the horizon, else `null`):

```
cashBeforeOwnerComp = Σ over the year of (netCashFlow + ownerCompensation)
ownerIncome.yearNAvgMonthly = cashBeforeOwnerComp / 12
```

i.e. the cash the business generated in that year for the owner after **all** costs, tax, working-capital
needs, replacement capex and debt service (interest and principal), per month. It equals
"owner compensation actually affordable + residual net cash flow":

```
avgMonthlyStatedOwnerCompensation     = Σ ownerCompensation / 12
avgMonthlyResidualNetCashFlow         = Σ netCashFlow / 12                     (negative = stated pay was not covered)
avgMonthlyAffordableOwnerCompensation = min(stated, max(0, cashBeforeOwnerComp)) / 12
ownerIncomeAvgMonthly                 = stated + residual = cashBeforeOwnerComp / 12
```

A negative owner income means the owner had to put money **into** the business that year.

### 15.4 Do not confuse these four

| Concept | Field | What it is |
|---|---|---|
| Revenue | `revenue` | Sales. Not income. |
| Operating profit | `operatingProfitBeforeOwnerComp` (EBITDA) | Revenue minus variable, fixed and staff costs. Before owner pay, depreciation, interest, tax, working capital, loan principal. |
| Cash flow | `netCashFlow` | Cash left in the business after everything, including owner pay and loan principal. |
| Owner income | `summary.ownerIncome.*` | `netCashFlow + ownerCompensation`, averaged per month over a year. |

`ownerIncome.components[]` repeats average monthly revenue, operating profit and cash flow next to owner
income for each year precisely so that they cannot be mixed up.

## 16. Warnings

`warnings[]` is a list of `{ code, severity: 'info' | 'warning' | 'critical', message }`, always in the
order below. Codes are stable identifiers; messages are English, for humans.

| Code | Fires when |
|---|---|
| `RESULTS_ARE_PRE_TAX` | `tax.kind = 'none'`. |
| `SEASONALITY_NOT_NORMALISED` | mean of the 12 multipliers deviates from 1 by more than 2 %. |
| `ASSET_WITHOUT_USEFUL_LIFE` | a depreciable capex item has no `usefulLifeYears`. |
| `LOAN_EXCEEDS_INITIAL_INVESTMENT` | `ownerEquityUpfront < 0`. |
| `ZERO_REVENUE` | steady-state revenue is 0. |
| `NEGATIVE_CONTRIBUTION_MARGIN` | steady-state contribution ≤ 0 with revenue > 0. |
| `VOLUME_CAPPED_AT_CAPACITY` | a capacity-bound stream was capped in some month. |
| `STEADY_STATE_NOT_REACHED_IN_HORIZON` | `monthsToSteadyState + 1 > horizonMonths`. |
| `NEVER_BREAKS_EVEN_IN_HORIZON` | EBITDA is not positive in any operating month. |
| `OWNER_COMPENSATION_NOT_COVERED` | EBITDA becomes positive but never exceeds the stated owner compensation. |
| `BREAK_EVEN_ABOVE_STEADY_STATE_REVENUE` | headline break-even revenue > steady-state revenue. |
| `CASH_SHORTFALL` | `peakFundingNeed > 0`. |
| `PAYBACK_NOT_WITHIN_HORIZON` | `paybackOperatingMonth` is null. |
| `DSCR_BELOW_1` | `minDscr < 1`. |
| `LOAN_OUTSTANDING_AT_HORIZON_END` | loan balance > 0 at the end of the horizon (no closure). |
| `SUBSIDY_NOT_RECEIVED_BEFORE_CLOSURE` | closure happens before the subsidy month. |

## 17. Scenarios, stress tests, sensitivity

A scenario is a pure transformation of the input: `applyOverrides(input, adjustments)` returns a new,
re-validated input (the original is never mutated) which is then run like any other input and has its own
`inputHash`.

Adjustment: `{ target, op: 'multiply' | 'add' | 'set', value, keys? }`, applied in order.

| `target` | Acts on |
|---|---|
| `volume` | the driver's volume parameter: `transactionsPerDay`, `utilization`, `yieldPerAreaPerCycle`, `enrolmentRate`, `occupancy`, `utilization` (fleet), `engagementsPerMonth` |
| `price` | `averageTicket`, `unitPrice`, `pricePerUnit`, `feePerStudentPerMonth`, `ratePerAreaPerMonth`, `ratePerUnitPerDay`, `realizedFee` |
| `variable_costs` | every variable cost `value` (per-unit and %-of-revenue) |
| `fixed_costs` | every fixed cost `monthlyAmount` |
| `rent` | fixed costs with `category = 'rent'` only |
| `staff_costs` | every `monthlySalary` |
| `capex` | every capex `amount` |
| `ramp_months` | `rampUp.monthsToSteadyState` (rounded **up** to whole months, 0–120) |
| `pre_operating_months` | `preOperatingMonths` (rounded, 0–24) |
| `interest_rate` | `loan.annualInterestPct` (percentage points for `add`; 0–100) |
| closure | `{ closureAtOperatingMonth, assetRecoveryPct, refundableDepositRecoveryPct, closureCosts?, workingCapitalRecoveryPct? }` sets the `closure` block |

`keys` restricts an adjustment to items with those keys. Amounts are clamped at 0 and utilisation-type
ratios at 1; every clamp, and every adjustment that had nothing to act on (e.g. `interest_rate` without a
loan), is reported in `notes` by `applyAdjustments` / `runScenarios` so that a no-op stress test is never
mistaken for resilience. A scenario whose adjusted input is invalid (e.g. closure after the horizon) is
returned with `status: 'invalid'` rather than failing the batch.

`DEFAULT_SCENARIOS` (conservative / base / optimistic) and `DEFAULT_STRESS_TESTS` are **generic,
illustrative shocks — not forecasts and not derived from data about any business or sector**:

| Key | Shock |
|---|---|
| `conservative` | volume ×0.85; variable, fixed, staff costs ×1.05; ramp months ×1.5 |
| `base` | none |
| `optimistic` | volume ×1.10 (capped at capacity); ramp months ×0.75 |
| `stress_revenue_minus_20` / `_35` | volume ×0.80 / ×0.65 |
| `stress_price_minus_10` | prices ×0.90 |
| `stress_rent_plus_25` | rent ×1.25 |
| `stress_variable_costs_plus_15` | variable costs ×1.15 |
| `stress_launch_delayed_3_months` | pre-operating months +3 |
| `stress_ramp_twice_as_long` | ramp months ×2 |
| `stress_interest_plus_3_points` | interest rate +3 percentage points |
| `failure_closure_month_12` / `_24` | closure; assets at 50 % of book value, deposits and working capital at 100 %, no closure costs |

`sensitivity(input, params, deltas = [-20, -10, 10, 20], metric = 'steadyStateEbitda')` multiplies one
parameter at a time by `(1 + delta/100)` and reports the metric for each delta, `changeFromBase`, and the
`spread` (max − min, including the base); rows are sorted by spread, largest first (tornado order).
Metrics: `steadyStateEbitda`, `paybackOperatingMonth` (null when not within the horizon),
`peakFundingNeed`, `cumulativeCashAtHorizonEnd`, `ownerIncomeYear1AvgMonthly`.

## 18. Determinism, hashing, CLI

* `inputHash` = SHA-256 (hex) of the canonical JSON of the **validated** input: defaults filled in, object
  keys sorted, array order preserved, `undefined` dropped, numbers in ECMAScript shortest form. Therefore
  key order and omitted-vs-explicit defaults do not change the hash; any change of a value or of an
  array's order does. SHA-256 is implemented in pure TypeScript (`src/sha256.ts`) so hashing is
  synchronous and identical in Node and browsers.
* The same input always yields byte-identical `JSON.stringify(result)`. Store results keyed by
  `(engineVersion, inputHash)`. `engineVersion` changes its major number whenever any output number can
  change for an unchanged input.
* CLI (`node dist/cli.mjs`, built with `pnpm build`; the only module with I/O): one JSON request on stdin,
  one JSON document on stdout.

| Request | Response |
|---|---|
| `{"op":"run","input":ModelInput}` | `ModelResult` |
| `{"op":"scenarios","input":…,"scenarios":ScenarioSpec[] \| "default" \| "stress" \| "all"}` | `{engineVersion, baseInputHash, scenarios: ScenarioRun[]}` |
| `{"op":"sensitivity","input":…,"params"?,"deltas"?,"metric"?}` | `SensitivityResult` |
| `{"op":"validate","input":…}` | `{ok, inputHash, issues[]}` (exit 0 even when `ok` is false) |
| `{"op":"hash","input":…}` | `{engineVersion, inputHash}` |
| `{"op":"defaults"}` | default scenarios, stress tests, sensitivity settings |
| `{"op":"archetypes"}` | `{engineVersion, archetypes}` |
| `{"op":"version"}` | `{name, engineVersion}` |

  Errors: nothing on stdout, `{"error":{"code","message","issues"?}}` on stderr, exit code **2** for a bad
  request or invalid input (`INVALID_JSON`, `INVALID_REQUEST`, `UNKNOWN_OP`, `INVALID_INPUT`), **1** for an
  internal error.

## 19. Simplifications and limitations

Read this list before relying on a result.

1. **It is arithmetic on the user's assumptions.** If the volume, price or cost inputs are wrong, every
   output is wrong. The engine has no knowledge of any market.
2. Monthly granularity; all flows at month end; no discounting, NPV or IRR; payback is undiscounted.
3. Tax is `none` or one flat rate (§9). No personal slabs, presumptive schemes, GST, TDS or WDV depreciation.
4. One ramp curve and one seasonality curve for the whole business (not per stream); linear ramp;
   stepwise annual escalation.
5. Volume of capacity-bound drivers is capped at capacity; demand above capacity is lost, not deferred.
6. Working capital is a days-of-the-same-month approximation; no bad debts; inventory at variable COGS.
7. Straight-line depreciation from operating month 1; replacements at inflated original cost; old assets
   sell at exactly their salvage value; items without a useful life are not depreciated or replaced.
8. One term loan, fully disbursed at the start, fixed rate, no fees, prepayment only through the subsidy.
   No working-capital (cash-credit) facility: shortfalls are reported as `peakFundingNeed`, never financed.
9. Subsidy: single receipt in a stated month; no lock-in, interest on the subsidy deposit, or claw-back.
10. Owner compensation is paid from operating month 1 whether or not the business can afford it; the
    shortfall shows up in `peakFundingNeed` and `ownerIncome`. Nothing is paid during pre-operating months
    and the owner's forgone salary elsewhere (opportunity cost) is not modelled.
11. Closure: single liquidation date, recovery percentages supplied by the caller, owner fully liable for
    the loan, no tax effects of liquidation.
12. The horizon end is not a valuation: no terminal value, and an outstanding loan is reported, not netted.
13. Default scenarios and stress tests are generic illustrative shocks, not forecasts or probabilities.
