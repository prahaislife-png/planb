"""Research pipelines.

document_research  one source document → evidence → business record → scenarios → gaps → human review
business_refresh   re-derive a business record after analysts reviewed/corrected evidence
freshness_scan     continuous maintenance: stale evidence, expired quotations
"""

from . import analysis, maintenance, stages
from .runner import PIPELINES, Worker, enqueue, register_pipeline

register_pipeline("document_research", [
    ("ingest_document", stages.ingest_document),
    ("extract_claims", stages.extract_claims),
    ("normalize_claims", stages.normalize_claims),
    ("structure_record", stages.structure_record),
    ("cross_verify", analysis.cross_verify),
    ("build_model", analysis.build_model),
    ("analyze_gaps", analysis.analyze_gaps),
    ("submit_for_review", analysis.submit_for_review),
])
register_pipeline("business_refresh", [
    ("normalize_claims", stages.normalize_claims),
    ("structure_record", stages.structure_record),
    ("cross_verify", analysis.cross_verify),
    ("build_model", analysis.build_model),
    ("analyze_gaps", analysis.analyze_gaps),
])
register_pipeline("freshness_scan", [("freshness_scan", maintenance.freshness_scan)])

__all__ = ["PIPELINES", "Worker", "enqueue", "register_pipeline"]
