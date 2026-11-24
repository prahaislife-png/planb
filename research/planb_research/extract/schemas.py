"""Validated schema for extracted claims (pipeline stage 4).

Every extractor — LLM, rule-based, or a human import — must produce exactly this shape. The model
never writes to the database: its output is parsed into these objects, each quote is verified
against the stored page text by deterministic code, and only then is anything persisted.
"""

from __future__ import annotations

import hashlib
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ClaimType = Literal[
    "cost", "price", "capacity", "yield", "utilization", "consumption", "staffing", "wage", "requirement",
    "regulatory", "scheme", "market", "process", "risk", "financial_summary", "other",
]
TargetKind = Literal[
    "cost_item", "parameter", "revenue_stream", "operating_requirement", "regulation", "scheme", "market",
    "risk", "launch_task", "context",
]
Period = Literal["one_time", "per_day", "per_month", "per_year", "per_cycle", "per_unit"]
DriverKind = Literal[
    "transactions", "capacity_utilization", "area_yield", "enrolment", "occupancy", "fleet_utilization", "engagements",
]


class Qualifiers(BaseModel):
    """Small, closed set of extra facts about a claim. Unknown keys are rejected."""

    model_config = ConfigDict(extra="forbid")

    stream_key: str | None = Field(None, description="snake_case key of the revenue stream this claim belongs to")
    stream_name: str | None = None
    driver_kind: DriverKind | None = None
    pricing_unit: str | None = Field(None, description="what one sold unit is, e.g. '1 kg packet'")
    requirement_type: str | None = None
    year_index: int | None = Field(None, ge=1, le=10, description="which projection year the figure refers to")
    at_utilization_pct: float | None = Field(None, ge=0, le=100)
    tax_treatment: Literal["inclusive", "exclusive", "unknown"] | None = None
    installation: Literal["included", "excluded", "unknown"] | None = None
    capacity_note: str | None = None
    authority: str | None = None
    recurrence: Literal["one_time", "monthly", "annual", "per_unit_output", "pct_of_revenue"] | None = None
    useful_life_years: float | None = Field(None, gt=0, le=100)
    is_line_total: bool | None = None


class ExtractedClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page_no: int = Field(ge=1)
    section_ref: str | None = None
    quote: str = Field(min_length=3, max_length=1200, description="verbatim text copied from the page that states the claim")
    claim_type: ClaimType
    subject: str = Field(min_length=1, max_length=200)
    attribute: str | None = Field(None, max_length=60)
    value_numeric: float | None = Field(None, description="the number exactly as printed (2.50 for 'Rs. 2.50 lakh')")
    value_low: float | None = None
    value_high: float | None = None
    value_text: str | None = Field(None, max_length=600)
    unit_raw: str | None = Field(None, max_length=60, description="unit exactly as printed, incl. money scale ('Rs. in lacs')")
    currency: str | None = Field(None, max_length=3)
    period_raw: str | None = Field(None, max_length=40)
    quantity: float | None = Field(None, gt=0)
    target_kind: TargetKind = "context"
    cost_category_slug: str | None = None
    parameter_key: str | None = None
    qualifiers: Qualifiers = Field(default_factory=Qualifiers)
    confidence: float | None = Field(None, ge=0, le=1)

    @model_validator(mode="after")
    def _shape(self) -> ExtractedClaim:
        if self.value_numeric is None and self.value_low is None and not self.value_text:
            raise ValueError("a claim needs a numeric value, a range, or text")
        if self.target_kind == "cost_item" and not self.cost_category_slug:
            raise ValueError("cost_item claims need cost_category_slug")
        if self.target_kind == "parameter" and not self.parameter_key:
            raise ValueError("parameter claims need parameter_key")
        if self.value_low is not None and self.value_high is not None and self.value_low > self.value_high:
            raise ValueError("value_low must not exceed value_high")
        return self

    def dedupe_hash(self) -> str:
        """Stable identity of the claim within its document, so re-extraction is idempotent."""
        key = "|".join(
            str(x)
            for x in (
                self.page_no, self.claim_type, self.subject.strip().lower(), (self.attribute or "").lower(),
                self.value_numeric, self.value_low, self.value_high, (self.unit_raw or "").lower(),
                self.target_kind, self.cost_category_slug, self.parameter_key, self.qualifiers.stream_key,
                self.qualifiers.year_index, (self.value_text or "")[:80].lower() if self.value_numeric is None else "",
            )
        )
        return hashlib.sha256(key.encode()).hexdigest()


class DocumentFacts(BaseModel):
    """Document-level metadata an extractor may propose. All optional; all verified by a human."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    publisher: str | None = None
    document_year: int | None = Field(None, ge=1990, le=2100)
    price_basis_year: int | None = Field(None, ge=1990, le=2100)
    capacity_description: str | None = None


class ExtractionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    extractor: str
    method: Literal["llm", "rule_based", "manual", "import"]
    facts: DocumentFacts = Field(default_factory=DocumentFacts)
    claims: list[ExtractedClaim] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
