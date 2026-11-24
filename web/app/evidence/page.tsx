import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { asUser, type Row } from '@/lib/db';
import { date, dateTime, humanize, num, valueWithUnit } from '@/lib/format';
import { Badge, Empty, Grade, OriginBadge, PageHead, Panel, Stat } from '@/components/ui';

type Search = { q?: string; status?: string; type?: string; verified?: string; method?: string; model?: string; grade?: string; vstatus?: string };

const CLAIM_STATUSES = ['extracted', 'accepted', 'rejected', 'superseded'];
const CLAIM_TYPES = ['cost', 'price', 'capacity', 'yield', 'utilization', 'consumption', 'staffing', 'wage', 'requirement',
  'regulatory', 'scheme', 'market', 'process', 'risk', 'financial_summary', 'other'];
const METHODS = ['llm', 'rule_based', 'manual', 'import'];
const GRADES = ['A', 'B', 'C', 'D'];
const VERIFICATION = ['unverified', 'verified', 'disputed', 'rejected'];
const LIMIT = 200;

// Private-use code points mark search hits in ts_headline output. The snippet is then split on them and
// rendered as text nodes, so nothing from a (untrusted) source document is ever interpreted as markup.
const HIT_START = '';
const HIT_STOP = '';
const HEADLINE_OPTIONS = `StartSel=${HIT_START}, StopSel=${HIT_STOP}, MaxFragments=2, MaxWords=26, MinWords=10, FragmentDelimiter=" … "`;

function Snippet({ headline }: { headline: string }): ReactNode {
  const parts = headline.replace(/\s+/g, ' ').trim().split(HIT_START);
  return (
    <span className="mono small">
      {parts.map((part, i) => {
        if (i === 0) return part;
        const stop = part.indexOf(HIT_STOP);
        return stop === -1 ? part : <span key={i}><mark>{part.slice(0, stop)}</mark>{part.slice(stop + 1)}</span>;
      })}
    </span>
  );
}

const pick = (value: string | undefined, allowed: string[]): string | null => (value && allowed.includes(value) ? value : null);

export default async function EvidenceExplorer({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 200);
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const status = pick(sp.status, CLAIM_STATUSES);
  const type = pick(sp.type, CLAIM_TYPES);
  const method = pick(sp.method, METHODS);
  const verified = sp.verified === 'yes' ? true : sp.verified === 'no' ? false : null;
  const grade = pick(sp.grade, GRADES);
  const vstatus = pick(sp.vstatus, VERIFICATION);
  const model = sp.model && /^[a-z0-9-]{1,120}$/.test(sp.model) ? sp.model : null;

  const d = await asUser(user.id, async (sql) => {
    const models = await sql`
      select m.slug, m.name from intel.business_models m
      where exists (select 1 from intel.evidence_claims c where c.business_model_id = m.id)
         or exists (select 1 from intel.v_observations o where o.business_model_id = m.id)
      order by m.name`;
    const pages = q ? await sql`
      select p.document_id, p.page_no, d.title, s.name as source_name, s.reuse_status,
             ts_headline('english', p.text, x.query, ${HEADLINE_OPTIONS}) as headline,
             (select count(*) from intel.evidence_claims c where c.source_document_id = p.document_id and c.page_no = p.page_no) as claims
      from websearch_to_tsquery('english', ${q}) as x(query)
      join intel.document_pages p on p.tsv @@ x.query
      join intel.source_documents d on d.id = p.document_id
      join intel.sources s on s.id = d.source_id
      order by ts_rank(p.tsv, x.query) desc, d.title, p.page_no
      limit 50` : [];
    const [pageHits] = q ? await sql`
      select count(*) as n from websearch_to_tsquery('english', ${q}) as x(query) join intel.document_pages p on p.tsv @@ x.query` : [];
    const [summary] = q ? [] : await sql`
      select
        (select count(*) from intel.source_documents) as documents,
        (select count(*) from intel.document_pages where char_count > 0) as pages,
        (select count(*) from intel.evidence_claims) as claims,
        (select count(*) from intel.evidence_claims where status = 'extracted') as claims_pending,
        (select count(*) from intel.evidence_claims where status = 'accepted') as claims_accepted,
        (select count(*) from intel.evidence_claims where not quote_verified) as claims_not_found,
        (select count(*) from intel.v_usable_observations) as observations,
        (select count(*) from intel.v_usable_observations where verification_status = 'verified') as observations_verified`;
    const documents = q ? [] : await sql`
      select d.id, d.title, d.page_count, d.retrieved_at, d.text_status, d.data_origin, s.name as source_name, s.reuse_status,
             (select count(*) from intel.evidence_claims c where c.source_document_id = d.id) as claims,
             (select count(*) from intel.evidence_claims c where c.source_document_id = d.id and c.status = 'extracted') as pending
      from intel.source_documents d join intel.sources s on s.id = d.source_id
      order by d.retrieved_at desc limit 25`;
    const claimFilter = sql`
      (${status}::text is null or c.status = ${status})
      and (${type}::text is null or c.claim_type = ${type})
      and (${method}::text is null or c.extraction_method = ${method})
      and (${verified}::boolean is null or c.quote_verified = ${verified})
      and (${model}::text is null or m.slug = ${model})
      and (${q} = '' or c.subject ilike ${like} or c.quote ilike ${like}
           or to_tsvector('english', c.subject || ' ' || coalesce(c.attribute, '') || ' ' || c.quote) @@ websearch_to_tsquery('english', ${q}))`;
    const claims = await sql`
      select c.id, c.source_document_id, c.page_no, c.subject, c.claim_type, c.attribute, c.value_numeric, c.value_low, c.value_high,
             c.value_text, c.unit_raw, c.quote, c.quote_verified, c.quote_match_score, c.status, c.extraction_method, c.data_origin,
             d.title as doc_title, m.slug as model_slug, m.name as model_name
      from intel.evidence_claims c
      join intel.source_documents d on d.id = c.source_document_id
      left join intel.business_models m on m.id = c.business_model_id
      where ${claimFilter}
      order by c.created_at desc, c.source_document_id, c.page_no, c.id
      limit ${LIMIT}`;
    const [claimTotal] = await sql`
      select count(*) as n from intel.evidence_claims c left join intel.business_models m on m.id = c.business_model_id where ${claimFilter}`;
    const obsFilter = sql`
      (${grade}::text is null or o.evidence_grade = ${grade})
      and (${vstatus}::text is null or o.verification_status = ${vstatus})
      and (${model}::text is null or m.slug = ${model})
      and (${q} = '' or o.subject ilike ${like} or to_tsvector('english', o.subject) @@ websearch_to_tsquery('english', ${q}))`;
    const observations = await sql`
      select o.observation_kind, o.id, o.subject, o.section, o.value, o.value_low, o.value_high, o.unit_code, o.period, o.observed_on,
             o.evidence_grade, o.verification_status, o.evidence_type, o.page_ref, o.source_document_id, o.is_superseded, o.data_origin,
             coalesce(least(o.revalidate_by, o.valid_until) < current_date, false) as is_stale,
             least(o.revalidate_by, o.valid_until) as due_on,
             s.name as source_name, s.reuse_status, m.slug as model_slug, m.name as model_name
      from intel.v_observations o
      join intel.sources s on s.id = o.source_id
      join intel.business_models m on m.id = o.business_model_id
      where ${obsFilter}
      order by o.observed_on desc nulls last, m.name, o.observation_kind, o.subject, o.id
      limit ${LIMIT}`;
    const [obsTotal] = await sql`
      select count(*) as n from intel.v_observations o join intel.business_models m on m.id = o.business_model_id where ${obsFilter}`;
    return { models, pages, pageHits: Number((pageHits as Row | undefined)?.n ?? 0), summary: (summary as Row | undefined) ?? null,
      documents, claims, claimTotal: Number(claimTotal.n), observations, obsTotal: Number(obsTotal.n) };
  });

  const filtered = Boolean(status || type || method || verified !== null || grade || vstatus || model);

  return (
    <>
      <PageHead title="Evidence explorer"
        sub="Search the stored text of every source document, then follow a figure from the page it was printed on, to the claim extracted from it, to the observation used in a model. Document text is shown exactly as extracted and is untrusted external content." />

      <form method="get" style={{ marginBottom: 12 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <input name="q" defaultValue={q} placeholder='Full-text search in document pages — e.g. interest term loan, "working capital", honey -bread' style={{ flex: 1, minWidth: 320 }} />
          <button type="submit" className="primary">Search</button>
          <Link href="/evidence" className="small">reset</Link>
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))' }}>
          <div><label htmlFor="f-model">Business model</label>
            <select id="f-model" name="model" defaultValue={model ?? ''}>
              <option value="">All with evidence</option>
              {d.models.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
            </select></div>
          <div><label htmlFor="f-status">Claim status</label>
            <select id="f-status" name="status" defaultValue={status ?? ''}>
              <option value="">Any</option>{CLAIM_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </select></div>
          <div><label htmlFor="f-type">Claim type</label>
            <select id="f-type" name="type" defaultValue={type ?? ''}>
              <option value="">Any</option>{CLAIM_TYPES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </select></div>
          <div><label htmlFor="f-verified">Quote check</label>
            <select id="f-verified" name="verified" defaultValue={verified === null ? '' : verified ? 'yes' : 'no'}>
              <option value="">Any</option><option value="yes">Quote found</option><option value="no">Quote not found</option>
            </select></div>
          <div><label htmlFor="f-method">Extraction method</label>
            <select id="f-method" name="method" defaultValue={method ?? ''}>
              <option value="">Any</option>{METHODS.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </select></div>
          <div><label htmlFor="f-grade">Observation grade</label>
            <select id="f-grade" name="grade" defaultValue={grade ?? ''}>
              <option value="">Any</option>{GRADES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select></div>
          <div><label htmlFor="f-vstatus">Observation verification</label>
            <select id="f-vstatus" name="vstatus" defaultValue={vstatus ?? ''}>
              <option value="">Any</option>{VERIFICATION.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </select></div>
        </div>
        <div className="faint small" style={{ marginTop: 6 }}>
          The search text filters document pages, claims (subject and quote) and observations (subject). Claim filters apply to the claims table, grade and verification to the observations table, business model to both.
        </div>
      </form>

      <div className="grid">
        {q ? (
          <Panel title={`Document pages matching “${q}”`} right={<span className="mono">{d.pages.length} of {num(d.pageHits)} pages shown</span>} flush>
            <table>
              <thead><tr><th style={{ width: 300 }}>Document</th><th>Page</th><th>Matching text</th><th className="num">Claims on page</th><th style={{ width: 260 }}>Source</th></tr></thead>
              <tbody>
                {d.pages.length === 0 ? <Empty cols={5}>No stored page contains all of these words. Search covers extracted page text only; scanned documents awaiting OCR are not searchable.</Empty> : null}
                {d.pages.map((p) => (
                  <tr key={`${p.document_id}/${p.page_no}`}>
                    <td><Link href={`/documents/${p.document_id}`}>{p.title}</Link></td>
                    <td className="mono small nowrap"><Link href={`/documents/${p.document_id}?page=${p.page_no}`}>p. {p.page_no}</Link></td>
                    <td><Snippet headline={p.headline} /></td>
                    <td className="num">{num(p.claims)}</td>
                    <td className="small"><span className="muted">{p.source_name}</span> <Badge value={p.reuse_status} title="Source reuse terms" /></td>
                  </tr>))}
              </tbody>
            </table>
          </Panel>
        ) : (
          <>
            {d.summary ? (
              <div className="grid g6">
                <Stat label="Source documents" value={num(d.summary.documents)} note={`${num(d.summary.pages)} pages with text`} />
                <Stat label="Claims extracted" value={num(d.summary.claims)} />
                <Stat label="Claims awaiting review" value={num(d.summary.claims_pending)} tone={d.summary.claims_pending ? 'warn' : undefined} note={<Link href="/review">review inbox →</Link>} />
                <Stat label="Claims accepted" value={num(d.summary.claims_accepted)} />
                <Stat label="Quote not found" value={num(d.summary.claims_not_found)} tone={d.summary.claims_not_found ? 'bad' : undefined} note="never usable as evidence" />
                <Stat label="Usable observations" value={num(d.summary.observations)} note={`${num(d.summary.observations_verified)} verified by a human`} />
              </div>) : null}
            <Panel title="Latest documents" right={<span className="mono">{d.documents.length} most recently retrieved</span>} flush>
              <table>
                <thead><tr><th>Title</th><th>Source</th><th>Reuse status</th><th className="num">Pages</th><th className="num">Claims</th><th className="num">To review</th><th>Text</th><th>Retrieved</th></tr></thead>
                <tbody>
                  {d.documents.length === 0 ? <Empty cols={8}>No source document has been ingested yet. Upload one from a business record.</Empty> : null}
                  {d.documents.map((doc) => (
                    <tr key={doc.id}>
                      <td><Link href={`/documents/${doc.id}`}>{doc.title}</Link> <OriginBadge origin={doc.data_origin} /></td>
                      <td className="muted small">{doc.source_name}</td>
                      <td><Badge value={doc.reuse_status} /></td>
                      <td className="num">{num(doc.page_count)}</td>
                      <td className="num">{num(doc.claims)}</td>
                      <td className="num" style={{ color: Number(doc.pending) ? 'var(--warn)' : undefined }}>{num(doc.pending)}</td>
                      <td><Badge value={doc.text_status} tone={doc.text_status === 'extracted' ? 'good' : doc.text_status === 'failed' ? 'bad' : 'warn'} /></td>
                      <td className="mono small">{dateTime(doc.retrieved_at)}</td>
                    </tr>))}
                </tbody>
              </table>
            </Panel>
          </>
        )}

        <Panel title="Claims" right={<span className="mono">{d.claims.length} of {num(d.claimTotal)} shown{d.claimTotal > LIMIT ? ` (limit ${LIMIT}, newest first)` : ''}</span>} flush>
          <table>
            <thead><tr>
              <th>Page</th><th>Document · business model</th><th>Subject</th><th className="num">As printed</th><th>Verbatim quote</th>
              <th>Quote check</th><th>Status</th><th>Method</th>
            </tr></thead>
            <tbody>
              {d.claims.length === 0 ? (
                <Empty cols={8}>{q || filtered ? 'No claim matches the search text and filters.' : 'No claim has been extracted yet.'}</Empty>) : null}
              {d.claims.map((c) => (
                <tr key={c.id} style={c.status === 'rejected' || c.status === 'superseded' ? { opacity: 0.5 } : undefined}>
                  <td className="mono small nowrap">
                    {c.page_no ? <Link href={`/documents/${c.source_document_id}?page=${c.page_no}&claim=${c.id}`}>p. {c.page_no}</Link> : <span className="faint">no page</span>}
                  </td>
                  <td className="small" style={{ maxWidth: 260 }}>
                    <Link href={`/documents/${c.source_document_id}`}>{c.doc_title}</Link>
                    <div>{c.model_slug ? <Link href={`/business/${c.model_slug}?tab=evidence`}>{c.model_name}</Link> : <span className="faint">not linked to a business model</span>}</div>
                  </td>
                  <td><b>{c.subject}</b> <OriginBadge origin={c.data_origin} /><div className="faint small">{humanize(c.claim_type)}{c.attribute ? ` · ${humanize(c.attribute)}` : ''}</div></td>
                  <td className="num">
                    {c.value_numeric !== null ? <>{num(c.value_numeric, 2)} <span className="muted">{c.unit_raw ?? ''}</span></>
                      : c.value_low !== null || c.value_high !== null ? <>{num(c.value_low, 2)}–{num(c.value_high, 2)} <span className="muted">{c.unit_raw ?? ''}</span></>
                      : c.value_text ? <span className="small">{c.value_text}</span> : <span className="faint">—</span>}
                  </td>
                  <td style={{ maxWidth: 420 }}><div className="quote">{c.quote}</div></td>
                  <td>{c.quote_verified
                    ? <Badge value="quote found" tone="good" title={`match score ${c.quote_match_score ?? 'not recorded'}`} />
                    : <Badge value="quote not found" tone="bad" title="The quote could not be located on the cited page by the deterministic check." />}</td>
                  <td><Badge value={c.status} /></td>
                  <td className="muted small">{humanize(c.extraction_method)}</td>
                </tr>))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Observations" right={<span className="mono">{d.observations.length} of {num(d.obsTotal)} shown{d.obsTotal > LIMIT ? ` (limit ${LIMIT}, latest first)` : ''}</span>} flush>
          <table>
            <thead><tr>
              <th>Kind</th><th>Business model</th><th>Subject</th><th className="num">Value</th><th>Observed</th><th>Grade</th><th>Verification</th>
              <th title="Past its revalidation or validity date">Freshness</th><th>Source</th>
            </tr></thead>
            <tbody>
              {d.observations.length === 0 ? (
                <Empty cols={9}>{q || grade || vstatus || model ? 'No observation matches the search text and filters.' : 'No observation exists yet. Observations are created from reviewed claims and manual entries.'}</Empty>) : null}
              {d.observations.map((o) => (
                <tr key={`${o.observation_kind}/${o.id}`} style={o.is_superseded || o.verification_status === 'rejected' ? { opacity: 0.5 } : undefined}>
                  <td><span className="badge">{o.observation_kind}</span></td>
                  <td><Link href={`/business/${o.model_slug}?tab=${o.observation_kind === 'cost' ? 'costs' : 'revenue'}`}>{o.model_name}</Link></td>
                  <td>{o.subject} <OriginBadge origin={o.data_origin} /><div className="faint small">{humanize(o.section)} · {humanize(o.evidence_type)}</div></td>
                  <td className="num">
                    {o.value !== null ? valueWithUnit(o.value, o.unit_code, o.period)
                      : o.value_low !== null || o.value_high !== null ? `${valueWithUnit(o.value_low, o.unit_code)} – ${valueWithUnit(o.value_high, o.unit_code, o.period)}`
                      : <span className="faint">—</span>}
                  </td>
                  <td className="mono small">{date(o.observed_on)}</td>
                  <td><Grade grade={o.evidence_grade} /></td>
                  <td><Badge value={o.verification_status} />{o.is_superseded ? <> <Badge value="superseded" /></> : null}</td>
                  <td>{o.due_on === null ? <span className="faint small" title="No revalidation or validity date recorded">no date</span>
                    : o.is_stale ? <Badge value="stale" title={`Due for revalidation on ${date(o.due_on)}`} />
                    : <span className="mono small muted" title="Revalidate by">{date(o.due_on)}</span>}</td>
                  <td className="small" style={{ maxWidth: 300 }}>
                    <span className="muted">{o.source_name}</span> <Badge value={o.reuse_status} title="Source reuse terms" />
                    {o.source_document_id ? <div><Link href={`/documents/${o.source_document_id}${/^\d+$/.test(o.page_ref ?? '') ? `?page=${o.page_ref}` : ''}`}>document{o.page_ref ? ` · p. ${o.page_ref}` : ''}</Link></div> : null}
                  </td>
                </tr>))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
