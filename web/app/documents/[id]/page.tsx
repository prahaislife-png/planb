import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { asUser, type Row } from '@/lib/db';
import { date, dateTime, humanize, num } from '@/lib/format';
import { Badge, Empty, OriginBadge, PageHead, Panel } from '@/components/ui';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Finds a claim's quote in the stored page text. Runs of whitespace in the quote match any run of
 * whitespace in the text (line breaks, table padding); everything else is matched literally.
 */
function locateQuote(text: string, quote: string): { start: number; end: number } | null {
  const tokens = quote.trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (tokens.length === 0) return null;
  const pattern = tokens.join('\\s+');
  const m = new RegExp(pattern).exec(text) ?? new RegExp(pattern, 'i').exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/** Shows only as much of the document date as its recorded precision supports (a year-precision date is not "1 January"). */
function documentDate(value: string, precision: string): string {
  const iso = date(value);
  return precision === 'year' ? iso.slice(0, 4) : precision === 'month' ? iso.slice(0, 7) : iso;
}

function printedValue(c: Row): ReactNode {
  if (c.value_numeric !== null) return <>{num(c.value_numeric, 2)} <span className="muted">{c.unit_raw ?? ''}</span></>;
  if (c.value_low !== null || c.value_high !== null) return <>{num(c.value_low, 2)}–{num(c.value_high, 2)} <span className="muted">{c.unit_raw ?? ''}</span></>;
  if (c.value_text) return <span className="small">{c.value_text}</span>;
  return <span className="faint">—</span>;
}

export default async function DocumentViewer({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; claim?: string }>;
}) {
  const user = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const claimId = sp.claim && UUID.test(sp.claim) ? sp.claim : null;
  const requestedPage = sp.page && /^\d{1,6}$/.test(sp.page) ? Number(sp.page) : null;

  const d = await asUser(user.id, async (sql) => {
    const [doc] = await sql`
      select d.*, s.name as source_name, s.slug as source_slug, s.reuse_status, s.licence_name, s.publisher
      from intel.source_documents d join intel.sources s on s.id = d.source_id
      where d.id = ${id}`;
    if (!doc) return null;
    const pages = await sql`
      select p.page_no, p.char_count,
             (select count(*) from intel.evidence_claims c where c.source_document_id = p.document_id and c.page_no = p.page_no) as claims
      from intel.document_pages p where p.document_id = ${id} order by p.page_no`;
    const [selected] = claimId
      ? await sql`select c.id, c.page_no, c.subject, c.quote, c.quote_verified, c.quote_match_score, c.status
                  from intel.evidence_claims c where c.id = ${claimId} and c.source_document_id = ${id}`
      : [];
    const pageNo = requestedPage ?? selected?.page_no ?? pages[0]?.page_no ?? 1;
    const [page] = await sql`select page_no, text from intel.document_pages where document_id = ${id} and page_no = ${pageNo}`;
    const claims = await sql`
      select c.id, c.subject, c.claim_type, c.attribute, c.value_numeric, c.value_low, c.value_high, c.value_text, c.unit_raw,
             c.quote_verified, c.quote_match_score, c.status, m.slug as model_slug, m.name as model_name
      from intel.evidence_claims c left join intel.business_models m on m.id = c.business_model_id
      where c.source_document_id = ${id} and c.page_no = ${pageNo}
      order by (c.target_kind = 'context'), c.created_at, c.id`;
    const [unpaged] = await sql`select count(*) as n from intel.evidence_claims c where c.source_document_id = ${id} and c.page_no is null`;
    return { doc, pages, selected: (selected as Row | undefined) ?? null, pageNo, page: (page as Row | undefined) ?? null, claims, unpaged: Number(unpaged.n) };
  });
  if (!d) notFound();
  const { doc, pages, selected, pageNo, page, claims } = d;

  const href = (p: number, claim?: string) => `/documents/${id}?page=${p}${claim ? `&claim=${claim}#quote` : ''}`;
  const ix = pages.findIndex((p) => p.page_no === pageNo);
  const prev = ix > 0 ? pages[ix - 1].page_no : null;
  const next = ix >= 0 && ix < pages.length - 1 ? pages[ix + 1].page_no : null;
  const text: string = page?.text ?? '';
  const onThisPage = selected !== null && selected.page_no === pageNo;
  const hit = selected && onThisPage && text ? locateQuote(text, selected.quote) : null;
  const totalClaims = pages.reduce((n, p) => n + Number(p.claims), 0) + d.unpaged;

  return (
    <>
      <PageHead
        title={<span className="row">{doc.title} <OriginBadge origin={doc.data_origin} /></span>}
        sub={<>Source document · {humanize(doc.doc_type)} · stored exactly as retrieved. The page text below is extracted from the original and is untrusted external content.</>}
        right={<a className="btn" href={`/documents/${id}/file`}>Download original</a>} />

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <Panel title="Provenance">
          <dl className="kv" style={{ margin: 0 }}>
            <dt>Source</dt>
            <dd><Link href="/sources">{doc.source_name}</Link> <Badge value={doc.reuse_status} title="Source reuse terms" />
              {doc.publisher ? <div className="faint small">{doc.publisher}</div> : null}</dd>
            <dt>Licence</dt><dd>{doc.licence_name ?? <Badge value="missing" />}</dd>
            <dt>URL</dt>
            <dd className="small" style={{ wordBreak: 'break-all' }}>
              {doc.url ? (/^https?:\/\//i.test(doc.url) ? <a href={doc.url} target="_blank" rel="noopener noreferrer nofollow">{doc.url}</a> : doc.url) : <span className="faint">— not recorded ({humanize(doc.retrieval_method)})</span>}
            </dd>
            <dt>Retrieved</dt><dd className="mono small">{dateTime(doc.retrieved_at)} <span className="faint">via {humanize(doc.retrieval_method)}</span></dd>
            <dt>SHA-256</dt><dd className="mono small" style={{ wordBreak: 'break-all' }}>{doc.sha256}</dd>
          </dl>
        </Panel>
        <Panel title="Document">
          <dl className="kv" style={{ margin: 0 }}>
            <dt>Pages</dt><dd>{doc.page_count === null ? <Badge value="missing" /> : num(doc.page_count)}{' '}
              <span className="faint small">· {num(pages.length)} with stored text · {num(doc.byte_size)} bytes · {doc.mime_type}</span></dd>
            <dt>Document date</dt><dd>{doc.document_date ? <span className="mono">{documentDate(doc.document_date, doc.document_date_precision)}</span> : <Badge value="missing" />}{' '}
              <span className="faint small">precision: {humanize(doc.document_date_precision)}</span></dd>
            <dt>Price basis year</dt><dd>{doc.price_basis_year ?? <span className="faint">— not determined</span>}</dd>
            <dt>Text extraction</dt><dd><Badge value={doc.text_status} tone={doc.text_status === 'extracted' ? 'good' : doc.text_status === 'failed' ? 'bad' : 'warn'} /></dd>
            <dt>Data origin</dt><dd>{doc.data_origin === 'research' ? <Badge value="research" tone="good" /> : <OriginBadge origin={doc.data_origin} />}</dd>
            <dt>Claims</dt><dd>{num(totalClaims)}{d.unpaged ? <span className="faint small"> · {num(d.unpaged)} without a page reference</span> : null}</dd>
          </dl>
        </Panel>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="body row">
          {prev !== null ? <Link className="btn" href={href(prev)}>← Prev</Link> : <button type="button" disabled>← Prev</button>}
          <span className="mono">page {pageNo}{doc.page_count ? ` of ${doc.page_count}` : ''}</span>
          {next !== null ? <Link className="btn" href={href(next)}>Next →</Link> : <button type="button" disabled>Next →</button>}
          <span className="faint small">pages (claims):</span>
          {pages.length === 0 ? <span className="faint small">no page text stored</span> : null}
          {pages.map((p) => (
            <Link key={p.page_no} href={href(p.page_no)} className="mono small" title={`${p.char_count} characters · ${p.claims} claims`}
              style={p.page_no === pageNo
                ? { padding: '1px 5px', background: 'var(--panel-2)', border: '1px solid var(--accent)', color: '#fff' }
                : { padding: '1px 5px', border: '1px solid var(--line-soft)' }}>
              {p.page_no}{Number(p.claims) ? <span className="muted"> ({p.claims})</span> : null}
            </Link>))}
        </div>
      </div>

      {sp.claim && !selected ? <div className="notice warn">The claim in this link does not belong to this document or is not visible to you.</div> : null}
      {selected ? (
        <div className={`notice ${hit ? 'good' : 'warn'}`}>
          <div className="row" style={{ marginBottom: 4 }}>
            <b>Selected claim:</b> <span>{selected.subject}</span> <Badge value={selected.status} />
            {hit ? <><Badge value="quote located" tone="good" /> <a href="#quote" className="small">jump to highlight ↓</a></>
              : onThisPage ? <Badge value="not located" tone="bad" title="The quote does not occur in this page's stored text, even ignoring whitespace and letter case." />
              : <><Badge value="cites another page" tone="warn" />{selected.page_no
                  ? <Link href={href(selected.page_no, selected.id)} className="small">go to page {selected.page_no} →</Link>
                  : <span className="small muted">the claim has no page reference</span>}</>}
            <Link href={href(pageNo)} className="small">clear</Link>
          </div>
          {!hit ? <div className="quote">{selected.quote}</div> : null}
        </div>) : null}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', alignItems: 'start' }}>
        <Panel title={`Stored text — page ${pageNo}`} right={page ? <span className="mono">{num(text.length)} characters</span> : null}>
          {!page ? (
            <div className="notice warn" style={{ marginBottom: 0 }}>
              {pages.length === 0
                ? `No page text is stored for this document (text extraction: ${humanize(doc.text_status)}). Download the original to read it.`
                : `Page ${pageNo} has no stored text. Pick a page from the list above.`}
            </div>
          ) : text.trim() === '' ? (
            <div className="notice warn" style={{ marginBottom: 0 }}>This page has no extractable text (it may be a scanned image). Download the original to read it.</div>
          ) : (
            <pre className="pagetext" style={{ margin: 0, maxHeight: 'none' }}>
              {hit ? <>{text.slice(0, hit.start)}<mark id="quote" style={{ scrollMarginTop: 120 }}>{text.slice(hit.start, hit.end)}</mark>{text.slice(hit.end)}</> : text}
            </pre>)}
        </Panel>

        <Panel title={`Claims on page ${pageNo}`} right={<span className="mono">{claims.length}</span>} flush>
          <table>
            <thead><tr><th>Subject</th><th className="num">As printed</th><th>Quote check</th><th>Status</th></tr></thead>
            <tbody>
              {claims.length === 0 ? <Empty cols={4}>No claim cites this page.</Empty> : null}
              {claims.map((c) => {
                const active = selected?.id === c.id;
                return (
                  <tr key={c.id}>
                    <td style={active ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}>
                      <Link href={href(pageNo, c.id)}>{active ? <b>{c.subject}</b> : c.subject}</Link>
                      <div className="faint small">{humanize(c.claim_type)}{c.attribute ? ` · ${humanize(c.attribute)}` : ''}
                        {c.model_slug ? <> · <Link href={`/business/${c.model_slug}?tab=evidence`}>{c.model_name}</Link></> : null}</div>
                    </td>
                    <td className="num">{printedValue(c)}</td>
                    <td>{c.quote_verified
                      ? <Badge value="quote found" tone="good" title={`match score ${c.quote_match_score ?? 'not recorded'}`} />
                      : <Badge value="quote not found" tone="bad" title="The quote could not be located on the cited page by the deterministic check." />}</td>
                    <td><Badge value={c.status} /></td>
                  </tr>);
              })}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
