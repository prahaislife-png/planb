-- PlanB · 0019 · Location overlays for cost items, and the extractor-evaluation run type.

-- A cost item can be tied to a location metric so that its value is derived locally:
--   rent line  = commercial_rent_per_sqft_month × floor area
--   wage line  = prevailing_wage_month (segment = role) × 1
-- The mapping is an explicit analyst decision with its basis recorded; the pipeline never guesses which
-- metric applies. Values are then resolved through the geography fallback hierarchy and every overlay
-- parameter records the level its evidence came from.
alter table intel.cost_items
  add column location_metric_key text references intel.metric_definitions (key),
  add column location_metric_segment text,
  add column location_metric_multiplier numeric check (location_metric_multiplier > 0),
  add column location_metric_basis text,
  add constraint cost_items_location_mapping_complete check (
    (location_metric_key is null and location_metric_multiplier is null and location_metric_segment is null)
    or (location_metric_key is not null and location_metric_multiplier is not null
        and location_metric_basis is not null and length(btrim(location_metric_basis)) > 0));
comment on column intel.cost_items.location_metric_key is 'Location metric this cost is derived from locally (e.g. commercial_rent_per_sqft_month). NULL = no local derivation; the national value is used everywhere.';
comment on column intel.cost_items.location_metric_segment is 'Segment of the metric to use (micro-market, role…). NULL = any segment.';
comment on column intel.cost_items.location_metric_multiplier is 'What the metric is multiplied by to give the monthly cost of one unit of the item (floor area for a per-sq-ft rent; 1 for a wage).';
comment on column intel.cost_items.location_metric_basis is 'Where the multiplier comes from (e.g. "2,500 sq ft — upper bound of the built-up area stated by the source, p. 10").';

alter table ops.research_runs drop constraint research_runs_pipeline_check;
alter table ops.research_runs add constraint research_runs_pipeline_check
  check (pipeline in ('document_research', 'business_refresh', 'freshness_scan', 'catalog_sync', 'extractor_evaluation'));
