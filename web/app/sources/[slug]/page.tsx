import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { date, dateTime, humanize, num } from '@/lib/format';
import { Badge, Empty, Flash, OriginBadge, PageHead, Panel } from '@/components/ui';
import { recordPermission, setIngestionEnabled } from '@/app/actions/sources';

const missing = <span className="badge bad">missing</span>;
const notRecorded = <span className="faint">—</span>;

/** External URL from the registry: rendered as a link only when it is plainly http(s); otherwise as plain text. */
function Ext({ url }: { url: string | null | undefined }) {
  if (!url) return notRecorded;
  if (!/^https?:\/\//i.test(url)) return <span className="mono small">{url}</span>;
  return <a href={url} rel="noreferrer noopener" target="_blank" style={{ wordBreak: 'break-all' }}>{url}</a>;
}

function Text({ children }: { children: string | null | undefined }): ReactNode {
  return children ? <span className="wrap">{children}</span> : notRecorded;
}

export default async function SourceDetail({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requireStaff();
  const { slug } = await params;
  const sp = await searchParams;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) notFound();

  const d = await asUser(user.id, async (sql) => {
    const [s] = await sql`
      select s.*, (s.terms_checked_on + s.default_revalidation_days)::date as terms_recheck_due,
             (current_date - (s.terms_checked_on + s.default_revalidation_days)) as terms_days_overdue
      from intel.sources s where s.slug = ${slug}`;
    if (!s) return null;
    const documents = await sql`
      select doc.id, doc.title, doc.doc_type, doc.url, doc.retrieved_at, doc.retrieval_method, doc.byte_size, doc.page_count, doc.document_date,
             doc.price_basis_year, doc.text_status, doc.sha256, doc.licence_snapshot, doc.data_origin,
             (select count(*) from intel.evidence_claims c where c.source_document_id = doc.id) as claims,
             (select string_agg(distinct m.slug || '|' || m.name, E'\n') from intel.evidence_claims c join intel.business_models m on m.id = c.business_model_id
               where c.source_document_id = doc.id) as models
      from intel.source_documents doc where doc.source_id = ${s.id} order by doc.retrieved_at desc limit 200`;
    const [docCount] = await sql`select count(*) as n from intel.source_documents where source_id = ${s.id}`;
    const log = await sql`
      select id, occurred_at, adapter_key, research_run_id, url, action, outcome, http_status, byte_size, duration_ms, attempt, detail
      from ops.ingestion_log where source_id = ${s.id} order by occurred_at desc, id desc limit 50`;
    return { s, documents, docTotal: Number(docCount.n), log };
  });
  if (!d) notFound();
  const { s, documents, log } = d;
  const admin = can(user, 'admin');
  const back = `/sources/${s.slug}`;

  const reusable = s.reuse_status === 'permitted' || s.reuse_status === 'permitted_with_attribution';
  const permissionRecorded = Boolean(s.permission_granted_on && s.permission_evidence);
  const gateOpen = reusable || (s.reuse_status === 'permission_required' && permissionRecorded);
  const gateReason = reusable
    ? 'The source’s own terms permit reuse.'
    : s.reuse_status === 'permission_required'
      ? (permissionRecorded ? `Written permission was recorded on ${s.permission_granted_on}.` : 'Permission is required and none has been recorded yet.')
      : s.reuse_status === 'prohibited' ? 'The source’s terms prohibit reuse.' : 'The reuse terms are unclear; unclear is treated as not permitted.';
  const canEnable = gateOpen && Boolean(s.terms_checked_on) && s.recommended_ingestion !== 'do_not_ingest';

  return (
    <>
      <PageHead
        title={<span className="row">{s.name} <Badge value={s.reuse_status} /><OriginBadge origin={s.data_origin} /></span>}
        sub={<><Link href="/sources">Source registry</Link> · <span className="mono">{s.slug}</span>{s.publisher ? <> · {s.publisher}</> : null}</>} />
      <Flash params={sp} />
      {s.registry_confidence !== 'verified' ? (
        <div className="notice warn">
          Registry confidence is <b>{humanize(s.registry_confidence).toLowerCase()}</b>:{' '}
          {s.registry_confidence === 'unverified'
            ? 'this entry was recorded from prior knowledge and its licence page has not been read. Check the terms before relying on it.'
            : 'only part of this entry was checked against the source itself. Read the notes below before relying on it.'}
        </div>
      ) : null}

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <Panel title="Source">
          <dl className="kv" style={{ margin: 0 }}>
            <dt>Name</dt><dd>{s.name}</dd>
            <dt>Publisher</dt><dd><Text>{s.publisher}</Text></dd>
            <dt>Source type</dt><dd>{humanize(s.source_type)}</dd>
            <dt>Authority level</dt><dd>{humanize(s.authority_level)}</dd>
            <dt>Base URL</dt><dd><Ext url={s.base_url} /></dd>
            <dt>What is available</dt><dd><Text>{s.information_available}</Text></dd>
            <dt>Geographic coverage</dt><dd><Text>{s.geographic_coverage}</Text></dd>
            <dt>Update frequency</dt><dd><Text>{s.update_frequency}</Text></dd>
            <dt>Registry confidence</dt><dd><Badge value={s.registry_confidence} /></dd>
            <dt>Registry entry</dt><dd className="mono small">created {dateTime(s.created_at)} · updated {dateTime(s.updated_at)}</dd>
          </dl>
        </Panel>
        <Panel title="Access">
          <dl className="kv" style={{ margin: 0 }}>
            <dt>Access method</dt><dd>{humanize(s.access_method)}</dd>
            <dt>Accessible</dt>
            <dd>{s.accessibility === 'untested' ? <span className="badge">untested</span> : <Badge value={s.accessibility} />}
              {s.accessibility_notes ? <div className="small muted wrap" style={{ marginTop: 3 }}>{s.accessibility_notes}</div> : null}</dd>
            <dt>API</dt>
            <dd>{s.api_available === 'yes' ? <Badge value="yes" tone="info" /> : <span className="badge">{s.api_available}</span>}
              {s.api_notes ? <div className="small muted wrap" style={{ marginTop: 3 }}>{s.api_notes}</div> : null}</dd>
            <dt>Requires sign-in</dt><dd>{s.requires_auth ? 'yes' : 'no'}</dd>
            <dt>robots.txt URL</dt><dd><Ext url={s.robots_txt_url} /></dd>
            <dt>robots.txt status</dt><dd>{s.robots_txt_status ? <Badge value={s.robots_txt_status} tone={s.robots_txt_status === 'fetched' ? 'good' : s.robots_txt_status === 'unreachable' ? 'bad' : undefined} /> : <span className="faint">— (not checked)</span>}</dd>
            <dt>robots.txt summary</dt><dd><Text>{s.robots_txt_summary}</Text></dd>
            <dt>Adapter</dt><dd className="mono">{s.adapter_key ?? <span className="faint">— (no adapter)</span>}</dd>
            <dt>Rate limit</dt><dd className="mono">{s.rate_limit_per_minute} requests / minute</dd>
            <dt>Last checked</dt><dd className="mono">{dateTime(s.last_checked_at)}</dd>
            <dt>Last ingested</dt><dd className="mono">{s.last_ingested_at ? dateTime(s.last_ingested_at) : <span className="faint">— (never by an adapter)</span>}</dd>
          </dl>
        </Panel>
      </div>

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <Panel title="Licence and reuse">
          <dl className="kv" style={{ margin: 0 }}>
            <dt>Reuse status</dt><dd><Badge value={s.reuse_status} /></dd>
            <dt>Licence</dt><dd>{s.licence_name ? <span className="wrap">{s.licence_name}</span> : missing}</dd>
            <dt>Licence URL</dt><dd>{s.licence_url ? <Ext url={s.licence_url} /> : missing}</dd>
            <dt>Terms as quoted</dt>
            <dd>{s.licence_quoted_terms
              ? <div className="quote">{s.licence_quoted_terms}</div>
              : <>{missing} <span className="faint small">no wording from the source’s terms has been recorded</span></>}</dd>
            <dt>Reuse notes</dt><dd><Text>{s.reuse_notes}</Text></dd>
            <dt>Terms checked on</dt>
            <dd>{s.terms_checked_on ? <span className="mono">{date(s.terms_checked_on)}</span> : <>{missing} <span className="faint small">never checked</span></>}
              {s.terms_recheck_due ? (
                <span className="small" style={{ color: s.terms_days_overdue > 0 ? 'var(--warn)' : 'var(--muted)' }}>
                  {' '}· re-check due {s.terms_recheck_due}{s.terms_days_overdue > 0 ? ` (${s.terms_days_overdue} days overdue)` : ''}
                </span>
              ) : null}</dd>
            <dt>Revalidate every</dt><dd className="mono">{s.default_revalidation_days} days</dd>
            <dt>Permission contact</dt><dd><Text>{s.permission_contact}</Text></dd>
            <dt>Permission granted on</dt><dd>{s.permission_granted_on ? <span className="mono">{date(s.permission_granted_on)}</span> : <span className="faint">— (none recorded)</span>}</dd>
            <dt>Permission evidence</dt><dd>{s.permission_evidence ? <div className="quote">{s.permission_evidence}</div> : <span className="faint">— (none recorded)</span>}</dd>
          </dl>
        </Panel>

        <Panel title="Automated ingestion — the legal gate">
          <dl className="kv" style={{ margin: '0 0 10px' }}>
            <dt>Recommended ingestion</dt><dd><Badge value={s.recommended_ingestion} /></dd>
            <dt>Ingestion enabled</dt><dd>{s.ingestion_enabled ? <Badge value="yes" tone="good" /> : <span className="badge">no</span>}</dd>
            <dt>Reuse right</dt>
            <dd><Badge value={gateOpen ? 'satisfied' : 'not satisfied'} tone={gateOpen ? 'good' : 'bad'} /> <span className="small muted">{gateReason}</span></dd>
          </dl>
          <p className="muted small">
            Automated collection can only be enabled where the reuse terms permit it or written permission is recorded, and only after the terms have been checked.
            The database enforces this (<span className="mono">sources_ingestion_requires_reuse_right</span>, <span className="mono">sources_ingestion_requires_terms_check</span>);
            a refused change is reported above. Being publicly visible is not a licence. Manual upload of individual documents is a separate, human decision.
          </p>
          <form action={setIngestionEnabled} className="inline" style={{ marginBottom: 12 }}>
            <input type="hidden" name="source_id" value={s.id} /><input type="hidden" name="back" value={back} />
            <input type="hidden" name="enabled" value={s.ingestion_enabled ? 'false' : 'true'} />
            <button type="submit" className={s.ingestion_enabled ? 'bad' : 'primary'} disabled={!admin}>
              {s.ingestion_enabled ? 'Disable automated ingestion' : 'Enable automated ingestion'}
            </button>
            {!admin ? <span className="faint small">Admin only.</span>
              : !s.ingestion_enabled && !canEnable ? <span className="small" style={{ color: 'var(--warn)' }}>
                {s.recommended_ingestion === 'do_not_ingest' ? 'Marked do-not-ingest — this will be refused.'
                  : !gateOpen ? 'The reuse right is not satisfied — the database will refuse this.'
                  : 'The terms have never been checked — the database will refuse this.'}</span>
              : null}
          </form>

          <h3>Record written permission</h3>
          <p className="muted small">
            {s.reuse_status === 'permission_required'
              ? 'This source requires permission. Recording the date it was granted and the evidence for it (who granted it, in what form, where the letter or email is filed) is what lifts the gate — nothing else does.'
              : `Recording a permission lifts the gate only for a source whose reuse status is “permission required”. This source is “${humanize(s.reuse_status).toLowerCase()}”, so a permission recorded here is kept on file but does not change what the database allows.`}
          </p>
          <form action={recordPermission}>
            <input type="hidden" name="source_id" value={s.id} /><input type="hidden" name="back" value={back} />
            <div className="form-grid">
              <div>
                <label htmlFor="permission_granted_on">Permission granted on</label>
                <input id="permission_granted_on" type="date" name="permission_granted_on" required defaultValue={s.permission_granted_on ?? ''} />
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <label htmlFor="permission_evidence">Permission evidence</label>
              <textarea id="permission_evidence" name="permission_evidence" required minLength={10} maxLength={2000} defaultValue={s.permission_evidence ?? ''}
                placeholder="Who granted it, their role, the scope granted (storage, extraction, commercial reuse), and where the written permission is filed" />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="submit" disabled={!admin}>Record permission</button>
              {!admin ? <span className="faint small">Admin only.</span> : null}
            </div>
          </form>
        </Panel>
      </div>

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <Panel title={`Quality limitations (${s.quality_limitations.length})`}>
          {s.quality_limitations.length === 0
            ? <span className="faint">No limitation has been recorded for this source. That is not a statement that it has none.</span>
            : <ul style={{ margin: 0, paddingLeft: 18 }}>{s.quality_limitations.map((q: string, i: number) => <li key={i}>{q}</li>)}</ul>}
        </Panel>
        <Panel title={`Evidence for this registry entry (${s.evidence_urls.length})`}>
          {s.evidence_urls.length === 0
            ? <span className="faint">No page was recorded as the basis of this registry entry.</span>
            : <ul style={{ margin: 0, paddingLeft: 18 }}>{s.evidence_urls.map((u: string, i: number) => <li key={i}><Ext url={u} /></li>)}</ul>}
        </Panel>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Panel title={`Documents from this source (${d.docTotal > documents.length ? `latest ${documents.length} of ${d.docTotal}` : documents.length})`} flush>
          <table>
            <thead><tr>
              <th>Document</th><th>Type</th><th>Retrieved</th><th>Method</th><th>Document date</th><th className="num">Pages</th><th className="num">Bytes</th>
              <th>Text</th><th className="num">Claims</th><th>Used by</th><th>Licence at retrieval</th>
            </tr></thead>
            <tbody>
              {documents.length === 0 ? <Empty cols={11}>No document from this source is in the evidence store.</Empty> : null}
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td style={{ maxWidth: 340 }}>
                    {doc.title} <OriginBadge origin={doc.data_origin} />
                    {doc.url ? <div className="small"><Ext url={doc.url} /></div> : null}
                    <div className="mono small faint" title={`SHA-256 ${doc.sha256}`}>sha256 {doc.sha256.slice(0, 16)}…</div>
                  </td>
                  <td className="small">{humanize(doc.doc_type)}</td>
                  <td className="mono small">{dateTime(doc.retrieved_at)}</td>
                  <td className="small">{humanize(doc.retrieval_method)}</td>
                  <td className="mono small">{doc.document_date ? date(doc.document_date) : doc.price_basis_year ? <span title="Only the price basis year is known">{doc.price_basis_year}</span> : <span className="faint">—</span>}</td>
                  <td className="num">{num(doc.page_count)}</td>
                  <td className="num">{num(doc.byte_size)}</td>
                  <td><Badge value={doc.text_status} tone={doc.text_status === 'extracted' ? 'good' : doc.text_status === 'failed' ? 'bad' : 'warn'} /></td>
                  <td className="num">{num(doc.claims)}</td>
                  <td className="small">
                    {doc.models ? String(doc.models).split('\n').map((m) => {
                      const [mSlug, ...rest] = m.split('|');
                      return <div key={mSlug}><Link href={`/business/${mSlug}?tab=evidence`}>{rest.join('|')}</Link></div>;
                    }) : <span className="faint">—</span>}
                  </td>
                  <td className="small muted" style={{ maxWidth: 260 }}>{doc.licence_snapshot ?? <span className="faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel title={`Recent ingestion log (${log.length}${log.length === 50 ? ', latest 50' : ''})`} flush>
        <table>
          <thead><tr><th>Time</th><th>Adapter</th><th>Action</th><th>Outcome</th><th className="num">HTTP</th><th className="num">Bytes</th><th className="num">Duration</th><th className="num">Attempt</th><th>Detail</th><th>Run</th></tr></thead>
          <tbody>
            {log.length === 0 ? <Empty cols={10}>No adapter action or upload has been logged for this source.</Empty> : null}
            {log.map((l) => (
              <tr key={l.id}>
                <td className="mono small">{dateTime(l.occurred_at)}</td>
                <td className="mono small">{l.adapter_key ?? <span className="faint">—</span>}</td>
                <td className="mono small">{l.action}</td>
                <td><Badge value={l.outcome} tone={l.outcome === 'ok' ? 'good' : l.outcome === 'skipped' ? undefined : l.outcome === 'blocked' ? 'warn' : 'bad'} /></td>
                <td className="num">{l.http_status ?? <span className="faint">—</span>}</td>
                <td className="num">{num(l.byte_size)}</td>
                <td className="num">{l.duration_ms === null ? <span className="faint">—</span> : `${num(l.duration_ms)} ms`}</td>
                <td className="num">{l.attempt}</td>
                <td className="small" style={{ maxWidth: 380 }}>
                  {l.detail ? <span className="wrap">{l.detail}</span> : null}
                  {l.url ? <div className="mono faint" style={{ wordBreak: 'break-all' }}>{l.url}</div> : null}
                  {!l.detail && !l.url ? <span className="faint">—</span> : null}
                </td>
                <td>{l.research_run_id ? <Link href={`/runs/${l.research_run_id}`} className="mono small">{String(l.research_run_id).slice(0, 8)}</Link> : <span className="faint">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
