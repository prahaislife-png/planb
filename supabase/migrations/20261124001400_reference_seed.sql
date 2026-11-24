-- PlanB · 0014 · Reference data the system needs in order to function.
-- Vocabulary only: units, taxonomy roots, cost chart, parameter definitions, questionnaires, policy.
-- No business facts, prices or market data are seeded here — those only ever enter through research.
-- Every statement is an idempotent upsert so the migration can be re-applied safely.

-- ── Units ────────────────────────────────────────────────────────────────────
insert into intel.units (code, name, dimension, base_unit, to_base_factor) values
  ('each', 'Each / number', 'count', null, null),
  ('kg', 'Kilogram', 'mass', null, null),
  ('litre', 'Litre', 'volume', null, null),
  ('sq_m', 'Square metre', 'area', null, null),
  ('m', 'Metre', 'length', null, null),
  ('kw', 'Kilowatt', 'power', null, null),
  ('kwh', 'Kilowatt-hour', 'energy', null, null),
  ('day', 'Day', 'time', null, null),
  ('inr', 'Indian rupee', 'currency', null, null),
  ('percent', 'Percent', 'ratio', null, null)
on conflict (code) do nothing;
insert into intel.units (code, name, dimension, base_unit, to_base_factor) values
  ('dozen', 'Dozen', 'count', 'each', 12),
  ('g', 'Gram', 'mass', 'kg', 0.001),
  ('quintal', 'Quintal', 'mass', 'kg', 100),
  ('tonne', 'Metric tonne', 'mass', 'kg', 1000),
  ('ml', 'Millilitre', 'volume', 'litre', 0.001),
  ('kl', 'Kilolitre', 'volume', 'litre', 1000),
  ('sq_ft', 'Square foot', 'area', 'sq_m', 0.09290304),
  ('acre', 'Acre', 'area', 'sq_m', 4046.8564224),
  ('hectare', 'Hectare', 'area', 'sq_m', 10000),
  ('guntha', 'Guntha (1/40 acre)', 'area', 'sq_m', 101.17141056),
  ('km', 'Kilometre', 'length', 'm', 1000),
  ('hp', 'Horsepower (metric conversion 0.7457 kW)', 'power', 'kw', 0.7457),
  ('hour', 'Hour', 'time', 'day', 0.0416666667),
  ('month', 'Month (30-day convention)', 'time', 'day', 30),
  ('year', 'Year (365-day convention)', 'time', 'day', 365)
on conflict (code) do nothing;

-- ── Industry taxonomy (top level) ────────────────────────────────────────────
insert into intel.industries (slug, name, sort_order) values
  ('agriculture-horticulture', 'Agriculture and horticulture', 10),
  ('livestock-fisheries', 'Livestock and fisheries', 20),
  ('food-processing', 'Food processing', 30),
  ('food-hospitality', 'Food and hospitality', 40),
  ('small-scale-manufacturing', 'Small-scale manufacturing', 50),
  ('industrial-services', 'Industrial services', 60),
  ('retail', 'Retail', 70),
  ('wholesale-distribution', 'Wholesale and distribution', 80),
  ('local-consumer-services', 'Local consumer services', 90),
  ('healthcare-related', 'Healthcare-related businesses', 100),
  ('education-training', 'Education and training', 110),
  ('automotive-services', 'Automotive services', 120),
  ('logistics-warehousing', 'Logistics and warehousing', 130),
  ('equipment-rental', 'Equipment rental', 140),
  ('construction-services', 'Construction-related services', 150),
  ('renewable-energy', 'Renewable energy', 160),
  ('sustainability-recycling', 'Sustainability and recycling', 170),
  ('professional-services', 'Professional services', 180),
  ('business-acquisitions', 'Business acquisitions', 190),
  ('franchises', 'Franchises', 200),
  ('alternative-skilled-professions', 'Alternative skilled professions', 210)
on conflict (slug) do nothing;

insert into intel.classification_systems (code, name, authority, notes) values
  ('NIC-2008', 'National Industrial Classification 2008', 'Ministry of Statistics and Programme Implementation, Government of India', 'Primary activity classification. Codes are recorded with is_verified = false until checked against the official publication.'),
  ('HSN', 'Harmonised System of Nomenclature (GST)', 'Central Board of Indirect Taxes and Customs', 'Goods classification for equipment and raw materials.'),
  ('NCO-2015', 'National Classification of Occupations 2015', 'Ministry of Labour and Employment', 'Occupation codes for alternative skilled professions.')
on conflict (code) do nothing;

-- ── Geography: India → Maharashtra → pilot districts and cities ──────────────
-- Official LGD / Census codes are intentionally NULL until verified against the Local Government Directory.
insert into intel.locations (slug, name, location_type, parent_id, iso_code) values
  ('india', 'India', 'country', null, 'IN') on conflict (slug) do nothing;
insert into intel.locations (slug, name, location_type, parent_id, iso_code)
  select 'maharashtra', 'Maharashtra', 'state', id, 'IN-MH' from intel.locations where slug = 'india'
  on conflict (slug) do nothing;
insert into intel.locations (slug, name, location_type, parent_id, is_pilot)
  select v.slug, v.name, 'district', s.id, true
  from (values ('pune-district', 'Pune district'), ('nanded-district', 'Nanded district')) v (slug, name),
       intel.locations s where s.slug = 'maharashtra'
  on conflict (slug) do nothing;
insert into intel.locations (slug, name, location_type, parent_id, tier, is_pilot, notes)
  select v.slug, v.name, 'city', d.id, v.tier, true, v.notes
  from (values
    ('pune-city', 'Pune (city)', 'pune-district', 'metro', 'Tier label is PlanB''s internal convention, not an official classification.'),
    ('nanded-city', 'Nanded-Waghala (city)', 'nanded-district', 'tier3', 'Tier label is PlanB''s internal convention, not an official classification.')
  ) v (slug, name, district_slug, tier, notes)
  join intel.locations d on d.slug = v.district_slug
  on conflict (slug) do nothing;

-- ── Cost categories ──────────────────────────────────────────────────────────
insert into intel.cost_categories (slug, name, cost_class, engine_category, default_useful_life_years, sort_order) values
  ('capex.land', 'Land', 'capex', 'land', null, 10),
  ('capex.building_civil', 'Building and civil works', 'capex', 'building_civil', 30, 20),
  ('capex.interiors', 'Interiors and fit-out', 'capex', 'interiors', 7, 30),
  ('capex.machinery', 'Plant and machinery', 'capex', 'machinery', 10, 40),
  ('capex.equipment', 'Utilities and auxiliary equipment', 'capex', 'equipment', 10, 50),
  ('capex.installation', 'Installation, erection and electrification', 'capex', 'machinery', 10, 55),
  ('capex.furniture', 'Furniture and fixtures', 'capex', 'furniture', 10, 60),
  ('capex.vehicle', 'Vehicles', 'capex', 'vehicle', 8, 70),
  ('capex.it', 'IT, software and POS', 'capex', 'it', 3, 80),
  ('capex.other', 'Other fixed assets', 'capex', 'other', 10, 90),
  ('preop.licensing', 'Licences, registrations and approvals', 'pre_operative', null, null, 110),
  ('preop.training', 'Founder and staff training', 'pre_operative', null, null, 120),
  ('preop.launch_marketing', 'Launch marketing', 'pre_operative', null, null, 130),
  ('preop.professional_fees', 'Professional and consultancy fees', 'pre_operative', null, null, 140),
  ('preop.other', 'Other pre-operative expenses', 'pre_operative', null, null, 150),
  ('deposit.property', 'Property security deposit', 'deposit', null, null, 210),
  ('deposit.utility', 'Utility deposits', 'deposit', null, null, 220),
  ('deposit.franchise', 'Franchise or dealership deposit', 'deposit', null, null, 230),
  ('wc.stated_margin', 'Working capital as stated by source', 'working_capital', null, null, 310),
  ('opex.rent', 'Rent', 'fixed_opex', 'rent', null, 410),
  ('opex.utilities', 'Electricity, water and fuel (fixed)', 'fixed_opex', 'utilities', null, 420),
  ('opex.marketing', 'Marketing and selling', 'fixed_opex', 'marketing', null, 430),
  ('opex.insurance', 'Insurance', 'fixed_opex', 'insurance', null, 440),
  ('opex.maintenance', 'Repairs and maintenance', 'fixed_opex', 'maintenance', null, 450),
  ('opex.admin', 'Administrative overheads', 'fixed_opex', 'admin', null, 460),
  ('opex.transport', 'Transport and logistics (fixed)', 'fixed_opex', 'transport', null, 470),
  ('opex.licence_renewal', 'Licence renewals and compliance', 'fixed_opex', 'licence_renewal', null, 480),
  ('opex.other', 'Other fixed operating costs', 'fixed_opex', 'other', null, 490),
  ('staff.production', 'Production and operations staff', 'staff', 'cogs', null, 510),
  ('staff.sales', 'Sales and service staff', 'staff', 'operating', null, 520),
  ('staff.admin', 'Administrative and supervisory staff', 'staff', 'operating', null, 530),
  ('variable.raw_material', 'Raw materials', 'variable', 'cogs', null, 610),
  ('variable.packaging', 'Packaging materials', 'variable', 'cogs', null, 620),
  ('variable.consumables', 'Consumables', 'variable', 'cogs', null, 630),
  ('variable.utilities', 'Power and fuel (variable)', 'variable', 'cogs', null, 640),
  ('variable.commission', 'Commissions and platform fees', 'variable', 'operating', null, 650),
  ('variable.other', 'Other variable costs', 'variable', 'operating', null, 690),
  ('financing.stated_interest', 'Interest as stated by source', 'financing', null, null, 710)
on conflict (slug) do nothing;

-- ── Skills (transferable capability vocabulary) ──────────────────────────────
insert into intel.skills (slug, name, skill_type, description) values
  ('operations-management', 'Operations management', 'transferable', 'Running repeatable processes to time, cost and quality.'),
  ('sales', 'Sales and business development', 'transferable', 'Finding, pitching and closing customers.'),
  ('negotiation', 'Negotiation', 'transferable', 'Commercial negotiation with suppliers, landlords and customers.'),
  ('procurement', 'Procurement and vendor management', 'transferable', 'Sourcing, comparing quotations, managing suppliers.'),
  ('financial-management', 'Financial management', 'transferable', 'Budgeting, cash-flow control, costing and bookkeeping oversight.'),
  ('project-management', 'Project management', 'transferable', 'Planning and delivering a set-up project against a schedule.'),
  ('marketing', 'Marketing', 'transferable', 'Positioning, local and digital promotion, customer acquisition.'),
  ('quality-assurance', 'Quality assurance', 'transferable', 'Defining and enforcing quality and hygiene standards.'),
  ('people-management', 'People management', 'transferable', 'Hiring, training, scheduling and retaining staff.'),
  ('customer-service', 'Customer service', 'transferable', 'Handling customers, complaints and repeat business.'),
  ('regulatory-compliance', 'Regulatory compliance', 'transferable', 'Navigating licences, inspections and statutory filings.'),
  ('logistics-planning', 'Logistics and inventory planning', 'transferable', 'Stock, storage, dispatch and route planning.'),
  ('data-analysis', 'Data analysis', 'transferable', 'Using numbers to monitor and improve the business.'),
  ('teaching-training', 'Teaching and training', 'transferable', 'Structuring and delivering instruction.'),
  ('technical-maintenance', 'Equipment operation and maintenance', 'technical', 'Operating, troubleshooting and maintaining machinery.'),
  ('food-safety', 'Food safety and hygiene', 'regulatory', 'Food-handling hygiene practice and FSSAI-style compliance.'),
  ('agronomy', 'Crop and cultivation practice', 'domain', 'Hands-on cultivation knowledge for agriculture and horticulture models.')
on conflict (slug) do nothing;

insert into intel.asset_types (slug, name, description) values
  ('agricultural-land', 'Agricultural land', 'Owned or family farmland available for cultivation or agri-allied activity.'),
  ('commercial-shop', 'Commercial shop or showroom', 'Owned street-facing commercial premises.'),
  ('industrial-shed', 'Industrial shed or gala', 'Owned industrial premises with power connection.'),
  ('warehouse-space', 'Warehouse or godown space', 'Covered storage space.'),
  ('residential-spare-space', 'Spare residential space', 'Spare room, garage or terrace usable for a home-based operation.'),
  ('rooftop-space', 'Rooftop space', 'Unshaded rooftop area.'),
  ('vehicle-car', 'Car', 'Passenger car available for business use.'),
  ('vehicle-light-commercial', 'Light commercial vehicle', 'Pickup, van or small truck.'),
  ('commercial-kitchen', 'Licensed commercial kitchen', 'Existing kitchen space with required utilities.')
on conflict (slug) do nothing;

-- ── Metric vocabulary ────────────────────────────────────────────────────────
insert into intel.metric_definitions (key, name, applies_to, unit_code, period, description) values
  ('population', 'Population', 'location', 'each', 'point_in_time', 'Resident population. A demand INDICATOR only.'),
  ('households', 'Households', 'location', 'each', 'point_in_time', 'Number of households.'),
  ('commercial_rent_per_sqft_month', 'Commercial rent per sq ft per month', 'location', 'inr', 'per_month', 'Asking or transacted rent for retail/commercial space; segment records micro-market and grade.'),
  ('industrial_shed_rent_per_sqft_month', 'Industrial shed rent per sq ft per month', 'location', 'inr', 'per_month', 'Rent for industrial sheds/galas.'),
  ('industrial_land_rate_per_sqm', 'Industrial land rate per sq m', 'location', 'inr', 'one_time', 'Allotment or market rate for industrial plots.'),
  ('min_wage_unskilled_month', 'Minimum wage, unskilled, per month', 'location', 'inr', 'per_month', 'Notified minimum wage incl. special allowance; segment records the scheduled employment and zone.'),
  ('min_wage_semiskilled_month', 'Minimum wage, semi-skilled, per month', 'location', 'inr', 'per_month', null),
  ('min_wage_skilled_month', 'Minimum wage, skilled, per month', 'location', 'inr', 'per_month', null),
  ('prevailing_wage_month', 'Prevailing market wage per month', 'location', 'inr', 'per_month', 'Observed market wage; segment records the role.'),
  ('electricity_tariff_commercial_per_kwh', 'Electricity energy charge, commercial, per kWh', 'location', 'inr', 'per_unit', 'Energy charge from the applicable tariff order; segment records the tariff category/slab.'),
  ('electricity_tariff_industrial_per_kwh', 'Electricity energy charge, industrial, per kWh', 'location', 'inr', 'per_unit', null),
  ('water_tariff_commercial_per_kl', 'Water tariff, commercial, per kilolitre', 'location', 'inr', 'per_unit', null),
  ('local_selling_price', 'Local selling price', 'market', 'inr', 'per_unit', 'Observed selling price of the business''s product or service at a location.'),
  ('competitor_count', 'Competitor count', 'market', 'each', 'point_in_time', 'Count of comparable businesses in a defined area. An indicator of competition, NOT a measure of demand.'),
  ('demand_indicator', 'Demand indicator', 'market', null, 'point_in_time', 'Any quantified proxy for demand; value_text must define what was measured.'),
  ('distribution_margin_pct', 'Distribution / trade margin', 'market', 'percent', 'point_in_time', 'Margin retained by distributors or retailers.'),
  ('market_note', 'Qualitative market note', 'market', null, 'point_in_time', 'Qualitative observation about customers, channels or saturation.'),
  ('initial_investment', 'Actual initial investment', 'actuals', 'inr', 'one_time', null),
  ('unexpected_expenditure', 'Unexpected expenditure', 'actuals', 'inr', 'one_time', null),
  ('monthly_revenue', 'Monthly revenue', 'actuals', 'inr', 'per_month', null),
  ('monthly_operating_expenses', 'Monthly operating expenses', 'actuals', 'inr', 'per_month', null),
  ('owner_monthly_income', 'Owner monthly income', 'actuals', 'inr', 'per_month', 'What the owner actually takes home.'),
  ('breakeven_months', 'Months to break even', 'actuals', 'month', 'one_time', null),
  ('owner_hours_per_week', 'Owner working hours per week', 'actuals', 'hour', 'point_in_time', null),
  ('employee_count', 'Employee count', 'actuals', 'each', 'point_in_time', null),
  ('capital_lost', 'Capital lost', 'actuals', 'inr', 'one_time', 'Owner capital not recovered on closure or sale.')
on conflict (key) do nothing;

-- ── Financial model templates and parameter definitions ──────────────────────
insert into intel.financial_model_templates (key, name, formula, example_businesses) values
  ('transactions', 'Transactions × ticket', 'transactions per day × operating days per month × average ticket', 'Cafés, kiosks, retail'),
  ('capacity_utilization', 'Capacity × utilisation × price', 'capacity units per month × utilisation × unit price', 'Manufacturing, food processing, laundry (kg)'),
  ('area_yield', 'Area × yield × price', 'cultivated area × yield per area per cycle × realised price, in harvest months', 'Agriculture, horticulture'),
  ('enrolment', 'Students × fees', 'student capacity × enrolment rate × fee per student per month', 'Preschools, training centres'),
  ('occupancy', 'Area × occupancy × rate', 'rentable area × occupancy × rate per area per month', 'Warehousing, co-working'),
  ('fleet_utilization', 'Units × utilisation × rental rate', 'unit count × billable days per month × utilisation × rate per unit per day', 'Equipment rental'),
  ('engagements', 'Engagements × fee', 'billable engagements per month × realised fee', 'Professional services')
on conflict (key) do nothing;

insert into intel.financial_parameter_definitions
  (key, template_key, name, unit_code, value_kind, scope, is_required, min_value, max_value, default_value, default_rationale, sort_order) values
  -- common, variant-scoped. Defaults are explicit PlanB assumptions (grade D), not evidence.
  ('pre_operating_months', null, 'Months from first spend to first sale', 'month', 'months', 'variant', false, 0, 24, 3, 'PlanB default assumption: 3 months of set-up before trading. Replace with owner-interview evidence.', 10),
  ('ramp_start_pct', null, 'Volume in first operating month (% of steady state)', 'percent', 'percent', 'variant', false, 0, 100, 50, 'PlanB default assumption: opens at half of steady-state volume. Replace with owner-interview evidence.', 20),
  ('ramp_months_to_steady_state', null, 'Months to reach steady-state volume', 'month', 'months', 'variant', false, 0, 60, 12, 'PlanB default assumption: 12 months to steady state. Replace with owner-interview evidence.', 30),
  ('operating_days_per_month', null, 'Operating days per month', 'day', 'days', 'variant', false, 1, 31, 25, 'PlanB default assumption: 25 operating days per month.', 40),
  ('inventory_days', null, 'Inventory holding (days of direct cost)', 'day', 'days', 'variant', false, 0, 365, 30, 'PlanB default assumption (conservative): 30 days of stock. Replace with source or owner evidence.', 50),
  ('receivable_days', null, 'Customer credit (days of revenue)', 'day', 'days', 'variant', false, 0, 365, 15, 'PlanB default assumption (conservative): 15 days of receivables. Replace with source or owner evidence.', 60),
  ('payable_days', null, 'Supplier credit (days of variable cost)', 'day', 'days', 'variant', false, 0, 365, 0, 'PlanB default assumption (conservative): suppliers paid on delivery.', 70),
  ('contingency_pct', null, 'Contingency on capital cost', 'percent', 'percent', 'variant', false, 0, 50, 10, 'PlanB default assumption: 10% contingency on capital cost.', 80),
  ('owner_monthly_compensation', null, 'Owner monthly compensation drawn', 'inr', 'money', 'variant', false, 0, null, 0, 'No owner draw is assumed; owner income is reported as the residual cash the business generates.', 90),
  ('term_loan_pct_of_project_cost', null, 'Term loan as % of fixed capital', 'percent', 'percent', 'variant', false, 0, 95, 0, 'All-equity case assumed unless a financing structure is specified.', 100),
  ('loan_interest_pct', null, 'Loan interest rate (% per annum)', 'percent', 'percent', 'variant', false, 0, 40, null, null, 110),
  ('loan_tenure_months', null, 'Loan tenure (months)', 'month', 'months', 'variant', false, 1, 240, null, null, 120),
  ('loan_moratorium_months', null, 'Loan moratorium (months)', 'month', 'months', 'variant', false, 0, 36, 0, 'No moratorium assumed.', 130),
  ('price_escalation_pct', null, 'Annual selling-price escalation', 'percent', 'percent', 'variant', false, -20, 30, 0, 'Constant prices assumed (real terms).', 140),
  ('cost_inflation_pct', null, 'Annual cost inflation', 'percent', 'percent', 'variant', false, -20, 30, 0, 'Constant prices assumed (real terms).', 150),
  ('tax_rate_pct', null, 'Flat tax rate on profit', 'percent', 'percent', 'variant', false, 0, 50, 0, 'Pre-tax model: personal/business income tax is not modelled.', 160),
  -- driver parameters, revenue-stream-scoped: required, never defaulted
  ('transactions_per_day', 'transactions', 'Transactions per operating day', 'each', 'count', 'revenue_stream', true, 0, null, null, null, 210),
  ('average_ticket', 'transactions', 'Average ticket value', 'inr', 'money', 'revenue_stream', true, 0, null, null, null, 220),
  ('capacity_units_per_month', 'capacity_utilization', 'Installed capacity (units per month)', null, 'number', 'revenue_stream', true, 0, null, null, null, 230),
  ('utilization_pct', 'capacity_utilization', 'Steady-state capacity utilisation', 'percent', 'percent', 'revenue_stream', true, 0, 100, null, null, 240),
  ('unit_price', 'capacity_utilization', 'Selling price per unit', 'inr', 'money', 'revenue_stream', true, 0, null, null, null, 250),
  ('cultivated_area', 'area_yield', 'Cultivated area', null, 'number', 'revenue_stream', true, 0, null, null, null, 260),
  ('yield_per_area_per_cycle', 'area_yield', 'Yield per unit area per cycle', null, 'number', 'revenue_stream', true, 0, null, null, null, 270),
  ('cycles_per_year', 'area_yield', 'Crop cycles per year', 'each', 'count', 'revenue_stream', true, 0, 24, null, null, 280),
  ('price_per_unit', 'area_yield', 'Realised price per unit of produce', 'inr', 'money', 'revenue_stream', true, 0, null, null, null, 290),
  ('capacity_students', 'enrolment', 'Student capacity', 'each', 'count', 'revenue_stream', true, 0, null, null, null, 300),
  ('enrolment_rate_pct', 'enrolment', 'Steady-state enrolment rate', 'percent', 'percent', 'revenue_stream', true, 0, 100, null, null, 310),
  ('fee_per_student_per_month', 'enrolment', 'Fee per student per month', 'inr', 'money', 'revenue_stream', true, 0, null, null, null, 320),
  ('rentable_area', 'occupancy', 'Rentable area', null, 'number', 'revenue_stream', true, 0, null, null, null, 330),
  ('occupancy_pct', 'occupancy', 'Steady-state occupancy', 'percent', 'percent', 'revenue_stream', true, 0, 100, null, null, 340),
  ('rate_per_area_per_month', 'occupancy', 'Rate per unit area per month', 'inr', 'money', 'revenue_stream', true, 0, null, null, null, 350),
  ('unit_count', 'fleet_utilization', 'Rental units in fleet', 'each', 'count', 'revenue_stream', true, 0, null, null, null, 360),
  ('billable_days_per_month', 'fleet_utilization', 'Billable days per month', 'day', 'days', 'revenue_stream', true, 0, 31, null, null, 370),
  ('fleet_utilization_pct', 'fleet_utilization', 'Steady-state fleet utilisation', 'percent', 'percent', 'revenue_stream', true, 0, 100, null, null, 380),
  ('rate_per_unit_per_day', 'fleet_utilization', 'Rental rate per unit per day', 'inr', 'money', 'revenue_stream', true, 0, null, null, null, 390),
  ('engagements_per_month', 'engagements', 'Billable engagements per month', 'each', 'count', 'revenue_stream', true, 0, null, null, null, 400),
  ('realized_fee', 'engagements', 'Realised fee per engagement', 'inr', 'money', 'revenue_stream', true, 0, null, null, null, 410)
on conflict (key) do nothing;

-- ── Ground Truth questionnaires (v1) ─────────────────────────────────────────
insert into gt.questionnaires (key, version, title, audience) values
  ('owner_operating', 1, 'Owner interview — operating business', 'operating_owner'),
  ('owner_former', 1, 'Owner interview — closed or sold business', 'former_owner')
on conflict (key, version) do nothing;

insert into gt.questionnaire_questions (questionnaire_id, key, section, sequence_no, prompt, answer_type, metric_key, guidance, is_sensitive)
select q.id, v.key, v.section, v.seq, v.prompt, v.answer_type, v.metric_key, v.guidance, v.is_sensitive
from gt.questionnaires q
join (values
  ('setup', 10, 'initial_investment', 'What did it actually cost to get to opening day, in total?', 'money', 'initial_investment', 'Ask for the all-in figure, then break it down: premises, machinery, interiors, deposits, licences, opening stock. Ask whether bills or a loan sanction letter exist (documented vs self-reported).', true),
  ('setup', 20, 'investment_vs_plan', 'How did that compare with what you had planned to spend?', 'text', null, 'Capture the planned figure and the main reasons for any difference.', false),
  ('setup', 30, 'unexpected_expenditure', 'What costs did you not anticipate, and how much were they?', 'money', 'unexpected_expenditure', 'Probe: deposits, statutory approvals, power connection, rework, delays, working capital in the first months.', true),
  ('setup', 40, 'setup_duration_months', 'How many months passed between your first spend and your first sale?', 'duration_months', null, null, false),
  ('economics', 50, 'monthly_revenue', 'In a typical month, what is the range of your sales?', 'money_range', 'monthly_revenue', 'Record low and high months separately. Ask which months are which.', true),
  ('economics', 60, 'monthly_operating_expenses', 'What are your total monthly running costs, including salaries and rent?', 'money_range', 'monthly_operating_expenses', 'Exclude the owner''s own drawings. Ask for the three biggest cost heads.', true),
  ('economics', 70, 'owner_monthly_income', 'What do you personally take home from the business in a typical month?', 'money_range', 'owner_monthly_income', 'Distinguish drawings from business profit retained. This is the single most important figure for career switchers.', true),
  ('economics', 80, 'breakeven_months', 'How long after opening did monthly income first cover monthly costs?', 'duration_months', 'breakeven_months', 'If not yet: record that explicitly and how long it has been.', false),
  ('economics', 90, 'seasonality', 'Which months are strongest and weakest, and by roughly how much?', 'text', null, null, false),
  ('operations', 100, 'owner_hours_per_week', 'How many hours a week do you personally work in the business?', 'number', 'owner_hours_per_week', 'Ask about weekends and whether the business runs when the owner is away.', false),
  ('operations', 110, 'employee_count', 'How many people work in the business, and in which roles?', 'number', 'employee_count', 'Record roles and whether staff turnover is a problem.', false),
  ('operations', 120, 'supplier_experience', 'How did you choose your main equipment and material suppliers, and what would you do differently?', 'text', null, 'Ask for supplier names only if they consent to those being recorded.', false),
  ('operations', 130, 'operational_problems', 'What goes wrong most often in day-to-day operations?', 'text', null, null, false),
  ('market', 140, 'customer_acquisition', 'Where do your customers come from, and what did not work?', 'text', null, null, false),
  ('market', 150, 'competition_change', 'How has competition changed since you opened?', 'text', null, null, false),
  ('reflection', 160, 'mistakes', 'What were your most expensive mistakes?', 'text', null, null, false),
  ('reflection', 170, 'advice', 'What would you tell someone leaving a salaried job to start this business?', 'text', null, 'Also ask: who should NOT start this business?', false)
) v (section, seq, key, prompt, answer_type, metric_key, guidance, is_sensitive) on true
where q.version = 1 and q.key in ('owner_operating', 'owner_former')
on conflict (questionnaire_id, key) do nothing;

insert into gt.questionnaire_questions (questionnaire_id, key, section, sequence_no, prompt, answer_type, metric_key, guidance, is_sensitive)
select q.id, v.key, v.section, v.seq, v.prompt, v.answer_type, v.metric_key, v.guidance, v.is_sensitive
from gt.questionnaires q
join (values
  ('closure', 200, 'closure_reasons', 'What were the main reasons the business closed or was sold?', 'text', null, 'Let the owner tell the story first; then probe demand, cash, partners, staff, regulation, health and family.', false),
  ('closure', 210, 'warning_signs', 'Looking back, what were the earliest warning signs?', 'text', null, null, false),
  ('closure', 220, 'capital_lost', 'How much of the money you put in did you not get back?', 'money', 'capital_lost', 'Include unrecovered deposits, equipment sold at a loss and loans repaid from personal funds.', true),
  ('closure', 230, 'asset_recovery', 'What did you recover from selling equipment, stock and deposits?', 'text', null, 'Record recovery as a share of original cost where the owner can estimate it.', true),
  ('closure', 240, 'months_to_decision', 'How long did you keep running after it stopped making sense, and why?', 'text', null, null, false)
) v (section, seq, key, prompt, answer_type, metric_key, guidance, is_sensitive) on true
where q.version = 1 and q.key = 'owner_former'
on conflict (questionnaire_id, key) do nothing;

-- ── Pricing hypotheses (configurable; not launched products) ─────────────────
insert into customer.pricing_plans (key, name, price_inr, description, is_active, is_hypothesis) values
  ('free_discovery', 'Free discovery', 0, 'Browse the catalogue and teaser intelligence.', true, true),
  ('career_discovery_report', 'Personalised career discovery report', 499, 'Hypothesis to validate.', false, true),
  ('business_blueprint', 'Detailed business blueprint', 1499, 'Hypothesis to validate.', false, true),
  ('transition_plan', 'Comprehensive transition plan', 4999, 'Hypothesis to validate.', false, true)
on conflict (key) do nothing;
