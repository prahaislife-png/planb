import Link from 'next/link';
import { can, requireStaff } from '@/lib/auth';
import { asUser, type Row } from '@/lib/db';
import { date, humanize, inr, MISSING, num, valueWithUnit } from '@/lib/format';
import { Badge, Empty, Flash, Grade, OriginBadge, PageHead, Panel, Stat } from '@/components/ui';
import { addActual, addSubject, planInterview, recordConsent, saveResponses, updateInterviewStatus } from '@/app/actions/interviews';

type Search = { interview?: string; ok?: string; error?: string };

const STATUSES = ['planned', 'scheduled', 'conducted', 'transcribed', 'coded', 'reviewed', 'withdrawn'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_TYPES = ['money', 'number', 'percent', 'duration_months'];
const ANSWER_UNIT: Record<string, string> = { money: '₹', money_range: '₹', percent: '%', percent_range: '%', duration_months: 'months' };

function sections(questions: Row[]): [string, Row[]][] {
  const out: [string, Row[]][] = [];
  for (const q of questions) {
    const last = out[out.length - 1];
    if (last && last[0] === q.section) last[1].push(q);
    else out.push([q.section, [q]]);
  }
  return out;
}

function ConsentFlags({ c }: { c: Row }) {
  const flag = (on: boolean, label: string) => <span className={`badge ${on ? 'good' : ''}`} title={on ? 'Agreed' : 'Not agreed'}>{on ? '✓' : '✗'} {label}</span>;
  return (
    <span className="row" style={{ gap: 4 }}>
      {flag(c.allows_aggregate_use, 'aggregate use')}{flag(c.allows_anonymised_quotes, 'anon. quotes')}
      {flag(c.allows_document_retention, 'keep documents')}{flag(c.allows_recontact, 'recontact')}
    </span>
  );
}

function actualValue(a: Row) {
  if (a.value !== null) return valueWithUnit(a.value, a.unit_code, a.period);
  if (a.value_low !== null && a.value_high !== null) return `${valueWithUnit(a.value_low, a.unit_code)} – ${valueWithUnit(a.value_high, a.unit_code, a.period)}`;
  return MISSING;
}

export default async function Interviews({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const selectedId = sp.interview && UUID.test(sp.interview) ? sp.interview : null;
  const d = await asUser(user.id, async (sql) => ({
    // Row-level security returns only the subjects this user may see (admin: all; others: assigned to or created by them).
    subjects: await sql`
      select s.id, s.full_name, s.business_name, s.phone, s.email, s.referral_source, s.erased_at, s.created_at, st.display_name as interviewer_name
      from gt.interview_subjects s left join ops.staff_members st on st.user_id = s.assigned_interviewer
      order by s.created_at desc`,
    consents: await sql`
      select c.*, s.full_name from gt.consents c join gt.interview_subjects s on s.id = c.subject_id order by c.given_on desc, c.created_at desc`,
    interviews: await sql`
      select i.id, i.subject_id, i.consent_id, i.questionnaire_id, i.business_status, i.started_year, i.ended_year, i.years_operated, i.interview_date, i.interview_mode,
             i.status, i.anonymisation_status, i.data_origin, i.reviewed_at, i.created_at,
             m.name as model_name, m.slug as model_slug, l.name as location_name, l.location_type, q.title as questionnaire_title,
             st.display_name as interviewer_name,
             (select count(*) from gt.interview_responses r where r.interview_id = i.id) as response_count,
             (select count(*) from gt.business_actuals a where a.interview_id = i.id) as actual_count
      from gt.owner_interviews i
      join intel.business_models m on m.id = i.business_model_id
      left join intel.locations l on l.id = i.location_id
      left join gt.questionnaires q on q.id = i.questionnaire_id
      left join ops.staff_members st on st.user_id = i.interviewer
      order by i.created_at desc`,
    questionnaires: await sql`select id, key, version, title, audience from gt.questionnaires where is_active order by audience desc, key, version`,
    questions: await sql`select * from gt.questionnaire_questions order by questionnaire_id, sequence_no`,
    aggregate: await sql`
      select a.*, m.name as model_name, m.slug as model_slug, d.name as metric_name, d.unit_code, d.period
      from gt.v_actuals_aggregate a
      join intel.business_models m on m.id = a.business_model_id
      join intel.metric_definitions d on d.key = a.metric_key
      order by m.name, d.name, a.business_status`,
    models: await sql`select id, name, is_pilot from intel.business_models order by is_pilot desc, name`,
    locations: await sql`
      select id, name, location_type from intel.locations where location_type in ('country', 'state', 'division', 'district')
      order by array_position(array['district', 'division', 'state', 'country'], location_type), name`,
    actualDefs: await sql`select key, name, unit_code, period from intel.metric_definitions where applies_to = 'actuals' order by name`,
    selected: selectedId ? {
      responses: await sql`select * from gt.interview_responses where interview_id = ${selectedId}`,
      actuals: await sql`
        select a.*, d.name as metric_name from gt.business_actuals a join intel.metric_definitions d on d.key = a.metric_key
        where a.interview_id = ${selectedId} order by d.name, a.created_at`,
    } : null,
  }));
  const writer = can(user, 'admin', 'researcher'); // subjects, consents, interviews and answers are written by researchers
  const anyRole = can(user, 'admin', 'researcher', 'reviewer');
  const reviewer = can(user, 'admin', 'reviewer');
  const today = new Date().toISOString().slice(0, 10);
  const back = selectedId ? `/interviews?interview=${selectedId}` : '/interviews';

  const byStatus = (s: string) => d.interviews.filter((i) => i.status === s).length;
  const operating = d.interviews.filter((i) => i.business_status === 'operating' || i.business_status === 'paused').length;
  const former = d.interviews.filter((i) => i.business_status === 'closed' || i.business_status === 'sold').length;
  const consentsBySubject = new Map<string, Row[]>();
  for (const c of d.consents) consentsBySubject.set(c.subject_id, [...(consentsBySubject.get(c.subject_id) ?? []), c]);
  const selected = selectedId ? d.interviews.find((i) => i.id === selectedId) : undefined;
  const selectedQuestions = selected ? d.questions.filter((q) => q.questionnaire_id === selected.questionnaire_id) : [];
  const responseByQuestion = new Map<string, Row>((d.selected?.responses ?? []).map((r) => [r.question_id, r]));
  const activeSubjects = d.subjects.filter((s) => !s.erased_at);

  return (
    <>
      <PageHead title="PlanB Ground Truth"
        sub="Structured interviews with people who run — or ran — the business: what it actually cost, earned and demanded. Primary research; nothing here is estimated." />
      <Flash params={sp} />
      <div className="notice">
        <b>Privacy model.</b>
        <ul>
          <li>A person or business is identifiable in one place only: <span className="mono">gt.interview_subjects</span>, visible to admins and the assigned interviewer — not to other staff.</li>
          <li>Interviews, answers and actuals are de-identified: no names, and geography no finer than a district.</li>
          <li>Nothing is usable without recorded consent: an interview cannot be marked conducted without one, and aggregates only include interviews whose consent allows aggregate use and has not been withdrawn.</li>
          <li>Closed and sold businesses are wanted as much as operating ones — interviewing only survivors would overstate every figure.</li>
          <li>Figures leave this workspace only as aggregates over at least 5 reviewed interviews per business model, metric and business status.</li>
        </ul>
      </div>

      <div className="grid g6" style={{ marginBottom: 12 }}>
        <Stat label="Interviews" value={d.interviews.length} note={d.interviews.length ? 'all stages' : 'no interview has been planned yet'} />
        <Stat label="Planned / scheduled" value={byStatus('planned') + byStatus('scheduled')} note="not yet held" />
        <Stat label="Conducted → coded" value={byStatus('conducted') + byStatus('transcribed') + byStatus('coded')} note={`${byStatus('conducted')} conducted · ${byStatus('transcribed')} transcribed · ${byStatus('coded')} coded`} />
        <Stat label="Reviewed" value={byStatus('reviewed')} tone={byStatus('reviewed') >= 5 ? 'good' : undefined} note="only reviewed interviews count towards aggregates" />
        <Stat label="Operating vs closed / sold" value={`${operating} : ${former}`} tone={d.interviews.length > 0 && former === 0 ? 'warn' : undefined}
          note={d.interviews.length > 0 && former === 0 ? 'no closed or sold business yet — survivorship bias' : 'operating (incl. paused) : closed or sold'} />
        <Stat label="Withdrawn" value={byStatus('withdrawn')} note="consent withdrawn or subject erased" />
      </div>

      <div className="grid">
        <Panel title="Subjects — personal data" right={<span className="muted">{d.subjects.length} visible to you{can(user, 'admin') ? ' (admin: all)' : ' (assigned to or created by you)'}</span>} flush>
          <table>
            <thead><tr><th>Name</th><th>Business</th><th>Contact</th><th>Referral</th><th>Assigned interviewer</th><th>Consents on file</th><th>Erased</th></tr></thead>
            <tbody>
              {d.subjects.length === 0 ? <Empty cols={7}>No interview subject is visible to you. {can(user, 'admin') ? 'No owner has been recruited for an interview yet.' : 'Either no owner has been recruited yet, or none is assigned to you — other interviewers’ subjects are deliberately hidden.'}</Empty> : null}
              {d.subjects.map((s) => {
                const consents = consentsBySubject.get(s.id) ?? [];
                return (
                  <tr key={s.id} style={s.erased_at ? { opacity: 0.55 } : undefined}>
                    <td><b>{s.full_name}</b></td>
                    <td className="small">{s.business_name ?? <span className="faint">{MISSING}</span>}</td>
                    <td className="small mono">{[s.phone, s.email].filter(Boolean).join(' · ') || <span className="faint">not recorded</span>}</td>
                    <td className="small">{s.referral_source ?? <span className="faint">{MISSING}</span>}</td>
                    <td className="small">{s.interviewer_name ?? <span className="faint">unassigned</span>}</td>
                    <td>{consents.length === 0 ? <Badge value="no consent recorded" tone="bad" /> : consents.map((c) => (
                      <div key={c.id} className="row small" style={{ gap: 6, marginBottom: 2 }}>
                        <span className="mono">{date(c.given_on)}</span><span className="muted">form {c.consent_form_version} · {humanize(c.collection_method)}</span>
                        {c.withdrawn_on ? <Badge value={`withdrawn ${date(c.withdrawn_on)}`} tone="bad" /> : <ConsentFlags c={c} />}
                      </div>))}</td>
                    <td>{s.erased_at ? <Badge value={`erased ${date(s.erased_at)}`} tone="bad" /> : <span className="faint">{MISSING}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>

        <div className="grid g2">
          <Panel title="Add a subject">
            <form action={addSubject}>
              <input type="hidden" name="back" value={back} />
              <div className="form-grid">
                <div><label>Full name</label><input name="full_name" required minLength={2} maxLength={200} autoComplete="off" /></div>
                <div><label>Business name</label><input name="business_name" maxLength={200} autoComplete="off" /></div>
                <div><label>Phone</label><input name="phone" maxLength={40} autoComplete="off" /></div>
                <div><label>Email</label><input name="email" type="email" maxLength={200} autoComplete="off" /></div>
                <div style={{ gridColumn: 'span 2' }}><label>Referral source (how we reached them)</label><input name="referral_source" maxLength={300} /></div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button type="submit" disabled={!writer}>Add subject</button>
                <span className="faint small">You become the assigned interviewer. {writer ? 'Only you and admins will see this record.' : 'Researcher or admin only.'}</span>
              </div>
            </form>
          </Panel>

          <Panel title="Record a consent">
            <form action={recordConsent}>
              <input type="hidden" name="back" value={back} />
              <div className="form-grid">
                <div><label>Subject</label><select name="subject_id" required defaultValue="">
                  <option value="" disabled>— select —</option>{activeSubjects.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
                <div><label>Consent form version</label><input name="consent_form_version" required maxLength={40} /></div>
                <div><label>Given on</label><input name="given_on" type="date" max={today} required /></div>
                <div><label>Collection method</label><select name="collection_method" required defaultValue="">
                  <option value="" disabled>— select —</option><option value="signed_form">Signed form</option><option value="recorded_verbal">Recorded verbal</option>
                  <option value="email">Email</option><option value="digital_form">Digital form</option></select></div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <label className="row" style={{ margin: 0 }}><input type="checkbox" name="allows_aggregate_use" /> aggregate use</label>
                <label className="row" style={{ margin: 0 }}><input type="checkbox" name="allows_anonymised_quotes" /> anonymised quotes</label>
                <label className="row" style={{ margin: 0 }}><input type="checkbox" name="allows_document_retention" /> document retention</label>
                <label className="row" style={{ margin: 0 }}><input type="checkbox" name="allows_recontact" /> recontact</label>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button type="submit" disabled={!writer || activeSubjects.length === 0}>Record consent</button>
                <span className="faint small">Tick only what the person actually agreed to. Nothing is ticked by default.</span>
              </div>
            </form>
          </Panel>
        </div>

        <Panel title="Interviews — de-identified" right={<span className="muted">{d.interviews.length} interviews</span>} flush>
          <table>
            <thead><tr>
              <th>Business model</th><th>Location</th><th>Business status</th><th>Years</th><th>Interviewer</th><th>Instrument</th><th>Consent</th>
              <th className="num">Answers</th><th>Status</th><th>Anonymisation</th><th>Move on</th>
            </tr></thead>
            <tbody>
              {d.interviews.length === 0 ? <Empty cols={11}>No owner interview has been planned or conducted yet. Ground Truth is empty until the first consented interview is recorded.</Empty> : null}
              {d.interviews.map((i) => {
                const consents = (i.subject_id ? consentsBySubject.get(i.subject_id) : undefined) ?? [];
                return (
                  <tr key={i.id} style={selectedId === i.id ? { background: 'var(--panel-2)' } : i.status === 'withdrawn' ? { opacity: 0.55 } : undefined}>
                    <td><Link href={`/business/${i.model_slug}`}>{i.model_name}</Link> <OriginBadge origin={i.data_origin} />
                      <div className="small"><Link href={`/interviews?interview=${i.id}`}>{selectedId === i.id ? 'answers shown below' : 'capture answers'}</Link></div></td>
                    <td className="small">{i.location_name ?? <span className="faint">not recorded</span>}{i.location_type ? <div className="faint">{i.location_type} level</div> : null}</td>
                    <td><Badge value={i.business_status} tone={i.business_status === 'operating' ? 'good' : i.business_status === 'paused' ? 'warn' : 'info'} /></td>
                    <td className="small">{i.years_operated !== null ? `${num(i.years_operated, 1)} yrs` : <span className="faint">{MISSING}</span>}
                      {i.started_year ? <div className="faint mono">{i.started_year}–{i.ended_year ?? ''}</div> : null}</td>
                    <td className="small">{i.interviewer_name ?? <span className="faint">{MISSING}</span>}{i.interview_date ? <div className="faint mono">{date(i.interview_date)}{i.interview_mode ? ` · ${humanize(i.interview_mode).toLowerCase()}` : ''}</div> : <div className="faint">no date set</div>}</td>
                    <td className="small">{i.questionnaire_title ?? <span className="faint">{MISSING}</span>}</td>
                    <td>{i.consent_id ? <Badge value="on file" tone="good" /> : <Badge value="none attached" tone="bad" title="Cannot be recorded as conducted" />}</td>
                    <td className="num small">{i.response_count}<div className="faint">{i.actual_count} actuals</div></td>
                    <td><Badge value={i.status} tone={i.status === 'reviewed' ? 'good' : i.status === 'withdrawn' ? 'bad' : i.status === 'planned' || i.status === 'scheduled' ? 'warn' : 'info'} /></td>
                    <td><Badge value={i.anonymisation_status} tone={i.anonymisation_status === 'pending' ? 'warn' : 'good'} /></td>
                    <td>
                      <form action={updateInterviewStatus} className="inline">
                        <input type="hidden" name="interview_id" value={i.id} /><input type="hidden" name="back" value={back} />
                        <select name="status" defaultValue={i.status} style={{ width: 112 }} aria-label="Status">
                          {STATUSES.map((s) => <option key={s} value={s} disabled={s === 'reviewed' && !reviewer}>{humanize(s)}</option>)}</select>
                        <select name="anonymisation_status" defaultValue={i.anonymisation_status} style={{ width: 118 }} aria-label="Anonymisation">
                          <option value="pending">Anon. pending</option><option value="anonymised">Anonymised</option><option value="not_required">Not required</option></select>
                        <select name="consent_id" defaultValue="" style={{ width: 150 }} aria-label="Consent">
                          <option value="">{i.consent_id ? 'keep consent' : 'no consent'}</option>
                          {consents.filter((c) => !c.withdrawn_on).map((c) => <option key={c.id} value={c.id}>attach {date(c.given_on)} · form {c.consent_form_version}</option>)}</select>
                        <button type="submit" disabled={!anyRole}>Set</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="body muted small">
            The database rejects “conducted” (or any later stage) without a consent attached, and “reviewed” until anonymisation is done or recorded as not required;
            the refusal is shown at the top of the page. Marking “reviewed” is a reviewer act. Consents can be attached only by someone who may see the subject.
          </div>
        </Panel>

        <Panel title="Plan an interview">
          {activeSubjects.length === 0 ? <div className="notice warn">Add the subject first: an interview is planned for a person you (or an admin) can identify.</div> : null}
          <form action={planInterview}>
            <input type="hidden" name="back" value="/interviews" />
            <div className="form-grid">
              <div><label>Subject</label><select name="subject_id" required defaultValue="">
                <option value="" disabled>— select —</option>{activeSubjects.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
              <div><label>Consent (optional until conducted)</label><select name="consent_id" defaultValue="">
                <option value="">— none yet —</option>
                {d.consents.filter((c) => !c.withdrawn_on).map((c) => <option key={c.id} value={c.id}>{c.full_name} · {date(c.given_on)} · form {c.consent_form_version}</option>)}</select></div>
              <div><label>Business model</label><select name="business_model_id" required defaultValue="">
                <option value="" disabled>— select —</option>{d.models.map((m) => <option key={m.id} value={m.id}>{m.name}{m.is_pilot ? ' (pilot)' : ''}</option>)}</select></div>
              <div><label>Location (district or coarser)</label><select name="location_id" required defaultValue="">
                <option value="" disabled>— select —</option>{d.locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.location_type})</option>)}</select></div>
              <div><label>Business status</label><select name="business_status" required defaultValue="">
                <option value="" disabled>— select —</option><option value="operating">Operating</option><option value="paused">Paused</option>
                <option value="closed">Closed</option><option value="sold">Sold</option></select></div>
              <div><label>Questionnaire</label><select name="questionnaire_id" required defaultValue="">
                <option value="" disabled>— select —</option>{d.questionnaires.map((q) => <option key={q.id} value={q.id}>{q.title} (v{q.version})</option>)}</select></div>
              <div><label>Started (year)</label><input name="started_year" type="number" min="1950" max="2100" step="1" /></div>
              <div><label>Ended (year, if closed/sold)</label><input name="ended_year" type="number" min="1950" max="2100" step="1" /></div>
              <div><label>Years operated</label><input name="years_operated" type="number" min="0" step="0.1" /></div>
              <div><label>Interview date</label><input name="interview_date" type="date" /></div>
              <div><label>Mode</label><select name="interview_mode" defaultValue=""><option value="">— not decided —</option><option value="in_person">In person</option>
                <option value="phone">Phone</option><option value="video">Video</option><option value="written">Written</option></select></div>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="submit" disabled={!writer || activeSubjects.length === 0}>Plan interview</button>
              <span className="faint small">Cities are not offered: an interview is located at district level or coarser. Closed and sold businesses use the former-owner instrument.</span>
            </div>
          </form>
        </Panel>

        {selectedId && !selected ? <div className="notice bad">That interview does not exist.</div> : null}
        {selected ? (
          <>
            <Panel title={`Answers — ${selected.model_name} · ${selected.location_name ?? 'location not recorded'} · ${humanize(selected.business_status).toLowerCase()}`}
              right={<><Badge value={selected.status} /> <Link href="/interviews">close</Link></>} flush>
              {!selected.consent_id ? <div className="body"><div className="notice bad" style={{ margin: 0 }}>No consent is attached to this interview, so no answer can be saved. Record the consent and attach it in the interviews table first.</div></div> : null}
              {selectedQuestions.length === 0 ? <div className="body muted">This interview has no questionnaire.</div> : (
                <form action={saveResponses}>
                  <input type="hidden" name="interview_id" value={selected.id} /><input type="hidden" name="back" value={back} />
                  <table>
                    <thead><tr><th style={{ width: '38%' }}>Question</th><th style={{ width: '34%' }}>Answer</th><th>Analyst note</th></tr></thead>
                    <tbody>
                      {sections(selectedQuestions).flatMap(([section, qs]) => [
                        <tr key={`s-${section}`} className="total"><td colSpan={3} className="muted">{humanize(section)}</td></tr>,
                        ...qs.map((q) => {
                          const r = responseByQuestion.get(q.id);
                          const unit = ANSWER_UNIT[q.answer_type];
                          return (
                            <tr key={q.id}>
                              <td>{q.prompt} {q.is_sensitive ? <Badge value="sensitive" tone="warn" title="Ask with care; the owner may decline" /> : null}
                                {q.metric_key ? <> <span className="badge info" title="A numeric answer is also stored as a self-reported actual">actual: {q.metric_key}</span></> : null}
                                {q.guidance ? <div className="faint small">{q.guidance}</div> : null}</td>
                              <td>
                                {String(q.answer_type).endsWith('_range') ? (
                                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                                    <input name={`low_${q.id}`} type="number" step="any" placeholder="low" defaultValue={r?.answer_low ?? ''} aria-label={`${q.key} low`} />
                                    <span className="muted">to</span>
                                    <input name={`high_${q.id}`} type="number" step="any" placeholder="high" defaultValue={r?.answer_high ?? ''} aria-label={`${q.key} high`} />
                                    <span className="muted small">{unit ?? ''}</span>
                                  </div>
                                ) : NUMERIC_TYPES.includes(q.answer_type) ? (
                                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                                    <input name={`num_${q.id}`} type="number" step="any" defaultValue={r?.answer_numeric ?? ''} aria-label={q.key} />
                                    <span className="muted small">{unit ?? ''}</span>
                                  </div>
                                ) : q.answer_type === 'boolean' ? (
                                  <select name={`txt_${q.id}`} defaultValue={r?.answer_text ?? ''} aria-label={q.key}><option value="">— not answered —</option><option value="yes">Yes</option><option value="no">No</option></select>
                                ) : q.answer_type === 'choice' && q.choices?.length ? (
                                  <select name={`txt_${q.id}`} defaultValue={r?.answer_text ?? ''} aria-label={q.key}><option value="">— not answered —</option>
                                    {q.choices.map((c: string) => <option key={c} value={c}>{c}</option>)}</select>
                                ) : (
                                  <textarea name={`txt_${q.id}`} defaultValue={r?.answer_text ?? ''} maxLength={8000} aria-label={q.key} />
                                )}
                              </td>
                              <td><input name={`note_${q.id}`} defaultValue={r?.analyst_note ?? ''} maxLength={2000} aria-label={`${q.key} note`} /></td>
                            </tr>
                          );
                        }),
                      ])}
                    </tbody>
                  </table>
                  <div className="body row">
                    <button type="submit" className="primary" disabled={!writer || !selected.consent_id}>Save answers</button>
                    <span className="faint small">Unanswered questions stay unanswered — a blank is never stored as zero. Money in rupees (never lakh). Do not type names or addresses into answers.
                      A numeric answer to an “actual” question is also stored as a self-reported actual, grade C.</span>
                  </div>
                </form>
              )}
            </Panel>

            <Panel title="Actuals recorded for this interview" right={<span className="muted">{d.selected?.actuals.length ?? 0} figures</span>} flush>
              <table>
                <thead><tr><th>Metric</th><th className="num">Value</th><th>Reference year</th><th>Evidence level</th><th>Supporting document</th><th>Status</th><th>Grade</th><th>Notes</th></tr></thead>
                <tbody>
                  {(d.selected?.actuals.length ?? 0) === 0 ? <Empty cols={8}>No actual figure has been recorded for this interview yet.</Empty> : null}
                  {(d.selected?.actuals ?? []).map((a) => (
                    <tr key={a.id}>
                      <td>{a.metric_name} <OriginBadge origin={a.data_origin} /></td>
                      <td className="num">{actualValue(a)}</td>
                      <td className="mono small">{a.reference_year ?? <span className="faint">{MISSING}</span>}</td>
                      <td><Badge value={a.evidence_level} tone={a.evidence_level === 'documented' ? 'good' : 'warn'} /></td>
                      <td className="mono small">{a.supporting_document_path ?? <span className="faint">none</span>}</td>
                      <td><Badge value={a.verification_status} /></td>
                      <td><Grade grade={a.evidence_grade} /></td>
                      <td className="small muted">{a.analyst_notes ?? MISSING}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="body">
                <form action={addActual}>
                  <input type="hidden" name="interview_id" value={selected.id} /><input type="hidden" name="back" value={back} />
                  <div className="form-grid">
                    <div><label>Metric</label><select name="metric_key" required defaultValue="">
                      <option value="" disabled>— select —</option>{d.actualDefs.map((m) => <option key={m.key} value={m.key}>{m.name} [{m.unit_code ?? 'no unit'}]</option>)}</select></div>
                    <div><label>Value</label><input name="value" type="number" step="any" /></div>
                    <div><label>…or low</label><input name="value_low" type="number" step="any" /></div>
                    <div><label>…and high</label><input name="value_high" type="number" step="any" /></div>
                    <div><label>Reference year</label><input name="reference_year" type="number" min="1950" max="2100" step="1" /></div>
                    <div><label>Evidence level</label><select name="evidence_level" defaultValue="documented">
                      <option value="documented">Documented (bill, statement, sanction letter)</option><option value="self_reported">Self-reported</option></select></div>
                    <div><label>Supporting document path</label><input name="supporting_document_path" maxLength={500} className="mono" placeholder="required when documented" /></div>
                    <div><label>Grade</label><select name="evidence_grade" defaultValue="C">
                      <option value="B">B (documented only)</option><option value="C">C</option><option value="D">D</option></select></div>
                    <div style={{ gridColumn: 'span 2' }}><label>Analyst notes (what the document is, without naming the person)</label><input name="analyst_notes" /></div>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button type="submit" disabled={!writer || !selected.consent_id}>Add actual</button>
                    <span className="faint small">Database rules: a documented actual must point at its document; a self-reported figure can never be grade A or B; grade A exists only for verified actuals.</span>
                  </div>
                </form>
              </div>
            </Panel>
          </>
        ) : null}

        <Panel title="Aggregated actuals (k-anonymous)" right={<span className="muted">released only at 5 or more interviews per cell</span>} flush>
          <table>
            <thead><tr><th>Business model</th><th>Metric</th><th>Business status</th><th className="num">Interviews</th><th className="num">P25</th><th className="num">Median</th><th className="num">P75</th><th className="num">Documented</th></tr></thead>
            <tbody>
              {d.aggregate.length === 0 ? (
                <Empty cols={8}>
                  No aggregate can be shown. A cell (business model × metric × business status) is released only when at least 5 reviewed interviews with active
                  aggregate-use consent contribute to it; with {byStatus('reviewed')} reviewed interview{byStatus('reviewed') === 1 ? '' : 's'} on file, none qualifies.
                </Empty>) : null}
              {d.aggregate.map((a) => (
                <tr key={`${a.business_model_id}-${a.metric_key}-${a.business_status}`}>
                  <td><Link href={`/business/${a.model_slug}`}>{a.model_name}</Link></td>
                  <td>{a.metric_name}</td>
                  <td><Badge value={a.business_status} /></td>
                  <td className="num">{a.interview_count}</td>
                  <td className="num">{a.unit_code === 'inr' ? inr(a.p25) : num(a.p25, 1)}</td>
                  <td className="num"><b>{a.unit_code === 'inr' ? inr(a.median) : num(a.median, 1)}</b></td>
                  <td className="num">{a.unit_code === 'inr' ? inr(a.p75) : num(a.p75, 1)}</td>
                  <td className="num">{a.documented_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="body muted small">
            Why the threshold: with fewer than 5 owners in a cell, a quartile could be traced back to one person. Minimum and maximum are never shown for the same reason.
            Demo data, rejected figures and interviews whose consent was withdrawn are excluded by the database view itself.
          </div>
        </Panel>

        <div className="grid g2">
          {d.questionnaires.map((qn) => {
            const qs = d.questions.filter((q) => q.questionnaire_id === qn.id);
            return (
              <Panel key={qn.id} title={`Interviewer's script — ${qn.title}`} right={<span className="muted">{humanize(qn.audience)} · v{qn.version} · {qs.length} questions</span>} flush>
                <table>
                  <thead><tr><th className="num" style={{ width: 34 }}>#</th><th>Prompt and guidance</th><th style={{ width: 120 }}>Answer type</th></tr></thead>
                  <tbody>
                    {qs.length === 0 ? <Empty cols={3}>This questionnaire has no questions.</Empty> : null}
                    {sections(qs).flatMap(([section, list]) => [
                      <tr key={`s-${section}`} className="total"><td colSpan={3} className="muted">{humanize(section)}</td></tr>,
                      ...list.map((q) => (
                        <tr key={q.id}>
                          <td className="num mono small faint">{q.sequence_no}</td>
                          <td>{q.prompt} {q.is_sensitive ? <Badge value="sensitive" tone="warn" title="Ask with care; the owner may decline" /> : null}
                            {q.guidance ? <div className="faint small">{q.guidance}</div> : null}</td>
                          <td className="small">{humanize(q.answer_type)}{q.metric_key ? <div className="faint mono">{q.metric_key}</div> : null}</td>
                        </tr>
                      )),
                    ])}
                  </tbody>
                </table>
              </Panel>
            );
          })}
        </div>
        {d.questionnaires.length === 0 ? <div className="notice warn">No active questionnaire is defined.</div> : null}
      </div>
    </>
  );
}
