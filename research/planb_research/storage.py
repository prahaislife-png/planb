"""Evidence document storage.

Original documents are immutable and content-addressed by SHA-256. Locally they live on disk under
PLANB_EVIDENCE_DIR; in production they live in a PRIVATE Supabase Storage bucket and are only ever
served through short-lived signed URLs created server-side for staff.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Protocol

import httpx


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def content_path(sha256: str, extension: str) -> str:
    ext = extension.lstrip(".").lower() or "bin"
    return f"documents/{sha256[:2]}/{sha256}.{ext}"


class EvidenceStore(Protocol):
    bucket: str

    def put(self, path: str, data: bytes, mime_type: str) -> None: ...
    def get(self, path: str) -> bytes: ...
    def exists(self, path: str) -> bool: ...


class LocalEvidenceStore:
    """Filesystem store for development and CI."""

    bucket = "evidence"

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def _full(self, path: str) -> Path:
        full = (self.root / path).resolve()
        if self.root.resolve() not in full.parents:
            raise ValueError("path escapes the evidence store")
        return full

    def put(self, path: str, data: bytes, mime_type: str) -> None:
        full = self._full(path)
        full.parent.mkdir(parents=True, exist_ok=True)
        if full.exists():
            return  # content-addressed: same path means same bytes
        tmp = full.with_suffix(full.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(full)

    def get(self, path: str) -> bytes:
        return self._full(path).read_bytes()

    def exists(self, path: str) -> bool:
        return self._full(path).exists()


class SupabaseEvidenceStore:
    """Supabase Storage (private bucket) via its REST API.

    STATUS: implemented against the documented Storage REST contract but NOT yet exercised against a
    live Supabase project (none was available when this was written). Verify before relying on it.
    """

    bucket = "evidence"

    def __init__(self, project_url: str, service_key: str, bucket: str = "evidence") -> None:
        self.bucket = bucket
        self._base = f"{project_url.rstrip('/')}/storage/v1/object"
        self._headers = {"Authorization": f"Bearer {service_key}", "apikey": service_key}

    def put(self, path: str, data: bytes, mime_type: str) -> None:
        r = httpx.post(
            f"{self._base}/{self.bucket}/{path}",
            content=data,
            headers={**self._headers, "Content-Type": mime_type, "x-upsert": "false"},
            timeout=60,
        )
        if r.status_code == 409 or (r.status_code == 400 and "exists" in r.text.lower()):
            return
        r.raise_for_status()

    def get(self, path: str) -> bytes:
        r = httpx.get(f"{self._base}/{self.bucket}/{path}", headers=self._headers, timeout=60)
        r.raise_for_status()
        return r.content

    def exists(self, path: str) -> bool:
        r = httpx.head(f"{self._base}/{self.bucket}/{path}", headers=self._headers, timeout=30)
        return r.status_code == 200


def default_store(evidence_dir: Path) -> EvidenceStore:
    import os

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if url and key and os.environ.get("PLANB_EVIDENCE_BACKEND") == "supabase":
        return SupabaseEvidenceStore(url, key)
    return LocalEvidenceStore(evidence_dir)
