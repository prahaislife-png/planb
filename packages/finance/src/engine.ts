import { hashCanonical } from './canonical';
import { driverPrice, driverUnits } from './drivers';
import { round2, round2OrNull, round6 } from './round';
import {
  PRE_OPERATIVE_AMORTISATION_MONTHS,
  parseModelInput,
  type ModelInput,
  type ValidatedModelInput,
} from './schema';
import type {
  AnnualRow,
  BreakEvenLevel,
  ClosureResult,
  FlowFields,
  ModelResult,
  ModelWarning,
  MonthPhase,
  MonthlyRow,
  OwnerIncomeYear,
  SteadyState,
  StreamMonth,
} from './types';
import { ENGINE_VERSION } from './version';

/**
 * The calculation engine. See docs/FINANCE_ENGINE.md for the specification this
 * file implements; the section numbers in comments refer to that document.
 *
 * Everything here is a pure function of the validated input: no I/O, no clock,
 * no randomness, no locale-dependent formatting.
 */

// ---------------------------------------------------------------------------
// small pure helpers (exported for tests and for the docs' worked examples)
// ---------------------------------------------------------------------------

/** 0-based operating-year index of operating month `m` (1-based). */
export function yearIndexOf(operatingMonth: number): number {
  return Math.floor((operatingMonth - 1) / 12);
}

/** Stepwise annual escalation factor: (1 + pct/100) ^ yearIndex. */
export function escalationFactor(pctPerYear: number, yearIndex: number): number {
  return (1 + pctPerYear / 100) ** yearIndex;
}

/**
 * Linear ramp-up multiplier for operating month `m`.
 *   m ≤ N : startPct/100 + (1 − startPct/100) × (m − 1) / N
 *   m > N : 1
 * where N = monthsToSteadyState. Month 1 is at startPct, month N + 1 is the first month at 100 %.
 */
export function rampMultiplier(operatingMonth: number, startPct: number, monthsToSteadyState: number): number {
  if (operatingMonth > monthsToSteadyState) return 1;
  const start = startPct / 100;
  return start + ((1 - start) * (operatingMonth - 1)) / monthsToSteadyState;
}

/** Calendar month (1–12) of a month index (negative = pre-operating, 1.. = operating). */
export function calendarMonthOf(monthIndex: number, startCalendarMonth: number): number {
  const offset = monthIndex > 0 ? monthIndex - 1 : monthIndex;
  return ((((startCalendarMonth - 1 + offset) % 12) + 12) % 12) + 1;
}

/** Level payment that amortises `balance` over `periods` at periodic rate `rate`. */
export function levelPayment(balance: number, rate: number, periods: number): number {
  if (periods <= 0) return 0;
  if (rate === 0) return balance / periods;
  return (balance * rate) / (1 - (1 + rate) ** -periods);
}

const formatInr = (value: number): string => `INR ${round2(value).toFixed(2)}`;

// ---------------------------------------------------------------------------
// operating line of one month (revenue → EBITDA drivers), full precision
// ---------------------------------------------------------------------------

interface StreamLine {
  key: string;
  units: number;
  price: number;
  revenue: number;
  variableCogs: number;
  otherVariableCosts: number;
  receivableDays: number;
  capped: boolean;
}

interface OperatingLine {
  streams: StreamLine[];
  revenue: number;
  variableCogs: number;
  otherVariableCosts: number;
  fixedCosts: number;
  fixedCostsCogs: number;
  staffCosts: number;
  staffCostsCogs: number;
  ownerCompensation: number;
  /** Σ stream revenue × credit days / 30. */
  receivables: number;
}

type VolumeMode =
  | { kind: 'month'; ramp: number; seasonality: number; calendarMonth: number }
  /** Ramp = 1, seasonality = 1, agricultural harvests spread evenly over 12 months. */
  | { kind: 'steady_state' };

function computeOperatingLine(input: ValidatedModelInput, yearIndex: number, mode: VolumeMode): OperatingLine {
  const priceFactor = escalationFactor(input.priceEscalationPctAnnual, yearIndex);
  const costFactor = escalationFactor(input.costInflationPctAnnual, yearIndex);

  let revenue = 0;
  let variableCogs = 0;
  let otherVariableCosts = 0;
  let receivables = 0;

  const streams: StreamLine[] = input.revenueStreams.map((stream) => {
    const driver = stream.driver;
    let units: number;
    let capped = false;

    if (driver.kind === 'area_yield') {
      if (mode.kind === 'steady_state') {
        units = (driverUnits(driver, 1).units * driver.harvestCalendarMonths.length) / 12;
      } else if (driver.harvestCalendarMonths.includes(mode.calendarMonth)) {
        units = driverUnits(driver, input.rampUp.applyToAreaYield ? mode.ramp : 1).units;
      } else {
        units = 0;
      }
    } else {
      const multiplier = mode.kind === 'steady_state' ? 1 : mode.ramp * mode.seasonality;
      const volume = driverUnits(driver, multiplier);
      units = volume.units;
      capped = volume.capped;
    }

    const price = driverPrice(driver) * priceFactor;
    const streamRevenue = units * price;

    let streamCogs = 0;
    let streamOther = 0;
    for (const cost of stream.variableCosts) {
      const costAmount =
        cost.basis === 'per_unit' ? cost.value * costFactor * units : (cost.value / 100) * streamRevenue;
      if (cost.classification === 'cogs') streamCogs += costAmount;
      else streamOther += costAmount;
    }

    const receivableDays = stream.paymentTermsDays ?? input.workingCapital.receivableDays;
    revenue += streamRevenue;
    variableCogs += streamCogs;
    otherVariableCosts += streamOther;
    receivables += (streamRevenue * receivableDays) / 30;

    return {
      key: stream.key,
      units,
      price,
      revenue: streamRevenue,
      variableCogs: streamCogs,
      otherVariableCosts: streamOther,
      receivableDays,
      capped,
    };
  });

  let fixedCosts = 0;
  let fixedCostsCogs = 0;
  for (const item of input.fixedCosts) {
    const cost =
      item.monthlyAmount * escalationFactor(item.annualEscalationPct ?? input.costInflationPctAnnual, yearIndex);
    fixedCosts += cost;
    if (item.classification === 'cogs') fixedCostsCogs += cost;
  }

  let staffCosts = 0;
  let staffCostsCogs = 0;
  for (const role of input.staff) {
    const cost =
      role.count *
      role.monthlySalary *
      escalationFactor(role.annualEscalationPct ?? input.costInflationPctAnnual, yearIndex);
    staffCosts += cost;
    if (role.classification === 'cogs') staffCostsCogs += cost;
  }

  const ownerCompensation =
    input.owner.monthlyCompensation * escalationFactor(input.owner.annualEscalationPct, yearIndex);

  return {
    streams,
    revenue,
    variableCogs,
    otherVariableCosts,
    fixedCosts,
    fixedCostsCogs,
    staffCosts,
    staffCostsCogs,
    ownerCompensation,
    receivables,
  };
}

// ---------------------------------------------------------------------------
// fixed assets
// ---------------------------------------------------------------------------

interface AssetState {
  key: string;
  originalAmount: number;
  /** Cost of the unit currently in service. */
  currentCost: number;
  salvageFraction: number;
  /** Useful life in months; null = not depreciated (land, or no useful life given). */
  lifeMonths: number | null;
  replace: boolean;
  /** Months of depreciation charged on the unit currently in service. */
  ageMonths: number;
}

function initialAssets(input: ValidatedModelInput): AssetState[] {
  return input.capex.map((item) => ({
    key: item.key,
    originalAmount: item.amount,
    currentCost: item.amount,
    salvageFraction: item.salvagePct / 100,
    lifeMonths:
      item.depreciable && item.usefulLifeYears !== undefined ? Math.round(item.usefulLifeYears * 12) : null,
    replace: item.replaceAtEndOfLife,
    ageMonths: 0,
  }));
}

function monthlyDepreciationOf(asset: AssetState): number {
  if (asset.lifeMonths === null) return 0;
  return (asset.currentCost * (1 - asset.salvageFraction)) / asset.lifeMonths;
}

function bookValueOf(asset: AssetState): number {
  if (asset.lifeMonths === null) return asset.currentCost;
  return asset.currentCost - monthlyDepreciationOf(asset) * asset.ageMonths;
}

// ---------------------------------------------------------------------------
// raw (full-precision) monthly rows
// ---------------------------------------------------------------------------

type FlowKey = keyof FlowFields;

/** Order matters: it is the key order of the emitted JSON. */
const FLOW_KEYS: readonly FlowKey[] = [
  'revenue',
  'variableCogs',
  'fixedCogs',
  'cogs',
  'grossProfit',
  'otherVariableCosts',
  'totalVariableCosts',
  'contribution',
  'fixedCosts',
  'staffCosts',
  'operatingProfitBeforeOwnerComp',
  'ownerCompensation',
  'operatingProfitAfterOwnerComp',
  'depreciation',
  'amortisation',
  'interest',
  'profitBeforeTax',
  'tax',
  'netProfit',
  'netProfitAfterOwnerComp',
  'workingCapitalChange',
  'capexOutflow',
  'assetSaleProceeds',
  'loanPrincipalRepayment',
  'subsidyInflow',
  'subsidyAppliedToLoan',
  'preOperatingFunding',
  'closureCashFlow',
  'netCashFlow',
];

interface RawRow extends FlowFields {
  monthIndex: number;
  phase: MonthPhase;
  operatingYear: number;
  calendarMonth: number;
  rampMultiplier: number;
  seasonalityMultiplier: number;
  streams: StreamMonth[];
  netWorkingCapital: number;
  cumulativeCash: number;
  loanBalance: number;
}

function zeroFlows(): FlowFields {
  const flows = {} as Record<FlowKey, number>;
  for (const key of FLOW_KEYS) flows[key] = 0;
  return flows;
}

function roundFlows(source: FlowFields): FlowFields {
  const flows = {} as Record<FlowKey, number>;
  for (const key of FLOW_KEYS) flows[key] = round2(source[key]);
  return flows;
}

// ---------------------------------------------------------------------------
// public entry points
// ---------------------------------------------------------------------------

/** Validate `input` (throws `ModelValidationError`) and run the model. */
export function runModel(input: ModelInput): ModelResult {
  return computeModel(parseModelInput(input));
}

/** Hash of an input after validation and default-filling. Key order of the raw input is irrelevant. */
export function hashModelInput(input: ModelInput): string {
  return hashCanonical(parseModelInput(input));
}

/** Run the model on an input that has ALREADY been validated by `parseModelInput`. */
export function computeModel(input: ValidatedModelInput): ModelResult {
  const H = input.horizonMonths;
  const P = input.preOperatingMonths;
  const closure = input.closure ?? null;
  const closureMonth = closure ? closure.atOperatingMonth : null;
  /** Last month with operations. */
  const lastActive = closureMonth ?? H;

  const loan = input.financing?.loan ?? null;
  const subsidy = input.financing?.subsidy ?? null;
  const monthlyRate = loan ? loan.annualInterestPct / 1200 : 0;
  const taxRate = input.tax.kind === 'flat_rate' ? input.tax.ratePct / 100 : 0;
  const carryForwardLosses = input.tax.kind === 'flat_rate' && input.tax.carryForwardLosses;
  const ownerIsExpense = input.owner.treatment === 'salary_expense';

  const warnings: ModelWarning[] = [];

  // ---- §3 initial investment (day-0 items) --------------------------------
  const capexTotal = input.capex.reduce((sum, item) => sum + item.amount, 0);
  const contingency = (capexTotal * input.contingencyPct) / 100;
  const preOperativeExpenses = input.preOperativeExpenses.reduce((sum, item) => sum + item.amount, 0);
  const depositsTotal = input.deposits.reduce((sum, item) => sum + item.amount, 0);
  const refundableDeposits = input.deposits.reduce((sum, item) => sum + (item.refundable ? item.amount : 0), 0);

  // ---- §4 pre-operating months --------------------------------------------
  let loanBalance = loan ? loan.principal : 0;
  let preOpFixed = 0;
  let preOpStaff = 0;
  let preOpInterest = 0;
  const rawRows: RawRow[] = [];

  for (let monthIndex = -P; monthIndex <= -1; monthIndex++) {
    const monthsBeforeOpening = -monthIndex;
    let fixedCosts = 0;
    let fixedCogs = 0;
    for (const item of input.fixedCosts) {
      if (!item.accruesDuringPreOperating) continue;
      fixedCosts += item.monthlyAmount;
      if (item.classification === 'cogs') fixedCogs += item.monthlyAmount;
    }
    let staffCosts = 0;
    for (const role of input.staff) {
      if (monthsBeforeOpening > Math.min(role.startsPreOperatingMonthsBefore, P)) continue;
      const cost = role.count * role.monthlySalary;
      staffCosts += cost;
      if (role.classification === 'cogs') fixedCogs += cost;
    }
    const interest = loanBalance * monthlyRate;
    preOpFixed += fixedCosts;
    preOpStaff += staffCosts;
    preOpInterest += interest;

    const ebitda = -(fixedCosts + staffCosts);
    const profitBeforeTax = ebitda - interest;
    const funding = fixedCosts + staffCosts + interest;
    rawRows.push({
      ...zeroFlows(),
      monthIndex,
      phase: 'pre_operating',
      operatingYear: 0,
      calendarMonth: calendarMonthOf(monthIndex, input.startCalendarMonth),
      rampMultiplier: 0,
      seasonalityMultiplier: 0,
      streams: input.revenueStreams.map((stream) => ({ key: stream.key, units: 0, revenue: 0, variableCosts: 0 })),
      fixedCogs,
      cogs: fixedCogs,
      grossProfit: -fixedCogs,
      fixedCosts,
      staffCosts,
      operatingProfitBeforeOwnerComp: ebitda,
      operatingProfitAfterOwnerComp: ebitda,
      interest,
      profitBeforeTax,
      netProfit: profitBeforeTax,
      netProfitAfterOwnerComp: profitBeforeTax,
      preOperatingFunding: funding,
      // Funded entirely out of the initial investment, which is already in the opening position.
      netCashFlow: -funding + funding,
      netWorkingCapital: 0,
      cumulativeCash: 0, // filled in below once ownerEquityUpfront is known
      loanBalance,
    });
  }

  const preOperatingCosts = preOpFixed + preOpStaff + preOpInterest;
  const initialInvestmentTotal = capexTotal + contingency + preOperativeExpenses + depositsTotal + preOperatingCosts;
  const loanPrincipal = loan ? loan.principal : 0;
  const ownerEquityUpfront = initialInvestmentTotal - loanPrincipal;
  /** Cash the owner actually injects upfront (a loan larger than the investment leaves surplus cash instead). */
  const ownerCashUpfront = Math.max(ownerEquityUpfront, 0);

  let cumulativeCash = -ownerEquityUpfront;
  for (const row of rawRows) row.cumulativeCash = cumulativeCash;

  // ---- §5–§11 operating months --------------------------------------------
  const assets = initialAssets(input);
  const amortisationMonths = Math.min(PRE_OPERATIVE_AMORTISATION_MONTHS, H);
  const monthlyAmortisation = (preOperativeExpenses + contingency) / amortisationMonths;

  // tax state (§9)
  let lossPool = carryForwardLosses ? Math.max(0, preOpFixed + preOpStaff + preOpInterest) : 0;
  let yearTaxable = 0;
  let yearTaxAccrued = 0;

  let previousNetWorkingCapital = 0;
  let cumulativeOwnerCompensation = 0;
  let subsidyReceived = false;
  const cappedStreams = new Set<string>();
  let closureResult: ClosureResult | null = null;

  // trackers
  let minCashBalance = Math.max(-ownerEquityUpfront, 0); // business cash after the initial spend
  let minCashMonthIndex: number | null = null;
  let paybackMonth: number | null = null;
  let paybackMonthInclOwnerComp: number | null = null;
  let firstEbitdaPositive: number | null = null;
  let firstAfterOwnerPositive: number | null = null;
  let firstNetCashPositive: number | null = null;

  for (let m = 1; m <= H; m++) {
    const calendarMonth = calendarMonthOf(m, input.startCalendarMonth);
    const operatingYear = Math.ceil(m / 12);

    if (m > lastActive) {
      rawRows.push({
        ...zeroFlows(),
        monthIndex: m,
        phase: 'closed',
        operatingYear,
        calendarMonth,
        rampMultiplier: 0,
        seasonalityMultiplier: 0,
        streams: input.revenueStreams.map((stream) => ({ key: stream.key, units: 0, revenue: 0, variableCosts: 0 })),
        netWorkingCapital: 0,
        cumulativeCash,
        loanBalance: 0,
      });
      continue;
    }

    const yearIndex = yearIndexOf(m);
    const ramp = rampMultiplier(m, input.rampUp.startPct, input.rampUp.monthsToSteadyState);
    const seasonality = input.seasonality ? (input.seasonality.multipliers[calendarMonth - 1] as number) : 1;

    // §5 revenue and costs
    const line = computeOperatingLine(input, yearIndex, { kind: 'month', ramp, seasonality, calendarMonth });
    for (const stream of line.streams) if (stream.capped) cappedStreams.add(stream.key);

    const totalVariableCosts = line.variableCogs + line.otherVariableCosts;
    const fixedCogs = line.fixedCostsCogs + line.staffCostsCogs;
    const cogs = line.variableCogs + fixedCogs;
    const contribution = line.revenue - totalVariableCosts;
    const ebitda = contribution - line.fixedCosts - line.staffCosts;
    const ownerCompensation = line.ownerCompensation;

    // §6 depreciation and replacement capex
    let depreciation = 0;
    let capexOutflow = 0;
    let assetSaleProceeds = 0;
    for (const asset of assets) {
      if (asset.lifeMonths === null) continue;
      if (asset.ageMonths < asset.lifeMonths) {
        depreciation += monthlyDepreciationOf(asset);
        asset.ageMonths += 1;
      }
      // Replace at the end of the month in which the life ends, if a later active month needs the asset.
      if (asset.ageMonths === asset.lifeMonths && asset.replace && m < lastActive && asset.originalAmount > 0) {
        assetSaleProceeds += asset.currentCost * asset.salvageFraction;
        const replacementCost = asset.originalAmount * escalationFactor(input.costInflationPctAnnual, yearIndex);
        capexOutflow += replacementCost;
        asset.currentCost = replacementCost;
        asset.ageMonths = 0;
      }
    }

    // §7 amortisation of pre-operative expenses and contingency
    const amortisation = m <= amortisationMonths ? monthlyAmortisation : 0;

    // §8 loan service and subsidy
    let interest = 0;
    let principalRepayment = 0;
    if (loan && loanBalance > 0) {
      interest = loanBalance * monthlyRate;
      if (m > loan.moratoriumMonths && m <= loan.tenureMonths) {
        const remainingInstalments = loan.tenureMonths - m + 1;
        principalRepayment =
          remainingInstalments === 1
            ? loanBalance
            : Math.min(loanBalance, levelPayment(loanBalance, monthlyRate, remainingInstalments) - interest);
      }
      loanBalance -= principalRepayment;
    }
    let subsidyInflow = 0;
    let subsidyAppliedToLoan = 0;
    if (subsidy && subsidy.receivedOperatingMonth === m) {
      subsidyReceived = true;
      if (subsidy.treatment === 'reduces_loan_principal') {
        subsidyAppliedToLoan = Math.min(subsidy.amount, loanBalance);
        loanBalance -= subsidyAppliedToLoan;
        subsidyInflow = subsidy.amount - subsidyAppliedToLoan;
      } else {
        subsidyInflow = subsidy.amount;
      }
    }

    // §9 profit and tax
    const profitBeforeTax = ebitda - (ownerIsExpense ? ownerCompensation : 0) - depreciation - amortisation - interest;
    if (m > 1 && (m - 1) % 12 === 0) {
      // a new tax year starts: settle the loss pool
      if (carryForwardLosses) {
        lossPool = yearTaxable < 0 ? lossPool - yearTaxable : Math.max(0, lossPool - yearTaxable);
      } else {
        lossPool = 0;
      }
      yearTaxable = 0;
      yearTaxAccrued = 0;
    }
    yearTaxable += profitBeforeTax;
    const taxDueYearToDate = taxRate * Math.max(0, yearTaxable - lossPool);
    const tax = taxDueYearToDate - yearTaxAccrued;
    yearTaxAccrued = taxDueYearToDate;
    const netProfit = profitBeforeTax - tax;

    // §10 working capital
    const inventory = (line.variableCogs * input.workingCapital.inventoryDays) / 30;
    const payables = (totalVariableCosts * input.workingCapital.payableDays) / 30;
    const netWorkingCapital = inventory + line.receivables - payables;
    const workingCapitalChange = netWorkingCapital - previousNetWorkingCapital;
    previousNetWorkingCapital = netWorkingCapital;

    // §12 closure at the end of this month
    let closureCashFlow = 0;
    let reportedNetWorkingCapital = netWorkingCapital;
    if (closure && m === closureMonth) {
      const assetBookValue = assets.reduce((sum, asset) => sum + bookValueOf(asset), 0);
      const proceeds = (assetBookValue * closure.assetRecoveryPct) / 100;
      const depositsRecovered = (refundableDeposits * closure.refundableDepositRecoveryPct) / 100;
      const workingCapitalRecovered =
        ((inventory + line.receivables) * closure.workingCapitalRecoveryPct) / 100 - payables;
      const loanRepaidAtClosure = loanBalance;
      closureCashFlow =
        proceeds + depositsRecovered + workingCapitalRecovered - closure.closureCosts - loanRepaidAtClosure;
      loanBalance = 0;
      reportedNetWorkingCapital = 0;
      closureResult = {
        atOperatingMonth: m,
        assetBookValue: round2(assetBookValue),
        assetSaleProceeds: round2(proceeds),
        depositsRecovered: round2(depositsRecovered),
        workingCapitalRecovered: round2(workingCapitalRecovered),
        closureCosts: round2(closure.closureCosts),
        loanRepaidAtClosure: round2(loanRepaidAtClosure),
        subsidyNotReceived: round2(subsidy && !subsidyReceived ? subsidy.amount : 0),
        netClosureCashFlow: round2(closureCashFlow),
        // the remaining fields are completed after the loop
        cumulativeCashAfterClosure: 0,
        totalOwnerCashRequired: 0,
        ownerCompensationDrawn: 0,
        ownerCapitalLost: 0,
        ownerNetPositionIncludingCompensation: 0,
      };
    }

    // §11 net cash flow
    const netCashFlow =
      ebitda -
      ownerCompensation -
      interest -
      tax -
      workingCapitalChange -
      capexOutflow +
      assetSaleProceeds -
      principalRepayment +
      subsidyInflow +
      closureCashFlow;
    cumulativeCash += netCashFlow;
    cumulativeOwnerCompensation += ownerCompensation;

    // trackers
    const cashBalance = cumulativeCash + ownerCashUpfront;
    if (cashBalance < minCashBalance) {
      minCashBalance = cashBalance;
      minCashMonthIndex = m;
    }
    if (paybackMonth === null && round2(cumulativeCash) >= 0) paybackMonth = m;
    if (paybackMonthInclOwnerComp === null && round2(cumulativeCash + cumulativeOwnerCompensation) >= 0) {
      paybackMonthInclOwnerComp = m;
    }
    if (firstEbitdaPositive === null && round2(ebitda) > 0) firstEbitdaPositive = m;
    if (firstAfterOwnerPositive === null && round2(ebitda - ownerCompensation) > 0) firstAfterOwnerPositive = m;
    if (firstNetCashPositive === null && round2(netCashFlow) > 0) firstNetCashPositive = m;

    rawRows.push({
      monthIndex: m,
      phase: 'operating',
      operatingYear,
      calendarMonth,
      rampMultiplier: ramp,
      seasonalityMultiplier: seasonality,
      streams: line.streams.map((stream) => ({
        key: stream.key,
        units: stream.units,
        revenue: stream.revenue,
        variableCosts: stream.variableCogs + stream.otherVariableCosts,
      })),
      revenue: line.revenue,
      variableCogs: line.variableCogs,
      fixedCogs,
      cogs,
      grossProfit: line.revenue - cogs,
      otherVariableCosts: line.otherVariableCosts,
      totalVariableCosts,
      contribution,
      fixedCosts: line.fixedCosts,
      staffCosts: line.staffCosts,
      operatingProfitBeforeOwnerComp: ebitda,
      ownerCompensation,
      operatingProfitAfterOwnerComp: ebitda - ownerCompensation,
      depreciation,
      amortisation,
      interest,
      profitBeforeTax,
      tax,
      netProfit,
      netProfitAfterOwnerComp: netProfit - (ownerIsExpense ? 0 : ownerCompensation),
      workingCapitalChange,
      capexOutflow,
      assetSaleProceeds,
      loanPrincipalRepayment: principalRepayment,
      subsidyInflow,
      subsidyAppliedToLoan,
      preOperatingFunding: 0,
      closureCashFlow,
      netCashFlow,
      netWorkingCapital: reportedNetWorkingCapital,
      cumulativeCash,
      loanBalance,
    });
  }

  // ---- §13 annual aggregates and DSCR --------------------------------------
  const annual: AnnualRow[] = [];
  const dscrYears: Array<{ cashAfterOwner: number; cashBeforeOwner: number; debtService: number }> = [];
  const years = [...new Set(rawRows.map((row) => row.operatingYear))].sort((a, b) => a - b);
  for (const year of years) {
    const rows = rawRows.filter((row) => row.operatingYear === year);
    const last = rows[rows.length - 1] as RawRow;
    const sums = zeroFlows();
    for (const row of rows) for (const key of FLOW_KEYS) sums[key] += row[key];

    let dscr: number | null = null;
    let dscrBeforeOwnerComp: number | null = null;
    if (year > 0) {
      const debtService = sums.interest + sums.loanPrincipalRepayment;
      if (debtService > 1e-9) {
        const cashBeforeOwner = sums.operatingProfitBeforeOwnerComp - sums.tax;
        const cashAfterOwner = cashBeforeOwner - sums.ownerCompensation;
        dscr = cashAfterOwner / debtService;
        dscrBeforeOwnerComp = cashBeforeOwner / debtService;
        dscrYears.push({ cashAfterOwner, cashBeforeOwner, debtService });
      }
    }

    annual.push({
      year,
      months: rows.length,
      unitsByStream: input.revenueStreams.map((stream, index) => ({
        key: stream.key,
        units: round2(rows.reduce((sum, row) => sum + (row.streams[index] as StreamMonth).units, 0)),
        revenue: round2(rows.reduce((sum, row) => sum + (row.streams[index] as StreamMonth).revenue, 0)),
      })),
      ...roundFlows(sums),
      cumulativeCashEnd: round2(last.cumulativeCash),
      loanBalanceEnd: round2(last.loanBalance),
      netWorkingCapitalEnd: round2(last.netWorkingCapital),
      dscr: round2OrNull(dscr),
      dscrBeforeOwnerComp: round2OrNull(dscrBeforeOwnerComp),
    });
  }

  let minDscr: number | null = null;
  let avgDscr: number | null = null;
  let minDscrBeforeOwnerComp: number | null = null;
  let avgDscrBeforeOwnerComp: number | null = null;
  if (dscrYears.length > 0) {
    minDscr = Math.min(...dscrYears.map((y) => y.cashAfterOwner / y.debtService));
    minDscrBeforeOwnerComp = Math.min(...dscrYears.map((y) => y.cashBeforeOwner / y.debtService));
    const totalDebtService = dscrYears.reduce((sum, y) => sum + y.debtService, 0);
    avgDscr = dscrYears.reduce((sum, y) => sum + y.cashAfterOwner, 0) / totalDebtService;
    avgDscrBeforeOwnerComp = dscrYears.reduce((sum, y) => sum + y.cashBeforeOwner, 0) / totalDebtService;
  }

  // ---- §14 steady state and break-even -------------------------------------
  const referenceMonth = input.rampUp.monthsToSteadyState + 1;
  const steadyLine = computeOperatingLine(input, yearIndexOf(referenceMonth), { kind: 'steady_state' });
  const ssTotalVariable = steadyLine.variableCogs + steadyLine.otherVariableCosts;
  const ssCogs = steadyLine.variableCogs + steadyLine.fixedCostsCogs + steadyLine.staffCostsCogs;
  const ssContribution = steadyLine.revenue - ssTotalVariable;
  const ssFixedBase = steadyLine.fixedCosts + steadyLine.staffCosts;
  const ssEbitda = ssContribution - ssFixedBase;
  const hasRevenue = steadyLine.revenue > 0;
  const contributionMarginRatio = hasRevenue ? ssContribution / steadyLine.revenue : null;
  const pctOf = (part: number): number | null => (hasRevenue ? round2((part / steadyLine.revenue) * 100) : null);

  const steadyState: SteadyState = {
    referenceOperatingMonth: referenceMonth,
    reachedWithinHorizon: referenceMonth <= H,
    streams: steadyLine.streams.map((stream) => ({
      key: stream.key,
      unitsPerMonth: round2(stream.units),
      pricePerUnit: round2(stream.price),
      revenue: round2(stream.revenue),
    })),
    revenue: round2(steadyLine.revenue),
    variableCogs: round2(steadyLine.variableCogs),
    cogs: round2(ssCogs),
    grossProfit: round2(steadyLine.revenue - ssCogs),
    grossMarginPct: pctOf(steadyLine.revenue - ssCogs),
    totalVariableCosts: round2(ssTotalVariable),
    contribution: round2(ssContribution),
    contributionMarginPct: pctOf(ssContribution),
    fixedCosts: round2(steadyLine.fixedCosts),
    staffCosts: round2(steadyLine.staffCosts),
    monthlyFixedCostBase: round2(ssFixedBase),
    ebitda: round2(ssEbitda),
    ebitdaMarginPct: pctOf(ssEbitda),
    ownerCompensation: round2(steadyLine.ownerCompensation),
    operatingProfitAfterOwnerComp: round2(ssEbitda - steadyLine.ownerCompensation),
  };

  const loanInterestForBreakEven = loan ? loan.principal * monthlyRate : 0;
  const loanEmiForBreakEven = loan
    ? levelPayment(loan.principal, monthlyRate, loan.tenureMonths - loan.moratoriumMonths)
    : 0;
  const breakEvenLevel = (fixedCostBase: number): { level: BreakEvenLevel; required: number | null } => {
    let required: number | null = null;
    if (fixedCostBase <= 0) required = 0;
    else if (contributionMarginRatio !== null && contributionMarginRatio > 0) {
      required = fixedCostBase / contributionMarginRatio;
    }
    return {
      required,
      level: {
        fixedCostBase: round2(fixedCostBase),
        monthlyRevenueRequired: round2OrNull(required),
        pctOfSteadyStateRevenue: required !== null && hasRevenue ? round2((required / steadyLine.revenue) * 100) : null,
      },
    };
  };
  const beBefore = breakEvenLevel(ssFixedBase + loanInterestForBreakEven);
  const beAfter = breakEvenLevel(ssFixedBase + loanInterestForBreakEven + steadyLine.ownerCompensation);
  const beAfterEmi = breakEvenLevel(ssFixedBase + steadyLine.ownerCompensation + loanEmiForBreakEven);

  // ---- §15 funding need, payback, owner income ------------------------------
  const peakFundingNeed = Math.max(0, -minCashBalance);
  const peakFundingNeedRounded = round2(peakFundingNeed);
  const totalOwnerCashRequired = ownerCashUpfront + peakFundingNeed;

  const ownerIncomeYears: OwnerIncomeYear[] = [1, 2, 3].map((year) => {
    if (year * 12 > H) {
      return {
        year,
        complete: false,
        avgMonthlyRevenue: null,
        avgMonthlyOperatingProfitBeforeOwnerComp: null,
        avgMonthlyCashBeforeOwnerComp: null,
        avgMonthlyStatedOwnerCompensation: null,
        avgMonthlyAffordableOwnerCompensation: null,
        avgMonthlyResidualNetCashFlow: null,
        ownerIncomeAvgMonthly: null,
      };
    }
    const rows = rawRows.filter((row) => row.operatingYear === year);
    const sum = (key: FlowKey): number => rows.reduce((total, row) => total + row[key], 0);
    const stated = sum('ownerCompensation');
    const residual = sum('netCashFlow');
    const cashBeforeOwnerComp = residual + stated;
    const affordable = Math.min(stated, Math.max(0, cashBeforeOwnerComp));
    return {
      year,
      complete: true,
      avgMonthlyRevenue: round2(sum('revenue') / 12),
      avgMonthlyOperatingProfitBeforeOwnerComp: round2(sum('operatingProfitBeforeOwnerComp') / 12),
      avgMonthlyCashBeforeOwnerComp: round2(cashBeforeOwnerComp / 12),
      avgMonthlyStatedOwnerCompensation: round2(stated / 12),
      avgMonthlyAffordableOwnerCompensation: round2(affordable / 12),
      avgMonthlyResidualNetCashFlow: round2(residual / 12),
      ownerIncomeAvgMonthly: round2(cashBeforeOwnerComp / 12),
    };
  });

  const totalOf = (key: FlowKey): number => rawRows.reduce((total, row) => total + row[key], 0);
  const loanBalanceAtHorizonEnd = (rawRows[rawRows.length - 1] as RawRow).loanBalance;

  if (closureResult) {
    closureResult.cumulativeCashAfterClosure = round2(cumulativeCash);
    closureResult.totalOwnerCashRequired = round2(totalOwnerCashRequired);
    closureResult.ownerCompensationDrawn = round2(cumulativeOwnerCompensation);
    closureResult.ownerCapitalLost = round2(Math.max(0, -cumulativeCash));
    closureResult.ownerNetPositionIncludingCompensation = round2(cumulativeCash + cumulativeOwnerCompensation);
  }

  // ---- §16 warnings (fixed order) -------------------------------------------
  if (input.tax.kind === 'none') {
    warnings.push({
      code: 'RESULTS_ARE_PRE_TAX',
      severity: 'info',
      message:
        'No tax is modelled (tax.kind = "none"): every profit, cash-flow and owner-income figure is before income tax.',
    });
  }
  if (input.seasonality) {
    const mean = input.seasonality.multipliers.reduce((sum, value) => sum + value, 0) / 12;
    if (Math.abs(mean - 1) > 0.02) {
      warnings.push({
        code: 'SEASONALITY_NOT_NORMALISED',
        severity: 'warning',
        message: `Seasonality multipliers average ${mean.toFixed(4)} instead of 1.0000, so annual volume is ${
          mean > 1 ? 'above' : 'below'
        } the stated steady-state volume by ${Math.abs((mean - 1) * 100).toFixed(2)}%.`,
      });
    }
  }
  const lifelessAssets = input.capex.filter(
    (item) => item.depreciable && item.usefulLifeYears === undefined && item.amount > 0,
  );
  if (lifelessAssets.length > 0) {
    warnings.push({
      code: 'ASSET_WITHOUT_USEFUL_LIFE',
      severity: 'warning',
      message: `No usefulLifeYears given for depreciable capex item(s) ${lifelessAssets
        .map((item) => `"${item.key}"`)
        .join(', ')}: they are neither depreciated nor replaced, which understates long-run costs.`,
    });
  }
  if (loan && ownerEquityUpfront < 0) {
    warnings.push({
      code: 'LOAN_EXCEEDS_INITIAL_INVESTMENT',
      severity: 'warning',
      message: `The loan (${formatInr(loan.principal)}) exceeds the initial investment (${formatInr(
        initialInvestmentTotal,
      )}); the surplus of ${formatInr(-ownerEquityUpfront)} is treated as opening cash and ownerEquityUpfront is negative.`,
    });
  }
  if (!hasRevenue) {
    warnings.push({
      code: 'ZERO_REVENUE',
      severity: 'critical',
      message: 'Steady-state revenue is zero: margins and break-even percentages cannot be computed.',
    });
  }
  if (hasRevenue && ssContribution <= 0) {
    warnings.push({
      code: 'NEGATIVE_CONTRIBUTION_MARGIN',
      severity: 'critical',
      message: `Variable costs (${formatInr(ssTotalVariable)}) are not below revenue (${formatInr(
        steadyLine.revenue,
      )}) at steady state: every additional sale loses money and no break-even revenue exists.`,
    });
  }
  if (cappedStreams.size > 0) {
    warnings.push({
      code: 'VOLUME_CAPPED_AT_CAPACITY',
      severity: 'warning',
      message: `Seasonality/ramp multipliers pushed stream(s) ${[...cappedStreams]
        .map((key) => `"${key}"`)
        .join(', ')} above 100% of capacity in some months; volume was capped at capacity.`,
    });
  }
  if (referenceMonth > H) {
    warnings.push({
      code: 'STEADY_STATE_NOT_REACHED_IN_HORIZON',
      severity: 'warning',
      message: `Ramp-up ends after operating month ${input.rampUp.monthsToSteadyState}, beyond the ${H}-month horizon: steady-state metrics describe a month that is not modelled.`,
    });
  }
  if (firstEbitdaPositive === null) {
    warnings.push({
      code: 'NEVER_BREAKS_EVEN_IN_HORIZON',
      severity: 'critical',
      message: `Operating profit before owner compensation (EBITDA) is never positive in any of the ${lastActive} operating months modelled.`,
    });
  } else if (firstAfterOwnerPositive === null && input.owner.monthlyCompensation > 0) {
    warnings.push({
      code: 'OWNER_COMPENSATION_NOT_COVERED',
      severity: 'critical',
      message:
        'Operating profit never covers the stated owner compensation in any modelled month: the owner cannot draw the stated amount from operations.',
    });
  }
  if (hasRevenue && beAfter.required !== null && beAfter.required > steadyLine.revenue) {
    warnings.push({
      code: 'BREAK_EVEN_ABOVE_STEADY_STATE_REVENUE',
      severity: 'critical',
      message: `Break-even revenue after owner compensation (${formatInr(
        beAfter.required,
      )} per month) is above steady-state revenue (${formatInr(steadyLine.revenue)} per month).`,
    });
  }
  if (peakFundingNeedRounded > 0) {
    warnings.push({
      code: 'CASH_SHORTFALL',
      severity: 'critical',
      message: `Cash runs short: beyond the upfront owner equity of ${formatInr(
        ownerCashUpfront,
      )} a further ${formatInr(peakFundingNeed)} is needed by month ${String(
        minCashMonthIndex,
      )}. The model does not assume any overdraft; this amount must be available in reserve.`,
    });
  }
  if (paybackMonth === null) {
    warnings.push({
      code: 'PAYBACK_NOT_WITHIN_HORIZON',
      severity: 'warning',
      message: `The owner's cumulative cash position is still ${formatInr(cumulativeCash)} at the end of the ${H}-month horizon: the upfront equity is not recovered within the horizon.`,
    });
  }
  if (minDscr !== null && round2(minDscr) < 1) {
    warnings.push({
      code: 'DSCR_BELOW_1',
      severity: 'critical',
      message: `The lowest annual debt-service coverage ratio is ${round2(minDscr).toFixed(
        2,
      )} (< 1): in at least one year operating cash after tax and owner compensation does not cover loan interest and principal.`,
    });
  }
  if (!closure && loanBalanceAtHorizonEnd > 0.005) {
    warnings.push({
      code: 'LOAN_OUTSTANDING_AT_HORIZON_END',
      severity: 'info',
      message: `${formatInr(loanBalanceAtHorizonEnd)} of loan principal is still outstanding at the end of the horizon and is not deducted from cumulativeCash.`,
    });
  }
  if (closure && subsidy && !subsidyReceived && subsidy.amount > 0) {
    warnings.push({
      code: 'SUBSIDY_NOT_RECEIVED_BEFORE_CLOSURE',
      severity: 'warning',
      message: `The subsidy of ${formatInr(subsidy.amount)} was due in operating month ${subsidy.receivedOperatingMonth}, after closure in month ${closure.atOperatingMonth}; it is treated as never received.`,
    });
  }

  // ---- assemble the reported (rounded) result -------------------------------
  const monthly: MonthlyRow[] = rawRows.map((row) => ({
    monthIndex: row.monthIndex,
    phase: row.phase,
    operatingYear: row.operatingYear,
    calendarMonth: row.calendarMonth,
    rampMultiplier: round6(row.rampMultiplier),
    seasonalityMultiplier: round6(row.seasonalityMultiplier),
    streams: row.streams.map((stream) => ({
      key: stream.key,
      units: round2(stream.units),
      revenue: round2(stream.revenue),
      variableCosts: round2(stream.variableCosts),
    })),
    ...roundFlows(row),
    netWorkingCapital: round2(row.netWorkingCapital),
    cumulativeCash: round2(row.cumulativeCash),
    loanBalance: round2(row.loanBalance),
  }));

  return {
    engineVersion: ENGINE_VERSION,
    inputHash: hashCanonical(input),
    currency: 'INR',
    horizonMonths: H,
    preOperatingMonths: P,
    initialInvestment: {
      capex: round2(capexTotal),
      contingency: round2(contingency),
      preOperativeExpenses: round2(preOperativeExpenses),
      deposits: round2(depositsTotal),
      refundableDeposits: round2(refundableDeposits),
      preOperatingCosts: round2(preOperatingCosts),
      preOperatingCostsBreakdown: {
        fixedCosts: round2(preOpFixed),
        staffCosts: round2(preOpStaff),
        interest: round2(preOpInterest),
      },
      total: round2(initialInvestmentTotal),
    },
    funding: {
      loan: round2(loanPrincipal),
      subsidy: round2(subsidy ? subsidy.amount : 0),
      ownerEquityUpfront: round2(ownerEquityUpfront),
    },
    monthly,
    annual,
    summary: {
      steadyState,
      breakEven: {
        monthlyRevenueRequired: beAfter.level.monthlyRevenueRequired,
        pctOfSteadyStateRevenue: beAfter.level.pctOfSteadyStateRevenue,
        beforeOwnerCompensation: beBefore.level,
        afterOwnerCompensation: beAfter.level,
        afterOwnerCompensationAndLoanEmi: beAfterEmi.level,
        components: {
          fixedCosts: round2(steadyLine.fixedCosts),
          staffCosts: round2(steadyLine.staffCosts),
          loanInterest: round2(loanInterestForBreakEven),
          loanEmi: round2(loanEmiForBreakEven),
          ownerCompensation: round2(steadyLine.ownerCompensation),
          contributionMarginPct: pctOf(ssContribution),
        },
        firstOperatingMonthEbitdaPositive: firstEbitdaPositive,
        firstOperatingMonthProfitAfterOwnerCompPositive: firstAfterOwnerPositive,
        firstOperatingMonthNetCashPositive: firstNetCashPositive,
      },
      capitalRecovery: {
        paybackOperatingMonth: paybackMonth,
        withinHorizon: paybackMonth !== null,
        paybackOperatingMonthIncludingOwnerComp: paybackMonthInclOwnerComp,
        cumulativeCashAtHorizonEnd: round2(cumulativeCash),
      },
      peakFundingNeed: peakFundingNeedRounded,
      peakFundingNeedMonthIndex: peakFundingNeedRounded > 0 ? minCashMonthIndex : null,
      totalOwnerCashRequired: round2(totalOwnerCashRequired),
      minDscr: round2OrNull(minDscr),
      avgDscr: round2OrNull(avgDscr),
      minDscrBeforeOwnerComp: round2OrNull(minDscrBeforeOwnerComp),
      avgDscrBeforeOwnerComp: round2OrNull(avgDscrBeforeOwnerComp),
      ownerIncome: {
        year1AvgMonthly: (ownerIncomeYears[0] as OwnerIncomeYear).ownerIncomeAvgMonthly,
        year2AvgMonthly: (ownerIncomeYears[1] as OwnerIncomeYear).ownerIncomeAvgMonthly,
        year3AvgMonthly: (ownerIncomeYears[2] as OwnerIncomeYear).ownerIncomeAvgMonthly,
        components: ownerIncomeYears,
      },
      totals: {
        revenue: round2(totalOf('revenue')),
        operatingProfitBeforeOwnerComp: round2(totalOf('operatingProfitBeforeOwnerComp')),
        ownerCompensation: round2(totalOf('ownerCompensation')),
        depreciation: round2(totalOf('depreciation')),
        amortisation: round2(totalOf('amortisation')),
        interest: round2(totalOf('interest')),
        tax: round2(totalOf('tax')),
        netProfit: round2(totalOf('netProfit')),
        netCashFlow: round2(totalOf('netCashFlow')),
      },
      loanBalanceAtHorizonEnd: round2(loanBalanceAtHorizonEnd),
    },
    closure: closureResult,
    warnings,
  };
}
