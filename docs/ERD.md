# PlanB entity-relationship diagrams

> Generated from the database catalogue by `scripts/gen_db_docs.py`. One diagram per domain; a table can appear in
> several diagrams where it joins domains. Columns shown are keys only — see `DATA_DICTIONARY.md` for every column.

Polymorphic links that foreign keys cannot express: `intel.evidence_links (target_table, target_id)` points at any evidenced record;
`intel.research_reviews (subject_type, subject_id)` at any reviewed record; `intel.research_tasks (target_table, target_id)` at the gap's subject.

## Taxonomy and business structure

```mermaid
erDiagram
  intel_industries {
    uuid id PK
    uuid parent_id FK
  }
  intel_business_models {
    uuid id PK
    uuid industry_id FK
    uuid created_by FK
  }
  intel_business_variants {
    uuid id PK
    uuid business_model_id FK
    text financial_template_key FK
    uuid created_by FK
  }
  intel_business_relationships {
    uuid id PK
    uuid from_business_model_id FK
    uuid to_business_model_id FK
  }
  intel_business_model_classifications {
    uuid business_model_id PK,FK
    uuid classification_code_id PK,FK
  }
  intel_classification_codes {
    uuid id PK
    text system_code FK
  }
  intel_classification_systems {
    text code PK
  }
  intel_business_assets {
    uuid id PK
    uuid business_variant_id FK
    text asset_type_slug FK
    text unit_code FK
    uuid substitutes_cost_category_id FK
  }
  intel_asset_types {
    text slug PK
  }
  intel_business_versions {
    uuid id PK
    uuid business_model_id FK
    uuid submitted_by FK
    uuid decided_by FK
  }
  intel_asset_types ||--o{ intel_business_assets : "asset_type_slug"
  intel_business_variants ||--o{ intel_business_assets : "business_variant_id"
  intel_business_models ||--o{ intel_business_model_classifications : "business_model_id"
  intel_classification_codes ||--o{ intel_business_model_classifications : "classification_code_id"
  intel_industries ||--o{ intel_business_models : "industry_id"
  intel_business_models ||--o{ intel_business_relationships : "from_business_model_id"
  intel_business_models ||--o{ intel_business_relationships : "to_business_model_id"
  intel_business_models ||--o{ intel_business_variants : "business_model_id"
  intel_business_models ||--o{ intel_business_versions : "business_model_id"
  intel_classification_systems ||--o{ intel_classification_codes : "system_code"
  intel_industries ||--o{ intel_industries : "parent_id"
```

## Evidence and provenance

```mermaid
erDiagram
  intel_sources {
    uuid id PK
  }
  intel_source_documents {
    uuid id PK
    uuid source_id FK
    uuid superseded_by FK
    uuid uploaded_by FK
  }
  intel_document_pages {
    uuid document_id PK,FK
    integer page_no PK
  }
  intel_document_chunks {
    uuid id PK
    uuid document_id FK
  }
  intel_evidence_claims {
    uuid id PK
    uuid source_document_id FK
    uuid business_model_id FK
    uuid business_variant_id FK
    text unit_code FK
    uuid reviewed_by FK
    uuid corrected_from_id FK
    uuid created_by FK
  }
  intel_evidence_links {
    uuid id PK
    uuid claim_id FK
    uuid created_by FK
  }
  intel_cost_observations {
    uuid id PK
    uuid cost_item_id FK
    text unit_code FK
    uuid location_id FK
    uuid source_id FK
    uuid source_document_id FK
    uuid supplier_quote_id FK
    uuid verified_by FK
    uuid supersedes_id FK
    uuid created_by FK
  }
  intel_parameter_observations {
    uuid id PK
    uuid business_variant_id FK
    text parameter_key FK
    uuid revenue_stream_id FK
    text unit_code FK
    uuid location_id FK
    uuid source_id FK
    uuid source_document_id FK
    uuid verified_by FK
    uuid supersedes_id FK
    uuid created_by FK
  }
  intel_market_observations {
    uuid id PK
    uuid business_model_id FK
    uuid location_id FK
    text metric_key FK
    text unit_code FK
    uuid source_id FK
    uuid source_document_id FK
    uuid verified_by FK
    uuid supersedes_id FK
    uuid created_by FK
  }
  intel_location_metrics {
    uuid id PK
    uuid location_id FK
    text metric_key FK
    text unit_code FK
    uuid source_id FK
    uuid source_document_id FK
    uuid verified_by FK
    uuid supersedes_id FK
    uuid created_by FK
  }
  intel_research_reviews {
    uuid id PK
    uuid business_model_id FK
    uuid reviewer FK
  }
  intel_source_documents ||--o{ intel_cost_observations : "source_document_id"
  intel_sources ||--o{ intel_cost_observations : "source_id"
  intel_cost_observations ||--o{ intel_cost_observations : "supersedes_id"
  intel_source_documents ||--o{ intel_document_chunks : "document_id"
  intel_source_documents ||--o{ intel_document_pages : "document_id"
  intel_evidence_claims ||--o{ intel_evidence_claims : "corrected_from_id"
  intel_source_documents ||--o{ intel_evidence_claims : "source_document_id"
  intel_evidence_claims ||--o{ intel_evidence_links : "claim_id"
  intel_source_documents ||--o{ intel_location_metrics : "source_document_id"
  intel_sources ||--o{ intel_location_metrics : "source_id"
  intel_location_metrics ||--o{ intel_location_metrics : "supersedes_id"
  intel_source_documents ||--o{ intel_market_observations : "source_document_id"
  intel_sources ||--o{ intel_market_observations : "source_id"
  intel_market_observations ||--o{ intel_market_observations : "supersedes_id"
  intel_source_documents ||--o{ intel_parameter_observations : "source_document_id"
  intel_sources ||--o{ intel_parameter_observations : "source_id"
  intel_parameter_observations ||--o{ intel_parameter_observations : "supersedes_id"
  intel_sources ||--o{ intel_source_documents : "source_id"
  intel_source_documents ||--o{ intel_source_documents : "superseded_by"
```

## Costs, equipment and suppliers

```mermaid
erDiagram
  intel_business_variants {
    uuid id PK
    uuid business_model_id FK
    text financial_template_key FK
    uuid created_by FK
  }
  intel_cost_categories {
    uuid id PK
    uuid parent_id FK
  }
  intel_cost_items {
    uuid id PK
    uuid business_variant_id FK
    uuid cost_category_id FK
    uuid equipment_id FK
    uuid raw_material_id FK
    uuid revenue_stream_id FK
    text quantity_unit_code FK
    uuid created_by FK
  }
  intel_cost_observations {
    uuid id PK
    uuid cost_item_id FK
    text unit_code FK
    uuid location_id FK
    uuid source_id FK
    uuid source_document_id FK
    uuid supplier_quote_id FK
    uuid verified_by FK
    uuid supersedes_id FK
    uuid created_by FK
  }
  intel_equipment {
    uuid id PK
  }
  intel_equipment_specifications {
    uuid id PK
    uuid equipment_id FK
    text unit_code FK
    uuid source_document_id FK
  }
  intel_suppliers {
    uuid id PK
    uuid location_id FK
    uuid created_by FK
  }
  intel_supplier_quotes {
    uuid id PK
    uuid supplier_id FK
    uuid business_variant_id FK
    uuid cost_item_id FK
    uuid equipment_id FK
    uuid raw_material_id FK
    text unit_code FK
    uuid delivery_location_id FK
    uuid source_document_id FK
    uuid collected_by FK
    uuid verified_by FK
  }
  intel_raw_materials {
    uuid id PK
    text default_unit_code FK
  }
  intel_business_raw_materials {
    uuid id PK
    uuid business_variant_id FK
    uuid raw_material_id FK
    uuid revenue_stream_id FK
    text consumption_unit_code FK
  }
  intel_observation_conflicts {
    uuid id PK
    uuid business_variant_id FK
    uuid cost_item_id FK
    text parameter_key FK
    uuid resolved_by FK
  }
  intel_business_variants ||--o{ intel_business_raw_materials : "business_variant_id"
  intel_raw_materials ||--o{ intel_business_raw_materials : "raw_material_id"
  intel_cost_categories ||--o{ intel_cost_categories : "parent_id"
  intel_business_variants ||--o{ intel_cost_items : "business_variant_id"
  intel_cost_categories ||--o{ intel_cost_items : "cost_category_id"
  intel_equipment ||--o{ intel_cost_items : "equipment_id"
  intel_raw_materials ||--o{ intel_cost_items : "raw_material_id"
  intel_cost_items ||--o{ intel_cost_observations : "cost_item_id"
  intel_cost_observations ||--o{ intel_cost_observations : "supersedes_id"
  intel_supplier_quotes ||--o{ intel_cost_observations : "supplier_quote_id"
  intel_equipment ||--o{ intel_equipment_specifications : "equipment_id"
  intel_business_variants ||--o{ intel_observation_conflicts : "business_variant_id"
  intel_cost_items ||--o{ intel_observation_conflicts : "cost_item_id"
  intel_business_variants ||--o{ intel_supplier_quotes : "business_variant_id"
  intel_cost_items ||--o{ intel_supplier_quotes : "cost_item_id"
  intel_equipment ||--o{ intel_supplier_quotes : "equipment_id"
  intel_raw_materials ||--o{ intel_supplier_quotes : "raw_material_id"
  intel_suppliers ||--o{ intel_supplier_quotes : "supplier_id"
```

## Financial model

```mermaid
erDiagram
  intel_business_variants {
    uuid id PK
    uuid business_model_id FK
    text financial_template_key FK
    uuid created_by FK
  }
  intel_revenue_streams {
    uuid id PK
    uuid business_variant_id FK
    text pricing_unit_code FK
  }
  intel_financial_model_templates {
    text key PK
  }
  intel_financial_parameter_definitions {
    text key PK
    text template_key FK
    text unit_code FK
  }
  intel_parameter_observations {
    uuid id PK
    uuid business_variant_id FK
    text parameter_key FK
    uuid revenue_stream_id FK
    text unit_code FK
    uuid location_id FK
    uuid source_id FK
    uuid source_document_id FK
    uuid verified_by FK
    uuid supersedes_id FK
    uuid created_by FK
  }
  intel_financial_parameters {
    uuid id PK
    uuid business_variant_id FK
    uuid location_id FK
    text parameter_key FK
    uuid cost_item_id FK
    uuid revenue_stream_id FK
    text unit_code FK
    uuid set_by FK
  }
  intel_financial_parameter_sources {
    uuid id PK
    uuid financial_parameter_id FK
    uuid cost_observation_id FK
    uuid parameter_observation_id FK
    uuid market_observation_id FK
    uuid location_metric_id FK
  }
  intel_financial_scenarios {
    uuid id PK
    uuid business_variant_id FK
    uuid location_id FK
    uuid computed_by FK
  }
  intel_cost_items {
    uuid id PK
    uuid business_variant_id FK
    uuid cost_category_id FK
    uuid equipment_id FK
    uuid raw_material_id FK
    uuid revenue_stream_id FK
    text quantity_unit_code FK
    uuid created_by FK
  }
  intel_locations {
    uuid id PK
    uuid parent_id FK
  }
  intel_financial_model_templates ||--o{ intel_business_variants : "financial_template_key"
  intel_business_variants ||--o{ intel_cost_items : "business_variant_id"
  intel_revenue_streams ||--o{ intel_cost_items : "revenue_stream_id"
  intel_financial_model_templates ||--o{ intel_financial_parameter_definitions : "template_key"
  intel_financial_parameters ||--o{ intel_financial_parameter_sources : "financial_parameter_id"
  intel_parameter_observations ||--o{ intel_financial_parameter_sources : "parameter_observation_id"
  intel_business_variants ||--o{ intel_financial_parameters : "business_variant_id"
  intel_cost_items ||--o{ intel_financial_parameters : "cost_item_id"
  intel_locations ||--o{ intel_financial_parameters : "location_id"
  intel_financial_parameter_definitions ||--o{ intel_financial_parameters : "parameter_key"
  intel_revenue_streams ||--o{ intel_financial_parameters : "revenue_stream_id"
  intel_business_variants ||--o{ intel_financial_scenarios : "business_variant_id"
  intel_locations ||--o{ intel_financial_scenarios : "location_id"
  intel_locations ||--o{ intel_locations : "parent_id"
  intel_business_variants ||--o{ intel_parameter_observations : "business_variant_id"
  intel_financial_parameter_definitions ||--o{ intel_parameter_observations : "parameter_key"
  intel_locations ||--o{ intel_parameter_observations : "location_id"
  intel_revenue_streams ||--o{ intel_parameter_observations : "revenue_stream_id"
  intel_parameter_observations ||--o{ intel_parameter_observations : "supersedes_id"
  intel_business_variants ||--o{ intel_revenue_streams : "business_variant_id"
```

## Requirements, founder, lifestyle, risk, execution

```mermaid
erDiagram
  intel_business_models {
    uuid id PK
    uuid industry_id FK
    uuid created_by FK
  }
  intel_business_variants {
    uuid id PK
    uuid business_model_id FK
    text financial_template_key FK
    uuid created_by FK
  }
  intel_operating_requirements {
    uuid id PK
    uuid business_variant_id FK
    text unit_code FK
  }
  intel_skills {
    uuid id PK
  }
  intel_business_skill_mapping {
    uuid business_model_id PK,FK
    uuid skill_id PK,FK
  }
  intel_founder_requirements {
    uuid business_model_id PK,FK
  }
  intel_lifestyle_profiles {
    uuid business_variant_id PK,FK
  }
  intel_training_programs {
    uuid id PK
    uuid location_id FK
    uuid source_document_id FK
  }
  intel_training_program_businesses {
    uuid training_program_id PK,FK
    uuid business_model_id PK,FK
  }
  intel_business_risks {
    uuid id PK
    uuid business_model_id FK
  }
  intel_launch_tasks {
    uuid id PK
    uuid business_model_id FK
    uuid depends_on FK
  }
  intel_business_models ||--o{ intel_business_risks : "business_model_id"
  intel_business_models ||--o{ intel_business_skill_mapping : "business_model_id"
  intel_skills ||--o{ intel_business_skill_mapping : "skill_id"
  intel_business_models ||--o{ intel_business_variants : "business_model_id"
  intel_business_models ||--o{ intel_founder_requirements : "business_model_id"
  intel_business_models ||--o{ intel_launch_tasks : "business_model_id"
  intel_launch_tasks ||--o{ intel_launch_tasks : "depends_on"
  intel_business_variants ||--o{ intel_lifestyle_profiles : "business_variant_id"
  intel_business_variants ||--o{ intel_operating_requirements : "business_variant_id"
  intel_business_models ||--o{ intel_training_program_businesses : "business_model_id"
  intel_training_programs ||--o{ intel_training_program_businesses : "training_program_id"
```

## Geography, market and regulation

```mermaid
erDiagram
  intel_locations {
    uuid id PK
    uuid parent_id FK
  }
  intel_location_metrics {
    uuid id PK
    uuid location_id FK
    text metric_key FK
    text unit_code FK
    uuid source_id FK
    uuid source_document_id FK
    uuid verified_by FK
    uuid supersedes_id FK
    uuid created_by FK
  }
  intel_metric_definitions {
    text key PK
    text unit_code FK
  }
  intel_market_observations {
    uuid id PK
    uuid business_model_id FK
    uuid location_id FK
    text metric_key FK
    text unit_code FK
    uuid source_id FK
    uuid source_document_id FK
    uuid verified_by FK
    uuid supersedes_id FK
    uuid created_by FK
  }
  intel_regulations {
    uuid id PK
    uuid jurisdiction_location_id FK
    uuid source_id FK
    uuid source_document_id FK
    uuid verified_by FK
  }
  intel_business_regulations {
    uuid id PK
    uuid business_model_id FK
    uuid regulation_id FK
    uuid verified_by FK
  }
  intel_government_schemes {
    uuid id PK
    uuid jurisdiction_location_id FK
    uuid source_id FK
    uuid source_document_id FK
  }
  intel_business_scheme_eligibility {
    uuid business_model_id PK,FK
    uuid scheme_id PK,FK
  }
  intel_business_models {
    uuid id PK
    uuid industry_id FK
    uuid created_by FK
  }
  intel_business_models ||--o{ intel_business_regulations : "business_model_id"
  intel_regulations ||--o{ intel_business_regulations : "regulation_id"
  intel_business_models ||--o{ intel_business_scheme_eligibility : "business_model_id"
  intel_government_schemes ||--o{ intel_business_scheme_eligibility : "scheme_id"
  intel_locations ||--o{ intel_government_schemes : "jurisdiction_location_id"
  intel_locations ||--o{ intel_location_metrics : "location_id"
  intel_metric_definitions ||--o{ intel_location_metrics : "metric_key"
  intel_location_metrics ||--o{ intel_location_metrics : "supersedes_id"
  intel_locations ||--o{ intel_locations : "parent_id"
  intel_business_models ||--o{ intel_market_observations : "business_model_id"
  intel_locations ||--o{ intel_market_observations : "location_id"
  intel_metric_definitions ||--o{ intel_market_observations : "metric_key"
  intel_market_observations ||--o{ intel_market_observations : "supersedes_id"
  intel_locations ||--o{ intel_regulations : "jurisdiction_location_id"
```

## Ground Truth

```mermaid
erDiagram
  gt_interview_subjects {
    uuid id PK
    uuid assigned_interviewer FK
    uuid created_by FK
  }
  gt_consents {
    uuid id PK
    uuid subject_id FK
    uuid recorded_by FK
  }
  gt_owner_interviews {
    uuid id PK
    uuid subject_id FK
    uuid consent_id FK
    uuid business_model_id FK
    uuid business_variant_id FK
    uuid location_id FK
    uuid questionnaire_id FK
    uuid interviewer FK
    uuid reviewed_by FK
    uuid created_by FK
  }
  gt_interview_responses {
    uuid id PK
    uuid interview_id FK
    uuid question_id FK
    text unit_code FK
  }
  gt_business_actuals {
    uuid id PK
    uuid interview_id FK
    text metric_key FK
    text unit_code FK
    uuid verified_by FK
    uuid question_id FK
  }
  gt_questionnaires {
    uuid id PK
  }
  gt_questionnaire_questions {
    uuid id PK
    uuid questionnaire_id FK
    text metric_key FK
  }
  intel_business_models {
    uuid id PK
    uuid industry_id FK
    uuid created_by FK
  }
  gt_owner_interviews ||--o{ gt_business_actuals : "interview_id"
  gt_questionnaire_questions ||--o{ gt_business_actuals : "question_id"
  gt_interview_subjects ||--o{ gt_consents : "subject_id"
  gt_owner_interviews ||--o{ gt_interview_responses : "interview_id"
  gt_questionnaire_questions ||--o{ gt_interview_responses : "question_id"
  intel_business_models ||--o{ gt_owner_interviews : "business_model_id"
  gt_consents ||--o{ gt_owner_interviews : "consent_id"
  gt_questionnaires ||--o{ gt_owner_interviews : "questionnaire_id"
  gt_interview_subjects ||--o{ gt_owner_interviews : "subject_id"
  gt_questionnaires ||--o{ gt_questionnaire_questions : "questionnaire_id"
```

## Research operations, review and publication

```mermaid
erDiagram
  ops_research_runs {
    uuid id PK
    uuid business_model_id FK
    uuid source_document_id FK
    uuid requested_by FK
  }
  ops_research_run_steps {
    uuid run_id PK,FK
    text stage PK
  }
  ops_research_run_logs {
    bigint id PK
    uuid run_id FK
  }
  ops_llm_usage {
    bigint id PK
    uuid run_id FK
    uuid business_model_id FK
    uuid source_document_id FK
  }
  ops_ingestion_log {
    bigint id PK
    uuid source_id FK
    uuid document_id FK
  }
  intel_research_tasks {
    uuid id PK
    uuid business_model_id FK
    uuid business_variant_id FK
    uuid source_id FK
    uuid assignee FK
    uuid completed_by FK
    uuid created_by FK
  }
  intel_business_versions {
    uuid id PK
    uuid business_model_id FK
    uuid submitted_by FK
    uuid decided_by FK
  }
  pub_publication_versions {
    uuid id PK
    uuid business_model_id FK
    uuid business_version_id FK
    uuid published_by FK
  }
  ops_publication_policy {
    boolean singleton PK
    uuid updated_by FK
  }
  ops_staff_members {
    uuid user_id PK,FK
  }
  ops_staff_roles {
    uuid user_id PK,FK
    text role PK
    uuid granted_by FK
  }
  ops_audit_log {
    bigint id PK
  }
  intel_business_models {
    uuid id PK
    uuid industry_id FK
    uuid created_by FK
  }
  intel_business_models ||--o{ intel_business_versions : "business_model_id"
  intel_business_models ||--o{ intel_research_tasks : "business_model_id"
  intel_business_models ||--o{ ops_llm_usage : "business_model_id"
  ops_research_runs ||--o{ ops_llm_usage : "run_id"
  ops_research_runs ||--o{ ops_research_run_logs : "run_id"
  ops_research_runs ||--o{ ops_research_run_steps : "run_id"
  intel_business_models ||--o{ ops_research_runs : "business_model_id"
  ops_staff_members ||--o{ ops_staff_roles : "user_id"
  intel_business_models ||--o{ pub_publication_versions : "business_model_id"
  intel_business_versions ||--o{ pub_publication_versions : "business_version_id"
```

## Customer

```mermaid
erDiagram
  customer_user_profiles {
    uuid user_id PK,FK
    uuid preferred_location_id FK
  }
  customer_user_assets {
    uuid id PK
    uuid user_id FK
    text asset_type_slug FK
    uuid location_id FK
    text unit_code FK
  }
  customer_user_capabilities {
    uuid user_id PK,FK
    uuid skill_id PK,FK
  }
  customer_profile_documents {
    uuid id PK
    uuid user_id FK
  }
  customer_recommendations {
    uuid id PK
    uuid user_id FK
    uuid publication_id FK
    uuid business_model_id FK
  }
  customer_saved_businesses {
    uuid user_id PK,FK
    uuid business_model_id PK,FK
  }
  customer_pricing_plans {
    text key PK
  }
  pub_publication_versions {
    uuid id PK
    uuid business_model_id FK
    uuid business_version_id FK
    uuid published_by FK
  }
  intel_skills {
    uuid id PK
  }
  intel_asset_types {
    text slug PK
  }
  pub_publication_versions ||--o{ customer_recommendations : "publication_id"
  intel_asset_types ||--o{ customer_user_assets : "asset_type_slug"
  intel_skills ||--o{ customer_user_capabilities : "skill_id"
```
