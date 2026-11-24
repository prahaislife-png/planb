"""Source adapter framework.

One adapter class per source (never one generic scraper): each knows how its source lists and
names documents. The base class owns everything that must be uniform and non-negotiable:

  * the LEGAL GATE   – automated fetching is refused unless the source registry row says
                       ingestion is enabled (which the database only allows when reuse terms permit it);
  * robots.txt       – fetched once per host and honoured for every URL;
  * rate limiting    – a per-source minimum interval between requests;
  * retries          – bounded exponential backoff on transient failures only;
  * hashing & dedupe – SHA-256 content addressing; an already-known document is a dedupe hit;
  * ingestion log    – every action is recorded in ops.ingestion_log.
"""

from __future__ import annotations

import random
import time
import urllib.robotparser
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
import psycopg

from ..config import Settings
from ..storage import EvidenceStore, content_path, sha256_bytes

MAX_DOCUMENT_BYTES = 40 * 1024 * 1024
ALLOWED_MIME = {"application/pdf": "pdf"}
TRANSIENT_STATUS = {408, 425, 429, 500, 502, 503, 504}


class IngestionRefused(Exception):
    """The adapter declined to fetch (legal gate, robots.txt, or validation). Not retryable."""


class FetchFailed(Exception):
    """The fetch failed after retries. Retryable at the job level."""


@dataclass
class DocumentRef:
    """A document an adapter intends to ingest."""

    url: str | None
    title: str
    doc_type: str = "project_report"
    listing_page_url: str | None = None
    local_path: Path | None = None
    expected_sha256: str | None = None
    document_year: int | None = None
    notes: str | None = None
    data_origin: str = "research"
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class IngestedDocument:
    document_id: str
    sha256: str
    was_duplicate: bool
    byte_size: int
    storage_path: str


class RateLimiter:
    def __init__(self, per_minute: int, clock=time.monotonic, sleep=time.sleep) -> None:
        self.min_interval = 60.0 / max(per_minute, 1)
        self._clock, self._sleep = clock, sleep
        self._last: float | None = None

    def wait(self) -> float:
        now = self._clock()
        waited = 0.0
        if self._last is not None:
            remaining = self.min_interval - (now - self._last)
            if remaining > 0:
                self._sleep(remaining)
                waited = remaining
        self._last = self._clock()
        return waited


class SourceAdapter:
    """Base class. Subclasses set `source_slug` and implement `discover()` where the source has a listing."""

    source_slug: str = ""
    adapter_key: str = ""
    retrieval_method: str = "adapter"
    max_attempts: int = 4

    def __init__(
        self,
        conn: psycopg.Connection,
        store: EvidenceStore,
        settings: Settings | None = None,
        *,
        client: httpx.Client | None = None,
        run_id: str | None = None,
        sleep=time.sleep,
    ) -> None:
        self.conn = conn
        self.store = store
        self.settings = settings or Settings.load()
        self.run_id = run_id
        self._sleep = sleep
        self.client = client or httpx.Client(
            headers={"User-Agent": self.settings.user_agent}, follow_redirects=True, timeout=httpx.Timeout(60, connect=20)
        )
        row = conn.execute("select * from intel.sources where slug = %s", (self.source_slug,)).fetchone()
        if row is None:
            raise IngestionRefused(f"source '{self.source_slug}' is not in the source registry")
        self.source = row
        self.limiter = RateLimiter(row["rate_limit_per_minute"], sleep=sleep)
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}

    # ── logging ──────────────────────────────────────────────────────────────
    def _log(self, action: str, outcome: str, **kw: Any) -> None:
        self.conn.execute(
            """insert into ops.ingestion_log
                 (source_id, adapter_key, research_run_id, url, action, outcome, http_status, byte_size, sha256,
                  duration_ms, attempt, detail, document_id)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                self.source["id"], self.adapter_key or type(self).__name__, self.run_id, kw.get("url"), action, outcome,
                kw.get("http_status"), kw.get("byte_size"), kw.get("sha256"), kw.get("duration_ms"),
                kw.get("attempt", 1), kw.get("detail"), kw.get("document_id"),
            ),
        )
        self.conn.commit()

    # ── gates ────────────────────────────────────────────────────────────────
    def assert_automated_fetch_allowed(self) -> None:
        s = self.source
        if not s["ingestion_enabled"]:
            raise IngestionRefused(
                f"automated ingestion is not enabled for source '{s['slug']}' "
                f"(reuse_status={s['reuse_status']}, recommended_ingestion={s['recommended_ingestion']}). "
                "Use the manual upload path once a human has obtained the document legitimately."
            )

    def robots_allows(self, url: str) -> bool:
        parts = urlsplit(url)
        host = f"{parts.scheme}://{parts.netloc}"
        if host not in self._robots:
            rp: urllib.robotparser.RobotFileParser | None = urllib.robotparser.RobotFileParser()
            try:
                r = self.client.get(f"{host}/robots.txt", timeout=20)
                if r.status_code == 200 and "text" in r.headers.get("content-type", "text/plain"):
                    rp.parse(r.text.splitlines())
                elif r.status_code in (401, 403):
                    rp = None  # robots.txt itself is forbidden → treat the host as disallowed
                else:
                    rp.parse([])  # no robots.txt → no restrictions stated
            except httpx.HTTPError as exc:
                self._log("robots_check", "failed", url=f"{host}/robots.txt", detail=str(exc)[:300])
                raise FetchFailed(f"could not read robots.txt for {host}: {exc}") from exc
            self._robots[host] = rp
        rp = self._robots[host]
        allowed = rp is not None and rp.can_fetch(self.settings.user_agent, url)
        self._log("robots_check", "ok" if allowed else "blocked", url=url)
        return allowed

    # ── fetching ─────────────────────────────────────────────────────────────
    def _http_get(self, url: str) -> httpx.Response:
        last: Exception | None = None
        for attempt in range(1, self.max_attempts + 1):
            self.limiter.wait()
            started = time.monotonic()
            try:
                r = self.client.get(url)
                ms = int((time.monotonic() - started) * 1000)
                if r.status_code in TRANSIENT_STATUS:
                    self._log("fetch", "failed", url=url, http_status=r.status_code, duration_ms=ms, attempt=attempt,
                              detail="transient status")
                    last = FetchFailed(f"HTTP {r.status_code}")
                elif r.status_code >= 400:
                    self._log("fetch", "failed", url=url, http_status=r.status_code, duration_ms=ms, attempt=attempt)
                    raise IngestionRefused(f"HTTP {r.status_code} for {url}")
                else:
                    self._log("fetch", "ok", url=url, http_status=r.status_code, duration_ms=ms, attempt=attempt,
                              byte_size=len(r.content))
                    return r
            except httpx.HTTPError as exc:
                ms = int((time.monotonic() - started) * 1000)
                self._log("fetch", "failed", url=url, duration_ms=ms, attempt=attempt, detail=f"{type(exc).__name__}: {exc}"[:300])
                last = exc
            if attempt < self.max_attempts:
                self._sleep(min(30.0, 2.0**attempt) + random.uniform(0, 0.5))  # noqa: S311 - jitter, not security
        raise FetchFailed(f"giving up on {url} after {self.max_attempts} attempts: {last}")

    def fetch_bytes(self, ref: DocumentRef) -> tuple[bytes, dict[str, Any]]:
        if ref.url is None:
            raise IngestionRefused("document reference has no URL")
        self.assert_automated_fetch_allowed()
        if urlsplit(ref.url).scheme != "https" and urlsplit(ref.url).scheme != "http":
            raise IngestionRefused("only http(s) URLs can be fetched")
        if not self.robots_allows(ref.url):
            raise IngestionRefused(f"robots.txt disallows {ref.url}")
        r = self._http_get(ref.url)
        return r.content, {"etag": r.headers.get("etag"), "last_modified": r.headers.get("last-modified"),
                           "final_url": str(r.url)}

    # ── validation + persistence ─────────────────────────────────────────────
    @staticmethod
    def sniff_mime(data: bytes) -> str | None:
        if data[:5] == b"%PDF-":
            return "application/pdf"
        return None

    def ingest(self, ref: DocumentRef, data: bytes | None = None, http_meta: dict[str, Any] | None = None) -> IngestedDocument:
        """Fetch (unless bytes are supplied), validate, de-duplicate, store and register one document."""
        if data is None:
            data, http_meta = self.fetch_bytes(ref)
        http_meta = http_meta or {}
        if not data:
            raise IngestionRefused("empty document")
        if len(data) > MAX_DOCUMENT_BYTES:
            raise IngestionRefused(f"document exceeds {MAX_DOCUMENT_BYTES} bytes")
        mime = self.sniff_mime(data)  # decided from content, never from a filename or header
        if mime not in ALLOWED_MIME:
            self._log("skip", "skipped", url=ref.url, detail="unsupported or unrecognised file type")
            raise IngestionRefused("unsupported file type (only PDF is accepted at present)")
        digest = sha256_bytes(data)
        if ref.expected_sha256 and ref.expected_sha256 != digest:
            raise IngestionRefused(f"content hash {digest} does not match the expected {ref.expected_sha256}")

        existing = self.conn.execute(
            "select id, storage_path, byte_size from intel.source_documents where sha256 = %s", (digest,)
        ).fetchone()
        if existing:
            self._log("dedupe_hit", "ok", url=ref.url, sha256=digest, document_id=existing["id"])
            return IngestedDocument(str(existing["id"]), digest, True, existing["byte_size"], existing["storage_path"])

        path = content_path(digest, ALLOWED_MIME[mime])
        self.store.put(path, data, mime)
        row = self.conn.execute(
            """insert into intel.source_documents
                 (source_id, title, doc_type, url, listing_page_url, retrieval_method, http_etag, http_last_modified,
                  mime_type, byte_size, sha256, storage_bucket, storage_path, document_date, document_date_precision,
                  licence_snapshot, notes, data_origin)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               on conflict (sha256) do update set updated_at = now()
               returning id""",
            (
                self.source["id"], ref.title, ref.doc_type, http_meta.get("final_url") or ref.url, ref.listing_page_url,
                self.retrieval_method, http_meta.get("etag"), http_meta.get("last_modified"), mime, len(data), digest,
                self.store.bucket, path,
                f"{ref.document_year}-01-01" if ref.document_year else None, "year" if ref.document_year else "unknown",
                f"{self.source['licence_name'] or 'licence not recorded'} — reuse_status={self.source['reuse_status']} "
                f"(terms checked {self.source['terms_checked_on']})",
                ref.notes, ref.data_origin,
            ),
        ).fetchone()
        self.conn.execute("update intel.sources set last_ingested_at = now() where id = %s", (self.source["id"],))
        self.conn.commit()
        self._log("store", "ok", url=ref.url, sha256=digest, byte_size=len(data), document_id=row["id"])
        return IngestedDocument(str(row["id"]), digest, False, len(data), path)

    def discover(self) -> list[DocumentRef]:
        """Documents this source currently lists. Sources without a machine-readable listing return []."""
        return []


class ManualUploadAdapter(SourceAdapter):
    """Registers a document a human obtained legitimately (download, email, in person).

    Deliberately bypasses the automated-fetch gate — nothing is fetched — but not the provenance
    requirements: the source must exist in the registry and must not be marked do_not_ingest.
    """

    retrieval_method = "manual_upload"
    adapter_key = "manual_upload"

    def __init__(self, conn: psycopg.Connection, store: EvidenceStore, source_slug: str, **kw: Any) -> None:
        self.source_slug = source_slug
        super().__init__(conn, store, **kw)

    def ingest_file(self, path: Path, ref: DocumentRef) -> IngestedDocument:
        if self.source["recommended_ingestion"] == "do_not_ingest" or self.source["reuse_status"] == "prohibited":
            raise IngestionRefused(f"source '{self.source_slug}' is marked do_not_ingest / prohibited")
        return self.ingest(ref, data=Path(path).read_bytes(), http_meta={})
