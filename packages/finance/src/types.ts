/**
 * Result types of the PlanB financial model.
 *
 * Every numeric field is INR rounded to 2 decimals unless stated otherwise.
 * The precise definition of each metric lives in docs/FINANCE_ENGINE.md.
 */

export type WarningCode =
  | 'NEGATIVE_CONTRIBUTION_MARGIN'
  | 'NEVER_BREAKS_EVEN_IN_HORIZON'
  | 'OWNER_COMPENSATION_NOT_COVERED'
  | 'BREAK_EVEN_ABOVE_STEADY_STATE_REVENUE'
  | 'PAYBACK_NOT_WITHIN_HORIZON'
  | 'CASH_SHORTFALL'
  | 'SEASONALITY_NOT_NORMALISED'
  | 'DSCR_BELOW_1'
  | 'LOAN_OUTSTANDING_AT_HORIZON_END'
  | 'LOAN_EXCEEDS_INITIAL_INVESTMENT'
  | 'VOLUME_CAPPED_AT_CAPACITY'
  | 'STEADY_STATE_NOT_REACHED_IN_HORIZON'
  | 'ASSET_WITHOUT_USEFUL_LIFE'
  | 'ZERO_REVENUE'
  | 'SUBSIDY_NOT_RECEIVED_BEFORE_CLOSURE'
  | 'RESULTS_ARE_PRE_TAX';

export type WarningSeverity = 'info' | 'warning' | 'critical';

export interface ModelWarning {
  code: WarningCode;
  severity: WarningSeverity;
  message: string;
}

export type MonthPhase = 'pre_operating' | 'operating' | 'closed';

export interface StreamMonth {
  key: string;
  /** Units sold in the month (driver-specific unit; see ARCHETYPES). */
  units: number;
  revenue: number;
  /** All variable costs of the stream (COGS + operating). */
  variableCosts: number;
}

/** The flow fields that are summed into annual rows. */
export interface FlowFields {
  revenue: number;
  /** Variable costs classified `cogs`. */
  variableCogs: number;
  /** Fixed costs and staff classified `cogs` (e.g. production staff). */
  fixedCogs: number;
  /** variableCogs + fixedCogs. */
  cogs: number;
  /** revenue − cogs. */
  grossProfit: number;
  /** Variable costs classified `operating`. */
  otherVariableCosts: number;
  /** variableCogs + otherVariableCosts. */
  totalVariableCosts: number;
  /** revenue − totalVariableCosts. */
  contribution: number;
  /** All fixed costs (both classifications), excluding staff. */
  fixedCosts: number;
  /** All staff costs (both classifications), excluding the owner. */
  staffCosts: number;
  /** EBITDA: contribution − fixedCosts − staffCosts. Before owner compensation, depreciation, interest, tax. */
  operatingProfitBeforeOwnerComp: number;
  /** Stated owner compensation paid in the month (cash outflow under either treatment). */
  ownerCompensation: number;
  /** operatingProfitBeforeOwnerComp − ownerCompensation (under either treatment). */
  operatingProfitAfterOwnerComp: number;
  depreciation: number;
  amortisation: number;
  interest: number;
  /** After depreciation, amortisation, interest — and after owner compensation ONLY when treatment is `salary_expense`. */
  profitBeforeTax: number;
  /** Tax accrued (and assumed paid) in the month. Can be negative: reversal of tax accrued earlier in the same year. */
  tax: number;
  /** profitBeforeTax − tax. */
  netProfit: number;
  /** netProfit less owner drawings (if treatment is `drawings`); equals netProfit for `salary_expense`. */
  netProfitAfterOwnerComp: number;
  /** Increase in net working capital during the month (positive = cash absorbed). */
  workingCapitalChange: number;
  /** Replacement purchases of fixed assets (gross). Initial capex is in `initialInvestment`, not here. */
  capexOutflow: number;
  /** Salvage proceeds of assets sold when they are replaced. */
  assetSaleProceeds: number;
  /** Scheduled loan principal repaid (excludes subsidy adjustments and closure settlement). */
  loanPrincipalRepayment: number;
  /** Subsidy received as cash by the business. */
  subsidyInflow: number;
  /** Subsidy adjusted directly against the loan balance (non-cash for the business). */
  subsidyAppliedToLoan: number;
  /** Pre-operating months only: costs of the month paid out of the initial investment (already inside ownerEquityUpfront/loan). */
  preOperatingFunding: number;
  /** Closure month only: liquidation proceeds − closure costs − loan settled. See `ModelResult.closure`. */
  closureCashFlow: number;
  /** Cash generated (+) or consumed (−) in the month after everything above, including owner compensation. */
  netCashFlow: number;
}

export interface MonthlyRow extends FlowFields {
  /** −preOperatingMonths … −1 for pre-operating months, 1 … horizonMonths for operating months. No month 0. */
  monthIndex: number;
  phase: MonthPhase;
  /** 0 for the pre-operating period; otherwise ceil(monthIndex / 12). */
  operatingYear: number;
  /** Calendar month 1–12. */
  calendarMonth: number;
  /** Ramp-up multiplier applied to volume (6 decimals). 0 outside operations. */
  rampMultiplier: number;
  /** Seasonality multiplier applied to volume (6 decimals). 0 outside operations. */
  seasonalityMultiplier: number;
  streams: StreamMonth[];
  /** Net working capital balance at month end (inventory + receivables − payables). */
  netWorkingCapital: number;
  /** Owner's cumulative cash position: −ownerEquityUpfront + Σ netCashFlow up to and including this month. */
  cumulativeCash: number;
  /** Loan balance outstanding at month end. */
  loanBalance: number;
}

export interface AnnualRow extends FlowFields {
  /** 0 = pre-operating period (present only if preOperatingMonths > 0); 1, 2, … = operating years. */
  year: number;
  /** Number of monthly rows aggregated (the last operating year may be partial). */
  months: number;
  unitsByStream: Array<{ key: string; units: number; revenue: number }>;
  /** Balances at the end of the year. */
  cumulativeCashEnd: number;
  loanBalanceEnd: number;
  netWorkingCapitalEnd: number;
  /** Debt-service coverage of the year, after owner compensation; null if no debt service in the year. */
  dscr: number | null;
  /** Same, without deducting owner compensation. */
  dscrBeforeOwnerComp: number | null;
}

export interface InitialInvestment {
  /** Σ capex amounts. */
  capex: number;
  /** capex × contingencyPct. */
  contingency: number;
  /** Σ pre-operative expenses. */
  preOperativeExpenses: number;
  /** Σ deposits (refundable and non-refundable). */
  deposits: number;
  /** Portion of `deposits` flagged refundable. */
  refundableDeposits: number;
  /** Running costs paid during the pre-operating months: flagged fixed costs + early staff + loan interest. */
  preOperatingCosts: number;
  preOperatingCostsBreakdown: { fixedCosts: number; staffCosts: number; interest: number };
  /** Sum of capex, contingency, preOperativeExpenses, deposits and preOperatingCosts. */
  total: number;
}

export interface Funding {
  /** Loan principal disbursed at the start. */
  loan: number;
  /** Subsidy amount expected (back-ended: it does NOT reduce the upfront requirement). */
  subsidy: number;
  /** initialInvestment.total − loan. The owner's own money needed before opening. Negative if the loan exceeds the investment. */
  ownerEquityUpfront: number;
}

export interface SteadyStateStream {
  key: string;
  unitsPerMonth: number;
  pricePerUnit: number;
  revenue: number;
}

export interface SteadyState {
  /** rampUp.monthsToSteadyState + 1: the operating month whose price/cost levels are used. */
  referenceOperatingMonth: number;
  /** False if the reference month lies beyond the horizon. */
  reachedWithinHorizon: boolean;
  streams: SteadyStateStream[];
  revenue: number;
  variableCogs: number;
  cogs: number;
  grossProfit: number;
  /** grossProfit / revenue × 100; null when revenue is 0. */
  grossMarginPct: number | null;
  totalVariableCosts: number;
  contribution: number;
  /** contribution / revenue × 100; null when revenue is 0. */
  contributionMarginPct: number | null;
  fixedCosts: number;
  staffCosts: number;
  /** fixedCosts + staffCosts (excludes owner compensation, interest, depreciation). */
  monthlyFixedCostBase: number;
  /** contribution − monthlyFixedCostBase (operating profit before owner compensation). */
  ebitda: number;
  /** ebitda / revenue × 100; null when revenue is 0. */
  ebitdaMarginPct: number | null;
  ownerCompensation: number;
  /** ebitda − ownerCompensation. */
  operatingProfitAfterOwnerComp: number;
}

export interface BreakEvenLevel {
  /** The monthly fixed cash costs that must be covered by contribution. */
  fixedCostBase: number;
  /** fixedCostBase ÷ contribution-margin ratio; null when the contribution margin is ≤ 0. */
  monthlyRevenueRequired: number | null;
  /** monthlyRevenueRequired ÷ steady-state revenue × 100; null when not computable. */
  pctOfSteadyStateRevenue: number | null;
}

export interface BreakEven {
  /** Headline figure = the `afterOwnerCompensation` level. */
  monthlyRevenueRequired: number | null;
  pctOfSteadyStateRevenue: number | null;
  /** Covers fixed costs + staff + loan interest. */
  beforeOwnerCompensation: BreakEvenLevel;
  /** Covers fixed costs + staff + loan interest + stated owner compensation. */
  afterOwnerCompensation: BreakEvenLevel;
  /** Covers fixed costs + staff + stated owner compensation + the full loan EMI (interest and principal). */
  afterOwnerCompensationAndLoanEmi: BreakEvenLevel;
  components: {
    fixedCosts: number;
    staffCosts: number;
    /** One month's interest on the full original principal (the highest monthly interest of the loan). */
    loanInterest: number;
    /** EMI on the full original principal over (tenure − moratorium) months. */
    loanEmi: number;
    ownerCompensation: number;
    contributionMarginPct: number | null;
  };
  /** First operating month with operatingProfitBeforeOwnerComp > 0. */
  firstOperatingMonthEbitdaPositive: number | null;
  /** First operating month with operatingProfitAfterOwnerComp > 0. */
  firstOperatingMonthProfitAfterOwnerCompPositive: number | null;
  /** First operating month with netCashFlow > 0. */
  firstOperatingMonthNetCashPositive: number | null;
}

export interface CapitalRecovery {
  /** First operating month in which cumulativeCash ≥ 0 (it may dip below 0 again later). */
  paybackOperatingMonth: number | null;
  withinHorizon: boolean;
  /** Same test on cumulativeCash + cumulative owner compensation paid (i.e. counting owner pay as recovery). */
  paybackOperatingMonthIncludingOwnerComp: number | null;
  cumulativeCashAtHorizonEnd: number;
}

export interface OwnerIncomeYear {
  /** Operating year 1, 2 or 3. */
  year: number;
  /** False when the horizon does not contain all 12 months of the year (then every figure is null). */
  complete: boolean;
  avgMonthlyRevenue: number | null;
  /** Average monthly operatingProfitBeforeOwnerComp (EBITDA). */
  avgMonthlyOperatingProfitBeforeOwnerComp: number | null;
  /** Average monthly net cash flow + owner compensation: cash the business generated for the owner. = owner income. */
  avgMonthlyCashBeforeOwnerComp: number | null;
  /** Average monthly stated owner compensation. */
  avgMonthlyStatedOwnerCompensation: number | null;
  /** min(stated, max(0, cash before owner compensation)): the part of stated pay the year's cash actually covered. */
  avgMonthlyAffordableOwnerCompensation: number | null;
  /** Average monthly netCashFlow (after paying the stated owner compensation). Negative = shortfall. */
  avgMonthlyResidualNetCashFlow: number | null;
  /** = avgMonthlyCashBeforeOwnerComp = stated owner compensation + residual net cash flow. */
  ownerIncomeAvgMonthly: number | null;
}

export interface OwnerIncome {
  year1AvgMonthly: number | null;
  year2AvgMonthly: number | null;
  year3AvgMonthly: number | null;
  components: OwnerIncomeYear[];
}

export interface Totals {
  revenue: number;
  operatingProfitBeforeOwnerComp: number;
  ownerCompensation: number;
  depreciation: number;
  amortisation: number;
  interest: number;
  tax: number;
  netProfit: number;
  netCashFlow: number;
}

export interface Summary {
  steadyState: SteadyState;
  breakEven: BreakEven;
  capitalRecovery: CapitalRecovery;
  /** Extra cash, beyond ownerEquityUpfront, the owner must have in reserve to keep the business solvent. ≥ 0. */
  peakFundingNeed: number;
  /** monthIndex at which the cash trough occurs; null when peakFundingNeed is 0. */
  peakFundingNeedMonthIndex: number | null;
  /** max(ownerEquityUpfront, 0) + peakFundingNeed. */
  totalOwnerCashRequired: number;
  /** Lowest annual DSCR (after owner compensation); null without a loan / debt service. */
  minDscr: number | null;
  /** Σ cash available for debt service ÷ Σ debt service over all years with debt service. */
  avgDscr: number | null;
  minDscrBeforeOwnerComp: number | null;
  avgDscrBeforeOwnerComp: number | null;
  ownerIncome: OwnerIncome;
  /** Sums over all monthly rows (pre-operating + operating). */
  totals: Totals;
  /** Loan balance still outstanding at the end of the horizon. */
  loanBalanceAtHorizonEnd: number;
}

export interface ClosureResult {
  atOperatingMonth: number;
  /** Net book value of all fixed assets at the end of the closure month. */
  assetBookValue: number;
  /** assetBookValue × assetRecoveryPct. */
  assetSaleProceeds: number;
  /** refundable deposits × refundableDepositRecoveryPct. */
  depositsRecovered: number;
  /** (inventory + receivables) × workingCapitalRecoveryPct − payables. Can be negative. */
  workingCapitalRecovered: number;
  closureCosts: number;
  /** Loan balance outstanding at closure, repaid in full by the owner/business. */
  loanRepaidAtClosure: number;
  /** Subsidy that was due after the closure month and is therefore never received. */
  subsidyNotReceived: number;
  /** assetSaleProceeds + depositsRecovered + workingCapitalRecovered − closureCosts − loanRepaidAtClosure. */
  netClosureCashFlow: number;
  /** cumulativeCash after the closure month (final position). */
  cumulativeCashAfterClosure: number;
  /** max(ownerEquityUpfront, 0) + peakFundingNeed: the most the owner had sunk in at any time. */
  totalOwnerCashRequired: number;
  /** Owner compensation actually drawn up to and including the closure month. */
  ownerCompensationDrawn: number;
  /** max(0, −cumulativeCashAfterClosure): owner money not recovered, AFTER counting compensation drawn as received. */
  ownerCapitalLost: number;
  /** cumulativeCashAfterClosure + ownerCompensationDrawn (signed): the owner's overall cash outcome if compensation drawn is counted as money received. */
  ownerNetPositionIncludingCompensation: number;
}

export interface ModelResult {
  engineVersion: string;
  /** sha256 of the canonical JSON of the validated (default-filled) input. */
  inputHash: string;
  currency: 'INR';
  horizonMonths: number;
  preOperatingMonths: number;
  initialInvestment: InitialInvestment;
  funding: Funding;
  monthly: MonthlyRow[];
  annual: AnnualRow[];
  summary: Summary;
  /** Present only when the input has a `closure` block. */
  closure: ClosureResult | null;
  warnings: ModelWarning[];
}
