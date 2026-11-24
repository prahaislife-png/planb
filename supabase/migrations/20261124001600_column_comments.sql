-- PlanB · 0016 · Column descriptions for the generated data dictionary. Documentation only — no schema change.

-- The passport columns are identical on all four observation tables.
do $$
declare
  t text;
  c record;
begin
  foreach t in array array['cost_observations', 'parameter_observations', 'market_observations', 'location_metrics']
  loop
    for c in
      select * from (values
        ('value_low', 'Lower bound when the source gives a range.'),
        ('value_high', 'Upper bound when the source gives a range.'),
        ('unit_code', 'Unit the value refers to (intel.units). Money is always ''inr'' in absolute rupees.'),
        ('period', 'Time basis of the value: one_time, per_month, per_year, per_unit…'),
        ('observed_on', 'Date the figure refers to: quotation date, document date or observation date — not the date we recorded it.'),
        ('observed_on_precision', 'How precisely observed_on is known. ''year'' = only the year is known; ''unknown'' = the source is undated and the retrieval date was recorded instead.'),
        ('location_id', 'Geography node the figure applies to, when it is location-specific.'),
        ('geographic_scope', 'Level at which the source says the figure applies (city, district, state, national).'),
        ('source_id', 'Registry source the figure came from.'),
        ('source_document_id', 'Original document holding the figure, when there is one.'),
        ('page_ref', 'Page of the source document that states the figure.'),
        ('section_ref', 'Section or table of the source document.'),
        ('tax_treatment', 'Whether the figure includes GST. ''unknown'' is a research gap, not ''exclusive''.'),
        ('evidence_type', 'What kind of evidence this is. Determines the best grade the observation can reach.'),
        ('verification_status', 'unverified → verified / disputed / rejected. Only reviewers and admins can verify; rejected observations are kept but never used.'),
        ('verified_by', 'Reviewer who verified the observation.'),
        ('evidence_grade', 'A verified primary/regulatory evidence · B corroborated by independent current sources · C single source, older benchmark or self-reported · D estimate or assumption.'),
        ('grade_basis', 'Why the observation holds its grade (e.g. "corroborated by 2 independent sources").'),
        ('analyst_notes', 'Free-text notes by analysts. Private: never included in snapshots or publications.'),
        ('valid_until', 'Date after which the figure itself expires (e.g. quotation validity).'),
        ('revalidate_by', 'Date by which the figure must be re-confirmed. Past this date it counts as stale and blocks publication.'),
        ('supersedes_id', 'The earlier observation this one replaces. The earlier row is retained as history.'),
        ('research_run_id', 'Pipeline run that created the row, when created automatically.'),
        ('data_origin', 'research = genuine research; demo / test rows can never be verified or published.')
      ) as v (col, txt)
    loop
      if exists (select 1 from information_schema.columns where table_schema = 'intel' and table_name = t and column_name = c.col) then
        execute format('comment on column intel.%I.%I is %L', t, c.col, c.txt);
      end if;
    end loop;
  end loop;
end $$;

comment on column intel.cost_observations.is_line_total is 'True when value is the total for quantity_covered units rather than a price for one unit.';
comment on column intel.cost_observations.quantity_covered is 'Number of units a line-total value covers.';
comment on column intel.cost_observations.projection_year is 'When the source gives a multi-year projection, the projection year this value belongs to (1 = first operating year).';
comment on column intel.cost_observations.installation is 'Whether installation/commissioning is included in the figure.';
comment on column intel.cost_observations.supplier_quote_id is 'The supplier quotation this observation was created from, for evidence_type = supplier_quote.';
comment on column intel.cost_observations.scale_note is 'Free-text note on the scale or capacity the figure relates to.';

comment on column intel.evidence_claims.page_no is 'Page of the source document the claim was read from (1-based).';
comment on column intel.evidence_claims.quote is 'Verbatim text from the page that states the claim.';
comment on column intel.evidence_claims.quote_match_score is '1.0 = exact match after whitespace normalisation; lower = tolerant layout match. Diagnostic.';
comment on column intel.evidence_claims.subject is 'What the claim is about, as named in the source (e.g. a machine, a staff role).';
comment on column intel.evidence_claims.attribute is 'Which property of the subject the value describes (unit_price, monthly_wage_per_head, annual_amount_year_1…).';
comment on column intel.evidence_claims.value_numeric is 'The number exactly as printed in the source (2.80 for "Rs. 2.80 lakh").';
comment on column intel.evidence_claims.unit_raw is 'Unit exactly as printed, including any money scale ("Rs. in lacs").';
comment on column intel.evidence_claims.value_normalized is 'value_numeric converted to absolute units by the normalisation stage (280000 for 2.80 lakh).';
comment on column intel.evidence_claims.normalization_notes is 'What the normalisation stage did, or why it could not normalise.';
comment on column intel.evidence_claims.qualifiers is 'Small closed set of extra facts from the extractor: revenue stream, projection year, tax treatment, recurrence…';
comment on column intel.evidence_claims.target_kind is 'What kind of record the extractor proposes this claim should become. ''context'' claims are kept as evidence but not materialised.';
comment on column intel.evidence_claims.extraction_method is 'llm, rule_based, manual (analyst correction) or import.';
comment on column intel.evidence_claims.extractor is 'Name and version of the extractor, or the model id.';
comment on column intel.evidence_claims.status is 'extracted → accepted / rejected by a human; superseded when replaced by a correction.';

comment on column intel.business_models.family is 'Grouping of sibling operating models (e.g. "coffee"). Siblings are separate records.';
comment on column intel.business_models.revenue_archetype is 'Finance-engine driver kind expected for this model (triage hint from the backlog).';
comment on column intel.business_models.is_pilot is 'One of the ten models researched in depth first.';
comment on column intel.business_models.backlog_notes is 'Unverified research leads from the backlog (scales, regulatory leads, candidate sources). Never shown to customers.';
comment on column intel.business_variants.financial_template_key is 'Primary revenue archetype of this variant.';
comment on column intel.cost_items.recurrence is 'one_time (capital), monthly, annual, per_unit_output or pct_of_revenue.';
comment on column intel.cost_items.useful_life_years is 'Evidenced useful life. When NULL the category default is applied and recorded as a model assumption.';
comment on column intel.cost_items.revenue_stream_id is 'For variable costs: the revenue stream the cost belongs to.';
comment on column intel.financial_parameters.basis is 'observation = resolved from observations · derived = computed by the formula in rationale · assumption = explicit analyst or PlanB default value (always grade D).';
comment on column intel.financial_parameters.method is 'How the value was resolved from its sources (single observation, median, formula, manual…).';
comment on column intel.financial_parameters.rationale is 'Why this value: the formula for derived values, the reason for assumptions, the conflict note for medians.';
comment on column intel.financial_parameters.is_current is 'Exactly one current row per subject and scenario; superseded rows are retained as history.';
comment on column intel.financial_parameters.set_by is 'Analyst who set the value by hand. Pipeline runs never overwrite an analyst-set value.';
comment on column intel.financial_scenarios.input is 'Exact engine input and scenario adjustments used. Sufficient to reproduce the outputs.';
comment on column intel.financial_scenarios.input_hash is 'SHA-256 of the canonical validated engine input.';
comment on column intel.financial_scenarios.summary is 'Initial investment, funding, summary metrics, model notes and source reconciliation.';
comment on column intel.financial_scenarios.assumption_count is 'How many model inputs behind this scenario are assumptions.';
comment on column intel.source_documents.sha256 is 'SHA-256 of the original file. Identity of the document; also its storage path.';
comment on column intel.source_documents.storage_path is 'Path inside the private evidence bucket.';
comment on column intel.source_documents.text_status is 'pending → extracted; needs_ocr when the PDF has no text layer.';
comment on column intel.source_documents.licence_snapshot is 'The source''s licence and reuse status as recorded when the document was ingested.';
comment on column intel.source_documents.document_date_precision is 'How precisely the document date is known; ''year'' often means it was taken from PDF metadata because the document prints no date.';
comment on column intel.sources.recommended_ingestion is 'Research recommendation: automated, manual_only or do_not_ingest.';
comment on column intel.sources.ingestion_enabled is 'Whether adapters may fetch from this source. An explicit admin decision, constrained by reuse rights.';
comment on column intel.sources.licence_quoted_terms is 'Verbatim excerpt of the operative reuse terms, as read on terms_checked_on.';
comment on column intel.sources.permission_granted_on is 'Date written permission to reuse was received, for permission_required sources.';
comment on column intel.sources.permission_evidence is 'Where the written permission is filed (email reference, document).';
comment on column intel.research_tasks.requires_human is 'True when the task cannot be completed by the pipeline (quotations, interviews, legal verification…).';
comment on column intel.research_tasks.generated_by is 'Rule or completeness check that raised the task, or ''manual''.';
comment on column intel.business_versions.pending_claims is 'Extracted claims not yet reviewed at submission. Must be 0 for publication under the default policy.';
comment on column intel.business_versions.submitted_by_run is 'Pipeline run that submitted the version, when not submitted by a person.';
comment on column ops.research_runs.locked_until is 'Lease expiry. A running run whose lease has expired is reclaimed by the next worker.';
comment on column ops.research_runs.attempt is 'Number of times the run has been claimed.';
comment on column ops.research_runs.next_attempt_at is 'Earliest time the run may be claimed (exponential backoff after a failure).';
comment on column ops.research_runs.spent_usd is 'LLM spend recorded against the run so far.';
comment on column ops.audit_log.actor_db_role is 'Database role in effect: authenticated (a staff user), planb_worker, or the owning role for migrations.';
comment on column ops.audit_log.changed_fields is 'Columns whose value changed (updates only).';
comment on column ops.audit_log.old_row is 'Row before the change. NULL for tables holding personal data (values are never copied into the audit log).';
comment on column gt.owner_interviews.business_status is 'operating, closed, sold or paused. Closed and sold businesses are sought deliberately.';
comment on column gt.owner_interviews.location_id is 'District-level or coarser location, to keep the interview de-identified.';
comment on column gt.owner_interviews.anonymisation_status is 'An interview cannot be marked reviewed until identifying detail has been removed from its free text.';
comment on column gt.business_actuals.evidence_level is 'documented = a supporting document was seen and referenced · self_reported = the owner''s word only (never better than grade C).';
