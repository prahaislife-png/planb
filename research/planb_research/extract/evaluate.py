"""Measure one extractor against another on the same document.

Purpose: before the LLM extractor is trusted at volume, run it on documents the rule-based extractor already
handles and whose claims a human has reviewed, and report — per document — how much of the reference it found,
how often it mapped a figure to the same place in the record, and what it added that the reference does not have.

The comparison is deterministic. It never judges whether an *extra* claim is true; it lists extras, with whether
their quote verifies against the page, for a human to read.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..textnorm import money_multiplier
from .schemas import ExtractedClaim, ExtractionResult
from .verify import verify_quote

MATERIAL_TARGETS = {"cost_item", "parameter", "operating_requirement"}


def _absolute(claim: ExtractedClaim) -> float | None:
    """The claim's number in absolute units, so 2.80 'Rs. in lacs' and 280000 'Rs.' compare equal."""
    value = claim.value_numeric if claim.value_numeric is not None else claim.value_high
    if value is None:
        return None
    return float(value) * (money_multiplier(claim.unit_raw) or 1.0)


def _target(claim: ExtractedClaim) -> str:
    return claim.cost_category_slug or claim.parameter_key or claim.qualifiers.requirement_type or claim.target_kind


def _same_number(a: float | None, b: float | None) -> bool:
    return a is not None and b is not None and abs(a - b) <= 1e-6 * max(1.0, abs(a), abs(b))


@dataclass
class Comparison:
    reference_extractor: str
    candidate_extractor: str
    reference_material: int = 0
    found: int = 0
    found_same_target: int = 0
    candidate_total: int = 0
    candidate_quote_verified: int = 0
    missed: list[dict[str, Any]] = field(default_factory=list)
    mapped_differently: list[dict[str, Any]] = field(default_factory=list)
    extras: list[dict[str, Any]] = field(default_factory=list)

    @property
    def recall_pct(self) -> float | None:
        return round(100.0 * self.found / self.reference_material, 1) if self.reference_material else None

    @property
    def target_agreement_pct(self) -> float | None:
        return round(100.0 * self.found_same_target / self.found, 1) if self.found else None

    @property
    def quote_verification_pct(self) -> float | None:
        return round(100.0 * self.candidate_quote_verified / self.candidate_total, 1) if self.candidate_total else None

    def as_dict(self) -> dict[str, Any]:
        return {
            "reference_extractor": self.reference_extractor, "candidate_extractor": self.candidate_extractor,
            "reference_material_claims": self.reference_material, "found_by_candidate": self.found, "recall_pct": self.recall_pct,
            "found_with_same_target": self.found_same_target, "target_agreement_pct": self.target_agreement_pct,
            "candidate_claims": self.candidate_total, "candidate_quote_verified": self.candidate_quote_verified,
            "candidate_quote_verification_pct": self.quote_verification_pct,
            "missed": self.missed, "mapped_differently": self.mapped_differently, "extras": self.extras,
        }


def compare(reference: ExtractionResult, candidate: ExtractionResult, page_text: dict[int, str]) -> Comparison:
    """Match on (page, absolute value). A reference claim counts as found when the candidate has a claim with the
    same number on the same page whose quote verifies; target agreement additionally needs the same mapping."""
    out = Comparison(reference.extractor, candidate.extractor)
    verified: list[tuple[ExtractedClaim, bool]] = []
    for c in candidate.claims:
        ok = verify_quote(c.quote, page_text.get(c.page_no, ""), c.value_numeric).verified
        verified.append((c, ok))
    out.candidate_total = len(verified)
    out.candidate_quote_verified = sum(ok for _, ok in verified)

    used: set[int] = set()
    for ref in reference.claims:
        if ref.target_kind not in MATERIAL_TARGETS:
            continue
        out.reference_material += 1
        ref_value = _absolute(ref)
        candidates = [(i, c) for i, (c, ok) in enumerate(verified)
                      if ok and i not in used and c.page_no == ref.page_no and _same_number(_absolute(c), ref_value)]
        if not candidates:
            out.missed.append({"page": ref.page_no, "subject": ref.subject, "value": ref.value_numeric, "unit": ref.unit_raw, "target": _target(ref)})
            continue
        # prefer a candidate that also agrees on the mapping
        i, match = next(((i, c) for i, c in candidates if _target(c) == _target(ref)), candidates[0])
        used.add(i)
        out.found += 1
        if _target(match) == _target(ref) and (ref.quantity or 1) == (match.quantity or 1):
            out.found_same_target += 1
        else:
            out.mapped_differently.append({"page": ref.page_no, "subject": ref.subject, "value": ref.value_numeric,
                                           "reference": {"target": _target(ref), "quantity": ref.quantity},
                                           "candidate": {"target": _target(match), "quantity": match.quantity, "subject": match.subject}})

    for i, (c, ok) in enumerate(verified):
        if i not in used and c.target_kind in MATERIAL_TARGETS:
            out.extras.append({"page": c.page_no, "subject": c.subject, "value": c.value_numeric, "unit": c.unit_raw, "target": _target(c),
                               "quote_verified": ok, "quote": c.quote[:200]})
    return out
