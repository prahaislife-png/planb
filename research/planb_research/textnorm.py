"""Deterministic text and number normalisation (pipeline stage 5).

All conversions are explicit rule tables. Anything that cannot be normalised with certainty is
left un-normalised and reported, never guessed.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

_WS = re.compile(r"\s+")
_NUM = re.compile(r"(?<![\w.])[-+]?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?%?")


def collapse_ws(text: str) -> str:
    return _WS.sub(" ", text).strip()


def canonical_text(text: str) -> str:
    """Canonical form used for quote verification: NFKC, unified quotes/dashes, lower-case, single spaces."""
    t = unicodedata.normalize("NFKC", text)
    t = t.translate(
        {
            0x2018: "'", 0x2019: "'", 0x201C: '"', 0x201D: '"',
            0x2010: "-", 0x2011: "-", 0x2012: "-", 0x2013: "-", 0x2014: "-", 0x2212: "-",
            0x00A0: " ", 0x20B9: "rs ",
        }
    )
    return collapse_ws(t).lower()


def slugify(text: str, sep: str = "-") -> str:
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    t = re.sub(r"[^a-zA-Z0-9]+", sep, t).strip(sep).lower()
    return t or "item"


def parse_number(raw: str) -> float | None:
    """Parse a printed number, accepting Indian (1,01,000) and Western (101,000) digit grouping."""
    s = raw.strip().rstrip("%").replace(",", "").replace(" ", "")
    if not re.fullmatch(r"[-+]?\d+(\.\d+)?", s):
        return None
    return float(s)


def numbers_in(text: str) -> list[float]:
    out = []
    for m in _NUM.finditer(text):
        v = parse_number(m.group(0))
        if v is not None:
            out.append(v)
    return out


# ── Money ────────────────────────────────────────────────────────────────────
_MULTIPLIERS: list[tuple[re.Pattern[str], float]] = [
    (re.compile(r"\b(crore|crores|cr)\b", re.I), 1e7),
    (re.compile(r"\b(lakh|lakhs|lac|lacs)\b", re.I), 1e5),
    (re.compile(r"\b(thousand|thousands|000s)\b|\b(in\s+)?'000\b", re.I), 1e3),
]
_CURRENCY = re.compile(r"(₹|\brs\b\.?|\binr\b|\brupees?\b)", re.I)


@dataclass(frozen=True)
class Money:
    amount_inr: float
    multiplier: float
    note: str


def money_multiplier(unit_raw: str | None) -> float | None:
    """Scale implied by a printed money unit ('Rs. in lacs' → 100000). None when it is not a money unit."""
    if not unit_raw:
        return None
    for pattern, mult in _MULTIPLIERS:
        if pattern.search(unit_raw):
            return mult
    if _CURRENCY.search(unit_raw):
        return 1.0
    return None


def normalize_money(value: float, unit_raw: str | None) -> Money | None:
    mult = money_multiplier(unit_raw)
    if mult is None:
        return None
    return Money(amount_inr=round(value * mult, 2), multiplier=mult, note=f"{value:g} × {mult:g} ({unit_raw!r})")


# ── Physical units ───────────────────────────────────────────────────────────
# printed token → unit code in intel.units
_UNIT_ALIASES: dict[str, str] = {
    "kg": "kg", "kgs": "kg", "kilogram": "kg", "kilograms": "kg", "kilo": "kg",
    "g": "g", "gm": "g", "gms": "g", "gram": "g", "grams": "g",
    "quintal": "quintal", "quintals": "quintal", "qtl": "quintal", "qtls": "quintal",
    "mt": "tonne", "tonne": "tonne", "tonnes": "tonne", "ton": "tonne", "tons": "tonne", "tpa": "tonne",
    "l": "litre", "ltr": "litre", "ltrs": "litre", "litre": "litre", "litres": "litre", "liter": "litre", "liters": "litre",
    "ml": "ml", "kl": "kl",
    "sqft": "sq_ft", "sq ft": "sq_ft", "sq. ft": "sq_ft", "sq.ft": "sq_ft", "sq. ft.": "sq_ft", "square feet": "sq_ft", "sft": "sq_ft",
    "sqm": "sq_m", "sq m": "sq_m", "sq. m": "sq_m", "sq.m": "sq_m", "sq mtr": "sq_m", "square metre": "sq_m", "square meter": "sq_m",
    "acre": "acre", "acres": "acre", "hectare": "hectare", "hectares": "hectare", "ha": "hectare", "guntha": "guntha",
    "kw": "kw", "kilowatt": "kw", "hp": "hp", "kwh": "kwh", "unit": "kwh", "units": "kwh",
    "no": "each", "nos": "each", "no.": "each", "nos.": "each", "number": "each", "each": "each", "pcs": "each",
    "piece": "each", "pieces": "each", "packet": "each", "packets": "each", "set": "each", "sets": "each",
    "day": "day", "days": "day", "month": "month", "months": "month", "year": "year", "years": "year",
    "hour": "hour", "hours": "hour", "hr": "hour", "hrs": "hour",
    "%": "percent", "percent": "percent", "per cent": "percent",
}

_PERIODS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(per\s+annum|p\.?a\.?|annual(ly)?|per\s+year|/\s*year|yearly|/\s*annum)\b", re.I), "per_year"),
    (re.compile(r"\b(per\s+month|p\.?m\.?|monthly|/\s*month)\b", re.I), "per_month"),
    (re.compile(r"\b(per\s+day|daily|/\s*day)\b", re.I), "per_day"),
    (re.compile(r"\b(per\s+cycle|per\s+crop|per\s+batch)\b", re.I), "per_cycle"),
    (re.compile(r"\b(one[- ]time|lump\s*sum|once)\b", re.I), "one_time"),
]


def normalize_unit(unit_raw: str | None) -> str | None:
    """Map a printed physical unit to a unit code, or None when unknown (left for an analyst)."""
    if not unit_raw:
        return None
    t = canonical_text(unit_raw).strip(" .()")
    t = re.sub(r"^(per|/)\s*", "", t)
    if t in _UNIT_ALIASES:
        return _UNIT_ALIASES[t]
    for token in re.split(r"[\s/]+", t):
        token = token.strip(".()")
        if token in _UNIT_ALIASES:
            return _UNIT_ALIASES[token]
    return None


def normalize_period(period_raw: str | None) -> str | None:
    if not period_raw:
        return None
    if period_raw in {"one_time", "per_day", "per_month", "per_year", "per_cycle", "per_unit"}:
        return period_raw
    for pattern, period in _PERIODS:
        if pattern.search(period_raw):
            return period
    return None


def to_monthly(value: float, period: str, *, operating_days_per_month: float | None = None) -> float | None:
    """Convert a recurring amount to a per-month figure. per_day needs an evidenced day count."""
    if period == "per_month":
        return value
    if period == "per_year":
        return value / 12.0
    if period == "per_day" and operating_days_per_month:
        return value * operating_days_per_month
    return None
