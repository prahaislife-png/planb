"""Deterministic quote verification — the guard between any extractor and the database.

An extractor (LLM or rules) asserts: "page P says Q, therefore value V". This module checks, with
no model involved, that (1) Q really occurs on page P of the stored document text, and (2) V really
occurs inside Q. A claim that fails is stored as unverified and can never be accepted or
materialised into an observation (database constraint claims_accept_requires_verified_quote).

This is also the main structural defence against prompt injection: text inside a source document
can at worst make a model emit claims, and every claim must survive this check against the
document itself plus human review before it becomes part of a business record.
"""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher

from ..textnorm import canonical_text, numbers_in

FUZZY_THRESHOLD = 0.92


@dataclass(frozen=True)
class QuoteCheck:
    verified: bool
    score: float
    reason: str


def _tokens(text: str) -> list[str]:
    return canonical_text(text).split(" ")


def verify_quote(quote: str, page_text: str, value: float | None = None) -> QuoteCheck:
    q = canonical_text(quote)
    p = canonical_text(page_text)
    if not q or not p:
        return QuoteCheck(False, 0.0, "empty quote or page text")

    if q in p:
        score = 1.0
    else:
        # Tolerate layout differences (column spacing, line breaks, hyphenation) but nothing semantic:
        # every number in the quote must appear on the page, and the token sequence must align closely.
        page_numbers = set(numbers_in(p))
        missing = [n for n in numbers_in(q) if n not in page_numbers]
        if missing:
            return QuoteCheck(False, 0.0, f"numbers in quote not found on page: {missing[:3]}")
        qt, pt = _tokens(quote), _tokens(page_text)
        matcher = SequenceMatcher(a=qt, b=pt, autojunk=False)
        matched = sum(block.size for block in matcher.get_matching_blocks())
        score = matched / max(len(qt), 1)
        if score < FUZZY_THRESHOLD:
            return QuoteCheck(False, round(score, 3), "quote text not found on the cited page")

    if value is not None:
        quoted = numbers_in(q)
        if not any(abs(n - value) <= 1e-9 * max(1.0, abs(value)) for n in quoted):
            return QuoteCheck(False, round(score, 3), f"claimed value {value:g} does not appear in the quote")
    return QuoteCheck(True, round(score, 3), "exact match" if score == 1.0 else "fuzzy layout match")
