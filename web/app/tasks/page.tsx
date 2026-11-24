import Link from 'next/link';
import { can, requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { humanize, num } from '@/lib/format';
import { Badge, Empty, Flash, OriginBadge, PageHead, Panel, Stat } from '@/components/ui';
import { createTask, updateTask } from '@/app/actions/research';

type Search = { status?: string; type?: string; priority?: string; business?: string; q?: string; ok?: string; error?: string };

// The CHECK list on intel.research_tasks.task_type (migration 0009).
const TASK_TYPES = [
  'obtain_supplier_quotes', 'confirm_local_rent', 'collect_local_price', 'verify_licence', 'interview_owner',
  'confirm_capacity', 'investigate_margin', 'resolve_conflict', 'revalidate_evidence', 'find_source_document',
  'review_claims', 'verify_source_terms', 'define_assumption', 'complete_record_section', 'ocr_document', 'other',
] as const;
const STATUS_FILTERS = [['open', 'Open (open · in progress · blocked)'], ['in_progress', 'In progress only'], ['blocked', 'Blocked only'],
  ['done', 'Closed (done · cancelled · auto-closed)'], ['all', 'All tasks']] as const;
const LIVE = ['open', 'in_progress', 'blocked'];
const LIMIT = 500;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export default async function Tasks({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const status = STATUS_FILTERS.some(([k]) => k === sp.status) ? str(sp.status) : 'open';
  const type = (TASK_TYPES as readonly string[]).includes(str(sp.type)) ? str(sp.type) : null;
  const priority = /^[1-4]$/.test(str(sp.priority)) ? Number(sp.priority) : null;
  const business = /^[a-z0-9-]{1,120}$/.test(str(sp.business)) ? str(sp.business) : null;
  const q = str(sp.q).trim().slice(0, 80);

  const { totals, tasks, taskModels, models } = await asUser(user.id, async (sql) => {
    const [totals] = await sql`
      select count(*) filter (where status = 'open') as open,
             count(*) filter (where status = 'in_progress') as in_progress,
             count(*) filter (where status = 'blocked') as blocked,
             count(*) filter (where status in ('open', 'in_progress', 'blocked') and requires_human) as human,
             count(*) filter (where status in ('open', 'in_progress', 'blocked') and priority = 1) as p1,
             count(*) filter (where status in ('open', 'in_progress', 'blocked')) as live,
             count(*) as total
      from intel.research_tasks`;
    const tasks = await sql`
      select t.id, t.title, t.description, t.instructions, t.template_key, t.task_type, t.priority, t.requires_human, t.status,
             t.generated_by, t.resolution_note, t.due_on, t.data_origin,
             coalesce(t.completed_at::date, current_date) - t.created_at::date as age_days,
             m.slug, m.name as model_name, bv.name as variant_name, a.display_name as assignee_name
      from intel.research_tasks t
      left join intel.business_models m on m.id = t.business_model_id
      left join intel.business_variants bv on bv.id = t.business_variant_id
      left join ops.staff_members a on a.user_id = t.assignee
      where (${status}::text = 'all'
             or (${status}::text = 'open' and t.status in ('open', 'in_progress', 'blocked'))
             or (${status}::text = 'done' and t.status in ('done', 'cancelled', 'auto_closed'))
             or t.status = ${status}::text)
        and (${type}::text is null or t.task_type = ${type})
        and (${priority}::int is null or t.priority = ${priority})
        and (${business}::text is null or m.slug = ${business})
        and (${q} = '' or t.title ilike ${'%' + q + '%'} or t.description ilike ${'%' + q + '%'} or t.instructions ilike ${'%' + q + '%'})
      order by (t.status in ('open', 'in_progress', 'blocked')) desc, t.priority, t.created_at, t.id
      limit ${LIMIT}`;
    const taskModels = await sql`
      select m.slug, m.name, count(*) as n from intel.research_tasks t join intel.business_models m on m.id = t.business_model_id
      group by m.slug, m.name order by m.name`;
    const models = await sql`select id, name, lifecycle_status from intel.business_models order by (lifecycle_status = 'backlog'), name`;
    return { totals, tasks, taskModels, models };
  });

  const editor = can(user, 'admin', 'researcher', 'reviewer');
  const query = new URLSearchParams();
  if (status !== 'open') query.set('status', status);
  if (type) query.set('type', type);
  if (priority) query.set('priority', String(priority));
  if (business) query.set('business', business);
  if (q) query.set('q', q);
  const back = `/tasks${query.size ? `?${query.toString()}` : ''}`;
  const filtered = query.size > 0;

  return (
    <>
      <PageHead title="Research tasks"
        sub="Work the pipeline cannot do by itself — quotations to obtain, rents to confirm, licences to verify, owners to interview — plus manually raised tasks. Gap analysis re-runs at the end of every research run and never duplicates a live task." />
      <Flash params={sp} />
      <div className="grid g6" style={{ marginBottom: 12 }}>
        <Stat label="Open" value={num(totals.open)} note="not started" tone={totals.open > 0 ? 'warn' : 'good'} />
        <Stat label="In progress" value={num(totals.in_progress)} note="claimed by an analyst" />
        <Stat label="Blocked" value={num(totals.blocked)} note="cannot proceed yet" tone={totals.blocked > 0 ? 'warn' : undefined} />
        <Stat label="Need a human" value={num(totals.human)} note={`of ${num(totals.live)} live tasks`} />
        <Stat label="Priority 1" value={num(totals.p1)} note="live tasks at P1" tone={totals.p1 > 0 ? 'bad' : 'good'} />
        <Stat label="All tasks" value={num(totals.total)} note={`${num(totals.total - totals.live)} closed`} />
      </div>

      <form method="get" className="row" style={{ marginBottom: 10 }}>
        <input name="q" placeholder="Search title, description, instructions" defaultValue={q} style={{ width: 260 }} />
        <select name="status" defaultValue={status} style={{ width: 250 }} aria-label="Status">
          {STATUS_FILTERS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select name="type" defaultValue={type ?? ''} style={{ width: 200 }} aria-label="Task type">
          <option value="">Any type</option>
          {TASK_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
        </select>
        <select name="priority" defaultValue={priority ? String(priority) : ''} style={{ width: 110 }} aria-label="Priority">
          <option value="">Any priority</option>
          {[1, 2, 3, 4].map((p) => <option key={p} value={p}>P{p}</option>)}
        </select>
        <select name="business" defaultValue={business ?? ''} style={{ width: 260 }} aria-label="Business model">
          <option value="">Any business model</option>
          {taskModels.map((m) => <option key={m.slug} value={m.slug}>{m.name} ({m.n})</option>)}
        </select>
        <button type="submit">Filter</button>
        <Link href="/tasks" className="small">reset</Link>
        <span className="muted small">{tasks.length === LIMIT ? `first ${LIMIT} tasks — narrow the filters to see the rest` : `${tasks.length} tasks`}</span>
      </form>

      <div style={{ marginBottom: 12 }}>
        <Panel title="Tasks" flush>
          <table>
            <thead><tr>
              <th className="num">Pri</th><th>Task</th><th>Type</th><th>Business model</th><th>Raised by</th><th>Needs</th>
              <th className="num" title="Days from creation until today, or until the task was closed">Age (days)</th><th>Status</th><th>Update</th>
            </tr></thead>
            <tbody>
              {tasks.length === 0 ? (
                <Empty cols={9}>{filtered
                  ? 'No task matches these filters.'
                  : 'No open tasks. Gap analysis raises tasks at the end of every research run; you can also create one below.'}</Empty>
              ) : null}
              {tasks.map((t) => (
                <tr key={t.id} style={LIVE.includes(t.status) ? undefined : { opacity: 0.55 }}>
                  <td className="num" style={t.priority === 1 && LIVE.includes(t.status) ? { color: 'var(--bad)' } : undefined}>P{t.priority}</td>
                  <td style={{ maxWidth: 520 }}>
                    <b>{t.title}</b> <OriginBadge origin={t.data_origin} />
                    {t.description ? <div className="muted small">{t.description}</div> : null}
                    {t.instructions ? <div className="faint small">How: {t.instructions}</div> : null}
                    {t.template_key ? <div className="faint small">Template: <span className="mono">research/templates/{t.template_key}.md</span></div> : null}
                    {t.due_on ? <div className="faint small">Due <span className="mono">{t.due_on}</span></div> : null}
                    {t.assignee_name ? <div className="faint small">Assigned to {t.assignee_name}</div> : null}
                    {t.resolution_note ? <div className="small">→ {t.resolution_note}</div> : null}
                  </td>
                  <td className="small"><Link href={`/tasks?type=${t.task_type}`}>{humanize(t.task_type)}</Link></td>
                  <td style={{ minWidth: 140 }}>
                    {t.slug ? <Link href={`/business/${t.slug}?tab=gaps`}>{t.model_name}</Link> : <span className="faint" title="Not tied to a business model">—</span>}
                    {t.variant_name ? <div className="faint small">{t.variant_name}</div> : null}
                  </td>
                  <td className="mono small faint">{String(t.generated_by).split(/(?<=[:.])/).map((part, i) => <span key={i}>{part}<wbr /></span>)}</td>
                  <td>{t.requires_human ? <Badge value="human" tone="info" /> : <Badge value="automatable" />}</td>
                  <td className="num">{t.age_days}</td>
                  <td><Badge value={t.status} /></td>
                  <td>
                    <form action={updateTask} className="inline">
                      <input type="hidden" name="task_id" value={t.id} /><input type="hidden" name="back" value={back} />
                      <select name="status" defaultValue={t.status === 'auto_closed' ? 'done' : t.status} style={{ width: 110 }} aria-label="New status">
                        <option value="open">Open</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option>
                        <option value="done">Done</option><option value="cancelled">Cancelled</option></select>
                      <input name="note" placeholder="note" style={{ width: 130 }} aria-label="Resolution note" />
                      <button type="submit" disabled={!editor}>Set</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel title="Create a task">
        <form action={createTask}>
          <input type="hidden" name="back" value={back} />
          <div className="form-grid">
            <div>
              <label htmlFor="task_type">Task type</label>
              <select id="task_type" name="task_type" defaultValue={type ?? 'other'}>
                {TASK_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="model_id">Business model (optional)</label>
              <select id="model_id" name="model_id" defaultValue="">
                <option value="">Not tied to a business model</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}{m.lifecycle_status === 'backlog' ? ' (backlog)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="priority">Priority</label>
              <select id="priority" name="priority" defaultValue="3">
                <option value="1">P1 (highest)</option><option value="2">P2</option>
                <option value="3">P3 (default)</option><option value="4">P4 (lowest)</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label htmlFor="title">Title</label>
            <input id="title" name="title" required minLength={5} maxLength={240} placeholder="What has to be done, in one line" />
          </div>
          <div style={{ marginTop: 8 }}>
            <label htmlFor="description">Description (optional)</label>
            <textarea id="description" name="description" maxLength={2000} placeholder="What evidence is needed and where it will be used" />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button type="submit" className="primary" disabled={!editor}>Create task</button>
            <span className="faint small">Recorded as raised manually by you. Manual tasks need a human by default.</span>
          </div>
        </form>
      </Panel>
    </>
  );
}
