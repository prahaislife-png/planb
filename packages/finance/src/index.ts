/**
 * @planb/finance — deterministic financial modelling engine.
 *
 * Pure functions only: no I/O, no clock, no randomness, no LLM.
 * Specification: packages/finance/docs/FINANCE_ENGINE.md
 */
export { ENGINE_VERSION, ENGINE_NAME } from './version';

export {
  runModel,
  computeModel,
  hashModelInput,
  rampMultiplier,
  escalationFactor,
  calendarMonthOf,
  yearIndexOf,
  levelPayment,
} from './engine';

export {
  ModelInputSchema,
  CapexItemSchema,
  RevenueStreamSchema,
  DriverSchema,
  VariableCostSchema,
  FixedCostSchema,
  StaffSchema,
  OwnerSchema,
  WorkingCapitalSchema,
  LoanSchema,
  SubsidySchema,
  FinancingSchema,
  TaxSchema,
  ClosureSchema,
  RampUpSchema,
  SeasonalitySchema,
  ModelValidationError,
  parseModelInput,
  validateModelInput,
  CAPEX_CATEGORIES,
  FIXED_COST_CATEGORIES,
  DRIVER_KINDS,
  MIN_HORIZON_MONTHS,
  MAX_HORIZON_MONTHS,
  MAX_PRE_OPERATING_MONTHS,
  PRE_OPERATIVE_AMORTISATION_MONTHS,
  MAX_AMOUNT,
} from './schema';
export type {
  ModelInput,
  ValidatedModelInput,
  ValidationIssue,
  CapexItem,
  CapexCategory,
  RevenueStream,
  Driver,
  DriverKind,
  VariableCost,
  FixedCost,
  FixedCostCategory,
  StaffRole,
  Owner,
  Loan,
  Subsidy,
  TaxConfig,
  Closure,
  CostClassification,
} from './schema';

export type {
  ModelResult,
  MonthlyRow,
  AnnualRow,
  FlowFields,
  StreamMonth,
  MonthPhase,
  InitialInvestment,
  Funding,
  Summary,
  SteadyState,
  SteadyStateStream,
  BreakEven,
  BreakEvenLevel,
  CapitalRecovery,
  OwnerIncome,
  OwnerIncomeYear,
  Totals,
  ClosureResult,
  ModelWarning,
  WarningCode,
  WarningSeverity,
} from './types';

export {
  applyOverrides,
  applyAdjustments,
  runScenarios,
  DEFAULT_SCENARIOS,
  DEFAULT_STRESS_TESTS,
  AdjustmentSchema,
  ScenarioSpecSchema,
  ScenarioSpecsSchema,
  ADJUSTMENT_TARGETS,
  SCENARIO_KINDS,
  volumeParameterOf,
  priceParameterOf,
} from './scenarios';
export type {
  Adjustment,
  NumericAdjustment,
  ClosureAdjustment,
  AdjustmentTarget,
  AdjustmentOp,
  ScenarioSpec,
  ScenarioKind,
  ScenarioRun,
  AppliedAdjustments,
  ValidatedAdjustment,
  ValidatedScenarioSpec,
} from './scenarios';

export {
  sensitivity,
  metricValue,
  SENSITIVITY_PARAMS,
  SENSITIVITY_METRICS,
  DEFAULT_SENSITIVITY_PARAMS,
  DEFAULT_SENSITIVITY_DELTAS,
} from './sensitivity';
export type {
  SensitivityParam,
  SensitivityMetric,
  SensitivityPoint,
  SensitivityRow,
  SensitivityResult,
} from './sensitivity';

export { ARCHETYPES } from './archetypes';
export type { Archetype, ArchetypeParameter } from './archetypes';

export { round2, roundTo } from './round';
export { canonicalJson, hashCanonical } from './canonical';
export { sha256Hex } from './sha256';
