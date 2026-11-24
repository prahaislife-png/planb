"""Unit tests: normalisation, quote verification, extractors, rate limiting. No database needed."""

from __future__ import annotations

import pytest

from planb_research.adapters.base import RateLimiter
from planb_research.extract import niftem_rules
from planb_research.extract.schemas import ExtractedClaim
from planb_research.extract.verify import verify_quote
from planb_research.ingest import chunk_text, extract_pages
from planb_research.textnorm import (
    money_multiplier,
    normalize_money,
    normalize_period,
    normalize_unit,
    numbers_in,
    parse_number,
    slugify,
    to_monthly,
)

from .fixtures import SYNTHETIC_DPR_PAGES, minimal_pdf


class TestNumbers:
    @pytest.mark.parametrize("raw,expected", [("1,01,000", 101000), ("101,000", 101000), ("2.50", 2.5), ("60%", 60), ("12", 12)])
    def test_parse_number_handles_indian_and_western_grouping(self, raw, expected):
        assert parse_number(raw) == expected

    @pytest.mark.parametrize("raw", ["", "abc", "1.2.3", "12kg"])
    def test_parse_number_rejects_non_numbers(self, raw):
        assert parse_number(raw) is None

    def test_numbers_in_text(self):
        assert numbers_in("Skilled 12,000 3 36,000 at 5%") == [12000, 3, 36000, 5]


class TestMoney:
    @pytest.mark.parametrize("unit,mult", [("Rs. in lacs", 1e5), ("Rs. Lakh", 1e5), ("₹ crore", 1e7), ("Rs.", 1), ("INR", 1), ("Rs. per packet", 1)])
    def test_multiplier(self, unit, mult):
        assert money_multiplier(unit) == mult

    def test_non_money_unit_is_not_money(self):
        assert money_multiplier("Kg") is None and normalize_money(5, "Kg") is None

    def test_lakh_to_rupees(self):
        assert normalize_money(2.80, "Rs. in lacs").amount_inr == 280000


class TestUnits:
    @pytest.mark.parametrize("raw,code", [("Kg", "kg"), ("Sq. ft", "sq_ft"), ("KW", "kw"), ("MT", "tonne"), ("Nos.", "each"), ("days", "day"), ("%", "percent")])
    def test_known_units(self, raw, code):
        assert normalize_unit(raw) == code

    def test_unknown_unit_is_left_unresolved(self):
        assert normalize_unit("bigha") is None

    def test_periods(self):
        assert normalize_period("per annum") == "per_year" and normalize_period("per month") == "per_month"
        assert normalize_period("fortnightly") is None

    def test_to_monthly_needs_evidence_for_daily(self):
        assert to_monthly(120, "per_year") == 10
        assert to_monthly(100, "per_day") is None
        assert to_monthly(100, "per_day", operating_days_per_month=25) == 2500

    def test_slugify(self):
        assert slugify("Impact pulveriser (without sieve)", "_") == "impact_pulveriser_without_sieve"


class TestQuoteVerification:
    PAGE = "Machine                Unit   Rate     Price\n Impact pulveriser without sieve     1    300000   300000\n"

    def test_exact_quote_with_layout_whitespace(self):
        r = verify_quote("Impact pulveriser without sieve 1 300000 300000", self.PAGE, 300000)
        assert r.verified and r.score == 1.0

    def test_quote_not_on_page(self):
        assert not verify_quote("Hammer mill 1 450000 450000", self.PAGE, 450000).verified

    def test_value_must_appear_in_quote(self):
        r = verify_quote("Impact pulveriser without sieve 1 300000 300000", self.PAGE, 350000)
        assert not r.verified and "does not appear" in r.reason

    def test_fabricated_number_fails_even_when_words_match(self):
        assert not verify_quote("Impact pulveriser without sieve 1 900000 900000", self.PAGE, 900000).verified

    def test_empty_page(self):
        assert not verify_quote("anything", "", None).verified


class TestNiftemRules:
    def test_recognises_template_only(self):
        assert niftem_rules.applies(SYNTHETIC_DPR_PAGES)
        assert not niftem_rules.applies([(1, "Annual report of a company")])

    def test_extracts_expected_claims_and_every_quote_verifies(self):
        result = niftem_rules.extract(SYNTHETIC_DPR_PAGES)
        pages = dict(SYNTHETIC_DPR_PAGES)
        assert result.method == "rule_based" and len(result.claims) >= 30
        for c in result.claims:
            assert verify_quote(c.quote, pages[c.page_no], c.value_numeric).verified, c.subject
        by_subject = {c.subject: c for c in result.claims}
        grinder = by_subject["Synthetic grinder"]
        assert (grinder.value_numeric, grinder.quantity, grinder.cost_category_slug) == (200000, 2, "capex.machinery")
        assert grinder.qualifiers.tax_treatment == "exclusive"
        assert by_subject["Miscellaneous fixed assets"].unit_raw == "Rs. in lacs"
        params = {c.parameter_key: c.value_numeric for c in result.claims if c.parameter_key}
        assert params["utilization_year1_pct"] == 50 and params["utilization_pct"] == 100
        assert params["unit_price"] == 100 and params["capacity_units_per_month"] == 120000  # printed per annum; normalised later
        assert params["loan_tenure_months"] == 60 and params["loan_moratorium_months"] == 6
        assert params["raw_material_stock_days"] == 10 and params["finished_goods_stock_days"] == 5

    def test_unrecognised_rows_are_not_invented(self):
        result = niftem_rules.extract([(1, "DETAILED PROJECT REPORT UNDER PMFME SCHEME\nnothing structured here")])
        assert result.claims == [] and result.notes


class TestClaimSchema:
    def test_claim_requires_a_value(self):
        with pytest.raises(ValueError):
            ExtractedClaim(page_no=1, quote="abc def", claim_type="cost", subject="x")

    def test_cost_item_requires_category(self):
        with pytest.raises(ValueError):
            ExtractedClaim(page_no=1, quote="abc 5", claim_type="cost", subject="x", value_numeric=5, target_kind="cost_item")

    def test_unknown_fields_rejected(self):
        with pytest.raises(ValueError):
            ExtractedClaim(page_no=1, quote="abc 5", claim_type="cost", subject="x", value_numeric=5, made_up_field=1)

    def test_dedupe_hash_is_stable(self):
        a = ExtractedClaim(page_no=1, quote="abc 5", claim_type="cost", subject="X", value_numeric=5)
        b = ExtractedClaim(page_no=1, quote="different quote 5", claim_type="cost", subject="x", value_numeric=5)
        assert a.dedupe_hash() == b.dedupe_hash()


class TestRateLimiter:
    def test_spaces_requests(self):
        now, slept = [0.0], []

        def sleep(s):
            slept.append(s)
            now[0] += s

        limiter = RateLimiter(per_minute=30, clock=lambda: now[0], sleep=sleep)
        limiter.wait()
        limiter.wait()
        now[0] += 5
        limiter.wait()
        assert slept == [2.0]


class TestPdfText:
    def test_minimal_pdf_roundtrip(self):
        pages = extract_pages(minimal_pdf(["Synthetic grinder 2 200000 400000", "Total 400000"]))
        assert len(pages) == 1 and "Synthetic grinder" in pages[0].text

    def test_chunking_keeps_all_text(self):
        text = "\n\n".join(f"paragraph {i} " + "x" * 300 for i in range(12))
        chunks = chunk_text(text, size=700)
        assert len(chunks) > 3 and all(len(c) <= 700 for c in chunks)
        assert sum(c.count("paragraph") for c in chunks) == 12
