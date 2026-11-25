import type { BusinessSnapshot, PersonProfile, SnapshotScenario } from '../src/index';

/**
 * SYNTHETIC test fixtures.
 *
 * Every number below is an obviously round, made-up value chosen so that each rule's outcome can be worked out by
 * hand. They are NOT data about any real business, sector, person or location and must never be shown as such.
 */

interface ScenarioNumbers {
  key: string;
  kind: string;
  label: string;
  loan?: number;
  upfront?: number;
  trough?: number;
  totalCash?: number;
  firstCashPositive?: number | null;
  income?: [number | null, number | null, number | null];
  payback?: number | null;
  minDscr?: number | null;
  closure?: { month: number; lost: number };
  local?: { local: number; inherited: number; byLevel?: Record<string, number> };
}

export function syntheticScenario(n: ScenarioNumbers): SnapshotScenario {
  const upfront = n.upfront ?? 600_000;
  const trough = n.trough ?? 200_000;
  return {
    scenario_key: n.key,
    kind: n.kind,
    label: n.label,
    summary: {
      initialInvestment: { total: upfront + (n.loan ?? 400_000) },
      funding: { loan: n.loan ?? 400_000, ownerEquityUpfront: upfront },
      summary: {
        breakEven: { firstOperatingMonthNetCashPositive: n.firstCashPositive === undefined ? 4 : n.firstCashPositive },
        capitalRecovery: { paybackOperatingMonth: n.payback === undefined ? 30 : n.payback },
        peakFundingNeed: trough,
        totalOwnerCashRequired: n.totalCash ?? upfront + trough,
        minDscr: n.minDscr === undefined ? 1.5 : n.minDscr,
        ownerIncome: {
          year1AvgMonthly: (n.income ?? [10_000, 40_000, 60_000])[0],
          year2AvgMonthly: (n.income ?? [10_000, 40_000, 60_000])[1],
          year3AvgMonthly: (n.income ?? [10_000, 40_000, 60_000])[2],
        },
      },
      closure: n.closure ? { atOperatingMonth: n.closure.month, ownerCapitalLost: n.closure.lost } : null,
      ...(n.local ? { locationCoverage: { local_inputs: n.local.local, inherited_national_inputs: n.local.inherited, by_level: n.local.byLevel ?? { city: n.local.local } } } : {}),
    },
    warnings: [{ code: 'RESULTS_ARE_PRE_TAX' }],
    grade_profile: { A: 10, B: 10, C: 18, D: 2, observed: 34, derived: 4, assumptions: 2 },
    assumption_count: 2,
    weakest_grade: 'D',
  };
}

/** National base: needs 8,00,000 of owner cash (6,00,000 upfront + 2,00,000 trough) beside a 4,00,000 loan. */
export const SYNTHETIC_BASE = (): SnapshotScenario => syntheticScenario({ key: 'base', kind: 'base', label: 'SYNTHETIC base' });
export const SYNTHETIC_CLOSURE_12 = (): SnapshotScenario =>
  syntheticScenario({ key: 'failure_closure_month_12', kind: 'failure', label: 'SYNTHETIC closure after month 12', closure: { month: 12, lost: 300_000 } });
export const SYNTHETIC_CLOSURE_24 = (): SnapshotScenario =>
  syntheticScenario({ key: 'failure_closure_month_24', kind: 'failure', label: 'SYNTHETIC closure after month 24', closure: { month: 24, lost: 100_000 } });
export const SYNTHETIC_STRESS_20 = (): SnapshotScenario =>
  syntheticScenario({ key: 'stress_revenue_minus_20', kind: 'stress', label: 'SYNTHETIC revenue −20%', income: [-10_000, 10_000, 20_000] });
/** A local case for "Synthetic City": 20 of 40 inputs local, needs 9,00,000 of owner cash. */
export const SYNTHETIC_LOCAL = (local = 20, inherited = 20): SnapshotScenario =>
  syntheticScenario({ key: 'base', kind: 'base', label: 'Base case — Synthetic City', upfront: 650_000, trough: 250_000, income: [5_000, 35_000, 55_000], local: { local, inherited } });

/** A record in which every section the engine reads has been researched. */
export function SYNTHETIC_FULL_RECORD(): BusinessSnapshot {
  return {
    model: {
      slug: 'synthetic-widget-workshop',
      name: 'SYNTHETIC widget workshop',
      family: 'widgets',
      industry: { slug: 'synthetic-industry', name: 'Synthetic manufacturing' },
      description: 'A made-up workshop that assembles gadgets for testing the matching rules.',
      operating_model: 'Buys parts, assembles gizmos, sells to retailers.',
      target_customers: 'Imaginary retailers',
      classifications: [{ title: 'Manufacture of synthetic test articles' }],
    },
    variants: [
      {
        name: 'SYNTHETIC reference variant',
        slug: 'synthetic-reference',
        is_reference: true,
        cost_items: [{ observations: [{ observed_on: '2025-01-01', evidence_type: 'supplier_quotation', source: 'SYNTHETIC source one' }] }],
        parameters: [{ key: 'pre_operating_months', value: 2, basis: 'observation', is_resolved: true }],
        operating_requirements: [{ type: 'built_up_space', name: 'Built-up area', value: 1000, unit: 'sq_ft', text: null, is_critical: false }],
        lifestyle: {
          owner_involvement: 'full_time_managerial',
          owner_hours_per_week_low: 40,
          owner_hours_per_week_high: 50,
          weekend_work: 'occasional',
          physical_demand: 2,
          operational_complexity: 2,
          basis: 'owner_interviews',
          evidence_grade: 'B',
        },
        assets: [
          { asset_type_slug: 'commercial-shop', name: 'Commercial shop', requirement_level: 'required' },
          { asset_type_slug: 'vehicle-car', name: 'Car', requirement_level: 'advantage' },
        ],
        scenarios: [SYNTHETIC_BASE(), SYNTHETIC_CLOSURE_12(), SYNTHETIC_CLOSURE_24(), SYNTHETIC_STRESS_20()],
      },
      { name: 'SYNTHETIC larger variant', slug: 'synthetic-larger', is_reference: false, scenarios: [syntheticScenario({ key: 'base', kind: 'base', label: 'SYNTHETIC larger base', upfront: 5_000_000 })] },
    ],
    skills: [
      { slug: 'sales', name: 'Sales', importance: 5, acquisition: 'needed_at_start' },
      { slug: 'food-safety', name: 'Food safety', importance: 4, acquisition: 'learnable' },
      { slug: 'people-management', name: 'People management', importance: 3, acquisition: 'hireable' },
      { slug: 'data-analysis', name: 'Data analysis', importance: 2, acquisition: 'learnable' },
    ],
    founder_requirements: {
      mandatory_qualifications: 'SYNTHETIC diploma in widget making',
      certifications: 'None',
      training_duration_weeks: 8,
      learning_difficulty: 2,
      basis: 'evidence',
      evidence_grade: 'B',
    },
    regulations: [{ name: 'SYNTHETIC trade licence', applicability: 'mandatory', stage: 'pre_launch' }],
    risks: [
      { type: 'market', title: 'SYNTHETIC demand risk', severity: 'high' },
      { type: 'supply', title: 'SYNTHETIC supply risk', severity: 'medium' },
      { type: 'capital_loss', title: 'SYNTHETIC capital loss', severity: 'low' },
    ],
    quality: {
      completeness: { completeness_pct: 90, critical_missing: 0, critical_missing_checks: [], missing_checks: [], checks_total: 25, checks_passed: 23 },
      evidence: {
        grade_a: 10, grade_b: 10, grade_c: 0, grade_d: 0, observation_count: 20, verified_count: 20, stale_count: 0, open_conflicts: 0,
        assumption_count: 2, parameter_count: 40, claims_pending_review: 0, distinct_sources: 4,
      },
    },
  };
}

/**
 * The shape of today's records: costs and scenarios exist, every qualitative section is EMPTY
 * (no skills, lifestyle, founder requirements, risks, regulations, assets, local scenarios) and all the
 * evidence is single-source grade C.
 */
export function SYNTHETIC_BARE_RECORD(): BusinessSnapshot {
  return {
    model: {
      slug: 'synthetic-bare-unit',
      name: 'SYNTHETIC bare unit',
      family: 'bare',
      industry: { slug: 'synthetic-industry', name: 'Synthetic manufacturing' },
      description: null,
      operating_model: null,
      target_customers: null,
      classifications: [],
    },
    variants: [
      {
        name: 'SYNTHETIC bare variant',
        slug: 'synthetic-bare',
        is_reference: true,
        cost_items: [{ observations: [{ observed_on: '2021-01-01', evidence_type: 'government_project_report', source: 'SYNTHETIC single report' }] }],
        parameters: [{ key: 'pre_operating_months', value: 3, basis: 'assumption', is_resolved: true }],
        operating_requirements: [],
        lifestyle: null,
        scenarios: [SYNTHETIC_BASE(), SYNTHETIC_CLOSURE_12(), SYNTHETIC_STRESS_20()],
      },
    ],
    skills: [],
    founder_requirements: null,
    regulations: [],
    risks: [],
    quality: {
      completeness: { completeness_pct: 55, critical_missing: 2, critical_missing_checks: ['identity.description', 'regulatory.mapping'], missing_checks: ['founder.skills'], checks_total: 25, checks_passed: 12 },
      evidence: {
        grade_a: 0, grade_b: 0, grade_c: 30, grade_d: 0, observation_count: 30, verified_count: 0, stale_count: 30, open_conflicts: 0,
        assumption_count: 5, parameter_count: 40, claims_pending_review: 50, distinct_sources: 1,
      },
    },
  };
}

/** A person for whom SYNTHETIC_FULL_RECORD passes every check: 15,00,000 capital − 3,00,000 reserve = 12,00,000 deployable. */
export function SYNTHETIC_PROFILE(): PersonProfile {
  return {
    investableCapitalInr: 1_500_000,
    reserveRequirementInr: 300_000,
    monthlyIncomeGoalInr: 50_000,
    currentMonthlyIncomeInr: 60_000,
    riskTolerance: 'moderate',
    desiredInvolvement: 'full_time_managerial',
    maxHoursPerWeek: 50,
    weekendWorkOk: true,
    physicalWorkTolerance: 3,
    transitionTimelineMonths: 12,
    preferredLocationSlug: null,
    preferredLocationName: null,
    interests: ['widgets'],
    capabilities: [
      { skillSlug: 'sales', proficiency: 4 },
      { skillSlug: 'food-safety', proficiency: 3 },
    ],
    assets: [{ assetTypeSlug: 'commercial-shop' }],
    qualificationsHeld: ['SYNTHETIC diploma in widget making'],
    willingToTakeLoan: true,
  };
}

/** The reference variant of a record built by the functions above. */
export function referenceVariant(record: BusinessSnapshot) {
  const v = record.variants?.find((x) => x.is_reference);
  if (!v) throw new Error('fixture has no reference variant');
  return v;
}

export function scenarioByKey(record: BusinessSnapshot, key: string): SnapshotScenario {
  const s = referenceVariant(record).scenarios?.find((x) => x.scenario_key === key && !x.summary?.locationCoverage);
  if (!s) throw new Error(`fixture has no scenario ${key}`);
  return s;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}
