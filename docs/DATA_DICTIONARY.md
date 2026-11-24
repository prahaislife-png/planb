# PlanB data dictionary

> Generated from the database catalogue by `scripts/gen_db_docs.py`. Do not edit by hand — change the
> `COMMENT ON` statements in `supabase/migrations/` and regenerate.

77 tables and 9 views across 5 schemas. Row-level security is enabled on every table.

## Contents

- **intel** (60): [asset_types](#intelasset_types), [business_assets](#intelbusiness_assets), [business_model_classifications](#intelbusiness_model_classifications), [business_models](#intelbusiness_models), [business_raw_materials](#intelbusiness_raw_materials), [business_regulations](#intelbusiness_regulations), [business_relationships](#intelbusiness_relationships), [business_risks](#intelbusiness_risks), [business_scheme_eligibility](#intelbusiness_scheme_eligibility), [business_skill_mapping](#intelbusiness_skill_mapping), [business_variants](#intelbusiness_variants), [business_versions](#intelbusiness_versions), [classification_codes](#intelclassification_codes), [classification_systems](#intelclassification_systems), [cost_categories](#intelcost_categories), [cost_items](#intelcost_items), [cost_observations](#intelcost_observations), [document_chunks](#inteldocument_chunks), [document_pages](#inteldocument_pages), [equipment](#intelequipment), [equipment_specifications](#intelequipment_specifications), [evidence_claims](#intelevidence_claims), [evidence_links](#intelevidence_links), [financial_model_templates](#intelfinancial_model_templates), [financial_parameter_definitions](#intelfinancial_parameter_definitions), [financial_parameter_sources](#intelfinancial_parameter_sources), [financial_parameters](#intelfinancial_parameters), [financial_scenarios](#intelfinancial_scenarios), [founder_requirements](#intelfounder_requirements), [government_schemes](#intelgovernment_schemes), [industries](#intelindustries), [launch_tasks](#intellaunch_tasks), [lifestyle_profiles](#intellifestyle_profiles), [location_metrics](#intellocation_metrics), [locations](#intellocations), [market_observations](#intelmarket_observations), [metric_definitions](#intelmetric_definitions), [observation_conflicts](#intelobservation_conflicts), [operating_requirements](#inteloperating_requirements), [parameter_observations](#intelparameter_observations), [raw_materials](#intelraw_materials), [regulations](#intelregulations), [research_reviews](#intelresearch_reviews), [research_tasks](#intelresearch_tasks), [revenue_streams](#intelrevenue_streams), [skills](#intelskills), [source_documents](#intelsource_documents), [sources](#intelsources), [supplier_quotes](#intelsupplier_quotes), [suppliers](#intelsuppliers), [training_program_businesses](#inteltraining_program_businesses), [training_programs](#inteltraining_programs), [units](#intelunits), [v_business_completeness](#intelv_business_completeness), [v_business_evidence_quality](#intelv_business_evidence_quality), [v_completeness_items](#intelv_completeness_items), [v_freshness_queue](#intelv_freshness_queue), [v_observations](#intelv_observations), [v_usable_observations](#intelv_usable_observations), [v_variant_parameter_status](#intelv_variant_parameter_status)
- **gt** (8): [business_actuals](#gtbusiness_actuals), [consents](#gtconsents), [interview_responses](#gtinterview_responses), [interview_subjects](#gtinterview_subjects), [owner_interviews](#gtowner_interviews), [questionnaire_questions](#gtquestionnaire_questions), [questionnaires](#gtquestionnaires), [v_actuals_aggregate](#gtv_actuals_aggregate)
- **pub** (2): [publication_versions](#pubpublication_versions), [catalog](#pubcatalog)
- **customer** (7): [pricing_plans](#customerpricing_plans), [profile_documents](#customerprofile_documents), [recommendations](#customerrecommendations), [saved_businesses](#customersaved_businesses), [user_assets](#customeruser_assets), [user_capabilities](#customeruser_capabilities), [user_profiles](#customeruser_profiles)
- **ops** (9): [audit_log](#opsaudit_log), [ingestion_log](#opsingestion_log), [llm_usage](#opsllm_usage), [publication_policy](#opspublication_policy), [research_run_logs](#opsresearch_run_logs), [research_run_steps](#opsresearch_run_steps), [research_runs](#opsresearch_runs), [staff_members](#opsstaff_members), [staff_roles](#opsstaff_roles)

## intel — private research records (the proprietary database)

<a id="intelasset_types"></a>
### intel.asset_types  ·  table

Kinds of assets a business may need and a customer may already own (land, shop, vehicle, rooftop…). Joins intel.business_assets to customer.user_assets.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `slug` | text | no |  | PK |  |
| `name` | text | no |  |  |  |
| `description` | text | yes |  |  |  |

<details><summary>Check constraints (1)</summary>

- `asset_types_slug_check`: `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`

</details>

<a id="intelbusiness_assets"></a>
### intel.business_assets  ·  table

Assets a variant needs or benefits from. Matched against customer.user_assets: an asset the customer already owns can replace a cost (substitutes_cost_category_id) — the basis of asset-monetisation recommendations.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_variant_id` | uuid | no |  | FK → intel.business_variants |  |
| `asset_type_slug` | text | no |  | FK → intel.asset_types |  |
| `requirement_level` | text | no |  |  |  |
| `quantity` | numeric | yes |  |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `substitutes_cost_category_id` | uuid | yes |  | FK → intel.cost_categories |  |
| `notes` | text | yes |  |  |  |
| `evidence_grade` | character(1) | no | `'D'::bpchar` |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(business_variant_id, asset_type_slug)`

<details><summary>Check constraints (2)</summary>

- `business_assets_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`
- `business_assets_requirement_level_check`: `CHECK ((requirement_level = ANY (ARRAY['required'::text, 'advantage'::text, 'substitutes_cost'::text])))`

</details>

<a id="intelbusiness_model_classifications"></a>
### intel.business_model_classifications  ·  table

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `business_model_id` | uuid | no |  | PK FK → intel.business_models |  |
| `classification_code_id` | uuid | no |  | PK FK → intel.classification_codes |  |
| `is_primary` | boolean | no | `false` |  |  |

<a id="intelbusiness_models"></a>
### intel.business_models  ·  table

A distinct business operating model — the atomic unit of the PlanB database. Categories are intel.industries; siblings such as kiosk/café/cart are separate rows linked by family + business_relationships.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `slug` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `industry_id` | uuid | no |  | FK → intel.industries |  |
| `family` | text | yes |  |  |  |
| `description` | text | yes |  |  |  |
| `operating_model` | text | yes |  |  |  |
| `target_customers` | text | yes |  |  |  |
| `revenue_archetype` | text | yes |  |  |  |
| `lifecycle_status` | text | no | `'backlog'::text` |  | backlog → researching → in_review → approved → published; needs_revalidation when evidence goes stale. Changed only by workflow functions. |
| `is_pilot` | boolean | no | `false` |  |  |
| `research_priority` | integer | no | `3` |  |  |
| `capital_tier_hypothesis` | text | yes |  |  | UNVERIFIED triage guess used only to prioritise the research backlog. Never shown to customers; real capital requirements come from cost observations. |
| `geography_fit` | text[] | no | `'{}'::text[]` |  |  |
| `backlog_notes` | text | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_by` | uuid | yes |  | FK → auth.users |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(slug)`

<details><summary>Check constraints (4)</summary>

- `business_models_capital_tier_hypothesis_check`: `CHECK ((capital_tier_hypothesis = ANY (ARRAY['<5L'::text, '5-25L'::text, '25L-1Cr'::text, '>1Cr'::text])))`
- `business_models_lifecycle_status_check`: `CHECK ((lifecycle_status = ANY (ARRAY['backlog'::text, 'researching'::text, 'in_review'::text, 'approved'::text, 'published'::text, 'needs_revalidation'::text, 'retired'::text])))`
- `business_models_research_priority_check`: `CHECK (((research_priority >= 1) AND (research_priority <= 3)))`
- `business_models_slug_check`: `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`

</details>

Triggers: `business_models_updated` → `set_updated_at()`

<a id="intelbusiness_raw_materials"></a>
### intel.business_raw_materials  ·  table

Bill of materials: consumption norm of each raw material per unit of output for a variant.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_variant_id` | uuid | no |  | FK → intel.business_variants |  |
| `raw_material_id` | uuid | no |  | FK → intel.raw_materials |  |
| `revenue_stream_id` | uuid | yes |  | FK → intel.revenue_streams |  |
| `consumption_per_output_unit` | numeric | yes |  |  |  |
| `consumption_unit_code` | text | yes |  | FK → intel.units |  |
| `output_unit_text` | text | yes |  |  |  |
| `wastage_pct` | numeric | yes |  |  |  |
| `basis` | text | no | `'unverified'::text` |  |  |
| `evidence_grade` | character(1) | no | `'D'::bpchar` |  |  |
| `notes` | text | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(business_variant_id, raw_material_id, revenue_stream_id)`

<details><summary>Check constraints (4)</summary>

- `business_raw_materials_basis_check`: `CHECK ((basis = ANY (ARRAY['evidence'::text, 'owner_interviews'::text, 'analyst_judgement'::text, 'unverified'::text])))`
- `business_raw_materials_consumption_per_output_unit_check`: `CHECK ((consumption_per_output_unit >= (0)::numeric))`
- `business_raw_materials_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`
- `business_raw_materials_wastage_pct_check`: `CHECK (((wastage_pct >= (0)::numeric) AND (wastage_pct <= (100)::numeric)))`

</details>

<a id="intelbusiness_regulations"></a>
### intel.business_regulations  ·  table

Which regulations apply to which business model, and under what condition. applicability = to_be_determined marks a research lead that must not be presented as a requirement.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_model_id` | uuid | no |  | FK → intel.business_models |  |
| `regulation_id` | uuid | no |  | FK → intel.regulations |  |
| `applicability` | text | no |  |  |  |
| `condition_text` | text | yes |  |  |  |
| `stage` | text | no | `'pre_launch'::text` |  |  |
| `verification_status` | text | no | `'unverified'::text` |  |  |
| `verified_by` | uuid | yes |  | FK → auth.users |  |
| `verified_at` | timestamp with time zone | yes |  |  |  |
| `notes` | text | yes |  |  |  |
| `research_run_id` | uuid | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(business_model_id, regulation_id)`

<details><summary>Check constraints (4)</summary>

- `business_regulations_applicability_check`: `CHECK ((applicability = ANY (ARRAY['mandatory'::text, 'conditional'::text, 'optional'::text, 'to_be_determined'::text])))`
- `business_regulations_check`: `CHECK (((applicability <> 'conditional'::text) OR (condition_text IS NOT NULL)))`
- `business_regulations_stage_check`: `CHECK ((stage = ANY (ARRAY['pre_launch'::text, 'at_launch'::text, 'ongoing'::text])))`
- `business_regulations_verification_status_check`: `CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'disputed'::text])))`

</details>

Triggers: `business_regulations_updated` → `set_updated_at()`

<a id="intelbusiness_relationships"></a>
### intel.business_relationships  ·  table

Typed edges between business models: siblings that must not be merged, value-chain links, upgrade paths. Feeds deduplication and "also consider" discovery.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `from_business_model_id` | uuid | no |  | FK → intel.business_models |  |
| `to_business_model_id` | uuid | no |  | FK → intel.business_models |  |
| `relationship_type` | text | no |  |  |  |
| `notes` | text | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(from_business_model_id, to_business_model_id, relationship_type)`

<details><summary>Check constraints (2)</summary>

- `business_relationships_check`: `CHECK ((from_business_model_id <> to_business_model_id))`
- `business_relationships_relationship_type_check`: `CHECK ((relationship_type = ANY (ARRAY['distinct_sibling'::text, 'upstream_supplier'::text, 'downstream_customer'::text, 'complementary'::text, 'substitute'::text, 'upgrade_path'::text, 'shares_skills'::text, 'franchise_of'::text])))`

</details>

<a id="intelbusiness_risks"></a>
### intel.business_risks  ·  table

Failure modes, capital-loss scenarios and exit possibilities. Deliberately has no probability column: we do not invent success/failure probabilities.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_model_id` | uuid | no |  | FK → intel.business_models |  |
| `risk_type` | text | no |  |  |  |
| `title` | text | no |  |  |  |
| `description` | text | no |  |  |  |
| `severity` | text | yes |  |  |  |
| `mitigation` | text | yes |  |  |  |
| `exit_notes` | text | yes |  |  |  |
| `basis` | text | no | `'unverified'::text` |  |  |
| `evidence_grade` | character(1) | no | `'D'::bpchar` |  |  |
| `research_run_id` | uuid | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (4)</summary>

- `business_risks_basis_check`: `CHECK ((basis = ANY (ARRAY['evidence'::text, 'owner_interviews'::text, 'analyst_judgement'::text, 'unverified'::text])))`
- `business_risks_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`
- `business_risks_risk_type_check`: `CHECK ((risk_type = ANY (ARRAY['failure_mode'::text, 'capital_loss'::text, 'operational'::text, 'customer_concentration'::text, 'seasonality'::text, 'regulatory'::text, 'supply'::text, 'market'::text, 'exit'::text])))`
- `business_risks_severity_check`: `CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))`

</details>

Triggers: `business_risks_updated` → `set_updated_at()`

<a id="intelbusiness_scheme_eligibility"></a>
### intel.business_scheme_eligibility  ·  table

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `business_model_id` | uuid | no |  | PK FK → intel.business_models |  |
| `scheme_id` | uuid | no |  | PK FK → intel.government_schemes |  |
| `eligibility` | text | no | `'to_be_determined'::text` |  |  |
| `condition_text` | text | yes |  |  |  |
| `verification_status` | text | no | `'unverified'::text` |  |  |
| `notes` | text | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (2)</summary>

- `business_scheme_eligibility_eligibility_check`: `CHECK ((eligibility = ANY (ARRAY['eligible'::text, 'conditional'::text, 'not_eligible'::text, 'to_be_determined'::text])))`
- `business_scheme_eligibility_verification_status_check`: `CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'disputed'::text])))`

</details>

<a id="intelbusiness_skill_mapping"></a>
### intel.business_skill_mapping  ·  table

Which capabilities a business model demands of its founder, how important each is, and whether it can be learned or hired.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `business_model_id` | uuid | no |  | PK FK → intel.business_models |  |
| `skill_id` | uuid | no |  | PK FK → intel.skills |  |
| `importance` | integer | no |  |  |  |
| `acquisition` | text | no |  |  |  |
| `basis` | text | no | `'unverified'::text` |  |  |
| `notes` | text | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (3)</summary>

- `business_skill_mapping_acquisition_check`: `CHECK ((acquisition = ANY (ARRAY['needed_at_start'::text, 'learnable'::text, 'hireable'::text])))`
- `business_skill_mapping_basis_check`: `CHECK ((basis = ANY (ARRAY['evidence'::text, 'owner_interviews'::text, 'analyst_judgement'::text, 'unverified'::text])))`
- `business_skill_mapping_importance_check`: `CHECK (((importance >= 1) AND (importance <= 5)))`

</details>

<a id="intelbusiness_variants"></a>
### intel.business_variants  ·  table

A costed configuration of a business model: operating scale × geographical configuration × ownership structure. Cost items, revenue streams and financial parameters attach here.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_model_id` | uuid | no |  | FK → intel.business_models |  |
| `slug` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `is_reference` | boolean | no | `false` |  | The reference variant is the configuration described by the principal source document; other variants are scaled or localised from it. |
| `scale_tier` | text | yes |  |  |  |
| `scale_description` | text | yes |  |  |  |
| `capacity_value` | numeric | yes |  |  |  |
| `capacity_unit` | text | yes |  |  |  |
| `capacity_period` | text | yes |  |  |  |
| `geography_config` | text | yes |  |  |  |
| `ownership_structure` | text | yes |  |  |  |
| `financial_template_key` | text | yes |  | FK → intel.financial_model_templates |  |
| `notes` | text | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_by` | uuid | yes |  | FK → auth.users |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(business_model_id, slug)`

<details><summary>Check constraints (6)</summary>

- `business_variants_capacity_period_check`: `CHECK ((capacity_period = ANY (ARRAY['per_day'::text, 'per_month'::text, 'per_year'::text, 'per_cycle'::text, 'installed'::text])))`
- `business_variants_capacity_value_check`: `CHECK ((capacity_value > (0)::numeric))`
- `business_variants_geography_config_check`: `CHECK ((geography_config = ANY (ARRAY['metro'::text, 'tier2'::text, 'tier3'::text, 'rural'::text, 'any'::text])))`
- `business_variants_ownership_structure_check`: `CHECK ((ownership_structure = ANY (ARRAY['sole_proprietorship'::text, 'partnership'::text, 'llp'::text, 'private_limited'::text, 'opc'::text, 'franchisee'::text, 'cooperative_fpo'::text, 'unspecified'::text])))`
- `business_variants_scale_tier_check`: `CHECK ((scale_tier = ANY (ARRAY['micro'::text, 'small'::text, 'medium'::text, 'large'::text])))`
- `business_variants_slug_check`: `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`

</details>

Triggers: `business_variants_updated` → `set_updated_at()`

<a id="intelbusiness_versions"></a>
### intel.business_versions  ·  table

Immutable, numbered snapshot of a business record submitted for human review. Version history is never rewritten: a newer approved version supersedes, it does not replace.

_RLS: enabled (5 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_model_id` | uuid | no |  | FK → intel.business_models |  |
| `version_no` | integer | no |  |  |  |
| `status` | text | no | `'submitted'::text` |  |  |
| `change_summary` | text | yes |  |  |  |
| `snapshot` | jsonb | no |  |  | Frozen JSON rendering of the normalised record at submission (built by intel.build_business_snapshot). The working data stays relational; this is the reviewable, diffable artefact. |
| `snapshot_hash` | text | no |  |  |  |
| `completeness_pct` | numeric | no |  |  |  |
| `critical_missing` | integer | no |  |  |  |
| `missing_checks` | text[] | no | `'{}'::text[]` |  |  |
| `evidence_profile` | jsonb | no | `'{}'::jsonb` |  |  |
| `open_conflicts` | integer | no | `0` |  |  |
| `pending_claims` | integer | no | `0` |  |  |
| `stale_observations` | integer | no | `0` |  |  |
| `parameters_c_or_better_pct` | numeric | yes |  |  |  |
| `non_research_rows` | integer | no | `0` |  | Number of demo/test rows feeding this version at submission. Must be 0 for publication. |
| `restricted_source_rows` | integer | no | `0` |  | Observations at submission that come from sources whose recorded reuse terms do not (yet) permit commercial reuse. Must be 0 for publication. |
| `submitted_by` | uuid | yes |  | FK → auth.users |  |
| `submitted_by_run` | uuid | yes |  |  |  |
| `submitted_at` | timestamp with time zone | no | `now()` |  |  |
| `decided_by` | uuid | yes |  | FK → auth.users |  |
| `decided_at` | timestamp with time zone | yes |  |  |  |
| `decision_comments` | text | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |

Unique: `(business_model_id, version_no)`

<details><summary>Check constraints (2)</summary>

- `business_versions_status_check`: `CHECK ((status = ANY (ARRAY['submitted'::text, 'changes_requested'::text, 'approved'::text, 'rejected'::text, 'superseded'::text])))`
- `business_versions_version_no_check`: `CHECK ((version_no >= 1))`

</details>

Triggers: `business_versions_guard` → `guard_business_version()`

<a id="intelclassification_codes"></a>
### intel.classification_codes  ·  table

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `system_code` | text | no |  | FK → intel.classification_systems |  |
| `code` | text | no |  |  |  |
| `title` | text | no |  |  |  |
| `parent_code` | text | yes |  |  |  |
| `is_verified` | boolean | no | `false` |  | True only when the code/title pair was checked against the official publication (verified_against records which). |
| `verified_against` | text | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(system_code, code)`

<a id="intelclassification_systems"></a>
### intel.classification_systems  ·  table

External classification schemes (NIC-2008, HSN, NCO-2015, …) used to anchor our taxonomy to official codes.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `code` | text | no |  | PK |  |
| `name` | text | no |  |  |  |
| `authority` | text | yes |  |  |  |
| `reference_url` | text | yes |  |  |  |
| `notes` | text | yes |  |  |  |

<a id="intelcost_categories"></a>
### intel.cost_categories  ·  table

Chart of cost categories. cost_class decides how the deterministic finance engine treats items in the category; engine_category is the engine's sub-bucket (e.g. machinery, rent).

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `slug` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `parent_id` | uuid | yes |  | FK → intel.cost_categories |  |
| `cost_class` | text | no |  |  |  |
| `engine_category` | text | yes |  |  |  |
| `default_useful_life_years` | numeric | yes |  |  | Depreciation life used when a cost item has no evidenced useful life. Applying it is recorded as a model assumption. |
| `description` | text | yes |  |  |  |
| `sort_order` | integer | no | `0` |  |  |

Unique: `(slug)`

<details><summary>Check constraints (3)</summary>

- `cost_categories_cost_class_check`: `CHECK ((cost_class = ANY (ARRAY['capex'::text, 'pre_operative'::text, 'deposit'::text, 'working_capital'::text, 'fixed_opex'::text, 'staff'::text, 'variable'::text, 'financing'::text])))`
- `cost_categories_default_useful_life_years_check`: `CHECK ((default_useful_life_years > (0)::numeric))`
- `cost_categories_slug_check`: `CHECK ((slug ~ '^[a-z_]+(\.[a-z_]+)*$'::text))`

</details>

<a id="intelcost_items"></a>
### intel.cost_items  ·  table

A line in a variant's cost structure (a machine, the rent, a staff role, a raw material). Holds NO price: prices are cost_observations, and several contradictory ones may exist.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_variant_id` | uuid | no |  | FK → intel.business_variants |  |
| `cost_category_id` | uuid | no |  | FK → intel.cost_categories |  |
| `key` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `description` | text | yes |  |  |  |
| `equipment_id` | uuid | yes |  | FK → intel.equipment |  |
| `raw_material_id` | uuid | yes |  | FK → intel.raw_materials |  |
| `revenue_stream_id` | uuid | yes |  | FK → intel.revenue_streams |  |
| `quantity` | numeric | no | `1` |  | Units required by the variant (machines, head-count, sq ft…). Observations price ONE unit unless flagged is_line_total. |
| `quantity_unit_code` | text | yes |  | FK → intel.units |  |
| `pricing_basis` | text | no | `'per_unit'::text` |  | per_unit: observations price one unit and the model multiplies by quantity. stated_total: the source only states a total for the line (e.g. an annual P&L amount). |
| `recurrence` | text | no |  |  |  |
| `useful_life_years` | numeric | yes |  |  |  |
| `is_optional` | boolean | no | `false` |  |  |
| `notes` | text | yes |  |  |  |
| `research_run_id` | uuid | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_by` | uuid | yes |  | FK → auth.users |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(business_variant_id, key)`

<details><summary>Check constraints (5)</summary>

- `cost_items_key_check`: `CHECK ((key ~ '^[a-z0-9_]+$'::text))`
- `cost_items_pricing_basis_check`: `CHECK ((pricing_basis = ANY (ARRAY['per_unit'::text, 'stated_total'::text])))`
- `cost_items_quantity_check`: `CHECK ((quantity > (0)::numeric))`
- `cost_items_recurrence_check`: `CHECK ((recurrence = ANY (ARRAY['one_time'::text, 'monthly'::text, 'annual'::text, 'per_unit_output'::text, 'pct_of_revenue'::text])))`
- `cost_items_useful_life_years_check`: `CHECK ((useful_life_years > (0)::numeric))`

</details>

Triggers: `cost_items_updated` → `set_updated_at()`

<a id="intelcost_observations"></a>
### intel.cost_observations  ·  table

The passport of a cost figure: value, unit, date, geography, scale, source, document, page, tax and installation treatment, evidence type, verification status, grade and revalidation date. Append-only; contradictory observations coexist.

_RLS: enabled (6 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `cost_item_id` | uuid | no |  | FK → intel.cost_items |  |
| `value` | numeric | no |  |  | Amount in `currency`, in absolute units (rupees, never lakh), for one `unit_code` per `period` — or for quantity_covered units when is_line_total. |
| `value_low` | numeric | yes |  |  |  |
| `value_high` | numeric | yes |  |  |  |
| `currency` | character(3) | no | `'INR'::bpchar` |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `period` | text | no |  |  |  |
| `is_line_total` | boolean | no | `false` |  |  |
| `quantity_covered` | numeric | yes |  |  |  |
| `observed_on` | date | no |  |  |  |
| `observed_on_precision` | text | no | `'day'::text` |  |  |
| `location_id` | uuid | yes |  | FK → intel.locations |  |
| `geographic_scope` | text | no | `'unspecified'::text` |  |  |
| `scale_note` | text | yes |  |  |  |
| `projection_year` | integer | yes |  |  |  |
| `capacity_value` | numeric | yes |  |  |  |
| `capacity_unit` | text | yes |  |  |  |
| `source_id` | uuid | no |  | FK → intel.sources |  |
| `source_document_id` | uuid | yes |  | FK → intel.source_documents |  |
| `page_ref` | text | yes |  |  |  |
| `section_ref` | text | yes |  |  |  |
| `supplier_quote_id` | uuid | yes |  | FK → intel.supplier_quotes |  |
| `tax_treatment` | text | no | `'unknown'::text` |  |  |
| `tax_rate_pct` | numeric | yes |  |  |  |
| `installation` | text | no | `'unknown'::text` |  |  |
| `evidence_type` | text | no |  |  |  |
| `verification_status` | text | no | `'unverified'::text` |  |  |
| `verified_by` | uuid | yes |  | FK → auth.users |  |
| `verified_at` | timestamp with time zone | yes |  |  |  |
| `evidence_grade` | character(1) | no | `'D'::bpchar` |  | A current documented primary/authoritative evidence, verified · B corroborated by independent reasonably-current sources · C single source / older benchmark / self-reported · D estimate or assumption. |
| `grade_basis` | text | yes |  |  |  |
| `analyst_notes` | text | yes |  |  |  |
| `valid_until` | date | yes |  |  |  |
| `revalidate_by` | date | yes |  |  |  |
| `supersedes_id` | uuid | yes |  | FK → intel.cost_observations | Points at the observation this one replaces (newer quotation, correction). The old row is retained as history. |
| `research_run_id` | uuid | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_by` | uuid | yes |  | FK → auth.users |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (14)</summary>

- `cost_observations_check`: `CHECK (((value_low IS NULL) OR (value_high IS NULL) OR (value_low <= value_high)))`
- `cost_observations_check1`: `CHECK (((NOT is_line_total) OR (quantity_covered IS NOT NULL)))`
- `cost_observations_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`
- `cost_observations_evidence_type_check`: `CHECK ((evidence_type = ANY (ARRAY['government_project_report'::text, 'government_tariff_or_notification'::text, 'regulatory_fee_schedule'::text, 'supplier_quote'::text, 'manufacturer_catalogue'::text, 'owner_documented'::text, 'owner_reported'::text, 'market_report'::text, 'listing_observation'::text, 'analyst_estimate'::text, 'llm_estimate'::text])))`
- `cost_observations_geographic_scope_check`: `CHECK ((geographic_scope = ANY (ARRAY['locality'::text, 'city'::text, 'district'::text, 'state'::text, 'national'::text, 'unspecified'::text])))`
- `cost_observations_installation_check`: `CHECK ((installation = ANY (ARRAY['included'::text, 'excluded'::text, 'unknown'::text, 'not_applicable'::text])))`
- `cost_observations_observed_on_precision_check`: `CHECK ((observed_on_precision = ANY (ARRAY['day'::text, 'month'::text, 'year'::text, 'unknown'::text])))`
- `cost_observations_period_check`: `CHECK ((period = ANY (ARRAY['one_time'::text, 'per_day'::text, 'per_month'::text, 'per_year'::text, 'per_cycle'::text, 'per_unit'::text])))`
- `cost_observations_projection_year_check`: `CHECK (((projection_year >= 1) AND (projection_year <= 30)))`
- `cost_observations_quantity_covered_check`: `CHECK ((quantity_covered > (0)::numeric))`
- `cost_observations_tax_rate_pct_check`: `CHECK (((tax_rate_pct >= (0)::numeric) AND (tax_rate_pct <= (100)::numeric)))`
- `cost_observations_tax_treatment_check`: `CHECK ((tax_treatment = ANY (ARRAY['inclusive'::text, 'exclusive'::text, 'unknown'::text, 'not_applicable'::text])))`
- `cost_observations_value_check`: `CHECK ((value >= (0)::numeric))`
- `cost_observations_verification_status_check`: `CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'disputed'::text, 'rejected'::text])))`

</details>

Triggers: `cost_observations_freeze` → `freeze_observation()`, `cost_observations_guard` → `guard_observation()`, `cost_observations_updated` → `set_updated_at()`, `cost_observations_verify_role` → `guard_verification_role()`

<a id="inteldocument_chunks"></a>
### intel.document_chunks  ·  table

Retrieval chunks for semantic search over evidence documents (pgvector). Embeddings are NULL until an embedding provider is configured; full-text search on document_pages works without them.

_RLS: enabled (7 policies) · audited: no_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `document_id` | uuid | no |  | FK → intel.source_documents |  |
| `page_no` | integer | no |  |  |  |
| `chunk_index` | integer | no |  |  |  |
| `content` | text | no |  |  |  |
| `embedding` | vector(1024) | yes |  |  |  |
| `embedding_model` | text | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(document_id, page_no, chunk_index)`

<details><summary>Check constraints (1)</summary>

- `document_chunks_embedding_model`: `CHECK (((embedding IS NULL) = (embedding_model IS NULL)))`

</details>

<a id="inteldocument_pages"></a>
### intel.document_pages  ·  table

Extracted text and tables per page. Claims cite (document, page) and their quote is verified against this text. Content is untrusted external data.

_RLS: enabled (7 policies) · audited: no_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `document_id` | uuid | no |  | PK FK → intel.source_documents |  |
| `page_no` | integer | no |  | PK |  |
| `text` | text | no | `''::text` |  |  |
| `tables` | jsonb | no | `'[]'::jsonb` |  |  |
| `char_count` | integer | yes | `generated` |  |  |
| `tsv` | tsvector | yes | `generated` |  |  |

<details><summary>Check constraints (1)</summary>

- `document_pages_page_no_check`: `CHECK ((page_no >= 1))`

</details>

<a id="intelequipment"></a>
### intel.equipment  ·  table

Catalogue of machine/equipment types, shared across business models (a planetary mixer is one row however many models use it).

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `slug` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `equipment_class` | text | yes |  |  |  |
| `description` | text | yes |  |  |  |
| `hsn_code` | text | yes |  |  |  |
| `typical_useful_life_years` | numeric | yes |  |  |  |
| `maintenance_notes` | text | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(slug)`

<details><summary>Check constraints (2)</summary>

- `equipment_slug_check`: `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`
- `equipment_typical_useful_life_years_check`: `CHECK ((typical_useful_life_years > (0)::numeric))`

</details>

Triggers: `equipment_updated` → `set_updated_at()`

<a id="intelequipment_specifications"></a>
### intel.equipment_specifications  ·  table

Key/value technical specifications of an equipment type (capacity, connected load, footprint…).

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `equipment_id` | uuid | no |  | FK → intel.equipment |  |
| `spec_key` | text | no |  |  |  |
| `value_numeric` | numeric | yes |  |  |  |
| `value_text` | text | yes |  |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `evidence_grade` | character(1) | no | `'D'::bpchar` |  |  |
| `source_document_id` | uuid | yes |  | FK → intel.source_documents |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (2)</summary>

- `equipment_specifications_check`: `CHECK (((value_numeric IS NOT NULL) OR (value_text IS NOT NULL)))`
- `equipment_specifications_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`

</details>

<a id="intelevidence_claims"></a>
### intel.evidence_claims  ·  table

Atomic statements extracted from source documents, each with a verbatim quote and page. A claim is raw evidence awaiting review; only accepted claims materialise into observations.

_RLS: enabled (6 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `source_document_id` | uuid | no |  | FK → intel.source_documents |  |
| `page_no` | integer | yes |  |  |  |
| `section_ref` | text | yes |  |  |  |
| `quote` | text | no |  |  |  |
| `quote_verified` | boolean | no | `false` |  | Set by a deterministic check that the quote text actually occurs on the cited page — the guard against hallucinated or injected extractions. LLMs never set this. |
| `quote_match_score` | numeric | yes |  |  |  |
| `business_model_id` | uuid | yes |  | FK → intel.business_models |  |
| `business_variant_id` | uuid | yes |  | FK → intel.business_variants |  |
| `claim_type` | text | no |  |  |  |
| `subject` | text | no |  |  |  |
| `attribute` | text | yes |  |  |  |
| `value_numeric` | numeric | yes |  |  |  |
| `value_low` | numeric | yes |  |  |  |
| `value_high` | numeric | yes |  |  |  |
| `value_text` | text | yes |  |  |  |
| `unit_raw` | text | yes |  |  |  |
| `currency` | text | yes |  |  |  |
| `period_raw` | text | yes |  |  |  |
| `quantity` | numeric | yes |  |  |  |
| `value_normalized` | numeric | yes |  |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `period` | text | yes |  |  |  |
| `normalization_notes` | text | yes |  |  |  |
| `qualifiers` | jsonb | no | `'{}'::jsonb` |  |  |
| `target_kind` | text | yes |  |  |  |
| `cost_category_slug` | text | yes |  |  |  |
| `parameter_key` | text | yes |  |  |  |
| `extraction_method` | text | no |  |  |  |
| `extractor` | text | no |  |  |  |
| `extractor_confidence` | numeric | yes |  |  | Extractor self-reported confidence. Diagnostic only; never an evidence grade and never shown to customers. |
| `research_run_id` | uuid | yes |  |  |  |
| `dedupe_hash` | text | no |  |  | Hash of (page, subject, attribute, value, unit) so re-running extraction on the same document is idempotent. |
| `status` | text | no | `'extracted'::text` |  |  |
| `reviewed_by` | uuid | yes |  | FK → auth.users |  |
| `reviewed_at` | timestamp with time zone | yes |  |  |  |
| `review_note` | text | yes |  |  |  |
| `corrected_from_id` | uuid | yes |  | FK → intel.evidence_claims | When an analyst corrects an extraction, the original is marked superseded and a new manual claim points back to it here. |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_by` | uuid | yes |  | FK → auth.users |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(source_document_id, dedupe_hash)`

<details><summary>Check constraints (12)</summary>

- `claims_accept_requires_verified_quote`: `CHECK (((status <> 'accepted'::text) OR quote_verified))`
- `claims_numeric_needs_page`: `CHECK ((((value_numeric IS NULL) AND (claim_type <> ALL (ARRAY['regulatory'::text, 'scheme'::text]))) OR (page_no IS NOT NULL)))`
- `claims_review_metadata`: `CHECK (((status = ANY (ARRAY['extracted'::text, 'superseded'::text])) OR (reviewed_at IS NOT NULL)))`
- `evidence_claims_claim_type_check`: `CHECK ((claim_type = ANY (ARRAY['cost'::text, 'price'::text, 'capacity'::text, 'yield'::text, 'utilization'::text, 'consumption'::text, 'staffing'::text, 'wage'::text, 'requirement'::text, 'regulatory'::text, 'scheme'::text, 'market'::text, 'process'::text, 'risk'::text, 'financial_summary'::text, 'other'::text])))`
- `evidence_claims_extraction_method_check`: `CHECK ((extraction_method = ANY (ARRAY['llm'::text, 'rule_based'::text, 'manual'::text, 'import'::text])))`
- `evidence_claims_extractor_confidence_check`: `CHECK (((extractor_confidence >= (0)::numeric) AND (extractor_confidence <= (1)::numeric)))`
- `evidence_claims_page_no_check`: `CHECK ((page_no >= 1))`
- `evidence_claims_period_check`: `CHECK ((period = ANY (ARRAY['one_time'::text, 'per_day'::text, 'per_month'::text, 'per_year'::text, 'per_cycle'::text, 'per_unit'::text])))`
- `evidence_claims_quote_check`: `CHECK ((length(btrim(quote)) > 0))`
- `evidence_claims_quote_match_score_check`: `CHECK (((quote_match_score >= (0)::numeric) AND (quote_match_score <= (1)::numeric)))`
- `evidence_claims_status_check`: `CHECK ((status = ANY (ARRAY['extracted'::text, 'accepted'::text, 'rejected'::text, 'superseded'::text])))`
- `evidence_claims_target_kind_check`: `CHECK ((target_kind = ANY (ARRAY['cost_item'::text, 'parameter'::text, 'revenue_stream'::text, 'operating_requirement'::text, 'regulation'::text, 'scheme'::text, 'market'::text, 'risk'::text, 'launch_task'::text, 'context'::text])))`

</details>

Triggers: `evidence_claims_freeze` → `freeze_claim()`, `evidence_claims_review_guard` → `guard_claim_review()`, `evidence_claims_updated` → `set_updated_at()`

<a id="intelevidence_links"></a>
### intel.evidence_links  ·  table

Links a claim to the record (and optionally the field) it supports or contradicts. Polymorphic by (target_table, target_id); the passport trail of any record is its evidence_links.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `claim_id` | uuid | no |  | FK → intel.evidence_claims |  |
| `target_table` | text | no |  |  |  |
| `target_id` | uuid | no |  |  |  |
| `target_field` | text | yes |  |  |  |
| `relation` | text | no | `'supports'::text` |  |  |
| `created_by` | uuid | yes |  | FK → auth.users |  |
| `research_run_id` | uuid | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (2)</summary>

- `evidence_links_relation_check`: `CHECK ((relation = ANY (ARRAY['supports'::text, 'contradicts'::text, 'context'::text])))`
- `evidence_links_target_table_check`: `CHECK ((target_table = ANY (ARRAY['cost_observations'::text, 'parameter_observations'::text, 'market_observations'::text, 'location_metrics'::text, 'supplier_quotes'::text, 'operating_requirements'::text, 'revenue_streams'::text, 'business_regulations'::text, 'regulations'::text, 'government_schemes'::text, 'business_risks'::text, 'launch_tasks'::text, 'equipment_specifications'::text, 'business_models'::text, 'business_variants'::text, 'cost_items'::text, 'founder_requirements'::text, 'lifestyle_profiles'::text, 'business_actuals'::text])))`

</details>

<a id="intelfinancial_model_templates"></a>
### intel.financial_model_templates  ·  table

Revenue archetypes supported by the deterministic finance engine (driver kinds). Seeded from the engine's ARCHETYPES metadata.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `key` | text | no |  | PK |  |
| `name` | text | no |  |  |  |
| `formula` | text | no |  |  |  |
| `description` | text | yes |  |  |  |
| `example_businesses` | text | yes |  |  |  |

<details><summary>Check constraints (1)</summary>

- `financial_model_templates_key_check`: `CHECK ((key ~ '^[a-z_]+$'::text))`

</details>

<a id="intelfinancial_parameter_definitions"></a>
### intel.financial_parameter_definitions  ·  table

Vocabulary of model parameters. template_key NULL = common to every archetype. is_required parameters must be resolved before a scenario can be computed; unresolved ones surface as research gaps.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `key` | text | no |  | PK |  |
| `template_key` | text | yes |  | FK → intel.financial_model_templates |  |
| `name` | text | no |  |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `value_kind` | text | no | `'number'::text` |  |  |
| `scope` | text | no | `'variant'::text` |  |  |
| `is_required` | boolean | no | `false` |  |  |
| `min_value` | numeric | yes |  |  |  |
| `max_value` | numeric | yes |  |  |  |
| `default_value` | numeric | yes |  |  | PlanB default ASSUMPTION used when no observation exists. When applied it becomes a financial_parameter with basis = assumption, grade D and default_rationale as its rationale — visible, counted and replaceable, never silent. |
| `default_rationale` | text | yes |  |  |  |
| `description` | text | yes |  |  |  |
| `sort_order` | integer | no | `0` |  |  |

<details><summary>Check constraints (4)</summary>

- `financial_parameter_definitions_check`: `CHECK (((default_value IS NULL) = (default_rationale IS NULL)))`
- `financial_parameter_definitions_key_check`: `CHECK ((key ~ '^[a-z0-9_]+$'::text))`
- `financial_parameter_definitions_scope_check`: `CHECK ((scope = ANY (ARRAY['variant'::text, 'revenue_stream'::text])))`
- `financial_parameter_definitions_value_kind_check`: `CHECK ((value_kind = ANY (ARRAY['number'::text, 'percent'::text, 'money'::text, 'days'::text, 'months'::text, 'count'::text])))`

</details>

<a id="intelfinancial_parameter_sources"></a>
### intel.financial_parameter_sources  ·  table

Which observations a resolved parameter value was computed from — the join that makes every model input traceable to its passports.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `financial_parameter_id` | uuid | no |  | FK → intel.financial_parameters |  |
| `cost_observation_id` | uuid | yes |  | FK → intel.cost_observations |  |
| `parameter_observation_id` | uuid | yes |  | FK → intel.parameter_observations |  |
| `market_observation_id` | uuid | yes |  | FK → intel.market_observations |  |
| `location_metric_id` | uuid | yes |  | FK → intel.location_metrics |  |

<details><summary>Check constraints (1)</summary>

- `financial_parameter_sources_check`: `CHECK ((num_nonnulls(cost_observation_id, parameter_observation_id, market_observation_id, location_metric_id) = 1))`

</details>

<a id="intelfinancial_parameters"></a>
### intel.financial_parameters  ·  table

The value the financial model actually uses for a parameter or cost item, per scenario and optional location overlay, with its basis (observation / derived / assumption), resolution method and inherited grade. History is retained: a changed value supersedes the previous row.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_variant_id` | uuid | no |  | FK → intel.business_variants |  |
| `location_id` | uuid | yes |  | FK → intel.locations |  |
| `scenario` | text | no | `'base'::text` |  |  |
| `parameter_key` | text | yes |  | FK → intel.financial_parameter_definitions |  |
| `cost_item_id` | uuid | yes |  | FK → intel.cost_items |  |
| `revenue_stream_id` | uuid | yes |  | FK → intel.revenue_streams |  |
| `value` | numeric | no |  |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `basis` | text | no |  |  |  |
| `method` | text | no |  |  |  |
| `rationale` | text | yes |  |  |  |
| `evidence_grade` | character(1) | no |  |  |  |
| `location_level` | text | yes |  |  | Geographic level of the evidence behind this value after the fallback hierarchy (city-specific, district, state, national or assumed). |
| `is_current` | boolean | no | `true` |  |  |
| `set_by` | uuid | yes |  | FK → auth.users |  |
| `set_at` | timestamp with time zone | no | `now()` |  |  |
| `superseded_at` | timestamp with time zone | yes |  |  |  |
| `research_run_id` | uuid | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |

<details><summary>Check constraints (9)</summary>

- `financial_parameters_basis_check`: `CHECK ((basis = ANY (ARRAY['observation'::text, 'derived'::text, 'assumption'::text])))`
- `financial_parameters_check`: `CHECK (((parameter_key IS NOT NULL) <> (cost_item_id IS NOT NULL)))`
- `financial_parameters_check1`: `CHECK (((basis <> 'assumption'::text) OR ((evidence_grade = 'D'::bpchar) AND (rationale IS NOT NULL) AND (length(btrim(rationale)) > 0))))`
- `financial_parameters_check2`: `CHECK (((method <> ALL (ARRAY['manual'::text, 'analyst_selected'::text])) OR (rationale IS NOT NULL)))`
- `financial_parameters_check3`: `CHECK ((is_current = (superseded_at IS NULL)))`
- `financial_parameters_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`
- `financial_parameters_location_level_check`: `CHECK ((location_level = ANY (ARRAY['locality'::text, 'city'::text, 'district'::text, 'state'::text, 'national'::text, 'unspecified'::text, 'assumed'::text])))`
- `financial_parameters_method_check`: `CHECK ((method = ANY (ARRAY['single_observation'::text, 'median'::text, 'mean'::text, 'min'::text, 'max'::text, 'latest'::text, 'analyst_selected'::text, 'formula'::text, 'manual'::text])))`
- `financial_parameters_scenario_check`: `CHECK ((scenario = ANY (ARRAY['conservative'::text, 'base'::text, 'optimistic'::text])))`

</details>

<a id="intelfinancial_scenarios"></a>
### intel.financial_scenarios  ·  table

A computed run of the deterministic finance engine: the exact input, its hash, the engine version and the outputs. Re-running the same engine version on `input` must reproduce `summary` exactly.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_variant_id` | uuid | no |  | FK → intel.business_variants |  |
| `location_id` | uuid | yes |  | FK → intel.locations |  |
| `scenario_key` | text | no |  |  |  |
| `label` | text | no |  |  |  |
| `kind` | text | no |  |  |  |
| `engine_version` | text | no |  |  |  |
| `input` | jsonb | no |  |  |  |
| `input_hash` | text | no |  |  |  |
| `summary` | jsonb | no |  |  |  |
| `monthly` | jsonb | yes |  |  |  |
| `annual` | jsonb | yes |  |  |  |
| `warnings` | jsonb | no | `'[]'::jsonb` |  |  |
| `parameter_count` | integer | no | `0` |  |  |
| `assumption_count` | integer | no | `0` |  |  |
| `grade_profile` | jsonb | no | `'{}'::jsonb` |  | Count of model inputs by evidence grade plus explicit assumptions, so a scenario's arithmetic is never mistaken for the quality of its inputs. |
| `weakest_grade` | character(1) | yes |  |  |  |
| `is_current` | boolean | no | `true` |  |  |
| `computed_at` | timestamp with time zone | no | `now()` |  |  |
| `computed_by` | uuid | yes |  | FK → auth.users |  |
| `research_run_id` | uuid | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |

<details><summary>Check constraints (3)</summary>

- `financial_scenarios_input_hash_check`: `CHECK ((input_hash ~ '^[0-9a-f]{64}$'::text))`
- `financial_scenarios_kind_check`: `CHECK ((kind = ANY (ARRAY['conservative'::text, 'base'::text, 'optimistic'::text, 'stress'::text, 'failure'::text, 'custom'::text])))`
- `financial_scenarios_weakest_grade_check`: `CHECK ((weakest_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`

</details>

<a id="intelfounder_requirements"></a>
### intel.founder_requirements  ·  table

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `business_model_id` | uuid | no |  | PK FK → intel.business_models |  |
| `mandatory_qualifications` | text | yes |  |  |  |
| `certifications` | text | yes |  |  |  |
| `industry_experience` | text | yes |  |  |  |
| `training_duration_weeks` | numeric | yes |  |  |  |
| `learning_difficulty` | integer | yes |  |  |  |
| `management_capabilities` | text | yes |  |  |  |
| `basis` | text | no | `'unverified'::text` |  |  |
| `evidence_grade` | character(1) | no | `'D'::bpchar` |  |  |
| `notes` | text | yes |  |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (4)</summary>

- `founder_requirements_basis_check`: `CHECK ((basis = ANY (ARRAY['evidence'::text, 'owner_interviews'::text, 'analyst_judgement'::text, 'unverified'::text])))`
- `founder_requirements_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`
- `founder_requirements_learning_difficulty_check`: `CHECK (((learning_difficulty >= 1) AND (learning_difficulty <= 5)))`
- `founder_requirements_training_duration_weeks_check`: `CHECK ((training_duration_weeks >= (0)::numeric))`

</details>

Triggers: `founder_requirements_updated` → `set_updated_at()`

<a id="intelgovernment_schemes"></a>
### intel.government_schemes  ·  table

Government support schemes (subsidy, credit guarantee, interest subvention, training). Scheme terms change frequently; revalidate_by drives freshness monitoring.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `slug` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `administering_body` | text | no |  |  |  |
| `scheme_type` | text | no |  |  |  |
| `jurisdiction_location_id` | uuid | yes |  | FK → intel.locations |  |
| `benefit_summary` | text | yes |  |  |  |
| `eligibility_summary` | text | yes |  |  |  |
| `application_url` | text | yes |  |  |  |
| `status` | text | no | `'unknown'::text` |  |  |
| `source_id` | uuid | yes |  | FK → intel.sources |  |
| `source_document_id` | uuid | yes |  | FK → intel.source_documents |  |
| `verification_status` | text | no | `'unverified'::text` |  |  |
| `last_verified_on` | date | yes |  |  |  |
| `revalidate_by` | date | yes |  |  |  |
| `evidence_grade` | character(1) | no | `'D'::bpchar` |  |  |
| `notes` | text | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(slug)`

<details><summary>Check constraints (6)</summary>

- `government_schemes_check`: `CHECK (((verification_status <> 'verified'::text) OR ((last_verified_on IS NOT NULL) AND (source_id IS NOT NULL))))`
- `government_schemes_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`
- `government_schemes_scheme_type_check`: `CHECK ((scheme_type = ANY (ARRAY['capital_subsidy'::text, 'interest_subvention'::text, 'credit_guarantee'::text, 'collateral_free_loan'::text, 'training'::text, 'marketing_support'::text, 'tax_incentive'::text, 'other'::text])))`
- `government_schemes_slug_check`: `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`
- `government_schemes_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'unknown'::text])))`
- `government_schemes_verification_status_check`: `CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'disputed'::text, 'outdated'::text])))`

</details>

Triggers: `government_schemes_updated` → `set_updated_at()`

<a id="intelindustries"></a>
### intel.industries  ·  table

Hierarchical industry taxonomy (sector → sub-sector). Business operating models hang off the leaves; an industry is never itself a business model.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `slug` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `parent_id` | uuid | yes |  | FK → intel.industries |  |
| `description` | text | yes |  |  |  |
| `sort_order` | integer | no | `0` |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(slug)`

<details><summary>Check constraints (1)</summary>

- `industries_slug_check`: `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`

</details>

Triggers: `industries_updated` → `set_updated_at()`

<a id="intellaunch_tasks"></a>
### intel.launch_tasks  ·  table

Establishment process / launch checklist for a business model, ordered by phase and sequence.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_model_id` | uuid | no |  | FK → intel.business_models |  |
| `phase` | text | no |  |  |  |
| `sequence_no` | integer | no |  |  |  |
| `title` | text | no |  |  |  |
| `description` | text | yes |  |  |  |
| `typical_duration_days` | numeric | yes |  |  |  |
| `depends_on` | uuid | yes |  | FK → intel.launch_tasks |  |
| `basis` | text | no | `'unverified'::text` |  |  |
| `research_run_id` | uuid | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(business_model_id, phase, sequence_no)`

<details><summary>Check constraints (3)</summary>

- `launch_tasks_basis_check`: `CHECK ((basis = ANY (ARRAY['evidence'::text, 'owner_interviews'::text, 'analyst_judgement'::text, 'unverified'::text])))`
- `launch_tasks_phase_check`: `CHECK ((phase = ANY (ARRAY['validate'::text, 'plan'::text, 'register_and_license'::text, 'site_and_setup'::text, 'procure'::text, 'hire_and_train'::text, 'launch'::text, 'stabilise'::text])))`
- `launch_tasks_typical_duration_days_check`: `CHECK ((typical_duration_days >= (0)::numeric))`

</details>

Triggers: `launch_tasks_updated` → `set_updated_at()`

<a id="intellifestyle_profiles"></a>
### intel.lifestyle_profiles  ·  table

What running the variant is like for the owner. These are judgements unless basis = owner_interviews; the grade says how far to trust them.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `business_variant_id` | uuid | no |  | PK FK → intel.business_variants |  |
| `owner_involvement` | text | yes |  |  |  |
| `owner_hours_per_week_low` | numeric | yes |  |  |  |
| `owner_hours_per_week_high` | numeric | yes |  |  |  |
| `weekend_work` | text | yes |  |  |  |
| `physical_demand` | integer | yes |  |  |  |
| `employee_dependence` | integer | yes |  |  |  |
| `remote_manageability` | integer | yes |  |  |  |
| `operational_complexity` | integer | yes |  |  |  |
| `basis` | text | no | `'unverified'::text` |  |  |
| `evidence_grade` | character(1) | no | `'D'::bpchar` |  |  |
| `notes` | text | yes |  |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (10)</summary>

- `lifestyle_profiles_basis_check`: `CHECK ((basis = ANY (ARRAY['evidence'::text, 'owner_interviews'::text, 'analyst_judgement'::text, 'unverified'::text])))`
- `lifestyle_profiles_check`: `CHECK (((owner_hours_per_week_high IS NULL) OR (owner_hours_per_week_high >= owner_hours_per_week_low)))`
- `lifestyle_profiles_employee_dependence_check`: `CHECK (((employee_dependence >= 1) AND (employee_dependence <= 5)))`
- `lifestyle_profiles_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`
- `lifestyle_profiles_operational_complexity_check`: `CHECK (((operational_complexity >= 1) AND (operational_complexity <= 5)))`
- `lifestyle_profiles_owner_hours_per_week_low_check`: `CHECK ((owner_hours_per_week_low >= (0)::numeric))`
- `lifestyle_profiles_owner_involvement_check`: `CHECK ((owner_involvement = ANY (ARRAY['full_time_hands_on'::text, 'full_time_managerial'::text, 'part_time'::text, 'semi_absentee'::text, 'absentee'::text])))`
- `lifestyle_profiles_physical_demand_check`: `CHECK (((physical_demand >= 1) AND (physical_demand <= 5)))`
- `lifestyle_profiles_remote_manageability_check`: `CHECK (((remote_manageability >= 1) AND (remote_manageability <= 5)))`
- `lifestyle_profiles_weekend_work_check`: `CHECK ((weekend_work = ANY (ARRAY['none'::text, 'occasional'::text, 'regular'::text, 'peak_days'::text])))`

</details>

Triggers: `lifestyle_profiles_updated` → `set_updated_at()`

<a id="intellocation_metrics"></a>
### intel.location_metrics  ·  table

Location-specific overlay values (commercial rent, wages, tariffs, population…) attached to exactly one node of the geography tree. City and district values are separate rows on separate nodes.

_RLS: enabled (6 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `location_id` | uuid | no |  | FK → intel.locations |  |
| `metric_key` | text | no |  | FK → intel.metric_definitions |  |
| `segment` | text | yes |  |  | Optional sub-segment of the metric (e.g. "high street ground floor", "MIDC industrial shed", "unskilled"). |
| `value` | numeric | no |  |  |  |
| `value_low` | numeric | yes |  |  |  |
| `value_high` | numeric | yes |  |  |  |
| `currency` | character(3) | yes |  |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `period` | text | yes |  |  |  |
| `observed_on` | date | no |  |  |  |
| `observed_on_precision` | text | no | `'day'::text` |  |  |
| `geographic_scope` | text | no | `'unspecified'::text` |  |  |
| `source_id` | uuid | no |  | FK → intel.sources |  |
| `source_document_id` | uuid | yes |  | FK → intel.source_documents |  |
| `page_ref` | text | yes |  |  |  |
| `section_ref` | text | yes |  |  |  |
| `tax_treatment` | text | no | `'unknown'::text` |  |  |
| `evidence_type` | text | no |  |  |  |
| `verification_status` | text | no | `'unverified'::text` |  |  |
| `verified_by` | uuid | yes |  | FK → auth.users |  |
| `verified_at` | timestamp with time zone | yes |  |  |  |
| `evidence_grade` | character(1) | no | `'D'::bpchar` |  |  |
| `grade_basis` | text | yes |  |  |  |
| `analyst_notes` | text | yes |  |  |  |
| `valid_until` | date | yes |  |  |  |
| `revalidate_by` | date | yes |  |  |  |
| `supersedes_id` | uuid | yes |  | FK → intel.location_metrics |  |
| `research_run_id` | uuid | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_by` | uuid | yes |  | FK → auth.users |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (7)</summary>

- `location_metrics_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`
- `location_metrics_evidence_type_check`: `CHECK ((evidence_type = ANY (ARRAY['government_project_report'::text, 'government_tariff_or_notification'::text, 'regulatory_fee_schedule'::text, 'supplier_quote'::text, 'manufacturer_catalogue'::text, 'owner_documented'::text, 'owner_reported'::text, 'market_report'::text, 'listing_observation'::text, 'analyst_estimate'::text, 'llm_estimate'::text])))`
- `location_metrics_geographic_scope_check`: `CHECK ((geographic_scope = ANY (ARRAY['locality'::text, 'city'::text, 'district'::text, 'state'::text, 'national'::text, 'unspecified'::text])))`
- `location_metrics_observed_on_precision_check`: `CHECK ((observed_on_precision = ANY (ARRAY['day'::text, 'month'::text, 'year'::text, 'unknown'::text])))`
- `location_metrics_period_check`: `CHECK ((period = ANY (ARRAY['one_time'::text, 'per_day'::text, 'per_month'::text, 'per_year'::text, 'per_cycle'::text, 'per_unit'::text, 'point_in_time'::text])))`
- `location_metrics_tax_treatment_check`: `CHECK ((tax_treatment = ANY (ARRAY['inclusive'::text, 'exclusive'::text, 'unknown'::text, 'not_applicable'::text])))`
- `location_metrics_verification_status_check`: `CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'disputed'::text, 'rejected'::text])))`

</details>

Triggers: `location_metrics_freeze` → `freeze_observation()`, `location_metrics_guard` → `guard_observation()`, `location_metrics_updated` → `set_updated_at()`, `location_metrics_verify_role` → `guard_verification_role()`

<a id="intellocations"></a>
### intel.locations  ·  table

Administrative geography tree (country → state → district → city → locality). City-level and district-level data are kept on separate nodes. Official codes are left NULL until verified.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `slug` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `location_type` | text | no |  |  |  |
| `parent_id` | uuid | yes |  | FK → intel.locations |  |
| `tier` | text | yes |  |  |  |
| `iso_code` | text | yes |  |  |  |
| `lgd_code` | text | yes |  |  |  |
| `census_2011_code` | text | yes |  |  |  |
| `is_pilot` | boolean | no | `false` |  |  |
| `notes` | text | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(slug)`

<details><summary>Check constraints (4)</summary>

- `locations_location_type_check`: `CHECK ((location_type = ANY (ARRAY['country'::text, 'state'::text, 'division'::text, 'district'::text, 'city'::text, 'locality'::text])))`
- `locations_root_is_country`: `CHECK (((parent_id IS NOT NULL) OR (location_type = 'country'::text)))`
- `locations_slug_check`: `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`
- `locations_tier_check`: `CHECK ((tier = ANY (ARRAY['metro'::text, 'tier1'::text, 'tier2'::text, 'tier3'::text, 'rural'::text])))`

</details>

Triggers: `locations_updated` → `set_updated_at()`

<a id="intelmarket_observations"></a>
### intel.market_observations  ·  table

Market intelligence datapoints: local selling prices, competitor counts, demand indicators, distribution margins. A competitor count or population figure is an indicator, never a demand estimate.

_RLS: enabled (6 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_model_id` | uuid | yes |  | FK → intel.business_models |  |
| `location_id` | uuid | yes |  | FK → intel.locations |  |
| `metric_key` | text | no |  | FK → intel.metric_definitions |  |
| `subject` | text | yes |  |  |  |
| `value` | numeric | yes |  |  |  |
| `value_low` | numeric | yes |  |  |  |
| `value_high` | numeric | yes |  |  |  |
| `value_text` | text | yes |  |  |  |
| `currency` | character(3) | yes |  |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `period` | text | yes |  |  |  |
| `observed_on` | date | no |  |  |  |
| `observed_on_precision` | text | no | `'day'::text` |  |  |
| `geographic_scope` | text | no | `'unspecified'::text` |  |  |
| `source_id` | uuid | no |  | FK → intel.sources |  |
| `source_document_id` | uuid | yes |  | FK → intel.source_documents |  |
| `page_ref` | text | yes |  |  |  |
| `section_ref` | text | yes |  |  |  |
| `tax_treatment` | text | no | `'unknown'::text` |  |  |
| `evidence_type` | text | no |  |  |  |
| `verification_status` | text | no | `'unverified'::text` |  |  |
| `verified_by` | uuid | yes |  | FK → auth.users |  |
| `verified_at` | timestamp with time zone | yes |  |  |  |
| `evidence_grade` | character(1) | no | `'D'::bpchar` |  |  |
| `grade_basis` | text | yes |  |  |  |
| `analyst_notes` | text | yes |  |  |  |
| `valid_until` | date | yes |  |  |  |
| `revalidate_by` | date | yes |  |  |  |
| `supersedes_id` | uuid | yes |  | FK → intel.market_observations |  |
| `research_run_id` | uuid | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_by` | uuid | yes |  | FK → auth.users |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (9)</summary>

- `market_observations_check`: `CHECK (((value IS NOT NULL) OR (value_text IS NOT NULL)))`
- `market_observations_check1`: `CHECK (((business_model_id IS NOT NULL) OR (location_id IS NOT NULL)))`
- `market_observations_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`
- `market_observations_evidence_type_check`: `CHECK ((evidence_type = ANY (ARRAY['government_project_report'::text, 'government_tariff_or_notification'::text, 'regulatory_fee_schedule'::text, 'supplier_quote'::text, 'manufacturer_catalogue'::text, 'owner_documented'::text, 'owner_reported'::text, 'market_report'::text, 'listing_observation'::text, 'analyst_estimate'::text, 'llm_estimate'::text])))`
- `market_observations_geographic_scope_check`: `CHECK ((geographic_scope = ANY (ARRAY['locality'::text, 'city'::text, 'district'::text, 'state'::text, 'national'::text, 'unspecified'::text])))`
- `market_observations_observed_on_precision_check`: `CHECK ((observed_on_precision = ANY (ARRAY['day'::text, 'month'::text, 'year'::text, 'unknown'::text])))`
- `market_observations_period_check`: `CHECK ((period = ANY (ARRAY['one_time'::text, 'per_day'::text, 'per_month'::text, 'per_year'::text, 'per_cycle'::text, 'per_unit'::text, 'point_in_time'::text])))`
- `market_observations_tax_treatment_check`: `CHECK ((tax_treatment = ANY (ARRAY['inclusive'::text, 'exclusive'::text, 'unknown'::text, 'not_applicable'::text])))`
- `market_observations_verification_status_check`: `CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'disputed'::text, 'rejected'::text])))`

</details>

Triggers: `market_observations_freeze` → `freeze_observation()`, `market_observations_guard` → `guard_observation()`, `market_observations_updated` → `set_updated_at()`, `market_observations_verify_role` → `guard_verification_role()`

<a id="intelmetric_definitions"></a>
### intel.metric_definitions  ·  table

Controlled vocabulary of metric keys for location_metrics, market_observations and business_actuals.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `key` | text | no |  | PK |  |
| `name` | text | no |  |  |  |
| `applies_to` | text | no |  |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `period` | text | yes |  |  |  |
| `description` | text | yes |  |  |  |

<details><summary>Check constraints (3)</summary>

- `metric_definitions_applies_to_check`: `CHECK ((applies_to = ANY (ARRAY['location'::text, 'market'::text, 'actuals'::text])))`
- `metric_definitions_key_check`: `CHECK ((key ~ '^[a-z0-9_]+$'::text))`
- `metric_definitions_period_check`: `CHECK ((period = ANY (ARRAY['one_time'::text, 'per_day'::text, 'per_month'::text, 'per_year'::text, 'per_unit'::text, 'point_in_time'::text])))`

</details>

<a id="intelobservation_conflicts"></a>
### intel.observation_conflicts  ·  table

Detected disagreement between comparable observations of the same subject (spread above tolerance). Analysts resolve by verifying/rejecting observations or accepting a range; the observations themselves are never deleted.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_variant_id` | uuid | no |  | FK → intel.business_variants |  |
| `cost_item_id` | uuid | yes |  | FK → intel.cost_items |  |
| `parameter_key` | text | yes |  | FK → intel.financial_parameter_definitions |  |
| `observation_count` | integer | no |  |  |  |
| `min_value` | numeric | no |  |  |  |
| `max_value` | numeric | no |  |  |  |
| `spread_pct` | numeric | no |  |  |  |
| `status` | text | no | `'open'::text` |  |  |
| `resolution_note` | text | yes |  |  |  |
| `resolved_by` | uuid | yes |  | FK → auth.users |  |
| `resolved_at` | timestamp with time zone | yes |  |  |  |
| `detected_at` | timestamp with time zone | no | `now()` |  |  |
| `last_seen_at` | timestamp with time zone | no | `now()` |  |  |
| `research_run_id` | uuid | yes |  |  |  |

<details><summary>Check constraints (3)</summary>

- `observation_conflicts_check`: `CHECK (((cost_item_id IS NULL) <> (parameter_key IS NULL)))`
- `observation_conflicts_check1`: `CHECK (((status = 'open'::text) OR ((resolved_at IS NOT NULL) AND (resolution_note IS NOT NULL))))`
- `observation_conflicts_status_check`: `CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'accepted_as_range'::text])))`

</details>

<a id="inteloperating_requirements"></a>
### intel.operating_requirements  ·  table

Infrastructure and operating prerequisites of a variant: space, land, electricity, water, ventilation, connectivity, transport, environmental.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_variant_id` | uuid | no |  | FK → intel.business_variants |  |
| `requirement_type` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `value_numeric` | numeric | yes |  |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `value_text` | text | yes |  |  |  |
| `is_critical` | boolean | no | `false` |  |  |
| `basis` | text | no | `'unverified'::text` |  |  |
| `evidence_grade` | character(1) | no | `'D'::bpchar` |  |  |
| `verification_status` | text | no | `'unverified'::text` |  |  |
| `notes` | text | yes |  |  |  |
| `research_run_id` | uuid | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (5)</summary>

- `operating_requirements_basis_check`: `CHECK ((basis = ANY (ARRAY['evidence'::text, 'analyst_judgement'::text, 'unverified'::text])))`
- `operating_requirements_check`: `CHECK (((value_numeric IS NOT NULL) OR (value_text IS NOT NULL)))`
- `operating_requirements_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`
- `operating_requirements_requirement_type_check`: `CHECK ((requirement_type = ANY (ARRAY['built_up_space'::text, 'land'::text, 'power_load'::text, 'water'::text, 'ventilation'::text, 'connectivity'::text, 'transport_access'::text, 'storage'::text, 'environmental'::text, 'zoning'::text, 'working_hours'::text, 'other'::text])))`
- `operating_requirements_verification_status_check`: `CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'disputed'::text, 'rejected'::text])))`

</details>

Triggers: `operating_requirements_updated` → `set_updated_at()`

<a id="intelparameter_observations"></a>
### intel.parameter_observations  ·  table

Observed values of operating and revenue parameters (selling price, capacity, utilisation, yield, transactions/day, working days…) with the same passport as cost observations. Append-only.

_RLS: enabled (6 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_variant_id` | uuid | no |  | FK → intel.business_variants |  |
| `parameter_key` | text | no |  | FK → intel.financial_parameter_definitions | Key in intel.financial_parameter_definitions (FK added in migration 0006). |
| `revenue_stream_id` | uuid | yes |  | FK → intel.revenue_streams |  |
| `value` | numeric | no |  |  |  |
| `value_low` | numeric | yes |  |  |  |
| `value_high` | numeric | yes |  |  |  |
| `currency` | character(3) | yes |  |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `period` | text | yes |  |  |  |
| `observed_on` | date | no |  |  |  |
| `observed_on_precision` | text | no | `'day'::text` |  |  |
| `location_id` | uuid | yes |  | FK → intel.locations |  |
| `geographic_scope` | text | no | `'unspecified'::text` |  |  |
| `scale_note` | text | yes |  |  |  |
| `projection_year` | integer | yes |  |  | When the source gives a multi-year projection, the projection year this value belongs to (1 = first operating year). |
| `source_id` | uuid | no |  | FK → intel.sources |  |
| `source_document_id` | uuid | yes |  | FK → intel.source_documents |  |
| `page_ref` | text | yes |  |  |  |
| `section_ref` | text | yes |  |  |  |
| `tax_treatment` | text | no | `'unknown'::text` |  |  |
| `evidence_type` | text | no |  |  |  |
| `verification_status` | text | no | `'unverified'::text` |  |  |
| `verified_by` | uuid | yes |  | FK → auth.users |  |
| `verified_at` | timestamp with time zone | yes |  |  |  |
| `evidence_grade` | character(1) | no | `'D'::bpchar` |  |  |
| `grade_basis` | text | yes |  |  |  |
| `analyst_notes` | text | yes |  |  |  |
| `valid_until` | date | yes |  |  |  |
| `revalidate_by` | date | yes |  |  |  |
| `supersedes_id` | uuid | yes |  | FK → intel.parameter_observations |  |
| `research_run_id` | uuid | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_by` | uuid | yes |  | FK → auth.users |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (9)</summary>

- `parameter_observations_check`: `CHECK (((value_low IS NULL) OR (value_high IS NULL) OR (value_low <= value_high)))`
- `parameter_observations_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`
- `parameter_observations_evidence_type_check`: `CHECK ((evidence_type = ANY (ARRAY['government_project_report'::text, 'government_tariff_or_notification'::text, 'regulatory_fee_schedule'::text, 'supplier_quote'::text, 'manufacturer_catalogue'::text, 'owner_documented'::text, 'owner_reported'::text, 'market_report'::text, 'listing_observation'::text, 'analyst_estimate'::text, 'llm_estimate'::text])))`
- `parameter_observations_geographic_scope_check`: `CHECK ((geographic_scope = ANY (ARRAY['locality'::text, 'city'::text, 'district'::text, 'state'::text, 'national'::text, 'unspecified'::text])))`
- `parameter_observations_observed_on_precision_check`: `CHECK ((observed_on_precision = ANY (ARRAY['day'::text, 'month'::text, 'year'::text, 'unknown'::text])))`
- `parameter_observations_period_check`: `CHECK ((period = ANY (ARRAY['one_time'::text, 'per_day'::text, 'per_month'::text, 'per_year'::text, 'per_cycle'::text, 'per_unit'::text])))`
- `parameter_observations_projection_year_check`: `CHECK (((projection_year >= 1) AND (projection_year <= 30)))`
- `parameter_observations_tax_treatment_check`: `CHECK ((tax_treatment = ANY (ARRAY['inclusive'::text, 'exclusive'::text, 'unknown'::text, 'not_applicable'::text])))`
- `parameter_observations_verification_status_check`: `CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'disputed'::text, 'rejected'::text])))`

</details>

Triggers: `parameter_observations_freeze` → `freeze_observation()`, `parameter_observations_guard` → `guard_observation()`, `parameter_observations_updated` → `set_updated_at()`, `parameter_observations_verify_role` → `guard_verification_role()`

<a id="intelraw_materials"></a>
### intel.raw_materials  ·  table

Raw material / consumable catalogue shared across models. Prices are observations (cost_observations / market_observations), never columns here.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `slug` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `default_unit_code` | text | yes |  | FK → intel.units |  |
| `hsn_code` | text | yes |  |  |  |
| `description` | text | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(slug)`

<details><summary>Check constraints (1)</summary>

- `raw_materials_slug_check`: `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`

</details>

<a id="intelregulations"></a>
### intel.regulations  ·  table

Licences, registrations, approvals, certifications and inspections, each tied to its issuing authority and jurisdiction, with verification date and revalidation deadline. Regulatory facts go stale; unverified entries are leads, not facts.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `slug` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `regulation_type` | text | no |  |  |  |
| `issuing_authority` | text | no |  |  |  |
| `jurisdiction_location_id` | uuid | yes |  | FK → intel.locations |  |
| `jurisdiction_level` | text | no |  |  |  |
| `legal_basis` | text | yes |  |  |  |
| `description` | text | yes |  |  |  |
| `eligibility_notes` | text | yes |  |  |  |
| `application_portal_url` | text | yes |  |  |  |
| `fee_notes` | text | yes |  |  |  |
| `validity_notes` | text | yes |  |  |  |
| `typical_timeline_days` | numeric | yes |  |  |  |
| `source_id` | uuid | yes |  | FK → intel.sources |  |
| `source_document_id` | uuid | yes |  | FK → intel.source_documents |  |
| `verification_status` | text | no | `'unverified'::text` |  |  |
| `verified_by` | uuid | yes |  | FK → auth.users |  |
| `last_verified_on` | date | yes |  |  |  |
| `revalidate_by` | date | yes |  |  |  |
| `evidence_grade` | character(1) | no | `'D'::bpchar` |  |  |
| `notes` | text | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(slug)`

<details><summary>Check constraints (9)</summary>

- `regulations_check`: `CHECK (((verification_status <> 'verified'::text) OR ((last_verified_on IS NOT NULL) AND (source_id IS NOT NULL))))`
- `regulations_check1`: `CHECK (((evidence_grade <> 'A'::bpchar) OR (verification_status = 'verified'::text)))`
- `regulations_check2`: `CHECK ((((data_origin)::text <> 'demo'::text) OR ((evidence_grade = 'D'::bpchar) AND (verification_status <> 'verified'::text))))`
- `regulations_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`
- `regulations_jurisdiction_level_check`: `CHECK ((jurisdiction_level = ANY (ARRAY['central'::text, 'state'::text, 'local_body'::text])))`
- `regulations_regulation_type_check`: `CHECK ((regulation_type = ANY (ARRAY['registration'::text, 'licence'::text, 'approval'::text, 'certification'::text, 'inspection'::text, 'ongoing_compliance'::text])))`
- `regulations_slug_check`: `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`
- `regulations_typical_timeline_days_check`: `CHECK ((typical_timeline_days >= (0)::numeric))`
- `regulations_verification_status_check`: `CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'disputed'::text, 'outdated'::text])))`

</details>

Triggers: `regulations_updated` → `set_updated_at()`

<a id="intelresearch_reviews"></a>
### intel.research_reviews  ·  table

Append-only log of every human review decision (claim accepted/rejected/corrected, observation verified/disputed, version approved…). Negative decisions must carry a reason.

_RLS: enabled (6 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `subject_type` | text | no |  |  |  |
| `subject_id` | uuid | no |  |  |  |
| `business_model_id` | uuid | yes |  | FK → intel.business_models |  |
| `decision` | text | no |  |  |  |
| `comments` | text | yes |  |  |  |
| `reviewer` | uuid | yes |  | FK → auth.users |  |
| `reviewed_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (3)</summary>

- `research_reviews_check`: `CHECK (((decision <> ALL (ARRAY['reject'::text, 'request_changes'::text, 'correct'::text, 'dispute'::text])) OR ((comments IS NOT NULL) AND (length(btrim(comments)) > 0))))`
- `research_reviews_decision_check`: `CHECK ((decision = ANY (ARRAY['approve'::text, 'reject'::text, 'request_changes'::text, 'accept'::text, 'correct'::text, 'verify'::text, 'dispute'::text, 'resolve'::text])))`
- `research_reviews_subject_type_check`: `CHECK ((subject_type = ANY (ARRAY['business_version'::text, 'evidence_claim'::text, 'cost_observation'::text, 'parameter_observation'::text, 'market_observation'::text, 'location_metric'::text, 'supplier_quote'::text, 'owner_interview'::text, 'regulation'::text, 'source'::text, 'observation_conflict'::text])))`

</details>

Triggers: `research_reviews_append_only` → `forbid_mutation()`

<a id="intelresearch_tasks"></a>
### intel.research_tasks  ·  table

Actionable research work: gaps found by the pipeline (quotes to obtain, rents to confirm, licences to verify, owners to interview, conflicts to resolve) and manually raised tasks.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_model_id` | uuid | yes |  | FK → intel.business_models |  |
| `business_variant_id` | uuid | yes |  | FK → intel.business_variants |  |
| `source_id` | uuid | yes |  | FK → intel.sources |  |
| `task_type` | text | no |  |  |  |
| `title` | text | no |  |  |  |
| `description` | text | yes |  |  |  |
| `instructions` | text | yes |  |  |  |
| `template_key` | text | yes |  |  | Key of the enquiry/questionnaire template in research/templates to use for this task. |
| `target_table` | text | yes |  |  |  |
| `target_id` | uuid | yes |  |  |  |
| `target_key` | text | yes |  |  |  |
| `priority` | integer | no | `3` |  |  |
| `requires_human` | boolean | no | `true` |  |  |
| `status` | text | no | `'open'::text` |  |  |
| `assignee` | uuid | yes |  | FK → auth.users |  |
| `due_on` | date | yes |  |  |  |
| `generated_by` | text | no | `'manual'::text` |  |  |
| `dedupe_key` | text | yes |  |  | Stable key of the gap that produced the task; at most one live task per key, so re-running gap analysis never duplicates work. |
| `research_run_id` | uuid | yes |  |  |  |
| `resolution_note` | text | yes |  |  |  |
| `completed_at` | timestamp with time zone | yes |  |  |  |
| `completed_by` | uuid | yes |  | FK → auth.users |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_by` | uuid | yes |  | FK → auth.users |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (4)</summary>

- `research_tasks_check`: `CHECK (((status <> ALL (ARRAY['done'::text, 'cancelled'::text, 'auto_closed'::text])) OR (completed_at IS NOT NULL)))`
- `research_tasks_priority_check`: `CHECK (((priority >= 1) AND (priority <= 4)))`
- `research_tasks_status_check`: `CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'blocked'::text, 'done'::text, 'cancelled'::text, 'auto_closed'::text])))`
- `research_tasks_task_type_check`: `CHECK ((task_type = ANY (ARRAY['obtain_supplier_quotes'::text, 'confirm_local_rent'::text, 'collect_local_price'::text, 'verify_licence'::text, 'interview_owner'::text, 'confirm_capacity'::text, 'investigate_margin'::text, 'resolve_conflict'::text, 'revalidate_evidence'::text, 'find_source_document'::text, 'review_claims'::text, 'verify_source_terms'::text, 'define_assumption'::text, 'complete_record_section'::text, 'ocr_document'::text, 'other'::text])))`

</details>

Triggers: `research_tasks_updated` → `set_updated_at()`

<a id="intelrevenue_streams"></a>
### intel.revenue_streams  ·  table

How a variant earns: pricing unit, volume driver (finance-engine driver kind), payment cycle and seasonality. Price/volume values are parameter observations.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_variant_id` | uuid | no |  | FK → intel.business_variants |  |
| `key` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `driver_kind` | text | no |  |  |  |
| `pricing_unit_code` | text | yes |  | FK → intel.units |  |
| `pricing_unit_text` | text | yes |  |  |  |
| `customer_segment` | text | yes |  |  |  |
| `payment_terms_days` | integer | yes |  |  |  |
| `seasonality_profile` | numeric[] | yes |  |  |  |
| `seasonality_basis` | text | yes |  |  |  |
| `share_of_revenue_note` | text | yes |  |  |  |
| `notes` | text | yes |  |  |  |
| `research_run_id` | uuid | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(business_variant_id, key)`

<details><summary>Check constraints (5)</summary>

- `revenue_streams_driver_kind_check`: `CHECK ((driver_kind = ANY (ARRAY['transactions'::text, 'capacity_utilization'::text, 'area_yield'::text, 'enrolment'::text, 'occupancy'::text, 'fleet_utilization'::text, 'engagements'::text])))`
- `revenue_streams_key_check`: `CHECK ((key ~ '^[a-z0-9_]+$'::text))`
- `revenue_streams_payment_terms_days_check`: `CHECK ((payment_terms_days >= 0))`
- `revenue_streams_seasonality_basis_check`: `CHECK ((seasonality_basis = ANY (ARRAY['evidence'::text, 'analyst_judgement'::text, 'unverified'::text])))`
- `revenue_streams_seasonality_profile_check`: `CHECK (((seasonality_profile IS NULL) OR (array_length(seasonality_profile, 1) = 12)))`

</details>

Triggers: `revenue_streams_updated` → `set_updated_at()`

<a id="intelskills"></a>
### intel.skills  ·  table

Capability vocabulary shared by business requirements and customer profiles. Transferable capabilities (operations, sales, procurement…) matter more than job titles.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `slug` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `skill_type` | text | no |  |  |  |
| `description` | text | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(slug)`

<details><summary>Check constraints (2)</summary>

- `skills_skill_type_check`: `CHECK ((skill_type = ANY (ARRAY['transferable'::text, 'technical'::text, 'regulatory'::text, 'domain'::text])))`
- `skills_slug_check`: `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`

</details>

<a id="intelsource_documents"></a>
### intel.source_documents  ·  table

One row per distinct original document (deduplicated by SHA-256). The file itself lives in private storage (bucket + path); this row is its provenance record.

_RLS: enabled (6 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `source_id` | uuid | no |  | FK → intel.sources |  |
| `title` | text | no |  |  |  |
| `doc_type` | text | no | `'project_report'::text` |  |  |
| `url` | text | yes |  |  |  |
| `listing_page_url` | text | yes |  |  |  |
| `retrieved_at` | timestamp with time zone | no | `now()` |  |  |
| `retrieval_method` | text | no | `'adapter'::text` |  |  |
| `http_etag` | text | yes |  |  |  |
| `http_last_modified` | text | yes |  |  |  |
| `mime_type` | text | no |  |  |  |
| `byte_size` | bigint | no |  |  |  |
| `sha256` | text | no |  |  |  |
| `storage_bucket` | text | no | `'evidence'::text` |  |  |
| `storage_path` | text | no |  |  |  |
| `page_count` | integer | yes |  |  |  |
| `language` | text | no | `'en'::text` |  |  |
| `document_date` | date | yes |  |  |  |
| `document_date_precision` | text | no | `'unknown'::text` |  |  |
| `price_basis_year` | integer | yes |  |  | Year the document's prices refer to, when determinable. Old benchmarks are downgraded by the evidence-grade rules. |
| `text_status` | text | no | `'pending'::text` |  |  |
| `licence_snapshot` | text | yes |  |  |  |
| `superseded_by` | uuid | yes |  | FK → intel.source_documents |  |
| `uploaded_by` | uuid | yes |  | FK → auth.users |  |
| `notes` | text | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(sha256)`

<details><summary>Check constraints (7)</summary>

- `source_documents_byte_size_check`: `CHECK ((byte_size > 0))`
- `source_documents_doc_type_check`: `CHECK ((doc_type = ANY (ARRAY['project_report'::text, 'unit_cost_publication'::text, 'tariff_order'::text, 'notification'::text, 'fee_schedule'::text, 'catalogue'::text, 'quotation'::text, 'market_report'::text, 'district_profile'::text, 'dataset'::text, 'training_manual'::text, 'interview_transcript'::text, 'franchise_document'::text, 'web_page'::text, 'other'::text])))`
- `source_documents_document_date_precision_check`: `CHECK ((document_date_precision = ANY (ARRAY['day'::text, 'month'::text, 'year'::text, 'unknown'::text])))`
- `source_documents_price_basis_year_check`: `CHECK (((price_basis_year >= 1990) AND (price_basis_year <= 2100)))`
- `source_documents_retrieval_method_check`: `CHECK ((retrieval_method = ANY (ARRAY['adapter'::text, 'manual_upload'::text, 'email'::text, 'api'::text])))`
- `source_documents_sha256_check`: `CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text))`
- `source_documents_text_status_check`: `CHECK ((text_status = ANY (ARRAY['pending'::text, 'extracted'::text, 'needs_ocr'::text, 'failed'::text])))`

</details>

Triggers: `source_documents_updated` → `set_updated_at()`

<a id="intelsources"></a>
### intel.sources  ·  table

Research source registry: what each source offers, how it may be accessed, and whether it may legally be collected and commercially reused. Gates all automated adapters.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `slug` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `publisher` | text | yes |  |  |  |
| `source_type` | text | no |  |  |  |
| `authority_level` | text | no |  |  |  |
| `base_url` | text | yes |  |  |  |
| `information_available` | text | yes |  |  |  |
| `geographic_coverage` | text | yes |  |  |  |
| `access_method` | text | no |  |  |  |
| `accessibility` | text | no | `'untested'::text` |  |  |
| `accessibility_notes` | text | yes |  |  |  |
| `api_available` | text | no | `'unknown'::text` |  |  |
| `api_notes` | text | yes |  |  |  |
| `requires_auth` | boolean | no | `false` |  |  |
| `robots_txt_url` | text | yes |  |  |  |
| `robots_txt_status` | text | yes |  |  |  |
| `robots_txt_summary` | text | yes |  |  |  |
| `licence_name` | text | yes |  |  |  |
| `licence_url` | text | yes |  |  |  |
| `licence_quoted_terms` | text | yes |  |  |  |
| `reuse_status` | text | no | `'unclear'::text` |  | Legal reuse position as read from the source's own terms. permission_required/unclear/prohibited sources cannot have automated ingestion enabled (see constraint). |
| `reuse_notes` | text | yes |  |  |  |
| `permission_contact` | text | yes |  |  |  |
| `permission_granted_on` | date | yes |  |  |  |
| `permission_evidence` | text | yes |  |  |  |
| `terms_checked_on` | date | yes |  |  |  |
| `registry_confidence` | text | no | `'unverified'::text` |  | verified = licence/terms page was actually read on terms_checked_on. unverified = recorded from prior knowledge; must be checked before reliance. |
| `update_frequency` | text | yes |  |  |  |
| `quality_limitations` | text[] | no | `'{}'::text[]` |  |  |
| `default_revalidation_days` | integer | no | `365` |  |  |
| `adapter_key` | text | yes |  |  |  |
| `recommended_ingestion` | text | no | `'manual_only'::text` |  |  |
| `ingestion_enabled` | boolean | no | `false` |  |  |
| `rate_limit_per_minute` | integer | no | `12` |  |  |
| `last_checked_at` | timestamp with time zone | yes |  |  |  |
| `last_ingested_at` | timestamp with time zone | yes |  |  |  |
| `evidence_urls` | text[] | no | `'{}'::text[]` |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(slug)`

<details><summary>Check constraints (14)</summary>

- `sources_access_method_check`: `CHECK ((access_method = ANY (ARRAY['http_download'::text, 'api'::text, 'manual_download'::text, 'portal_login'::text, 'email_request'::text, 'paid_subscription'::text, 'primary_collection'::text])))`
- `sources_accessibility_check`: `CHECK ((accessibility = ANY (ARRAY['yes'::text, 'partial'::text, 'no'::text, 'untested'::text])))`
- `sources_api_available_check`: `CHECK ((api_available = ANY (ARRAY['yes'::text, 'no'::text, 'unknown'::text])))`
- `sources_authority_level_check`: `CHECK ((authority_level = ANY (ARRAY['primary_government'::text, 'quasi_government'::text, 'academic'::text, 'industry_association'::text, 'commercial'::text, 'primary_research'::text])))`
- `sources_default_revalidation_days_check`: `CHECK ((default_revalidation_days > 0))`
- `sources_ingestion_requires_reuse_right`: `CHECK (((NOT ingestion_enabled) OR (reuse_status = ANY (ARRAY['permitted'::text, 'permitted_with_attribution'::text])) OR ((reuse_status = 'permission_required'::text) AND (permission_granted_on IS NOT NULL) AND (permission_evidence IS NOT NULL))))`
- `sources_ingestion_requires_terms_check`: `CHECK (((NOT ingestion_enabled) OR (terms_checked_on IS NOT NULL)))`
- `sources_rate_limit_per_minute_check`: `CHECK (((rate_limit_per_minute >= 1) AND (rate_limit_per_minute <= 600)))`
- `sources_recommended_ingestion_check`: `CHECK ((recommended_ingestion = ANY (ARRAY['automated'::text, 'manual_only'::text, 'do_not_ingest'::text])))`
- `sources_registry_confidence_check`: `CHECK ((registry_confidence = ANY (ARRAY['verified'::text, 'partially_verified'::text, 'unverified'::text])))`
- `sources_reuse_status_check`: `CHECK ((reuse_status = ANY (ARRAY['permitted'::text, 'permitted_with_attribution'::text, 'permission_required'::text, 'prohibited'::text, 'unclear'::text])))`
- `sources_robots_txt_status_check`: `CHECK ((robots_txt_status = ANY (ARRAY['fetched'::text, 'not_found'::text, 'unreachable'::text])))`
- `sources_slug_check`: `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`
- `sources_source_type_check`: `CHECK ((source_type = ANY (ARRAY['government_project_report'::text, 'government_dataset'::text, 'regulatory_portal'::text, 'scheme_portal'::text, 'statistical_agency'::text, 'academic_extension'::text, 'skills_training'::text, 'industry_association'::text, 'procurement_portal'::text, 'manufacturer_catalogue'::text, 'b2b_marketplace'::text, 'commercial_report'::text, 'property_listing'::text, 'franchise_disclosure'::text, 'primary_research'::text])))`

</details>

Triggers: `sources_updated` → `set_updated_at()`

<a id="intelsupplier_quotes"></a>
### intel.supplier_quotes  ·  table

Consented supplier quotations collected by PlanB researchers. A verified quote is turned into a cost_observation (evidence_type = supplier_quote) referencing this row.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `supplier_id` | uuid | no |  | FK → intel.suppliers |  |
| `business_variant_id` | uuid | yes |  | FK → intel.business_variants |  |
| `cost_item_id` | uuid | yes |  | FK → intel.cost_items |  |
| `equipment_id` | uuid | yes |  | FK → intel.equipment |  |
| `raw_material_id` | uuid | yes |  | FK → intel.raw_materials |  |
| `item_description` | text | no |  |  |  |
| `model_or_spec` | text | yes |  |  |  |
| `capacity_value` | numeric | yes |  |  |  |
| `capacity_unit` | text | yes |  |  |  |
| `quoted_price` | numeric | no |  |  |  |
| `currency` | character(3) | no | `'INR'::bpchar` |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `quantity` | numeric | no | `1` |  |  |
| `tax_treatment` | text | no | `'unknown'::text` |  |  |
| `tax_rate_pct` | numeric | yes |  |  |  |
| `installation` | text | no | `'unknown'::text` |  |  |
| `freight_terms` | text | yes |  |  |  |
| `warranty_months` | integer | yes |  |  |  |
| `lead_time_days` | integer | yes |  |  |  |
| `payment_terms` | text | yes |  |  |  |
| `quoted_on` | date | no |  |  |  |
| `valid_until` | date | yes |  |  |  |
| `delivery_location_id` | uuid | yes |  | FK → intel.locations |  |
| `collection_method` | text | no |  |  |  |
| `source_document_id` | uuid | yes |  | FK → intel.source_documents |  |
| `consent_to_use` | boolean | no | `false` |  |  |
| `consent_notes` | text | yes |  |  |  |
| `collected_by` | uuid | yes |  | FK → auth.users |  |
| `research_task_id` | uuid | yes |  |  |  |
| `status` | text | no | `'received'::text` |  |  |
| `verified_by` | uuid | yes |  | FK → auth.users |  |
| `verified_at` | timestamp with time zone | yes |  |  |  |
| `analyst_notes` | text | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (9)</summary>

- `supplier_quotes_check`: `CHECK (((valid_until IS NULL) OR (valid_until >= quoted_on)))`
- `supplier_quotes_check1`: `CHECK (((status <> 'verified'::text) OR consent_to_use))`
- `supplier_quotes_collection_method_check`: `CHECK ((collection_method = ANY (ARRAY['email'::text, 'phone'::text, 'in_person'::text, 'supplier_portal'::text, 'written_quotation'::text])))`
- `supplier_quotes_installation_check`: `CHECK ((installation = ANY (ARRAY['included'::text, 'excluded'::text, 'unknown'::text, 'not_applicable'::text])))`
- `supplier_quotes_quantity_check`: `CHECK ((quantity > (0)::numeric))`
- `supplier_quotes_quoted_price_check`: `CHECK ((quoted_price >= (0)::numeric))`
- `supplier_quotes_status_check`: `CHECK ((status = ANY (ARRAY['requested'::text, 'received'::text, 'verified'::text, 'expired'::text, 'rejected'::text])))`
- `supplier_quotes_tax_rate_pct_check`: `CHECK (((tax_rate_pct >= (0)::numeric) AND (tax_rate_pct <= (100)::numeric)))`
- `supplier_quotes_tax_treatment_check`: `CHECK ((tax_treatment = ANY (ARRAY['inclusive'::text, 'exclusive'::text, 'unknown'::text, 'not_applicable'::text])))`

</details>

Triggers: `supplier_quotes_updated` → `set_updated_at()`

<a id="intelsuppliers"></a>
### intel.suppliers  ·  table

Supplier intelligence. Contact fields are private research data; a supplier is only ever shown to customers when consent_to_list is true.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `name` | text | no |  |  |  |
| `supplier_type` | text | no |  |  |  |
| `location_id` | uuid | yes |  | FK → intel.locations |  |
| `city_text` | text | yes |  |  |  |
| `website` | text | yes |  |  |  |
| `contact_name` | text | yes |  |  |  |
| `contact_phone` | text | yes |  |  |  |
| `contact_email` | text | yes |  |  |  |
| `gstin` | text | yes |  |  |  |
| `categories` | text[] | no | `'{}'::text[]` |  |  |
| `verification_status` | text | no | `'unverified'::text` |  |  |
| `consent_to_list` | boolean | no | `false` |  |  |
| `consent_recorded_on` | date | yes |  |  |  |
| `first_contacted_on` | date | yes |  |  |  |
| `notes` | text | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_by` | uuid | yes |  | FK → auth.users |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (2)</summary>

- `suppliers_supplier_type_check`: `CHECK ((supplier_type = ANY (ARRAY['manufacturer'::text, 'authorised_dealer'::text, 'trader'::text, 'importer'::text, 'service_provider'::text, 'raw_material_supplier'::text])))`
- `suppliers_verification_status_check`: `CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'contact_verified'::text, 'gst_verified'::text, 'site_verified'::text, 'rejected'::text])))`

</details>

Triggers: `suppliers_updated` → `set_updated_at()`

<a id="inteltraining_program_businesses"></a>
### intel.training_program_businesses  ·  table

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `training_program_id` | uuid | no |  | PK FK → intel.training_programs |  |
| `business_model_id` | uuid | no |  | PK FK → intel.business_models |  |

<a id="inteltraining_programs"></a>
### intel.training_programs  ·  table

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `name` | text | no |  |  |  |
| `provider` | text | no |  |  |  |
| `provider_type` | text | yes |  |  |  |
| `location_id` | uuid | yes |  | FK → intel.locations |  |
| `mode` | text | yes |  |  |  |
| `duration_days` | numeric | yes |  |  |  |
| `fee_inr` | numeric | yes |  |  |  |
| `url` | text | yes |  |  |  |
| `last_verified_on` | date | yes |  |  |  |
| `source_document_id` | uuid | yes |  | FK → intel.source_documents |  |
| `notes` | text | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (3)</summary>

- `training_programs_fee_inr_check`: `CHECK ((fee_inr >= (0)::numeric))`
- `training_programs_mode_check`: `CHECK ((mode = ANY (ARRAY['in_person'::text, 'online'::text, 'hybrid'::text])))`
- `training_programs_provider_type_check`: `CHECK ((provider_type = ANY (ARRAY['government_institute'::text, 'agricultural_university'::text, 'kvk'::text, 'rseti'::text, 'industry_body'::text, 'private'::text, 'manufacturer'::text])))`

</details>

Triggers: `training_programs_updated` → `set_updated_at()`

<a id="intelunits"></a>
### intel.units  ·  table

Controlled unit vocabulary. Normalisation converts raw document units to these codes; to_base_factor converts to the dimension's base unit.

_RLS: enabled (7 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `code` | text | no |  | PK |  |
| `name` | text | no |  |  |  |
| `dimension` | text | no |  |  |  |
| `base_unit` | text | yes |  | FK → intel.units |  |
| `to_base_factor` | numeric | yes |  |  |  |

<details><summary>Check constraints (2)</summary>

- `units_base_consistency`: `CHECK (((base_unit IS NULL) = (to_base_factor IS NULL)))`
- `units_dimension_check`: `CHECK ((dimension = ANY (ARRAY['count'::text, 'mass'::text, 'volume'::text, 'area'::text, 'length'::text, 'power'::text, 'energy'::text, 'time'::text, 'currency'::text, 'ratio'::text, 'other'::text])))`

</details>

<a id="intelv_business_completeness"></a>
### intel.v_business_completeness  ·  view

Research completeness per business model: weighted share of completeness checks satisfied, and which critical parts are missing.

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `business_model_id` | uuid | yes |  |  |  |
| `completeness_pct` | numeric | yes |  |  |  |
| `checks_passed` | bigint | yes |  |  |  |
| `checks_total` | bigint | yes |  |  |  |
| `critical_missing` | bigint | yes |  |  |  |
| `missing_checks` | text[] | yes |  |  |  |
| `critical_missing_checks` | text[] | yes |  |  |  |

<a id="intelv_business_evidence_quality"></a>
### intel.v_business_evidence_quality  ·  view

Evidence quality per business model: grade distribution overall and per section (capital can be strong while revenue is weak), verification state, staleness, open conflicts and the share of model inputs that are assumptions.

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `business_model_id` | uuid | yes |  |  |  |
| `observation_count` | bigint | yes |  |  |  |
| `grade_a` | bigint | yes |  |  |  |
| `grade_b` | bigint | yes |  |  |  |
| `grade_c` | bigint | yes |  |  |  |
| `grade_d` | bigint | yes |  |  |  |
| `verified_count` | bigint | yes |  |  |  |
| `unverified_count` | bigint | yes |  |  |  |
| `disputed_count` | bigint | yes |  |  |  |
| `stale_count` | bigint | yes |  |  |  |
| `distinct_sources` | bigint | yes |  |  |  |
| `section_profiles` | jsonb | yes |  |  |  |
| `parameter_count` | bigint | yes |  |  |  |
| `assumption_count` | bigint | yes |  |  |  |
| `parameters_c_or_better_pct` | numeric | yes |  |  |  |
| `open_conflicts` | bigint | yes |  |  |  |
| `claims_pending_review` | bigint | yes |  |  |  |
| `claims_accepted` | bigint | yes |  |  |  |
| `claims_rejected` | bigint | yes |  |  |  |
| `claims_quote_unverified` | bigint | yes |  |  |  |

<a id="intelv_completeness_items"></a>
### intel.v_completeness_items  ·  view

One row per (business model, completeness check): is that part of the record present? Says nothing about how good the evidence is.

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `business_model_id` | uuid | yes |  |  |  |
| `check_key` | text | yes |  |  |  |
| `section` | text | yes |  |  |  |
| `label` | text | yes |  |  |  |
| `weight` | integer | yes |  |  |  |
| `is_critical` | boolean | yes |  |  |  |
| `is_satisfied` | boolean | yes |  |  |  |

<a id="intelv_freshness_queue"></a>
### intel.v_freshness_queue  ·  view

Everything with a revalidation or expiry date (observations, quotations, regulations, schemes, source terms). days_overdue > 0 means stale; drives continuous-maintenance tasks.

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `item_kind` | text | yes |  |  |  |
| `item_id` | uuid | yes |  |  |  |
| `business_model_id` | uuid | yes |  |  |  |
| `label` | text | yes |  |  |  |
| `due_on` | date | yes |  |  |  |
| `days_overdue` | integer | yes |  |  |  |

<a id="intelv_observations"></a>
### intel.v_observations  ·  view

All business-linked observations (cost, parameter, market) in one shape for evidence exploration, quality analytics and freshness monitoring.

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `observation_kind` | text | yes |  |  |  |
| `id` | uuid | yes |  |  |  |
| `business_model_id` | uuid | yes |  |  |  |
| `business_variant_id` | uuid | yes |  |  |  |
| `cost_item_id` | uuid | yes |  |  |  |
| `parameter_key` | text | yes |  |  |  |
| `subject` | text | yes |  |  |  |
| `section` | text | yes |  |  |  |
| `value` | numeric | yes |  |  |  |
| `value_low` | numeric | yes |  |  |  |
| `value_high` | numeric | yes |  |  |  |
| `currency` | character(3) | yes |  |  |  |
| `unit_code` | text | yes |  |  |  |
| `period` | text | yes |  |  |  |
| `observed_on` | date | yes |  |  |  |
| `location_id` | uuid | yes |  |  |  |
| `geographic_scope` | text | yes |  |  |  |
| `source_id` | uuid | yes |  |  |  |
| `source_document_id` | uuid | yes |  |  |  |
| `page_ref` | text | yes |  |  |  |
| `evidence_type` | text | yes |  |  |  |
| `verification_status` | text | yes |  |  |  |
| `evidence_grade` | character(1) | yes |  |  |  |
| `valid_until` | date | yes |  |  |  |
| `revalidate_by` | date | yes |  |  |  |
| `supersedes_id` | uuid | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | yes |  |  |  |
| `is_superseded` | boolean | yes |  |  |  |

<a id="intelv_usable_observations"></a>
### intel.v_usable_observations  ·  view

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `observation_kind` | text | yes |  |  |  |
| `id` | uuid | yes |  |  |  |
| `business_model_id` | uuid | yes |  |  |  |
| `business_variant_id` | uuid | yes |  |  |  |
| `cost_item_id` | uuid | yes |  |  |  |
| `parameter_key` | text | yes |  |  |  |
| `subject` | text | yes |  |  |  |
| `section` | text | yes |  |  |  |
| `value` | numeric | yes |  |  |  |
| `value_low` | numeric | yes |  |  |  |
| `value_high` | numeric | yes |  |  |  |
| `currency` | character(3) | yes |  |  |  |
| `unit_code` | text | yes |  |  |  |
| `period` | text | yes |  |  |  |
| `observed_on` | date | yes |  |  |  |
| `location_id` | uuid | yes |  |  |  |
| `geographic_scope` | text | yes |  |  |  |
| `source_id` | uuid | yes |  |  |  |
| `source_document_id` | uuid | yes |  |  |  |
| `page_ref` | text | yes |  |  |  |
| `evidence_type` | text | yes |  |  |  |
| `verification_status` | text | yes |  |  |  |
| `evidence_grade` | character(1) | yes |  |  |  |
| `valid_until` | date | yes |  |  |  |
| `revalidate_by` | date | yes |  |  |  |
| `supersedes_id` | uuid | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | yes |  |  |  |
| `is_superseded` | boolean | yes |  |  |  |

<a id="intelv_variant_parameter_status"></a>
### intel.v_variant_parameter_status  ·  view

For every variant: each model parameter it needs (common ones, plus the driver parameters of each revenue stream) and whether a current base value exists. Unresolved required parameters are research gaps; they are never auto-filled.

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `business_model_id` | uuid | yes |  |  |  |
| `business_variant_id` | uuid | yes |  |  |  |
| `parameter_key` | text | yes |  |  |  |
| `parameter_name` | text | yes |  |  |  |
| `is_required` | boolean | yes |  |  |  |
| `scope` | text | yes |  |  |  |
| `revenue_stream_id` | uuid | yes |  |  |  |
| `revenue_stream_name` | text | yes |  |  |  |
| `financial_parameter_id` | uuid | yes |  |  |  |
| `value` | numeric | yes |  |  |  |
| `unit_code` | text | yes |  |  |  |
| `basis` | text | yes |  |  |  |
| `method` | text | yes |  |  |  |
| `evidence_grade` | character(1) | yes |  |  |  |
| `is_resolved` | boolean | yes |  |  |  |
| `observation_count` | bigint | yes |  |  |  |

## gt — PlanB Ground Truth (owner interviews and actuals)

<a id="gtbusiness_actuals"></a>
### gt.business_actuals  ·  table

Actual figures reported by owners (investment, revenue range, owner income, break-even time, hours…). evidence_level separates documented actuals from self-reported ones.

_RLS: enabled (4 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `interview_id` | uuid | no |  | FK → gt.owner_interviews |  |
| `metric_key` | text | no |  | FK → intel.metric_definitions |  |
| `value` | numeric | yes |  |  |  |
| `value_low` | numeric | yes |  |  |  |
| `value_high` | numeric | yes |  |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `period` | text | yes |  |  |  |
| `reference_year` | integer | yes |  |  |  |
| `evidence_level` | text | no |  |  |  |
| `supporting_document_path` | text | yes |  |  |  |
| `verification_status` | text | no | `'unverified'::text` |  |  |
| `verified_by` | uuid | yes |  | FK → auth.users |  |
| `evidence_grade` | character(1) | no | `'C'::bpchar` |  |  |
| `analyst_notes` | text | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (10)</summary>

- `business_actuals_check`: `CHECK (((value IS NOT NULL) OR ((value_low IS NOT NULL) AND (value_high IS NOT NULL))))`
- `business_actuals_check1`: `CHECK (((evidence_level <> 'documented'::text) OR (supporting_document_path IS NOT NULL)))`
- `business_actuals_check2`: `CHECK (((evidence_level <> 'self_reported'::text) OR (evidence_grade = ANY (ARRAY['C'::bpchar, 'D'::bpchar]))))`
- `business_actuals_check3`: `CHECK (((evidence_grade <> 'A'::bpchar) OR (verification_status = 'verified'::text)))`
- `business_actuals_check4`: `CHECK ((((data_origin)::text <> 'demo'::text) OR ((evidence_grade = 'D'::bpchar) AND (verification_status <> 'verified'::text))))`
- `business_actuals_evidence_grade_check`: `CHECK ((evidence_grade = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))`
- `business_actuals_evidence_level_check`: `CHECK ((evidence_level = ANY (ARRAY['documented'::text, 'self_reported'::text])))`
- `business_actuals_period_check`: `CHECK ((period = ANY (ARRAY['one_time'::text, 'per_day'::text, 'per_month'::text, 'per_year'::text, 'point_in_time'::text])))`
- `business_actuals_reference_year_check`: `CHECK (((reference_year >= 1950) AND (reference_year <= 2100)))`
- `business_actuals_verification_status_check`: `CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'disputed'::text, 'rejected'::text])))`

</details>

Triggers: `business_actuals_updated` → `set_updated_at()`

<a id="gtconsents"></a>
### gt.consents  ·  table

Consent records per interviewee: what they agreed to, when, how, and whether it was withdrawn. No interview data is usable without an active consent.

_RLS: enabled (3 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `subject_id` | uuid | no |  | FK → gt.interview_subjects |  |
| `consent_form_version` | text | no |  |  |  |
| `allows_aggregate_use` | boolean | no |  |  |  |
| `allows_anonymised_quotes` | boolean | no | `false` |  |  |
| `allows_document_retention` | boolean | no | `false` |  |  |
| `allows_recontact` | boolean | no | `false` |  |  |
| `given_on` | date | no |  |  |  |
| `collection_method` | text | no |  |  |  |
| `evidence_storage_path` | text | yes |  |  |  |
| `withdrawn_on` | date | yes |  |  |  |
| `recorded_by` | uuid | yes |  | FK → auth.users |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (2)</summary>

- `consents_check`: `CHECK (((withdrawn_on IS NULL) OR (withdrawn_on >= given_on)))`
- `consents_collection_method_check`: `CHECK ((collection_method = ANY (ARRAY['signed_form'::text, 'recorded_verbal'::text, 'email'::text, 'digital_form'::text])))`

</details>

<a id="gtinterview_responses"></a>
### gt.interview_responses  ·  table

_RLS: enabled (4 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `interview_id` | uuid | no |  | FK → gt.owner_interviews |  |
| `question_id` | uuid | no |  | FK → gt.questionnaire_questions |  |
| `answer_text` | text | yes |  |  |  |
| `answer_numeric` | numeric | yes |  |  |  |
| `answer_low` | numeric | yes |  |  |  |
| `answer_high` | numeric | yes |  |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `analyst_note` | text | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(interview_id, question_id)`

<a id="gtinterview_subjects"></a>
### gt.interview_subjects  ·  table

PERSONAL DATA. Identity and contact details of interviewees. Visible only to admins and the assigned interviewer; never joined into aggregates or publications.

_RLS: enabled (4 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `full_name` | text | no |  |  |  |
| `business_name` | text | yes |  |  |  |
| `phone` | text | yes |  |  |  |
| `email` | text | yes |  |  |  |
| `address` | text | yes |  |  |  |
| `referral_source` | text | yes |  |  |  |
| `assigned_interviewer` | uuid | yes |  | FK → auth.users |  |
| `created_by` | uuid | yes |  | FK → auth.users |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |
| `erased_at` | timestamp with time zone | yes |  |  |  |

Triggers: `interview_subjects_updated` → `set_updated_at()`

<a id="gtowner_interviews"></a>
### gt.owner_interviews  ·  table

De-identified interview with an existing or former owner. location_id must be district level or coarser. Closed and sold businesses are first-class to counter survivorship bias.

_RLS: enabled (4 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `subject_id` | uuid | yes |  | FK → gt.interview_subjects |  |
| `consent_id` | uuid | yes |  | FK → gt.consents |  |
| `business_model_id` | uuid | no |  | FK → intel.business_models |  |
| `business_variant_id` | uuid | yes |  | FK → intel.business_variants |  |
| `location_id` | uuid | yes |  | FK → intel.locations |  |
| `questionnaire_id` | uuid | yes |  | FK → gt.questionnaires |  |
| `business_status` | text | no |  |  |  |
| `started_year` | integer | yes |  |  |  |
| `ended_year` | integer | yes |  |  |  |
| `years_operated` | numeric | yes |  |  |  |
| `interview_date` | date | yes |  |  |  |
| `interview_mode` | text | yes |  |  |  |
| `interviewer` | uuid | yes |  | FK → auth.users |  |
| `transcript_storage_path` | text | yes |  |  |  |
| `analyst_summary` | text | yes |  |  |  |
| `closure_or_success_reasons` | text | yes |  |  |  |
| `advice_for_entrants` | text | yes |  |  |  |
| `status` | text | no | `'planned'::text` |  |  |
| `anonymisation_status` | text | no | `'pending'::text` |  |  |
| `reviewed_by` | uuid | yes |  | FK → auth.users |  |
| `reviewed_at` | timestamp with time zone | yes |  |  |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_by` | uuid | yes |  | FK → auth.users |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (9)</summary>

- `owner_interviews_anonymisation_status_check`: `CHECK ((anonymisation_status = ANY (ARRAY['pending'::text, 'anonymised'::text, 'not_required'::text])))`
- `owner_interviews_business_status_check`: `CHECK ((business_status = ANY (ARRAY['operating'::text, 'closed'::text, 'sold'::text, 'paused'::text])))`
- `owner_interviews_check`: `CHECK (((ended_year IS NULL) OR (ended_year >= started_year)))`
- `owner_interviews_check1`: `CHECK (((status = ANY (ARRAY['planned'::text, 'scheduled'::text, 'withdrawn'::text])) OR (consent_id IS NOT NULL)))`
- `owner_interviews_check2`: `CHECK (((status <> 'reviewed'::text) OR (anonymisation_status = ANY (ARRAY['anonymised'::text, 'not_required'::text]))))`
- `owner_interviews_interview_mode_check`: `CHECK ((interview_mode = ANY (ARRAY['in_person'::text, 'phone'::text, 'video'::text, 'written'::text])))`
- `owner_interviews_started_year_check`: `CHECK (((started_year >= 1950) AND (started_year <= 2100)))`
- `owner_interviews_status_check`: `CHECK ((status = ANY (ARRAY['planned'::text, 'scheduled'::text, 'conducted'::text, 'transcribed'::text, 'coded'::text, 'reviewed'::text, 'withdrawn'::text])))`
- `owner_interviews_years_operated_check`: `CHECK ((years_operated >= (0)::numeric))`

</details>

Triggers: `owner_interviews_updated` → `set_updated_at()`

<a id="gtquestionnaire_questions"></a>
### gt.questionnaire_questions  ·  table

_RLS: enabled (3 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `questionnaire_id` | uuid | no |  | FK → gt.questionnaires |  |
| `key` | text | no |  |  |  |
| `section` | text | no |  |  |  |
| `sequence_no` | integer | no |  |  |  |
| `prompt` | text | no |  |  |  |
| `answer_type` | text | no |  |  |  |
| `metric_key` | text | yes |  | FK → intel.metric_definitions | When set, a numeric answer is recorded as a gt.business_actuals row under this metric. |
| `choices` | text[] | yes |  |  |  |
| `guidance` | text | yes |  |  |  |
| `is_sensitive` | boolean | no | `false` |  |  |

Unique: `(questionnaire_id, key)`

<details><summary>Check constraints (2)</summary>

- `questionnaire_questions_answer_type_check`: `CHECK ((answer_type = ANY (ARRAY['money'::text, 'money_range'::text, 'number'::text, 'number_range'::text, 'percent'::text, 'duration_months'::text, 'text'::text, 'choice'::text, 'boolean'::text])))`
- `questionnaire_questions_key_check`: `CHECK ((key ~ '^[a-z0-9_]+$'::text))`

</details>

<a id="gtquestionnaires"></a>
### gt.questionnaires  ·  table

Versioned structured interview questionnaires. Separate instruments for operating and former (closed/sold) owners so failures are captured, not just survivors.

_RLS: enabled (3 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `key` | text | no |  |  |  |
| `version` | integer | no |  |  |  |
| `title` | text | no |  |  |  |
| `audience` | text | no |  |  |  |
| `is_active` | boolean | no | `true` |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

Unique: `(key, version)`

<details><summary>Check constraints (2)</summary>

- `questionnaires_audience_check`: `CHECK ((audience = ANY (ARRAY['operating_owner'::text, 'former_owner'::text, 'supplier'::text, 'expert'::text])))`
- `questionnaires_version_check`: `CHECK ((version >= 1))`

</details>

<a id="gtv_actuals_aggregate"></a>
### gt.v_actuals_aggregate  ·  view

Privacy-preserving aggregate of owner actuals (k ≥ 5 interviews per cell, consent active, reviewed). Min/max are deliberately omitted.

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `business_model_id` | uuid | yes |  |  |  |
| `metric_key` | text | yes |  |  |  |
| `business_status` | text | yes |  |  |  |
| `interview_count` | bigint | yes |  |  |  |
| `p25` | double precision | yes |  |  |  |
| `median` | double precision | yes |  |  |  |
| `p75` | double precision | yes |  |  |  |
| `documented_count` | bigint | yes |  |  |  |

## pub — published, customer-facing snapshots

<a id="pubpublication_versions"></a>
### pub.publication_versions  ·  table

Customer-facing publications. Each row is an approved business version that passed the publication policy at the time (policy_applied). Exactly one live publication per business model; history is kept.

_RLS: enabled (3 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `business_model_id` | uuid | no |  | FK → intel.business_models |  |
| `business_version_id` | uuid | no |  | FK → intel.business_versions |  |
| `publication_no` | integer | no |  |  |  |
| `slug` | text | no |  |  |  |
| `name` | text | no |  |  |  |
| `snapshot` | jsonb | no |  |  |  |
| `completeness_pct` | numeric | no |  |  |  |
| `evidence_profile` | jsonb | no |  |  |  |
| `policy_applied` | jsonb | no |  |  |  |
| `status` | text | no | `'live'::text` |  |  |
| `published_by` | uuid | yes |  | FK → auth.users |  |
| `published_at` | timestamp with time zone | no | `now()` |  |  |
| `withdrawn_at` | timestamp with time zone | yes |  |  |  |
| `withdrawn_reason` | text | yes |  |  |  |

Unique: `(business_model_id, publication_no)`; `(business_version_id)`

<details><summary>Check constraints (3)</summary>

- `publication_versions_check`: `CHECK (((status <> 'withdrawn'::text) OR ((withdrawn_at IS NOT NULL) AND (withdrawn_reason IS NOT NULL))))`
- `publication_versions_publication_no_check`: `CHECK ((publication_no >= 1))`
- `publication_versions_status_check`: `CHECK ((status = ANY (ARRAY['live'::text, 'superseded'::text, 'withdrawn'::text])))`

</details>

Triggers: `publication_versions_guard` → `guard_publication()`

<a id="pubcatalog"></a>
### pub.catalog  ·  view

Teaser fields of live publications for free discovery. Full snapshots are reachable only through entitlement-checked server code.

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `publication_id` | uuid | yes |  |  |  |
| `business_model_id` | uuid | yes |  |  |  |
| `slug` | text | yes |  |  |  |
| `name` | text | yes |  |  |  |
| `publication_no` | integer | yes |  |  |  |
| `published_at` | timestamp with time zone | yes |  |  |  |
| `industry` | jsonb | yes |  |  |  |
| `description` | text | yes |  |  |  |
| `operating_model` | text | yes |  |  |  |
| `completeness_pct` | numeric | yes |  |  |  |
| `evidence_profile` | jsonb | yes |  |  |  |

## customer — customer personal data

<a id="customerpricing_plans"></a>
### customer.pricing_plans  ·  table

Configurable pricing. Current rows are monetisation HYPOTHESES to validate, not launched products.

_RLS: enabled (2 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `key` | text | no |  | PK |  |
| `name` | text | no |  |  |  |
| `price_inr` | numeric | no |  |  |  |
| `description` | text | yes |  |  |  |
| `is_active` | boolean | no | `true` |  |  |
| `is_hypothesis` | boolean | no | `true` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (1)</summary>

- `pricing_plans_price_inr_check`: `CHECK ((price_inr >= (0)::numeric))`

</details>

<a id="customerprofile_documents"></a>
### customer.profile_documents  ·  table

PERSONAL DATA. CVs and user-provided LinkedIn exports (never scraped). Files live in a private bucket.

_RLS: enabled (1 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `user_id` | uuid | no |  | FK → auth.users |  |
| `document_kind` | text | no |  |  |  |
| `storage_bucket` | text | no | `'customer-uploads'::text` |  |  |
| `storage_path` | text | no |  |  |  |
| `mime_type` | text | no |  |  |  |
| `byte_size` | bigint | no |  |  |  |
| `sha256` | text | no |  |  |  |
| `parsed_at` | timestamp with time zone | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `deleted_at` | timestamp with time zone | yes |  |  |  |

<details><summary>Check constraints (2)</summary>

- `profile_documents_byte_size_check`: `CHECK (((byte_size > 0) AND (byte_size <= 10485760)))`
- `profile_documents_document_kind_check`: `CHECK ((document_kind = ANY (ARRAY['cv'::text, 'linkedin_export'::text, 'other'::text])))`

</details>

<a id="customerrecommendations"></a>
### customer.recommendations  ·  table

Explainable match results. Suitability (fit_dimensions) and research confidence are stored separately and no single "score" is stored; recommendations only ever reference a published version.

_RLS: enabled (1 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `user_id` | uuid | no |  | FK → auth.users |  |
| `publication_id` | uuid | no |  | FK → pub.publication_versions |  |
| `business_model_id` | uuid | no |  | FK → intel.business_models |  |
| `generated_at` | timestamp with time zone | no | `now()` |  |  |
| `matcher_version` | text | no |  |  |  |
| `profile_hash` | text | no |  |  |  |
| `passed_feasibility` | boolean | no |  |  |  |
| `feasibility_failures` | jsonb | no | `'[]'::jsonb` |  |  |
| `fit_dimensions` | jsonb | no | `'{}'::jsonb` |  |  |
| `trade_offs` | jsonb | no | `'[]'::jsonb` |  |  |
| `missing_prerequisites` | jsonb | no | `'[]'::jsonb` |  |  |
| `research_confidence` | jsonb | no | `'{}'::jsonb` |  | Evidence-quality summary of the publication at match time — kept apart from suitability on purpose. |
| `rank_position` | integer | yes |  |  |  |

<a id="customersaved_businesses"></a>
### customer.saved_businesses  ·  table

_RLS: enabled (1 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `user_id` | uuid | no |  | PK FK → auth.users |  |
| `business_model_id` | uuid | no |  | PK FK → intel.business_models |  |
| `note` | text | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

<a id="customeruser_assets"></a>
### customer.user_assets  ·  table

PERSONAL DATA. Assets the customer already owns (land, shop, vehicle…) that could substitute a business cost.

_RLS: enabled (1 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `user_id` | uuid | no |  | FK → auth.users |  |
| `asset_type_slug` | text | no |  | FK → intel.asset_types |  |
| `description` | text | yes |  |  |  |
| `location_id` | uuid | yes |  | FK → intel.locations |  |
| `quantity` | numeric | yes |  |  |  |
| `unit_code` | text | yes |  | FK → intel.units |  |
| `estimated_value_inr` | numeric | yes |  |  |  |
| `available_for_business` | boolean | no | `true` |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (1)</summary>

- `user_assets_estimated_value_inr_check`: `CHECK ((estimated_value_inr >= (0)::numeric))`

</details>

Triggers: `user_assets_updated` → `set_updated_at()`

<a id="customeruser_capabilities"></a>
### customer.user_capabilities  ·  table

Transferable capabilities of a customer, mapped to the same skill vocabulary as business requirements. Extracted capabilities stay unconfirmed until the user confirms them.

_RLS: enabled (1 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `user_id` | uuid | no |  | PK FK → auth.users |  |
| `skill_id` | uuid | no |  | PK FK → intel.skills |  |
| `proficiency` | integer | no |  |  |  |
| `years_practised` | numeric | yes |  |  |  |
| `derivation` | text | no |  |  |  |
| `evidence_excerpt` | text | yes |  |  |  |
| `confirmed_by_user` | boolean | no | `false` |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |

<details><summary>Check constraints (3)</summary>

- `user_capabilities_derivation_check`: `CHECK ((derivation = ANY (ARRAY['self_declared'::text, 'extracted_from_cv'::text, 'extracted_from_linkedin_export'::text, 'inferred'::text])))`
- `user_capabilities_proficiency_check`: `CHECK (((proficiency >= 1) AND (proficiency <= 5)))`
- `user_capabilities_years_practised_check`: `CHECK ((years_practised >= (0)::numeric))`

</details>

<a id="customeruser_profiles"></a>
### customer.user_profiles  ·  table

PERSONAL DATA. A customer's professional and financial profile used for matching. Owner-only access; staff see it only through explicit support tooling (not yet built).

_RLS: enabled (1 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `user_id` | uuid | no |  | PK FK → auth.users |  |
| `display_name` | text | yes |  |  |  |
| `current_role_title` | text | yes |  |  |  |
| `current_industry` | text | yes |  |  |  |
| `years_experience` | numeric | yes |  |  |  |
| `professional_summary` | text | yes |  |  |  |
| `preferred_location_id` | uuid | yes |  | FK → intel.locations |  |
| `investable_capital_inr` | numeric | yes |  |  |  |
| `reserve_requirement_inr` | numeric | yes |  |  |  |
| `monthly_income_goal_inr` | numeric | yes |  |  |  |
| `current_monthly_income_inr` | numeric | yes |  |  |  |
| `risk_tolerance` | text | yes |  |  |  |
| `desired_involvement` | text | yes |  |  |  |
| `max_hours_per_week` | numeric | yes |  |  |  |
| `weekend_work_ok` | boolean | yes |  |  |  |
| `physical_work_tolerance` | integer | yes |  |  |  |
| `transition_timeline_months` | integer | yes |  |  |  |
| `interests` | text[] | no | `'{}'::text[]` |  |  |
| `household_mode` | text | no | `'individual'::text` |  |  |
| `marketing_consent` | boolean | no | `false` |  |  |
| `data_processing_consent_at` | timestamp with time zone | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |
| `deleted_at` | timestamp with time zone | yes |  |  |  |

<details><summary>Check constraints (11)</summary>

- `user_profiles_current_monthly_income_inr_check`: `CHECK ((current_monthly_income_inr >= (0)::numeric))`
- `user_profiles_desired_involvement_check`: `CHECK ((desired_involvement = ANY (ARRAY['full_time_hands_on'::text, 'full_time_managerial'::text, 'part_time'::text, 'semi_absentee'::text, 'absentee'::text])))`
- `user_profiles_household_mode_check`: `CHECK ((household_mode = ANY (ARRAY['individual'::text, 'couple'::text])))`
- `user_profiles_investable_capital_inr_check`: `CHECK ((investable_capital_inr >= (0)::numeric))`
- `user_profiles_max_hours_per_week_check`: `CHECK (((max_hours_per_week >= (0)::numeric) AND (max_hours_per_week <= (120)::numeric)))`
- `user_profiles_monthly_income_goal_inr_check`: `CHECK ((monthly_income_goal_inr >= (0)::numeric))`
- `user_profiles_physical_work_tolerance_check`: `CHECK (((physical_work_tolerance >= 1) AND (physical_work_tolerance <= 5)))`
- `user_profiles_reserve_requirement_inr_check`: `CHECK ((reserve_requirement_inr >= (0)::numeric))`
- `user_profiles_risk_tolerance_check`: `CHECK ((risk_tolerance = ANY (ARRAY['low'::text, 'moderate'::text, 'high'::text])))`
- `user_profiles_transition_timeline_months_check`: `CHECK (((transition_timeline_months >= 0) AND (transition_timeline_months <= 120)))`
- `user_profiles_years_experience_check`: `CHECK (((years_experience >= (0)::numeric) AND (years_experience <= (60)::numeric)))`

</details>

Triggers: `user_profiles_updated` → `set_updated_at()`

## ops — research operations, RBAC and audit

<a id="opsaudit_log"></a>
### ops.audit_log  ·  table

Append-only row-level audit trail for research, ground-truth, publication and customer tables. Written by ops.audit_row() triggers.

_RLS: enabled (1 policies) · audited: no_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `occurred_at` | timestamp with time zone | no | `now()` |  |  |
| `schema_name` | text | no |  |  |  |
| `table_name` | text | no |  |  |  |
| `row_id` | text | yes |  |  |  |
| `action` | text | no |  |  |  |
| `actor_user_id` | uuid | yes |  |  |  |
| `actor_db_role` | text | no | `CURRENT_USER` |  |  |
| `research_run_id` | uuid | yes |  |  |  |
| `changed_fields` | text[] | yes |  |  |  |
| `old_row` | jsonb | yes |  |  |  |
| `new_row` | jsonb | yes |  |  |  |

<details><summary>Check constraints (1)</summary>

- `audit_log_action_check`: `CHECK ((action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))`

</details>

Triggers: `audit_log_append_only` → `forbid_mutation()`

<a id="opsingestion_log"></a>
### ops.ingestion_log  ·  table

Every adapter action (robots check, fetch, dedupe hit, store, failure) for traceability of how each document entered the system.

_RLS: enabled (4 policies) · audited: no_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `occurred_at` | timestamp with time zone | no | `now()` |  |  |
| `source_id` | uuid | yes |  | FK → intel.sources |  |
| `adapter_key` | text | yes |  |  |  |
| `research_run_id` | uuid | yes |  |  |  |
| `url` | text | yes |  |  |  |
| `action` | text | no |  |  |  |
| `outcome` | text | no |  |  |  |
| `http_status` | integer | yes |  |  |  |
| `byte_size` | bigint | yes |  |  |  |
| `sha256` | text | yes |  |  |  |
| `duration_ms` | integer | yes |  |  |  |
| `attempt` | integer | no | `1` |  |  |
| `detail` | text | yes |  |  |  |
| `document_id` | uuid | yes |  | FK → intel.source_documents |  |

<details><summary>Check constraints (2)</summary>

- `ingestion_log_action_check`: `CHECK ((action = ANY (ARRAY['robots_check'::text, 'fetch'::text, 'store'::text, 'dedupe_hit'::text, 'text_extract'::text, 'skip'::text, 'error'::text])))`
- `ingestion_log_outcome_check`: `CHECK ((outcome = ANY (ARRAY['ok'::text, 'skipped'::text, 'blocked'::text, 'failed'::text])))`

</details>

<a id="opsllm_usage"></a>
### ops.llm_usage  ·  table

Every LLM call made by research workers with tokens and computed cost — the basis of research cost monitoring and run budgets.

_RLS: enabled (3 policies) · audited: no_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `occurred_at` | timestamp with time zone | no | `now()` |  |  |
| `run_id` | uuid | yes |  | FK → ops.research_runs |  |
| `stage` | text | yes |  |  |  |
| `provider` | text | no |  |  |  |
| `model` | text | no |  |  |  |
| `purpose` | text | no |  |  |  |
| `input_tokens` | bigint | no | `0` |  |  |
| `output_tokens` | bigint | no | `0` |  |  |
| `cache_read_tokens` | bigint | no | `0` |  |  |
| `cost_usd` | numeric | no | `0` |  |  |
| `business_model_id` | uuid | yes |  | FK → intel.business_models |  |
| `source_document_id` | uuid | yes |  | FK → intel.source_documents |  |

<a id="opspublication_policy"></a>
### ops.publication_policy  ·  table

Quality thresholds a business version must meet before it can be published. Single row; changes are audited.

_RLS: enabled (3 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `singleton` | boolean | no | `true` | PK |  |
| `min_completeness_pct` | numeric | no | `75` |  |  |
| `max_critical_missing` | integer | no | `0` |  |  |
| `max_open_conflicts` | integer | no | `0` |  |  |
| `max_pending_claims` | integer | no | `0` |  |  |
| `max_stale_observations` | integer | no | `0` |  |  |
| `min_parameters_c_or_better_pct` | numeric | no | `70` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_by` | uuid | yes |  | FK → auth.users |  |

<details><summary>Check constraints (7)</summary>

- `publication_policy_max_critical_missing_check`: `CHECK ((max_critical_missing >= 0))`
- `publication_policy_max_open_conflicts_check`: `CHECK ((max_open_conflicts >= 0))`
- `publication_policy_max_pending_claims_check`: `CHECK ((max_pending_claims >= 0))`
- `publication_policy_max_stale_observations_check`: `CHECK ((max_stale_observations >= 0))`
- `publication_policy_min_completeness_pct_check`: `CHECK (((min_completeness_pct >= (0)::numeric) AND (min_completeness_pct <= (100)::numeric)))`
- `publication_policy_min_parameters_c_or_better_pct_check`: `CHECK (((min_parameters_c_or_better_pct >= (0)::numeric) AND (min_parameters_c_or_better_pct <= (100)::numeric)))`
- `publication_policy_singleton_check`: `CHECK (singleton)`

</details>

<a id="opsresearch_run_logs"></a>
### ops.research_run_logs  ·  table

_RLS: enabled (3 policies) · audited: no_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `run_id` | uuid | no |  | FK → ops.research_runs |  |
| `logged_at` | timestamp with time zone | no | `clock_timestamp()` |  |  |
| `level` | text | no | `'info'::text` |  |  |
| `stage` | text | yes |  |  |  |
| `message` | text | no |  |  |  |
| `data` | jsonb | yes |  |  |  |

<details><summary>Check constraints (1)</summary>

- `research_run_logs_level_check`: `CHECK ((level = ANY (ARRAY['debug'::text, 'info'::text, 'warning'::text, 'error'::text])))`

</details>

<a id="opsresearch_run_steps"></a>
### ops.research_run_steps  ·  table

One row per pipeline stage of a run. A succeeded step is never re-executed on resume; each stage is written to be idempotent so a re-executed failed step cannot duplicate records.

_RLS: enabled (4 policies) · audited: no_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `run_id` | uuid | no |  | PK FK → ops.research_runs |  |
| `stage` | text | no |  | PK |  |
| `sequence_no` | integer | no |  |  |  |
| `status` | text | no | `'pending'::text` |  |  |
| `attempt` | integer | no | `0` |  |  |
| `started_at` | timestamp with time zone | yes |  |  |  |
| `finished_at` | timestamp with time zone | yes |  |  |  |
| `duration_ms` | integer | yes |  |  |  |
| `output` | jsonb | yes |  |  |  |
| `error` | text | yes |  |  |  |

<details><summary>Check constraints (1)</summary>

- `research_run_steps_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'skipped'::text])))`

</details>

<a id="opsresearch_runs"></a>
### ops.research_runs  ·  table

Durable job record for a multi-stage research pipeline. Workers lease a run (locked_until), heartbeat while working, and can crash at any point: an expired lease makes the run claimable again and it resumes from its first unfinished step.

_RLS: enabled (6 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |  |
| `pipeline` | text | no |  |  |  |
| `business_model_id` | uuid | yes |  | FK → intel.business_models |  |
| `source_document_id` | uuid | yes |  | FK → intel.source_documents |  |
| `params` | jsonb | no | `'{}'::jsonb` |  |  |
| `idempotency_key` | text | yes |  |  | Enqueueing the same logical job twice returns the existing run instead of duplicating work. |
| `status` | text | no | `'queued'::text` |  |  |
| `current_stage` | text | yes |  |  |  |
| `attempt` | integer | no | `0` |  |  |
| `max_attempts` | integer | no | `3` |  |  |
| `next_attempt_at` | timestamp with time zone | no | `now()` |  |  |
| `locked_by` | text | yes |  |  |  |
| `locked_until` | timestamp with time zone | yes |  |  |  |
| `heartbeat_at` | timestamp with time zone | yes |  |  |  |
| `budget_usd` | numeric | yes |  |  | Execution budget. When LLM spend reaches it the run stops with status budget_exhausted instead of continuing to spend. |
| `budget_tokens` | bigint | yes |  |  |  |
| `spent_usd` | numeric | no | `0` |  |  |
| `spent_tokens` | bigint | no | `0` |  |  |
| `result` | jsonb | yes |  |  |  |
| `error` | text | yes |  |  |  |
| `requested_by` | uuid | yes |  | FK → auth.users |  |
| `data_origin` | ops.data_origin | yes |  |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `started_at` | timestamp with time zone | yes |  |  |  |
| `finished_at` | timestamp with time zone | yes |  |  |  |

Unique: `(idempotency_key)`

<details><summary>Check constraints (5)</summary>

- `research_runs_budget_tokens_check`: `CHECK ((budget_tokens >= 0))`
- `research_runs_budget_usd_check`: `CHECK ((budget_usd >= (0)::numeric))`
- `research_runs_max_attempts_check`: `CHECK (((max_attempts >= 1) AND (max_attempts <= 20)))`
- `research_runs_pipeline_check`: `CHECK ((pipeline = ANY (ARRAY['document_research'::text, 'business_refresh'::text, 'freshness_scan'::text, 'catalog_sync'::text])))`
- `research_runs_status_check`: `CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'waiting_retry'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text, 'budget_exhausted'::text])))`

</details>

<a id="opsstaff_members"></a>
### ops.staff_members  ·  table

Internal PlanB Intelligence users. Anyone authenticated who is not listed here is a customer.

_RLS: enabled (2 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `user_id` | uuid | no |  | PK FK → auth.users |  |
| `display_name` | text | no |  |  |  |
| `is_active` | boolean | no | `true` |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |  |

<a id="opsstaff_roles"></a>
### ops.staff_roles  ·  table

Role grants. admin: everything incl. publication & staff. researcher: create/edit research records. reviewer: verify claims, approve versions.

_RLS: enabled (2 policies) · audited: yes_

| Column | Type | Null | Default | Key | Description |
|---|---|---|---|---|---|
| `user_id` | uuid | no |  | PK FK → ops.staff_members |  |
| `role` | text | no |  | PK |  |
| `granted_at` | timestamp with time zone | no | `now()` |  |  |
| `granted_by` | uuid | yes |  | FK → auth.users |  |

<details><summary>Check constraints (1)</summary>

- `staff_roles_role_check`: `CHECK ((role = ANY (ARRAY['admin'::text, 'researcher'::text, 'reviewer'::text])))`

</details>

## Functions

| Function | Security | Description |
|---|---|---|
| `customer.erase_user_data(p_user uuid)` | definer |  |
| `gt.erase_subject(p_subject uuid)` | definer |  |
| `intel._retire_claim_outputs(p_claim uuid, p_reason text)` | invoker |  |
| `intel.build_business_snapshot(p_model uuid)` | invoker | JSON rendering of one business record with per-number source attribution and quality metrics. Excludes private research notes, supplier contacts and all interview identities. |
| `intel.correct_claim(p_claim uuid, p_value numeric, p_unit_raw text, p_quote text, p_page integer, p_note text, p_quantity numeric)` | invoker | Replace a wrong extraction with an analyst-entered claim. The corrected value becomes usable only if its quote is found on the cited page; it is structured into the record on the next business_refresh run. |
| `intel.count_non_research_rows(p_model uuid)` | invoker |  |
| `intel.count_restricted_source_rows(p_model uuid)` | invoker |  |
| `intel.decide_business_version(p_version uuid, p_decision text, p_comments text)` | invoker |  |
| `intel.location_ancestry(p_location_id uuid)` | invoker |  |
| `intel.quote_occurs(p_document uuid, p_page integer, p_quote text)` | invoker |  |
| `intel.resolve_conflict(p_conflict uuid, p_status text, p_note text)` | invoker |  |
| `intel.resolve_location_metric(p_location_id uuid, p_metric_key text, p_segment text)` | invoker | Resolves a location metric through the geography fallback hierarchy. Returns no row when nothing is known at any level — missing stays missing. |
| `intel.review_claim(p_claim uuid, p_decision text, p_note text)` | invoker | Accept or reject an extracted claim. Acceptance requires a verified quote (table constraint); rejection retires every observation materialised from the claim. |
| `intel.set_assumption(p_variant uuid, p_parameter_key text, p_revenue_stream uuid, p_value numeric, p_rationale text)` | invoker | Analyst override of a model input. Stored as basis = assumption, grade D, with the analyst and rationale recorded; the pipeline never overwrites it. |
| `intel.set_observation_status(p_kind text, p_id uuid, p_status text, p_note text)` | invoker |  |
| `intel.submit_business_version(p_model uuid, p_change_summary text, p_run uuid)` | invoker |  |
| `ops.claim_research_run(p_worker text, p_lease_seconds integer)` | invoker |  |
| `ops.current_user_id()` | definer |  |
| `ops.has_role(VARIADIC roles text[])` | definer | True when the current JWT subject holds any of the given staff roles. SECURITY DEFINER so RLS policies can call it without recursive policy checks. |
| `ops.heartbeat_research_run(p_run_id uuid, p_worker text, p_lease_seconds integer)` | invoker |  |
| `ops.is_staff()` | definer |  |
| `ops.is_worker()` | invoker |  |
| `pub.publication_blockers(p_version uuid)` | invoker |  |
| `pub.publish_business_version(p_version uuid)` | invoker |  |
| `pub.withdraw_publication(p_publication uuid, p_reason text)` | invoker |  |
