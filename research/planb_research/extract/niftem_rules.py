"""Deterministic extractor for NIFTEM "Detailed Project Report … under PMFME scheme" documents.

These reports are generated from one template (sections 4.1–4.19 with fixed table layouts), so
they can be read with explicit rules instead of a language model: zero cost, fully reproducible,
and every emitted claim quotes the exact line it came from. Anything the rules do not recognise is
simply not extracted — it surfaces later as a research gap, never as a guess.

The extractor only reads; it does not interpret document text as instructions in any way.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from ..textnorm import collapse_ws, parse_number, slugify
from .schemas import DocumentFacts, ExtractedClaim, ExtractionResult, Qualifiers

NAME = "niftem_pmfme_dpr_rules/1.0"

_NUM = r"\d[\d,]*(?:\.\d+)?"
_ROW_NUMS = re.compile(rf"(?<![\w.])({_NUM})%?(?![\w])")
_MACHINE_HEADER = re.compile(r"^\s*Machine\s+.*Unit\s+Rate\s+Price", re.I)
_MACHINE_ROW = re.compile(rf"^\s*(?P<name>\S.*?)\s{{2,}}(?:(?P<qty>\d{{1,3}})\s+)?(?P<rate>{_NUM})\s+(?P<price>{_NUM})\s*$")
_STAFF_ROW = re.compile(rf"^\s*(?P<role>[A-Za-z][A-Za-z .&/()'-]*?)\s{{2,}}(?P<wage>{_NUM})\s+(?P<count>\d{{1,3}})\s+(?P<total>{_NUM})\s*$")
_LABEL_VALUE = re.compile(rf"^\s*(?P<label>[A-Za-z][^\d]*?)\s{{2,}}(?P<value>{_NUM})\s*(?P<unit>[A-Za-z.%]*)\s*$")

# P&L rows we read from the year-1 column: label regex → (subject, target, category/parameter, recurrence)
_PNL_ROWS: list[tuple[re.Pattern[str], dict]] = [
    (re.compile(r"^raw material consumed", re.I),
     {"subject": "Raw material consumed", "target_kind": "cost_item", "cost_category_slug": "variable.raw_material", "recurrence": "pct_of_revenue"}),
    (re.compile(r"^packaging", re.I),
     {"subject": "Packaging", "target_kind": "cost_item", "cost_category_slug": "variable.packaging", "recurrence": "pct_of_revenue"}),
    (re.compile(r"^rent\b", re.I),
     {"subject": "Rent", "target_kind": "cost_item", "cost_category_slug": "opex.rent", "recurrence": "annual"}),
    (re.compile(r"^selling\s*&\s*adm", re.I),
     {"subject": "Selling and administrative expenses", "target_kind": "cost_item", "cost_category_slug": "opex.admin", "recurrence": "annual"}),
    (re.compile(r"^net profit", re.I),
     {"subject": "Net profit (stated)", "target_kind": "parameter", "parameter_key": "stated_annual_net_profit"}),
    (re.compile(r"^electricity expenses", re.I), {"subject": "Electricity expenses (stated)", "target_kind": "context"}),
    (re.compile(r"^wages\s*&\s*labour", re.I), {"subject": "Wages and labour (stated)", "target_kind": "context"}),
    (re.compile(r"^salary to staff", re.I), {"subject": "Salary to staff (stated)", "target_kind": "context"}),
    (re.compile(r"^depreciation", re.I), {"subject": "Depreciation (stated)", "target_kind": "context"}),
    (re.compile(r"^interest on term loan", re.I), {"subject": "Interest on term loan (stated)", "target_kind": "context"}),
    (re.compile(r"^interest on working capital", re.I), {"subject": "Interest on working capital (stated)", "target_kind": "context"}),
    (re.compile(r"^repair\s*&\s*maintenance", re.I), {"subject": "Repair and maintenance (stated)", "target_kind": "context"}),
    (re.compile(r"^gross profit", re.I), {"subject": "Gross profit (stated)", "target_kind": "context"}),
]


def applies(pages: Iterable[tuple[int, str]]) -> bool:
    head = " ".join(text for _, text in list(pages)[:3]).upper()
    return "DETAILED PROJECT REPORT" in head and ("PMFME" in head or "PM FME" in head or "PM-FME" in head)


def _nums(line: str) -> list[float]:
    return [v for v in (parse_number(m.group(1)) for m in _ROW_NUMS.finditer(line)) if v is not None]


class _Builder:
    def __init__(self) -> None:
        self.claims: list[ExtractedClaim] = []
        self.notes: list[str] = []
        self.stream_key = "product"
        self.stream_name: str | None = None

    def add(self, **kw) -> ExtractedClaim | None:
        q = kw.pop("q", {}) or {}
        try:
            claim = ExtractedClaim(qualifiers=Qualifiers(**q), confidence=None, **kw)
        except Exception as exc:  # noqa: BLE001 - a malformed row is skipped and reported, never forced through
            self.notes.append(f"skipped unparseable row on page {kw.get('page_no')}: {exc}")
            return None
        self.claims.append(claim)
        return claim

    def stream_q(self, **extra) -> dict:
        return {"stream_key": self.stream_key, "stream_name": self.stream_name, "driver_kind": "capacity_utilization", **extra}


def extract(pages: list[tuple[int, str]]) -> ExtractionResult:
    """pages: [(page_no, layout-preserved text)] in order."""
    b = _Builder()
    facts = DocumentFacts()
    state = "none"
    machinery: list[ExtractedClaim] = []
    in_lacs = "Rs. in lacs"

    # ── document-level facts and the product name (needed for the revenue stream key) ──
    for _page_no, text in pages[:4]:
        m = re.search(r"Name of the proposed project\s*:\s*(.+)", text)
        if m and not b.stream_name:
            product = re.sub(r"\s+unit\s*$", "", collapse_ws(m.group(1)), flags=re.I)
            b.stream_name = product
            b.stream_key = slugify(product, "_")[:40]
            facts.title = f"Detailed Project Report — {collapse_ws(m.group(1))} (PMFME scheme)"
            facts.publisher = "National Institute of Food Technology Entrepreneurship and Management (NIFTEM)"
        m = re.search(r"Proposed project capacity\s*:\s*([^\n]+)", text)
        if m:
            facts.capacity_description = collapse_ws(m.group(1))[:200]

    for page_no, text in pages:
        # ── sentence-level rules (may wrap across lines) ──
        def sentence(pattern: str, _text: str = text, flags: int = re.I | re.S):
            return re.search(pattern, _text, flags)

        m = sentence(r"Raw Material stock is for\s+(\d+)\s+days\s+and\s+Finished goods Closing Stock has\s+been\s+taken\s+for\s+(\d+)\s+days")
        if m:
            quote = collapse_ws(m.group(0))
            b.add(page_no=page_no, section_ref="4.1 Basis & presumptions", quote=quote, claim_type="other",
                  subject="Raw material stock days", value_numeric=float(m.group(1)), unit_raw="days",
                  target_kind="parameter", parameter_key="raw_material_stock_days")
            b.add(page_no=page_no, section_ref="4.1 Basis & presumptions", quote=quote, claim_type="other",
                  subject="Finished goods stock days", value_numeric=float(m.group(2)), unit_raw="days",
                  target_kind="parameter", parameter_key="finished_goods_stock_days")
        for pattern, subject, key in (
            (r"Credit period to Sundry Debtors has been given for\s+(\d+)\s+days", "Credit period to customers", "receivable_days"),
            (r"Credit period by the Sundry Creditors has been provided for\s+(\d+)\s+days", "Credit period from suppliers", "payable_days"),
        ):
            m = sentence(pattern)
            if m:
                b.add(page_no=page_no, section_ref="4.1 Basis & presumptions", quote=collapse_ws(m.group(0)), claim_type="other",
                      subject=subject, value_numeric=float(m.group(1)), unit_raw="days",
                      target_kind="parameter", parameter_key=key)
        m = sentence(r"Interest on working Capital Loan and Term loan has been taken at\s+(\d+(?:\.\d+)?)\s*%")
        if m:
            b.add(page_no=page_no, section_ref="4.1 Basis & presumptions", quote=collapse_ws(m.group(0)), claim_type="other",
                  subject="Interest rate on term loan and working capital", value_numeric=float(m.group(1)), unit_raw="%",
                  period_raw="per annum", target_kind="parameter", parameter_key="loan_interest_pct")
        m = sentence(r"Power Consumption has been taken at\s+(\d+(?:\.\d+)?)\s*KW")
        if m:
            b.add(page_no=page_no, section_ref="4.1 Basis & presumptions", quote=collapse_ws(m.group(0)), claim_type="requirement",
                  subject="Connected power load", value_numeric=float(m.group(1)), unit_raw="KW",
                  target_kind="operating_requirement", q={"requirement_type": "power_load"})
        m = sentence(r"Increase in sales and raw material costing has been taken @\s*(\d+(?:\.\d+)?)\s*%\s+on a yearly basis")
        if m:
            quote = collapse_ws(m.group(0))
            for subject, key in (("Annual selling price escalation", "price_escalation_pct"), ("Annual cost escalation", "cost_inflation_pct")):
                b.add(page_no=page_no, section_ref="4.1 Basis & presumptions", quote=quote, claim_type="other", subject=subject,
                      value_numeric=float(m.group(1)), unit_raw="%", period_raw="per annum", target_kind="parameter", parameter_key=key)
        m = sentence(r"Selling Prices?\s*&\s*Raw material costing has been increased by\s+(\d+(?:\.\d+)?)\s*%\s*&\s*(\d+(?:\.\d+)?)\s*%\s+respectively")
        if m:
            quote = collapse_ws(m.group(0))
            b.add(page_no=page_no, section_ref="4.1 Basis & presumptions", quote=quote, claim_type="other",
                  subject="Annual selling price escalation", value_numeric=float(m.group(1)), unit_raw="%", period_raw="per annum",
                  target_kind="parameter", parameter_key="price_escalation_pct")
            b.add(page_no=page_no, section_ref="4.1 Basis & presumptions", quote=quote, claim_type="other",
                  subject="Annual cost escalation", value_numeric=float(m.group(2)), unit_raw="%", period_raw="per annum",
                  target_kind="parameter", parameter_key="cost_inflation_pct")
        m = sentence(r"approximate total area required for complete[\w\s]*?setup is\s+(\d[\d,]*)\s*-\s*(\d[\d,]*)\s*(Sq\.?\s*ft\.?|square feet)")
        if m:
            b.add(page_no=page_no, section_ref="4.3 Premises", quote=collapse_ws(m.group(0)), claim_type="requirement",
                  subject="Built-up area required", value_low=parse_number(m.group(1)), value_high=parse_number(m.group(2)),
                  unit_raw="Sq. ft", target_kind="operating_requirement", q={"requirement_type": "built_up_space"})
        m = sentence(r"Repair\s*&\s*Maintenance is\s+(\d+(?:\.\d+)?)\s*%\s*of Gross Sale")
        if m:
            b.add(page_no=page_no, section_ref="4.14 Repairs & maintenance", quote=collapse_ws(m.group(0)), claim_type="cost",
                  subject="Repair and maintenance", attribute="pct_of_gross_sale", value_numeric=float(m.group(1)), unit_raw="%",
                  target_kind="cost_item", cost_category_slug="variable.other", q=b.stream_q(recurrence="pct_of_revenue"))
        m = sentence(r"DOOR TO DOOR\s+(\d+)\s+MONTHS")
        if m:
            b.add(page_no=page_no, section_ref="4.9 Term loan repayment", quote=collapse_ws(m.group(0)), claim_type="other",
                  subject="Term loan tenure (door to door)", value_numeric=float(m.group(1)), unit_raw="months",
                  target_kind="parameter", parameter_key="loan_tenure_months")
        m = sentence(r"MORATORIUM\s+PERIOD\s+(\d+)\s+MONTHS")
        if m:
            b.add(page_no=page_no, section_ref="4.9 Term loan repayment", quote=collapse_ws(m.group(0)), claim_type="other",
                  subject="Term loan moratorium", value_numeric=float(m.group(1)), unit_raw="months",
                  target_kind="parameter", parameter_key="loan_moratorium_months")
        # ── line-level rules with a small table state machine ──
        lines = text.splitlines()
        for i, raw in enumerate(lines):
            line = raw.rstrip()
            stripped = collapse_ws(line)
            if not stripped:
                continue
            upper = stripped.upper()

            # state transitions on the template's upper-case table titles
            if _MACHINE_HEADER.match(line):
                state = "machinery"
                continue
            if upper.startswith("NOTE:") or re.match(r"^4\.5\.?\s", upper):
                state = "none" if state == "machinery" else state
            if upper == "COST OF PROJECT":
                state = "cost_of_project"
                continue
            if upper == "MEANS OF FINANCE":
                state = "means_of_finance"
                continue
            if upper.startswith("BREAK UP OF LABOUR CHARGES"):
                state = "labour"
                continue
            if upper.startswith("BREAK UP OF STAFF SALARY CHARGES"):
                state = "staff"
                continue
            if upper.startswith("PROJECTED PROFITABILITY STATEMENT"):
                state = "pnl"
                continue
            if upper.startswith("COMPUTATION OF PRODUCTION"):
                state = "capacity"
                continue
            if upper.startswith("COMPUTATION OF SALE"):
                state = "sales"
                continue
            if re.match(r"^4\.(8|12|13|16)\.?\s", upper) or upper.startswith("BREAK EVEN POINT ANALYSIS") or upper.startswith("UTILITY CHARGES"):
                state = "utility" if upper.startswith("UTILITY CHARGES") or upper.startswith("4.12") else "none"
                continue
            if upper.startswith("TOTAL SALARY PER MONTH") or upper.startswith("TOTAL ANNUAL"):
                state = "none" if state in ("labour", "staff") else state
                continue

            if state == "machinery":
                m = _MACHINE_ROW.match(line)
                if m:
                    name = collapse_ws(m.group("name")).rstrip(" -")
                    # a wrapped name continues on the next line ("Mixer machine (Capacity -" / "50 kg)")
                    if name.count("(") > name.count(")") and i + 1 < len(lines):
                        cont = collapse_ws(lines[i + 1])
                        if cont and not _MACHINE_ROW.match(lines[i + 1]) and len(cont) < 60:
                            name = f"{name} {cont}"
                    rate, price = parse_number(m.group("rate")), parse_number(m.group("price"))
                    qty = float(m.group("qty")) if m.group("qty") else None
                    if rate is None or price is None or rate <= 0:
                        continue
                    if qty is None:
                        qty = round(price / rate) if rate and abs(price / rate - round(price / rate)) < 1e-6 and price >= rate else 1.0
                    if abs(qty * rate - price) > 0.5:
                        b.notes.append(f"page {page_no}: machinery row '{name}' quantity × rate ≠ price as printed")
                    c = b.add(page_no=page_no, section_ref="4.4 Machinery & equipment", quote=stripped, claim_type="cost",
                              subject=name, attribute="unit_price", value_numeric=rate, unit_raw="Rs.", currency="INR",
                              period_raw="one_time", quantity=qty, target_kind="cost_item", cost_category_slug="capex.machinery",
                              q={"recurrence": "one_time", "tax_treatment": "unknown", "installation": "unknown"})
                    if c:
                        machinery.append(c)
                continue

            m = _LABEL_VALUE.match(line)
            if state == "cost_of_project" and m:
                label, value = collapse_ws(m.group("label")), parse_number(m.group("value"))
                low = label.lower()
                if value is None:
                    continue
                if low.startswith("miscellaneous assets"):
                    b.add(page_no=page_no, section_ref="4.6 Total cost of project", quote=stripped, claim_type="cost",
                          subject="Miscellaneous fixed assets", attribute="line_total", value_numeric=value, unit_raw=in_lacs,
                          currency="INR", period_raw="one_time", quantity=1, target_kind="cost_item", cost_category_slug="capex.other",
                          q={"recurrence": "one_time", "is_line_total": True})
                elif low.startswith("plant & machinery"):
                    b.add(page_no=page_no, section_ref="4.6 Total cost of project", quote=stripped, claim_type="financial_summary",
                          subject="Plant and machinery (stated total)", value_numeric=value, unit_raw=in_lacs, currency="INR")
                elif low.startswith("working capital"):
                    b.add(page_no=page_no, section_ref="4.6 Total cost of project", quote=stripped, claim_type="financial_summary",
                          subject="Working capital (stated)", value_numeric=value, unit_raw=in_lacs, currency="INR")
                elif low.startswith("total"):
                    b.add(page_no=page_no, section_ref="4.6 Total cost of project", quote=stripped, claim_type="financial_summary",
                          subject="Total cost of project (stated)", value_numeric=value, unit_raw=in_lacs, currency="INR")
                    state = "none"
                continue

            if state == "means_of_finance":
                nums = _nums(line)
                low = stripped.lower()
                if not nums:
                    continue
                value = nums[-1]
                if low.startswith("term loan @"):
                    b.add(page_no=page_no, section_ref="4.7 Means of finance", quote=stripped, claim_type="other",
                          subject="Term loan", value_numeric=value, unit_raw=in_lacs, currency="INR",
                          target_kind="parameter", parameter_key="term_loan_amount")
                elif low.startswith("subsidy"):
                    b.add(page_no=page_no, section_ref="4.7 Means of finance", quote=stripped, claim_type="scheme",
                          subject="Capital subsidy assumed by source (PMFME)", value_numeric=value, unit_raw=in_lacs, currency="INR",
                          target_kind="parameter", parameter_key="stated_subsidy_amount", q={"authority": "Ministry of Food Processing Industries"})
                elif low.startswith("own contribution"):
                    b.add(page_no=page_no, section_ref="4.7 Means of finance", quote=stripped, claim_type="financial_summary",
                          subject="Promoter contribution (stated)", value_numeric=value, unit_raw=in_lacs, currency="INR")
                elif low.startswith("working capital"):
                    b.add(page_no=page_no, section_ref="4.7 Means of finance", quote=stripped, claim_type="financial_summary",
                          subject="Working capital bank finance (stated)", value_numeric=value, unit_raw=in_lacs, currency="INR")
                elif low.startswith("total"):
                    state = "none"
                continue

            if state in ("labour", "staff"):
                m = _STAFF_ROW.match(line)
                if m:
                    wage, count = parse_number(m.group("wage")), float(m.group("count"))
                    if wage is None or wage <= 0:
                        continue
                    b.add(page_no=page_no, section_ref="4.11 Salary & wages", quote=stripped, claim_type="wage",
                          subject=collapse_ws(m.group("role")), attribute="monthly_wage_per_head", value_numeric=wage, unit_raw="Rs.",
                          currency="INR", period_raw="per month", quantity=count, target_kind="cost_item",
                          cost_category_slug="staff.production" if state == "labour" else "staff.admin", q={"recurrence": "monthly"})
                continue

            if state == "utility":
                m = re.match(rf"^\s*power Bill per month\s+({_NUM})\s*Rs", line, re.I)
                if m:
                    b.add(page_no=page_no, section_ref="4.12 Power requirement", quote=stripped, claim_type="cost",
                          subject="Electricity bill", attribute="monthly_amount", value_numeric=parse_number(m.group(1)), unit_raw="Rs.",
                          currency="INR", period_raw="per month", quantity=1, target_kind="cost_item", cost_category_slug="opex.utilities",
                          q={"recurrence": "monthly", "is_line_total": True})
                    state = "none"
                continue

            if state == "capacity":
                m = re.match(rf"^\s*Working days in a month\s+({_NUM})", line, re.I)
                if m:
                    b.add(page_no=page_no, section_ref="4.2 Capacity", quote=stripped, claim_type="other",
                          subject="Working days in a month", value_numeric=parse_number(m.group(1)), unit_raw="days",
                          target_kind="parameter", parameter_key="operating_days_per_month")
                m = re.match(rf"^\s*Final Output per annum after wastage\s+({_NUM})\s+(\w+)", line, re.I)
                if m:
                    b.add(page_no=page_no, section_ref="4.2 Capacity", quote=stripped, claim_type="capacity",
                          subject="Installed output capacity after wastage", value_numeric=parse_number(m.group(1)),
                          unit_raw=m.group(2), period_raw="per annum", target_kind="parameter",
                          parameter_key="capacity_units_per_month", q=b.stream_q(pricing_unit=m.group(2)))
                m = re.match(rf"^\s*Raw material requirement\s+({_NUM})\s+(\w+)", line, re.I)
                if m:
                    b.add(page_no=page_no, section_ref="4.2 Capacity", quote=stripped, claim_type="consumption",
                          subject="Raw material requirement at full capacity", value_numeric=parse_number(m.group(1)),
                          unit_raw=m.group(2), period_raw="per annum")
                m = re.match(rf"^\s*Wastage Considered\s+({_NUM})\s*%", line, re.I)
                if m:
                    b.add(page_no=page_no, section_ref="4.2 Capacity", quote=stripped, claim_type="consumption",
                          subject="Process wastage", value_numeric=parse_number(m.group(1)), unit_raw="%")
                continue

            if state == "sales":
                m = re.match(r"^\s*Sale price per (\w+)\s+", line, re.I)
                nums = _nums(line)
                if m and nums:
                    b.add(page_no=page_no, section_ref="4.2 Computation of sale", quote=stripped, claim_type="price",
                          subject=f"Selling price per {m.group(1).lower()}", value_numeric=nums[0], unit_raw=f"Rs. per {m.group(1).lower()}",
                          currency="INR", target_kind="parameter", parameter_key="unit_price",
                          q=b.stream_q(year_index=1, pricing_unit=m.group(1).lower()))
                    state = "none"
                continue

            if state == "pnl":
                nums = _nums(line)
                low = stripped.lower()
                if low.startswith("capacity utilisation") and nums:
                    last = len(nums)
                    for idx, value in enumerate(nums, start=1):
                        key = "utilization_year1_pct" if idx == 1 else ("utilization_pct" if idx == last and last > 1 else None)
                        b.add(page_no=page_no, section_ref="4.15 Projected profitability", quote=stripped, claim_type="utilization",
                              subject=f"Capacity utilisation, year {idx}", value_numeric=value, unit_raw="%",
                              target_kind="parameter" if key else "context", parameter_key=key, q=b.stream_q(year_index=idx))
                    continue
                if low.startswith("total") and nums and not any(c.parameter_key == "stated_annual_revenue" for c in b.claims):
                    b.add(page_no=page_no, section_ref="4.15 Projected profitability", quote=stripped, claim_type="financial_summary",
                          subject="Gross sales (stated)", value_numeric=nums[0], unit_raw=in_lacs, currency="INR", period_raw="per annum",
                          target_kind="parameter", parameter_key="stated_annual_revenue", q={"year_index": 1})
                    continue
                if low.startswith("profit (after tax)"):
                    state = "none"
                    continue
                if not nums:
                    continue
                for pattern, spec in _PNL_ROWS:
                    if pattern.match(stripped):
                        spec = dict(spec)
                        recurrence = spec.pop("recurrence", None)
                        q: dict = {"year_index": 1}
                        if recurrence:
                            q.update({"recurrence": recurrence, "is_line_total": True})
                            if recurrence == "pct_of_revenue":
                                q.update({"stream_key": b.stream_key})
                        kind = spec.get("target_kind", "context")
                        b.add(page_no=page_no, section_ref="4.15 Projected profitability", quote=stripped,
                              claim_type="cost" if kind == "cost_item" else "financial_summary",
                              attribute="annual_amount_year_1", value_numeric=nums[0], unit_raw=in_lacs, currency="INR",
                              period_raw="per annum", quantity=1 if kind == "cost_item" else None, q=q, **spec)
                        break

        # The template's note under the machinery table states the tax basis of every line above it.
        # (Checked after the page's rows are parsed: the note sits on the same page as the table.)
        if re.search(r"excluding GST", text, re.I) and re.search(r"Total Machinery cost", text, re.I):
            for c in machinery:
                c.qualifiers.tax_treatment = "exclusive"

    if not b.claims:
        b.notes.append("no template rows recognised")
    return ExtractionResult(extractor=NAME, method="rule_based", facts=facts, claims=b.claims, notes=b.notes)
