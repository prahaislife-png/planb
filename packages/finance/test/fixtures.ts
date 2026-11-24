import type { ModelInput } from '../src/index';

/**
 * SYNTHETIC test fixtures.
 *
 * Every number below is an obviously round, made-up value chosen so that the
 * expected results can be computed by hand. They are NOT data about any real
 * business, sector or location and must never be shown to users as such.
 */

/** (a) Café — `transactions` driver, ramp-up, pre-operating months, working capital, proprietor drawings. */
export const SYNTHETIC_CAFE: ModelInput = {
  horizonMonths: 24,
  preOperatingMonths: 2,
  startCalendarMonth: 1,
  capex: [
    { key: 'interiors', label: 'SYNTHETIC interiors', amount: 600_000, category: 'interiors', usefulLifeYears: 5 },
    { key: 'kitchen', label: 'SYNTHETIC kitchen equipment', amount: 360_000, category: 'equipment', usefulLifeYears: 6 },
  ],
  contingencyPct: 5,
  preOperativeExpenses: [{ key: 'licences', label: 'SYNTHETIC licences', amount: 72_000 }],
  deposits: [{ key: 'rent_deposit', label: 'SYNTHETIC rent deposit', amount: 150_000, refundable: true }],
  revenueStreams: [
    {
      key: 'counter',
      label: 'SYNTHETIC counter sales',
      driver: { kind: 'transactions', transactionsPerDay: 100, operatingDaysPerMonth: 30, averageTicket: 200 },
      variableCosts: [
        { key: 'ingredients', label: 'Ingredients', basis: 'pct_of_revenue', value: 35, classification: 'cogs' },
        { key: 'packaging', label: 'Packaging', basis: 'per_unit', value: 10, classification: 'cogs' },
        { key: 'payment_fees', label: 'Payment fees', basis: 'pct_of_revenue', value: 2, classification: 'operating' },
      ],
    },
  ],
  rampUp: { startPct: 50, monthsToSteadyState: 5 },
  fixedCosts: [
    { key: 'rent', label: 'Rent', category: 'rent', monthlyAmount: 50_000, accruesDuringPreOperating: true, classification: 'operating' },
    { key: 'utilities', label: 'Utilities', category: 'utilities', monthlyAmount: 20_000, classification: 'operating' },
  ],
  staff: [
    { key: 'crew', role: 'Crew', count: 4, monthlySalary: 15_000, classification: 'operating', startsPreOperatingMonthsBefore: 1 },
  ],
  owner: { monthlyCompensation: 40_000, treatment: 'drawings' },
  workingCapital: { inventoryDays: 6, receivableDays: 0, payableDays: 3 },
};

/** (b) Manufacturing unit — `capacity_utilization`, term loan with moratorium, back-ended subsidy, flat tax. */
export const SYNTHETIC_MANUFACTURING: ModelInput = {
  horizonMonths: 36,
  preOperatingMonths: 3,
  startCalendarMonth: 4,
  capex: [
    { key: 'machinery', label: 'SYNTHETIC machinery', amount: 1_200_000, category: 'machinery', usefulLifeYears: 10, salvagePct: 10 },
    { key: 'shed', label: 'SYNTHETIC shed', amount: 600_000, category: 'building_civil', usefulLifeYears: 25 },
  ],
  preOperativeExpenses: [{ key: 'setup', label: 'SYNTHETIC licences and trials', amount: 180_000 }],
  deposits: [{ key: 'power_deposit', label: 'SYNTHETIC electricity deposit', amount: 50_000, refundable: true }],
  revenueStreams: [
    {
      key: 'widgets',
      label: 'SYNTHETIC widgets',
      driver: { kind: 'capacity_utilization', capacityUnitsPerMonth: 10_000, utilization: 0.8, unitPrice: 100 },
      variableCosts: [
        { key: 'raw_material', label: 'Raw material', basis: 'per_unit', value: 50, classification: 'cogs' },
        { key: 'power', label: 'Power', basis: 'per_unit', value: 5, classification: 'cogs' },
        { key: 'commission', label: 'Sales commission', basis: 'pct_of_revenue', value: 5, classification: 'operating' },
      ],
    },
  ],
  rampUp: { startPct: 40, monthsToSteadyState: 3 },
  fixedCosts: [
    { key: 'rent', label: 'Rent', category: 'rent', monthlyAmount: 40_000, accruesDuringPreOperating: true, classification: 'operating' },
    { key: 'maintenance', label: 'Maintenance', category: 'maintenance', monthlyAmount: 10_000, classification: 'cogs' },
  ],
  staff: [
    { key: 'operators', role: 'Machine operators', count: 5, monthlySalary: 12_000, classification: 'cogs' },
    { key: 'admin', role: 'Administrator', count: 1, monthlySalary: 20_000, classification: 'operating' },
  ],
  owner: { monthlyCompensation: 50_000, treatment: 'salary_expense' },
  workingCapital: { inventoryDays: 15, receivableDays: 30, payableDays: 15 },
  financing: {
    loan: { principal: 1_200_000, annualInterestPct: 12, tenureMonths: 30, moratoriumMonths: 6 },
    subsidy: { amount: 300_000, receivedOperatingMonth: 12, treatment: 'reduces_loan_principal' },
  },
  tax: { kind: 'flat_rate', ratePct: 25, carryForwardLosses: true },
};

/** (c) Seasonal farm — `area_yield`, two harvests a year, operations start in June. */
export const SYNTHETIC_FARM: ModelInput = {
  horizonMonths: 24,
  preOperatingMonths: 0,
  startCalendarMonth: 6,
  capex: [
    { key: 'irrigation', label: 'SYNTHETIC irrigation set', amount: 120_000, category: 'equipment', usefulLifeYears: 10 },
  ],
  revenueStreams: [
    {
      key: 'crop',
      label: 'SYNTHETIC crop',
      driver: {
        kind: 'area_yield',
        area: 2,
        yieldPerAreaPerCycle: 1_000,
        pricePerUnit: 150,
        harvestCalendarMonths: [10, 3],
      },
      variableCosts: [
        { key: 'harvest_packing', label: 'Harvest and packing', basis: 'per_unit', value: 10, classification: 'cogs' },
        { key: 'market_commission', label: 'Market commission', basis: 'pct_of_revenue', value: 5, classification: 'operating' },
      ],
    },
  ],
  // deliberately present: must NOT affect an area_yield stream (applyToAreaYield defaults to false)
  rampUp: { startPct: 50, monthsToSteadyState: 6 },
  fixedCosts: [
    { key: 'lease', label: 'Land lease', category: 'rent', monthlyAmount: 5_000, classification: 'operating' },
    { key: 'inputs', label: 'Seeds, fertiliser, water', category: 'other', monthlyAmount: 8_000, classification: 'cogs' },
  ],
  staff: [{ key: 'helper', role: 'Farm helper', count: 1, monthlySalary: 6_000, classification: 'cogs' }],
  owner: { monthlyCompensation: 5_000, treatment: 'drawings' },
};

/** (d) Equipment rental — `fleet_utilization`, price and cost escalation, equipment replaced inside the horizon. */
export const SYNTHETIC_RENTAL: ModelInput = {
  horizonMonths: 36,
  capex: [
    { key: 'machines', label: 'SYNTHETIC rental machines', amount: 240_000, category: 'equipment', usefulLifeYears: 2, salvagePct: 10 },
    { key: 'van', label: 'SYNTHETIC delivery van', amount: 300_000, category: 'vehicle', usefulLifeYears: 5, salvagePct: 20 },
  ],
  revenueStreams: [
    {
      key: 'hire',
      label: 'SYNTHETIC machine hire',
      driver: { kind: 'fleet_utilization', unitCount: 10, billableDaysPerMonth: 20, utilization: 0.5, ratePerUnitPerDay: 1_000 },
      variableCosts: [
        { key: 'servicing', label: 'Servicing per hire-day', basis: 'per_unit', value: 100, classification: 'cogs' },
      ],
    },
  ],
  fixedCosts: [
    { key: 'yard_rent', label: 'Yard rent (fixed by contract)', category: 'rent', monthlyAmount: 10_000, annualEscalationPct: 0, classification: 'operating' },
    { key: 'insurance', label: 'Insurance', category: 'insurance', monthlyAmount: 5_000, classification: 'operating' },
  ],
  staff: [
    { key: 'technician', role: 'Technician', count: 1, monthlySalary: 20_000, annualEscalationPct: 5, classification: 'operating' },
  ],
  owner: { monthlyCompensation: 20_000, treatment: 'drawings' },
  priceEscalationPctAnnual: 5,
  costInflationPctAnnual: 10,
};

/** Minimal valid input used by validation and invariant tests. */
export const SYNTHETIC_MINIMAL: ModelInput = {
  revenueStreams: [
    {
      key: 'services',
      label: 'SYNTHETIC services',
      driver: { kind: 'engagements', engagementsPerMonth: 10, realizedFee: 10_000 },
    },
  ],
  owner: { monthlyCompensation: 0, treatment: 'drawings' },
};

export const ALL_SYNTHETIC: Record<string, ModelInput> = {
  SYNTHETIC_CAFE,
  SYNTHETIC_MANUFACTURING,
  SYNTHETIC_FARM,
  SYNTHETIC_RENTAL,
  SYNTHETIC_MINIMAL,
};
