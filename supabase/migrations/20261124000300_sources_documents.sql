-- PlanB · 0003 · Source registry, source documents, extracted text, ingestion log.

create table intel.sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  publisher text,
  source_type text not null check (source_type in (
    'government_project_report', 'government_dataset', 'regulatory_portal', 'scheme_portal', 'statistical_agency',
    'academic_extension', 'skills_training', 'industry_association', 'procurement_portal', 'manufacturer_catalogue',
    'b2b_marketplace', 'commercial_report', 'property_listing', 'franchise_disclosure', 'primary_research')),
  authority_level text not null check (authority_level in (
    'primary_government', 'quasi_government', 'academic', 'industry_association', 'commercial', 'primary_research')),
  base_url text,
  information_available text,
  geographic_coverage text,
  -- access
  access_method text not null check (access_method in (
    'http_download', 'api', 'manual_download', 'portal_login', 'email_request', 'paid_subscription', 'primary_collection')),
  accessibility text not null default 'untested' check (accessibility in ('yes', 'partial', 'no', 'untested')),
  accessibility_notes text,
  api_available text not null default 'unknown' check (api_available in ('yes', 'no', 'unknown')),
  api_notes text,
  requires_auth boolean not null default false,
  robots_txt_url text,
  robots_txt_status text check (robots_txt_status in ('fetched', 'not_found', 'unreachable')),
  robots_txt_summary text,
  -- legal
  licence_name text,
  licence_url text,
  licence_quoted_terms text,
  reuse_status text not null default 'unclear' check (reuse_status in (
    'permitted', 'permitted_with_attribution', 'permission_required', 'prohibited', 'unclear')),
  reuse_notes text,
  permission_contact text,
  permission_granted_on date,
  permission_evidence text,
  terms_checked_on date,
  registry_confidence text not null default 'unverified' check (registry_confidence in ('verified', 'partially_verified', 'unverified')),
  -- freshness & quality
  update_frequency text,
  quality_limitations text[] not null default '{}',
  default_revalidation_days int not null default 365 check (default_revalidation_days > 0),
  -- automation
  adapter_key text,
  recommended_ingestion text not null default 'manual_only' check (recommended_ingestion in ('automated', 'manual_only', 'do_not_ingest')),
  ingestion_enabled boolean not null default false,
  rate_limit_per_minute int not null default 12 check (rate_limit_per_minute between 1 and 600),
  last_checked_at timestamptz,
  last_ingested_at timestamptz,
  evidence_urls text[] not null default '{}',
  data_origin ops.data_origin,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The legal gate. Automated collection can only be switched on for a source whose reuse terms
  -- allow it, or for which written permission has been recorded. "Publicly visible" is not enough.
  constraint sources_ingestion_requires_reuse_right check (
    not ingestion_enabled
    or reuse_status in ('permitted', 'permitted_with_attribution')
    or (reuse_status = 'permission_required' and permission_granted_on is not null and permission_evidence is not null)
  ),
  constraint sources_ingestion_requires_terms_check check (not ingestion_enabled or terms_checked_on is not null)
);
comment on table intel.sources is 'Research source registry: what each source offers, how it may be accessed, and whether it may legally be collected and commercially reused. Gates all automated adapters.';
comment on column intel.sources.reuse_status is 'Legal reuse position as read from the source''s own terms. permission_required/unclear/prohibited sources cannot have automated ingestion enabled (see constraint).';
comment on column intel.sources.registry_confidence is 'verified = licence/terms page was actually read on terms_checked_on. unverified = recorded from prior knowledge; must be checked before reliance.';

create table intel.source_documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references intel.sources (id),
  title text not null,
  doc_type text not null default 'project_report' check (doc_type in (
    'project_report', 'unit_cost_publication', 'tariff_order', 'notification', 'fee_schedule', 'catalogue', 'quotation',
    'market_report', 'district_profile', 'dataset', 'training_manual', 'interview_transcript', 'franchise_document', 'web_page', 'other')),
  url text,
  listing_page_url text,
  retrieved_at timestamptz not null default now(),
  retrieval_method text not null default 'adapter' check (retrieval_method in ('adapter', 'manual_upload', 'email', 'api')),
  http_etag text,
  http_last_modified text,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_bucket text not null default 'evidence',
  storage_path text not null,
  page_count int,
  language text not null default 'en',
  document_date date,
  document_date_precision text not null default 'unknown' check (document_date_precision in ('day', 'month', 'year', 'unknown')),
  price_basis_year int check (price_basis_year between 1990 and 2100),
  text_status text not null default 'pending' check (text_status in ('pending', 'extracted', 'needs_ocr', 'failed')),
  licence_snapshot text,
  superseded_by uuid references intel.source_documents (id),
  uploaded_by uuid references auth.users (id),
  notes text,
  data_origin ops.data_origin,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_documents_sha_unique unique (sha256)
);
comment on table intel.source_documents is 'One row per distinct original document (deduplicated by SHA-256). The file itself lives in private storage (bucket + path); this row is its provenance record.';
comment on column intel.source_documents.price_basis_year is 'Year the document''s prices refer to, when determinable. Old benchmarks are downgraded by the evidence-grade rules.';
create index source_documents_source_idx on intel.source_documents (source_id);
create index source_documents_url_idx on intel.source_documents (url);

create table intel.document_pages (
  document_id uuid not null references intel.source_documents (id) on delete cascade,
  page_no int not null check (page_no >= 1),
  text text not null default '',
  tables jsonb not null default '[]'::jsonb,
  char_count int generated always as (length(text)) stored,
  tsv tsvector generated always as (to_tsvector('english', text)) stored,
  primary key (document_id, page_no)
);
comment on table intel.document_pages is 'Extracted text and tables per page. Claims cite (document, page) and their quote is verified against this text. Content is untrusted external data.';
create index document_pages_tsv_idx on intel.document_pages using gin (tsv);

create table intel.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references intel.source_documents (id) on delete cascade,
  page_no int not null,
  chunk_index int not null,
  content text not null,
  embedding extensions.vector(1024),
  embedding_model text,
  created_at timestamptz not null default now(),
  unique (document_id, page_no, chunk_index),
  constraint document_chunks_embedding_model check ((embedding is null) = (embedding_model is null))
);
comment on table intel.document_chunks is 'Retrieval chunks for semantic search over evidence documents (pgvector). Embeddings are NULL until an embedding provider is configured; full-text search on document_pages works without them.';
create index document_chunks_embedding_idx on intel.document_chunks using hnsw (embedding extensions.vector_cosine_ops);

create table ops.ingestion_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  source_id uuid references intel.sources (id),
  adapter_key text,
  research_run_id uuid,
  url text,
  action text not null check (action in ('robots_check', 'fetch', 'store', 'dedupe_hit', 'text_extract', 'skip', 'error')),
  outcome text not null check (outcome in ('ok', 'skipped', 'blocked', 'failed')),
  http_status int,
  byte_size bigint,
  sha256 text,
  duration_ms int,
  attempt int not null default 1,
  detail text,
  document_id uuid references intel.source_documents (id)
);
comment on table ops.ingestion_log is 'Every adapter action (robots check, fetch, dedupe hit, store, failure) for traceability of how each document entered the system.';
create index ingestion_log_source_idx on ops.ingestion_log (source_id, occurred_at desc);
create index ingestion_log_run_idx on ops.ingestion_log (research_run_id);

create trigger sources_updated before update on intel.sources for each row execute function ops.set_updated_at();
create trigger source_documents_updated before update on intel.source_documents for each row execute function ops.set_updated_at();
create trigger industries_updated before update on intel.industries for each row execute function ops.set_updated_at();
create trigger locations_updated before update on intel.locations for each row execute function ops.set_updated_at();
