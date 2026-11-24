"""Document text extraction (pipeline stage 3): per-page text and tables, stored for citation.

Text is extracted with poppler's `pdftotext -layout` when available (it preserves table columns,
which the rule-based extractors rely on) and pdfplumber otherwise; tables always come from
pdfplumber. Extracted text is untrusted external content: it is stored and searched, never executed
or treated as instructions.
"""

from __future__ import annotations

import io
import shutil
import subprocess
import tempfile
from dataclasses import dataclass

import pdfplumber
import psycopg
from psycopg.types.json import Jsonb

MIN_CHARS_PER_PAGE_FOR_TEXT_PDF = 40
CHUNK_CHARS = 1400


@dataclass
class PageText:
    page_no: int
    text: str
    tables: list[list[list[str | None]]]


def _poppler_pages(data: bytes) -> list[str] | None:
    exe = shutil.which("pdftotext")
    if not exe:
        return None
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(data)
        f.flush()
        try:
            out = subprocess.run([exe, "-layout", "-enc", "UTF-8", f.name, "-"], capture_output=True, timeout=120, check=True)
        except (subprocess.SubprocessError, OSError):
            return None
    pages = out.stdout.decode("utf-8", "replace").split("\f")
    if pages and not pages[-1].strip():
        pages = pages[:-1]
    return pages


def extract_pages(data: bytes) -> list[PageText]:
    poppler = _poppler_pages(data)
    pages: list[PageText] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            if poppler is not None and len(poppler) == len(pdf.pages):
                text = poppler[i - 1]
            else:
                text = page.extract_text(layout=True) or ""
            try:
                tables = page.extract_tables() or []
            except Exception:  # noqa: BLE001 - a malformed table must not lose the page text
                tables = []
            pages.append(PageText(i, text.replace("\x00", ""), tables))
    return pages


def chunk_text(text: str, size: int = CHUNK_CHARS) -> list[str]:
    """Paragraph-aware fixed-budget chunks for retrieval."""
    chunks: list[str] = []
    buf = ""
    for para in [p for p in text.split("\n\n") if p.strip()] or [text]:
        if len(buf) + len(para) > size and buf:
            chunks.append(buf.strip())
            buf = ""
        while len(para) > size:
            chunks.append(para[:size].strip())
            para = para[size:]
        buf += para + "\n\n"
    if buf.strip():
        chunks.append(buf.strip())
    return chunks


def store_document_text(conn: psycopg.Connection, document_id: str, data: bytes) -> dict:
    """Idempotently (re)build page text and retrieval chunks for a document."""
    pages = extract_pages(data)
    total_chars = sum(len(p.text.strip()) for p in pages)
    needs_ocr = bool(pages) and total_chars / len(pages) < MIN_CHARS_PER_PAGE_FOR_TEXT_PDF
    with conn.transaction():
        for p in pages:
            conn.execute(
                """insert into intel.document_pages (document_id, page_no, text, tables) values (%s, %s, %s, %s)
                   on conflict (document_id, page_no) do update set text = excluded.text, tables = excluded.tables""",
                (document_id, p.page_no, p.text, Jsonb(p.tables)),
            )
            for ix, chunk in enumerate(chunk_text(p.text)):
                conn.execute(
                    """insert into intel.document_chunks (document_id, page_no, chunk_index, content) values (%s, %s, %s, %s)
                       on conflict (document_id, page_no, chunk_index) do update set content = excluded.content""",
                    (document_id, p.page_no, ix, chunk),
                )
        conn.execute(
            "update intel.source_documents set page_count = %s, text_status = %s where id = %s",
            (len(pages), "needs_ocr" if needs_ocr else "extracted", document_id),
        )
    return {"pages": len(pages), "chars": total_chars, "needs_ocr": needs_ocr}
