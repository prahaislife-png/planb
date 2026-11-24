import Link from 'next/link';
import { can, type StaffUser } from '@/lib/auth';
import { asUser, type Row } from '@/lib/db';
import { humanize, num } from '@/lib/format';
import { Badge, Empty, Panel } from '@/components/ui';
import { acceptVerifiedClaims, correctClaim, reviewClaim } from '@/app/actions/research';

export function ClaimRow({ c, back, canReview }: { c: Row; back: string; canReview: boolean }) {
  const reviewable = c.status === 'extracted' || c.status === 'accepted';
  return (
    <tr style={c.status === 'rejected' || c.status === 'superseded' ? { opacity: 0.5 } : undefined}>
      <td className="mono small nowrap"><Link href={`/documents/${c.source_document_id}?page=${c.page_no ?? 1}&claim=${c.id}`}>p. {c.page_no ?? '?'}</Link></td>
      <td><b>{c.subject}</b><div className="faint small">{humanize(c.claim_type)}{c.attribute ? ` · ${humanize(c.attribute)}` : ''}{c.cost_category_slug ? ` → ${c.cost_category_slug}` : ''}{c.parameter_key ? ` → ${c.parameter_key}` : ''}
        {c.target_kind === 'context' ? ' · context only' : ''}</div></td>
      <td className="num">{c.value_numeric !== null ? <>{num(c.value_numeric, 2)} <span className="muted">{c.unit_raw}</span></> : c.value_low !== null ? `${num(c.value_low)}–${num(c.value_high)} ${c.unit_raw ?? ''}` : <span className="small">{c.value_text}</span>}
        {c.quantity ? <div className="faint small">qty {num(c.quantity, 2)}</div> : null}</td>
      <td className="num small">{c.value_normalized !== null && c.value_normalized !== c.value_numeric ? <>{num(c.value_normalized, 2)} {c.unit_code}</> : <span className="faint">{c.unit_code ?? ''}</span>}</td>
      <td style={{ maxWidth: 420 }}><div className="quote">{c.quote}</div></td>
      <td>{c.quote_verified ? <Badge value="quote found" tone="good" title={`match score ${c.quote_match_score}`} /> : <Badge value="quote not found" tone="bad" title="The quote could not be located on the cited page. This claim was not used." />}</td>
      <td><Badge value={c.status} /><div className="faint small">{humanize(c.extraction_method)}</div></td>
      <td>
        {reviewable ? (
          <div className="grid" style={{ gap: 4 }}>
            <form action={reviewClaim} className="inline">
              <input type="hidden" name="claim_id" value={c.id} /><input type="hidden" name="back" value={back} />
              <input name="note" placeholder="reason (required to reject)" style={{ width: 170 }} />
              <button type="submit" name="decision" value="accept" className="good" disabled={!canReview || !c.quote_verified || c.status === 'accepted'}>Accept</button>
              <button type="submit" name="decision" value="reject" className="bad" disabled={!canReview}>Reject</button>
            </form>
            <details><summary>correct</summary>
              <form action={correctClaim}>
                <input type="hidden" name="claim_id" value={c.id} /><input type="hidden" name="back" value={back} />
                <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(70px, 1fr))' }}>
                  <div><label>Value as printed</label><input name="value" type="number" step="any" defaultValue={c.value_numeric ?? ''} required /></div>
                  <div><label>Unit as printed</label><input name="unit_raw" defaultValue={c.unit_raw ?? ''} /></div>
                  <div><label>Quantity</label><input name="quantity" type="number" step="any" defaultValue={c.quantity ?? ''} /></div>
                  <div><label>Page</label><input name="page" type="number" min={1} defaultValue={c.page_no ?? 1} required /></div>
                  <div style={{ gridColumn: 'span 4' }}><label>Verbatim quote from that page</label><input name="quote" defaultValue={c.quote} required minLength={3} /></div>
                  <div style={{ gridColumn: 'span 3' }}><label>What was wrong</label><input name="note" required minLength={3} /></div>
                  <div style={{ alignSelf: 'end' }}><button type="submit" disabled={!canReview}>Save correction</button></div>
                </div>
              </form>
            </details>
          </div>) : <span className="muted small">{c.review_note}</span>}
      </td>
    </tr>
  );
}

export async function EvidenceTab({ user, model, back }: { user: StaffUser; model: Row; back: string }) {
  const { docs, claims } = await asUser(user.id, async (sql) => ({
    docs: await sql`
      select d.id, d.title, d.page_count, s.name as source_name, s.reuse_status,
             count(*) as claims, count(*) filter (where c.status = 'extracted') as pending,
             count(*) filter (where c.status = 'extracted' and c.quote_verified) as acceptable,
             count(*) filter (where not c.quote_verified) as unverifiable
      from intel.evidence_claims c join intel.source_documents d on d.id = c.source_document_id join intel.sources s on s.id = d.source_id
      where c.business_model_id = ${model.id} group by d.id, d.title, d.page_count, s.name, s.reuse_status order by d.title`,
    claims: await sql`
      select c.* from intel.evidence_claims c where c.business_model_id = ${model.id}
      order by c.source_document_id, c.page_no, (c.target_kind = 'context'), c.created_at limit 600`,
  }));
  const canReview = can(user, 'admin', 'reviewer', 'researcher');

  return (
    <div className="grid">
      <div className="notice">
        Each claim is a statement copied from a source page. The quote is checked against the stored page text by deterministic code before a claim can be used;
        a human then accepts, corrects or rejects it. Rejecting or correcting a claim retires every observation that was built from it.
      </div>
      {docs.length === 0 ? <div className="notice warn">No evidence yet for this business.</div> : null}
      {docs.map((doc) => (
        <Panel key={doc.id} title={<><Link href={`/documents/${doc.id}`}>{doc.title}</Link></>}
          right={<>
            <span className="muted">{doc.source_name}</span><Badge value={doc.reuse_status} title="Source reuse terms" />
            <span className="mono">{doc.claims} claims · {doc.pending} to review · {doc.unverifiable} not found</span>
            <form action={acceptVerifiedClaims} className="inline">
              <input type="hidden" name="document_id" value={doc.id} /><input type="hidden" name="back" value={back} />
              <button type="submit" disabled={!canReview || Number(doc.acceptable) === 0} title="Use only after reading the document against its claims">Accept all {doc.acceptable} quote-verified</button>
            </form></>} flush>
          <table>
            <thead><tr><th>Page</th><th>Subject</th><th className="num">As printed</th><th className="num">Normalised</th><th>Verbatim quote</th><th>Quote check</th><th>Status</th><th>Review</th></tr></thead>
            <tbody>
              {claims.filter((c) => c.source_document_id === doc.id).map((c) => <ClaimRow key={c.id} c={c} back={back} canReview={canReview} />)}
              {claims.length === 0 ? <Empty cols={8}>No claims.</Empty> : null}
            </tbody>
          </table>
        </Panel>))}
    </div>
  );
}
