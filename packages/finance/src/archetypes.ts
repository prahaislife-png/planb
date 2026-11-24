import type { DriverKind } from './schema';

/**
 * Metadata describing each revenue-driver archetype. Used to seed
 * `financial_model_templates` and to render input forms. Purely descriptive:
 * it contains no business data and no default values.
 */
export interface ArchetypeParameter {
  key: string;
  label: string;
  /** Unit of the value as the engine expects it. */
  unit: string;
  role: 'volume' | 'capacity' | 'ratio' | 'price' | 'time' | 'calendar';
  valueType: 'number' | 'integer' | 'fraction_0_1' | 'calendar_months';
  min: number;
  max: number | null;
  description: string;
}

export interface Archetype {
  /** Equals the `driver.kind` discriminator. */
  key: DriverKind;
  label: string;
  description: string;
  /** Human-readable steady-state formula. */
  formula: string;
  /** What one "unit" means for this archetype (basis of `per_unit` variable costs). */
  unitOfVolume: string;
  /** The parameter scaled by 'volume' scenario adjustments. */
  volumeParameter: string;
  /** The parameter scaled by 'price' scenario adjustments. */
  priceParameter: string;
  /** True when volume is physically capped at 100 % of a stated capacity. */
  capacityBound: boolean;
  /** Whether ramp-up and seasonality multipliers apply to this archetype by default. */
  rampAndSeasonalityApply: boolean;
  requiredParameters: ArchetypeParameter[];
  typicalUses: string[];
}

export const ARCHETYPES: readonly Archetype[] = [
  {
    key: 'transactions',
    label: 'Daily transactions × average ticket',
    description: 'Walk-in or order-based businesses where revenue is the number of bills times the average bill value.',
    formula: 'units/month = transactionsPerDay × operatingDaysPerMonth; revenue = units × averageTicket',
    unitOfVolume: 'transaction (bill)',
    volumeParameter: 'transactionsPerDay',
    priceParameter: 'averageTicket',
    capacityBound: false,
    rampAndSeasonalityApply: true,
    requiredParameters: [
      { key: 'transactionsPerDay', label: 'Transactions per operating day', unit: 'transactions/day', role: 'volume', valueType: 'number', min: 0, max: null, description: 'Average number of paid bills per operating day at steady state.' },
      { key: 'operatingDaysPerMonth', label: 'Operating days per month', unit: 'days/month', role: 'time', valueType: 'number', min: 0, max: 31, description: 'Days the business is open in an average month.' },
      { key: 'averageTicket', label: 'Average ticket', unit: 'INR/transaction', role: 'price', valueType: 'number', min: 0, max: null, description: 'Average bill value net of discounts, excluding GST.' },
    ],
    typicalUses: ['cafés and food outlets', 'retail shops', 'salons'],
  },
  {
    key: 'capacity_utilization',
    label: 'Installed capacity × utilisation',
    description: 'Production or processing units with an installed monthly capacity, of which a fraction is used and sold.',
    formula: 'units/month = capacityUnitsPerMonth × utilization; revenue = units × unitPrice',
    unitOfVolume: 'unit of output (piece, kg, litre …)',
    volumeParameter: 'utilization',
    priceParameter: 'unitPrice',
    capacityBound: true,
    rampAndSeasonalityApply: true,
    requiredParameters: [
      { key: 'capacityUnitsPerMonth', label: 'Installed capacity per month', unit: 'units/month', role: 'capacity', valueType: 'number', min: 0, max: null, description: 'Maximum sellable output per month at 100 % utilisation.' },
      { key: 'utilization', label: 'Capacity utilisation', unit: 'fraction (0–1)', role: 'ratio', valueType: 'fraction_0_1', min: 0, max: 1, description: 'Share of capacity produced and sold at steady state.' },
      { key: 'unitPrice', label: 'Selling price per unit', unit: 'INR/unit', role: 'price', valueType: 'number', min: 0, max: null, description: 'Net realised price per unit, excluding GST.' },
    ],
    typicalUses: ['small manufacturing units', 'laundries (kg)', 'food processing'],
  },
  {
    key: 'area_yield',
    label: 'Cultivated area × yield per cycle',
    description: 'Agriculture and allied activities: one harvest cycle is sold in each listed calendar month; other months have no revenue.',
    formula: 'units/cycle = area × yieldPerAreaPerCycle; revenue = units × pricePerUnit, recognised in each of harvestCalendarMonths',
    unitOfVolume: 'unit of produce (kg, quintal, litre …)',
    volumeParameter: 'yieldPerAreaPerCycle',
    priceParameter: 'pricePerUnit',
    capacityBound: false,
    rampAndSeasonalityApply: false,
    requiredParameters: [
      { key: 'area', label: 'Cultivated area', unit: 'area units (acre, sq m …)', role: 'capacity', valueType: 'number', min: 0, max: null, description: 'Area under cultivation.' },
      { key: 'yieldPerAreaPerCycle', label: 'Yield per area unit per cycle', unit: 'produce units/area unit/cycle', role: 'volume', valueType: 'number', min: 0, max: null, description: 'Saleable yield of one harvest cycle per unit of area.' },
      { key: 'pricePerUnit', label: 'Price per unit of produce', unit: 'INR/produce unit', role: 'price', valueType: 'number', min: 0, max: null, description: 'Net realised farm-gate price.' },
      { key: 'harvestCalendarMonths', label: 'Harvest calendar months', unit: 'calendar months (1–12)', role: 'calendar', valueType: 'calendar_months', min: 1, max: 12, description: 'Calendar months in which one full cycle is harvested and sold.' },
    ],
    typicalUses: ['field crops', 'horticulture', 'polyhouse cultivation'],
  },
  {
    key: 'enrolment',
    label: 'Student capacity × enrolment rate',
    description: 'Education and training businesses billed per enrolled student per month.',
    formula: 'units/month = capacityStudents × enrolmentRate; revenue = units × feePerStudentPerMonth',
    unitOfVolume: 'student-month',
    volumeParameter: 'enrolmentRate',
    priceParameter: 'feePerStudentPerMonth',
    capacityBound: true,
    rampAndSeasonalityApply: true,
    requiredParameters: [
      { key: 'capacityStudents', label: 'Student capacity', unit: 'students', role: 'capacity', valueType: 'number', min: 0, max: null, description: 'Maximum number of students that can be enrolled at once.' },
      { key: 'enrolmentRate', label: 'Enrolment rate', unit: 'fraction (0–1)', role: 'ratio', valueType: 'fraction_0_1', min: 0, max: 1, description: 'Share of capacity enrolled at steady state.' },
      { key: 'feePerStudentPerMonth', label: 'Fee per student per month', unit: 'INR/student/month', role: 'price', valueType: 'number', min: 0, max: null, description: 'Average net fee collected per enrolled student per month.' },
    ],
    typicalUses: ['coaching centres', 'pre-schools', 'skill-training institutes'],
  },
  {
    key: 'occupancy',
    label: 'Rentable area × occupancy',
    description: 'Space-rental businesses billed per unit of occupied area per month.',
    formula: 'units/month = rentableArea × occupancy; revenue = units × ratePerAreaPerMonth',
    unitOfVolume: 'occupied area unit-month (sq ft, pallet position …)',
    volumeParameter: 'occupancy',
    priceParameter: 'ratePerAreaPerMonth',
    capacityBound: true,
    rampAndSeasonalityApply: true,
    requiredParameters: [
      { key: 'rentableArea', label: 'Rentable area', unit: 'area units', role: 'capacity', valueType: 'number', min: 0, max: null, description: 'Total area (or positions) available to rent.' },
      { key: 'occupancy', label: 'Occupancy', unit: 'fraction (0–1)', role: 'ratio', valueType: 'fraction_0_1', min: 0, max: 1, description: 'Share of rentable area occupied and billed at steady state.' },
      { key: 'ratePerAreaPerMonth', label: 'Rate per area unit per month', unit: 'INR/area unit/month', role: 'price', valueType: 'number', min: 0, max: null, description: 'Net rental rate.' },
    ],
    typicalUses: ['warehousing', 'cold storage', 'co-working space'],
  },
  {
    key: 'fleet_utilization',
    label: 'Fleet size × billable days × utilisation',
    description: 'Equipment or vehicle rental billed per unit per day.',
    formula: 'units/month = unitCount × billableDaysPerMonth × utilization; revenue = units × ratePerUnitPerDay',
    unitOfVolume: 'billed unit-day',
    volumeParameter: 'utilization',
    priceParameter: 'ratePerUnitPerDay',
    capacityBound: true,
    rampAndSeasonalityApply: true,
    requiredParameters: [
      { key: 'unitCount', label: 'Number of rental units', unit: 'units', role: 'capacity', valueType: 'number', min: 0, max: null, description: 'Machines / vehicles available for hire.' },
      { key: 'billableDaysPerMonth', label: 'Billable days per month', unit: 'days/month', role: 'time', valueType: 'number', min: 0, max: 31, description: 'Days per month a unit could be on hire.' },
      { key: 'utilization', label: 'Utilisation', unit: 'fraction (0–1)', role: 'ratio', valueType: 'fraction_0_1', min: 0, max: 1, description: 'Share of billable unit-days actually hired at steady state.' },
      { key: 'ratePerUnitPerDay', label: 'Rate per unit per day', unit: 'INR/unit/day', role: 'price', valueType: 'number', min: 0, max: null, description: 'Net hire rate per unit per day.' },
    ],
    typicalUses: ['construction-equipment rental', 'farm-machinery hiring centres', 'vehicle rental'],
  },
  {
    key: 'engagements',
    label: 'Engagements × realised fee',
    description: 'Professional and project-based services billed per engagement.',
    formula: 'units/month = engagementsPerMonth; revenue = units × realizedFee',
    unitOfVolume: 'engagement (project / assignment)',
    volumeParameter: 'engagementsPerMonth',
    priceParameter: 'realizedFee',
    capacityBound: false,
    rampAndSeasonalityApply: true,
    requiredParameters: [
      { key: 'engagementsPerMonth', label: 'Engagements per month', unit: 'engagements/month', role: 'volume', valueType: 'number', min: 0, max: null, description: 'Billable engagements completed per month at steady state.' },
      { key: 'realizedFee', label: 'Realised fee per engagement', unit: 'INR/engagement', role: 'price', valueType: 'number', min: 0, max: null, description: 'Average fee actually collected per engagement, after discounts and write-offs.' },
    ],
    typicalUses: ['consulting and accounting practices', 'design studios', 'repair and installation services'],
  },
] as const;
