"""Per-source adapters and their registry.

Each adapter encodes what is specific to one source: where its documents live and which URLs are
legitimately part of it. An adapter can only fetch when the source registry enables ingestion for its
source (see SourceAdapter.assert_automated_fetch_allowed) — adding an adapter here grants no permission.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from .base import DocumentRef, IngestionRefused, SourceAdapter


class _HostScopedAdapter(SourceAdapter):
    """Refuses any URL outside the source's own hosts and path prefix."""

    allowed_hosts: tuple[str, ...] = ()
    path_prefixes: tuple[str, ...] = ("/",)

    def fetch_bytes(self, ref: DocumentRef):
        parts = urlsplit(ref.url or "")
        if parts.hostname not in self.allowed_hosts or not parts.path.startswith(self.path_prefixes):
            raise IngestionRefused(f"{ref.url} is outside the scope of source '{self.source_slug}'")
        return super().fetch_bytes(ref)


class NiftemPmfmeAdapter(_HostScopedAdapter):
    """NIFTEM (Kundli) and NIFTEM-T (Thanjavur) detailed project reports published for the PMFME scheme."""

    source_slug = "niftem-pmfme-dpr"
    adapter_key = "niftem_pmfme"
    allowed_hosts = ("niftem.ac.in", "www.niftem.ac.in", "niftem-t.ac.in", "www.niftem-t.ac.in")
    path_prefixes = ("/newsite/pmfme/", "/pmfme/", "/site/pmfme/")


class NstfdcProfilesAdapter(_HostScopedAdapter):
    """NSTFDC model project profiles."""

    source_slug = "nstfdc-model-project-profiles"
    adapter_key = "nstfdc_profiles"
    allowed_hosts = ("nstfdc.tribal.gov.in",)
    path_prefixes = ("/UploadData/pdf/",)


class UpMsmeOneConnectAdapter(_HostScopedAdapter):
    """Project reports on the Uttar Pradesh MSME 1-Connect portal."""

    source_slug = "up-msme-1connect"
    adapter_key = "up_msme_1connect"
    allowed_hosts = ("msme1connect.up.gov.in",)
    path_prefixes = ("/Projectreport/",)


ADAPTERS: dict[str, type[SourceAdapter]] = {a.source_slug: a for a in (NiftemPmfmeAdapter, NstfdcProfilesAdapter, UpMsmeOneConnectAdapter)}


def adapter_for(source_slug: str) -> type[SourceAdapter]:
    try:
        return ADAPTERS[source_slug]
    except KeyError:
        raise IngestionRefused(
            f"no automated adapter exists for source '{source_slug}'. Obtain the document manually and register it with the manual-upload path."
        ) from None
