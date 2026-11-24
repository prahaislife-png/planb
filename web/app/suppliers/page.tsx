import Link from 'next/link';
import { can, requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { date, humanize, inr, MISSING, num } from '@/lib/format';
import { Badge, Empty, Flash, OriginBadge, PageHead, Panel, Stat } from '@/components/ui';
import { addQuote, addSupplier, verifyQuote } from '@/app/actions/suppliers';

type Search = { ok?: string; error?: string };

const SUPPLIER_TYPES = ['manufacturer', 'authorised_dealer', 'trader', 'importer', 'service_provider', 'raw_material_supplier'];
const SUPPLIER_STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'info'> = {
  unverified: 'warn', contact_verified: 'info', gst_verified: 'good', site_verified: 'good', rejected: 'bad',
};
const QUOTE_STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'info'> = { requested: 'warn', received: 'info', verified: 'good', expired: 'warn', rejected: 'bad' };

export default async function Suppliers({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const d = await asUser(user.id, async (sql) => ({
    suppliers: await sql`
      select s.*, l.name as location_name,
             (select count(*) from intel.supplier_quotes q where q.supplier_id = s.id) as quote_count
      from intel.suppliers s left join intel.locations l on l.id = s.location_id
      order by s.name`,
    quotes: await sql`
      select q.*, s.name as supplier_name, ci.name as cost_item_name, m.slug as model_slug, m.name as model_name, dl.name as delivery_location,
             (select count(*) from intel.cost_observations o where o.supplier_quote_id = q.id) as observation_count
      from intel.supplier_quotes q
      join intel.suppliers s on s.id = q.supplier_id
      left join intel.cost_items ci on ci.id = q.cost_item_id
      left join intel.business_variants bv on bv.id = ci.business_variant_id
      left join intel.business_models m on m.id = bv.business_model_id
      left join intel.locations dl on dl.id = q.delivery_location_id
      order by q.quoted_on desc, q.created_at desc
      limit 500`,
    costItems: await sql`
      select ci.id, ci.name, bv.slug as variant_slug, m.name as model_name
      from intel.cost_items ci
      join intel.business_variants bv on bv.id = ci.business_variant_id
      join intel.business_models m on m.id = bv.business_model_id
      join intel.cost_categories cc on cc.id = ci.cost_category_id
      order by m.name, bv.slug, cc.sort_order, ci.name`,
    tasks: await sql`
      select t.id, t.title, t.description, t.status, t.priority, m.slug as model_slug, m.name as model_name
      from intel.research_tasks t left join intel.business_models m on m.id = t.business_model_id
      where t.task_type = 'obtain_supplier_quotes' and t.status in ('open', 'in_progress')
      order by t.priority, m.name nulls last, t.title`,
    locations: await sql`select id, name, location_type from intel.locations order by location_type, name`,
    units: await sql`select code from intel.units order by code`,
    source: await sql`
      select slug, name from intel.sources
      where slug in ('consented-supplier-quotations', 'supplier-quotations-consented') or source_type = 'primary_research'
      order by (slug = 'consented-supplier-quotations') desc, (slug = 'supplier-quotations-consented') desc, (slug like '%supplier%') desc, slug limit 1`,
  }));
  const editor = can(user, 'admin', 'researcher', 'reviewer');
  const reviewer = can(user, 'admin', 'reviewer');
  const today = new Date().toISOString().slice(0, 10);
  const models = [...new Set(d.costItems.map((c) => c.model_name as string))];
  const expired = d.quotes.filter((q) => q.valid_until && q.valid_until < today).length;

  return (
    <>
      <PageHead title="Suppliers & quotations"
        sub="Primary research: consented quotations collected from named suppliers. A verified quotation linked to a cost item becomes a cost observation beside the figures already on file — it never overwrites them." />
      <Flash params={sp} />
      <div className="notice">
        Supplier contact fields are private research data. A supplier is only ever shown to customers when <b>consent to list</b> is true,
        and a quotation can only be verified when the supplier gave <b>consent to use</b> it.
      </div>
      <div className="grid g4" style={{ marginBottom: 12 }}>
        <Stat label="Suppliers on file" value={d.suppliers.length} note={d.suppliers.length ? `${d.suppliers.filter((s) => s.consent_to_list).length} consented to listing` : 'no supplier has been contacted yet'} />
        <Stat label="Quotations collected" value={d.quotes.length} note={d.quotes.length ? `${d.quotes.filter((q) => q.status === 'verified').length} verified` : 'none collected yet'} />
        <Stat label="Past validity date" value={d.quotes.length ? expired : MISSING} tone={expired ? 'warn' : undefined} note="quotations whose valid-until date has passed" />
        <Stat label="Open quotation tasks" value={d.tasks.length} tone={d.tasks.length ? 'warn' : undefined} note="machines and materials still without a quotation" />
      </div>

      <div className="grid">
        <Panel title="Suppliers" right={<span className="muted">{d.suppliers.length} on file</span>} flush>
          <table>
            <thead><tr>
              <th>Supplier</th><th>Type</th><th>City / location</th><th>Categories</th><th>Contact (private)</th><th>Verification</th>
              <th>Consent to list</th><th className="num">Quotes</th><th>First contacted</th>
            </tr></thead>
            <tbody>
              {d.suppliers.length === 0 ? <Empty cols={9}>No supplier has been recorded yet. Primary supplier research has not started; add a supplier below once one has been contacted.</Empty> : null}
              {d.suppliers.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.name}</b> <OriginBadge origin={s.data_origin} />{s.gstin ? <div className="mono small faint">GSTIN {s.gstin}</div> : null}
                    {s.notes ? <div className="faint small">{s.notes}</div> : null}</td>
                  <td className="small">{humanize(s.supplier_type)}</td>
                  <td className="small">{s.city_text ?? s.location_name ?? MISSING}{s.city_text && s.location_name ? <div className="faint">{s.location_name}</div> : null}</td>
                  <td className="small">{s.categories.length ? s.categories.join(', ') : <span className="faint">{MISSING}</span>}</td>
                  <td className="small">{s.contact_name || s.contact_phone || s.contact_email
                    ? <>{s.contact_name ?? MISSING}<div className="faint mono">{[s.contact_phone, s.contact_email].filter(Boolean).join(' · ') || 'no phone or email recorded'}</div></>
                    : <span className="faint">not recorded</span>}</td>
                  <td><Badge value={s.verification_status} tone={SUPPLIER_STATUS_TONE[s.verification_status]} /></td>
                  <td>{s.consent_to_list ? <><Badge value="yes" /> <span className="mono small faint">{date(s.consent_recorded_on)}</span></> : <Badge value="no" tone="warn" title="Never shown to customers" />}</td>
                  <td className="num">{s.quote_count}</td>
                  <td className="mono small">{s.first_contacted_on ? date(s.first_contacted_on) : <span className="faint">not recorded</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Add a supplier">
          <form action={addSupplier}>
            <input type="hidden" name="back" value="/suppliers" />
            <div className="form-grid">
              <div><label>Supplier name</label><input name="name" required minLength={2} maxLength={200} /></div>
              <div><label>Type</label><select name="supplier_type" required>{SUPPLIER_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></div>
              <div><label>Location (geography tree)</label><select name="location_id"><option value="">— not recorded —</option>
                {d.locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.location_type})</option>)}</select></div>
              <div><label>City (as stated by supplier)</label><input name="city_text" maxLength={120} /></div>
              <div><label>Website</label><input name="website" type="url" placeholder="https://" maxLength={300} /></div>
              <div><label>Contact name (private)</label><input name="contact_name" maxLength={160} /></div>
              <div><label>Contact phone (private)</label><input name="contact_phone" maxLength={40} /></div>
              <div><label>Contact email (private)</label><input name="contact_email" type="email" maxLength={200} /></div>
              <div><label>GSTIN</label><input name="gstin" maxLength={15} className="mono" /></div>
              <div><label>Categories (comma separated)</label><input name="categories" maxLength={400} /></div>
              <div><label>First contacted on</label><input name="first_contacted_on" type="date" max={today} /></div>
              <div><label>Consent to list recorded on</label><input name="consent_recorded_on" type="date" max={today} /></div>
              <div style={{ gridColumn: 'span 2' }}><label>Notes</label><input name="notes" /></div>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <label className="row" style={{ margin: 0 }}><input type="checkbox" name="consent_to_list" /> supplier consented to be listed to customers</label>
              <button type="submit" disabled={!editor}>Add supplier</button>
              <span className="faint small">New suppliers start unverified. Leave unknown fields blank — nothing is guessed.</span>
            </div>
          </form>
        </Panel>

        <Panel title="Quotations" right={<span className="muted">{d.quotes.length} collected</span>} flush>
          <table>
            <thead><tr>
              <th>Supplier</th><th>Item</th><th>Model / spec</th><th>Capacity</th><th className="num">Price</th><th>GST</th><th>Install.</th><th>Freight</th>
              <th className="num">Warranty</th><th className="num">Lead time</th><th>Quoted on</th><th>Valid until</th><th>Collected</th><th>Consent to use</th><th>Status</th><th>Review</th>
            </tr></thead>
            <tbody>
              {d.quotes.length === 0 ? <Empty cols={16}>No supplier quotation has been collected yet. Machinery and material prices on file come from project reports only; see the open quotation tasks below.</Empty> : null}
              {d.quotes.map((q) => {
                const past = Boolean(q.valid_until && q.valid_until < today);
                return (
                  <tr key={q.id}>
                    <td>{q.supplier_name} <OriginBadge origin={q.data_origin} /></td>
                    <td>{q.item_description}
                      {q.cost_item_id
                        ? <div className="faint small">cost item: <Link href={`/business/${q.model_slug}?tab=costs`}>{q.cost_item_name}</Link> · {q.model_name}</div>
                        : <div className="faint small">not linked to a cost item</div>}
                      {q.analyst_notes ? <div className="faint small">{q.analyst_notes}</div> : null}</td>
                    <td className="small">{q.model_or_spec ?? MISSING}</td>
                    <td className="small">{q.capacity_value === null ? (q.capacity_unit ?? MISSING) : `${num(q.capacity_value, 2)} ${q.capacity_unit ?? ''}`}</td>
                    <td className="num">{q.currency === 'INR' ? inr(q.quoted_price) : `${q.currency} ${num(q.quoted_price, 2)}`}
                      <div className="faint small">for {num(q.quantity, 2)}{q.unit_code ? ` ${q.unit_code}` : ''}{q.quantity !== 1 && q.currency === 'INR' ? ` · ${inr(q.quoted_price / q.quantity)} each` : ''}</div></td>
                    <td className="small">{humanize(q.tax_treatment)}{q.tax_rate_pct === null ? <div className="faint">rate not stated</div> : <div className="faint">{num(q.tax_rate_pct, 2)}%</div>}</td>
                    <td className="small">{humanize(q.installation)}</td>
                    <td className="small">{q.freight_terms ?? MISSING}{q.delivery_location ? <div className="faint">to {q.delivery_location}</div> : null}</td>
                    <td className="num small">{q.warranty_months === null ? MISSING : `${q.warranty_months} mo`}</td>
                    <td className="num small">{q.lead_time_days === null ? MISSING : `${q.lead_time_days} d`}</td>
                    <td className="mono small">{date(q.quoted_on)}</td>
                    <td className="mono small">{q.valid_until ? date(q.valid_until) : <span className="faint">not stated</span>} {past ? <Badge value="EXPIRED" tone="bad" title="The validity date of this quotation has passed" /> : null}</td>
                    <td className="small">{humanize(q.collection_method)}</td>
                    <td>{q.consent_to_use ? <Badge value="yes" /> : <Badge value="no" tone="bad" title="Cannot be verified or used without consent" />}{q.consent_notes ? <div className="faint small">{q.consent_notes}</div> : null}</td>
                    <td><Badge value={q.status} tone={QUOTE_STATUS_TONE[q.status]} />{q.observation_count ? <div className="faint small">cost observation recorded</div> : null}</td>
                    <td>{q.status === 'received' ? (
                      <form action={verifyQuote} className="inline">
                        <input type="hidden" name="quote_id" value={q.id} /><input type="hidden" name="back" value="/suppliers" />
                        <button type="submit" className="good" disabled={!reviewer} title={reviewer ? 'Mark verified; creates a cost observation when linked to a cost item' : 'Reviewer or admin only'}>Verify</button>
                      </form>) : <span className="faint small">{q.verified_at ? `verified ${date(q.verified_at)}` : MISSING}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="body muted small">
            Verify is a reviewer act. A verified quotation linked to a cost item is stored as a cost observation (evidence type “supplier quote”, value = price ÷ quantity)
            at <b>grade C, unverified</b>, sourced to {d.source[0] ? <>“{d.source[0].name}”</> : <span className="badge bad">no primary-research source registered</span>}.
            Grade A needs a source document (the scanned quotation), which this form does not capture yet.
          </div>
        </Panel>

        <Panel title="Record a quotation">
          {d.suppliers.length === 0 ? <div className="notice warn">Add the supplier first: every quotation belongs to a supplier on file.</div> : null}
          <form action={addQuote}>
            <input type="hidden" name="back" value="/suppliers" />
            <div className="form-grid">
              <div><label>Supplier</label><select name="supplier_id" required defaultValue="">
                <option value="" disabled>— select —</option>{d.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div style={{ gridColumn: 'span 2' }}><label>Cost item it prices (optional)</label><select name="cost_item_id" defaultValue="">
                <option value="">— not linked to a business cost item —</option>
                {models.map((m) => (
                  <optgroup key={m} label={m}>
                    {d.costItems.filter((c) => c.model_name === m).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.variant_slug})</option>)}
                  </optgroup>))}
              </select></div>
              <div style={{ gridColumn: 'span 2' }}><label>Item quoted</label><input name="item_description" required minLength={3} maxLength={300} /></div>
              <div><label>Model / specification</label><input name="model_or_spec" maxLength={300} /></div>
              <div><label>Capacity (number)</label><input name="capacity_value" type="number" step="any" /></div>
              <div><label>Capacity unit (e.g. kg/hour)</label><input name="capacity_unit" maxLength={40} /></div>
              <div><label>Quoted price (₹, for the quantity)</label><input name="quoted_price" type="number" step="0.01" min="0" required /></div>
              <div><label>Quantity quoted</label><input name="quantity" type="number" step="any" min="0" defaultValue="1" required /></div>
              <div><label>Quantity unit</label><select name="unit_code" defaultValue=""><option value="">— not stated —</option>{d.units.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}</select></div>
              <div><label>GST treatment</label><select name="tax_treatment" defaultValue="unknown"><option value="unknown">Unknown</option><option value="exclusive">Excl. GST</option><option value="inclusive">Incl. GST</option><option value="not_applicable">n/a</option></select></div>
              <div><label>GST rate %</label><input name="tax_rate_pct" type="number" step="0.01" min="0" max="100" /></div>
              <div><label>Installation</label><select name="installation" defaultValue="unknown"><option value="unknown">Unknown</option><option value="included">Included</option><option value="excluded">Excluded</option><option value="not_applicable">n/a</option></select></div>
              <div><label>Freight terms</label><input name="freight_terms" maxLength={300} /></div>
              <div><label>Delivery location</label><select name="delivery_location_id" defaultValue=""><option value="">— not stated —</option>
                {d.locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.location_type})</option>)}</select></div>
              <div><label>Warranty (months)</label><input name="warranty_months" type="number" step="1" min="0" /></div>
              <div><label>Lead time (days)</label><input name="lead_time_days" type="number" step="1" min="0" /></div>
              <div><label>Payment terms</label><input name="payment_terms" maxLength={300} /></div>
              <div><label>Quoted on</label><input name="quoted_on" type="date" max={today} required /></div>
              <div><label>Valid until</label><input name="valid_until" type="date" /></div>
              <div><label>Collection method</label><select name="collection_method" required defaultValue="">
                <option value="" disabled>— select —</option><option value="written_quotation">Written quotation</option><option value="email">Email</option>
                <option value="phone">Phone</option><option value="in_person">In person</option><option value="supplier_portal">Supplier portal</option></select></div>
              <div style={{ gridColumn: 'span 2' }}><label>Consent notes (who agreed, how)</label><input name="consent_notes" /></div>
              <div style={{ gridColumn: 'span 2' }}><label>Analyst notes</label><input name="analyst_notes" /></div>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <label className="row" style={{ margin: 0 }}><input type="checkbox" name="consent_to_use" /> supplier consented to PlanB using this quotation</label>
              <button type="submit" disabled={!editor || d.suppliers.length === 0}>Record quotation</button>
              <span className="faint small">Stored as “received”. Enter only what the supplier stated; leave the rest blank.</span>
            </div>
          </form>
        </Panel>

        <Panel title="Open quotation tasks" right={<Link href="/tasks">all research tasks</Link>} flush>
          <table>
            <thead><tr><th>What to collect</th><th>Business</th><th>Why</th><th className="num">Pri</th><th>Status</th></tr></thead>
            <tbody>
              {d.tasks.length === 0 ? <Empty cols={5}>No open quotation task. Tasks appear here when a machine or material price has no supplier quotation behind it.</Empty> : null}
              {d.tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.title}</td>
                  <td>{t.model_slug ? <Link href={`/business/${t.model_slug}`}>{t.model_name}</Link> : <span className="faint">{MISSING}</span>}</td>
                  <td className="muted small">{t.description ?? MISSING}</td>
                  <td className="num">{t.priority}</td>
                  <td><Badge value={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="body muted small">
            Use the enquiry template at <span className="mono">research/templates/supplier_enquiry.md</span> when approaching a supplier: it asks for the
            specification, price basis, GST, installation, freight, warranty, validity and — explicitly — consent to use the quotation.
          </div>
        </Panel>
      </div>
    </>
  );
}
