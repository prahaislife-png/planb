import { can, type StaffUser } from '@/lib/auth';
import { asUser, type Row } from '@/lib/db';
import { date, humanize } from '@/lib/format';
import { Badge, Empty, Panel } from '@/components/ui';
import { updateTask } from '@/app/actions/research';

export async function GapsTab({ user, model, back }: { user: StaffUser; model: Row; back: string }) {
  const { tasks, missing } = await asUser(user.id, async (sql) => ({
    tasks: await sql`
      select t.*, bv.name as variant_name from intel.research_tasks t left join intel.business_variants bv on bv.id = t.business_variant_id
      where t.business_model_id = ${model.id}
      order by (t.status in ('open', 'in_progress', 'blocked')) desc, t.priority, t.created_at limit 300`,
    missing: await sql`select * from intel.v_completeness_items where business_model_id = ${model.id} and not is_satisfied order by is_critical desc, section`,
  }));
  const editor = can(user, 'admin', 'researcher', 'reviewer');
  const open = tasks.filter((t) => ['open', 'in_progress', 'blocked'].includes(t.status));

  return (
    <div className="grid">
      <Panel title={`What is missing (${missing.length})`} flush>
        <table>
          <thead><tr><th>Section</th><th>Missing</th><th>Severity</th></tr></thead>
          <tbody>
            {missing.length === 0 ? <Empty cols={3}>Every completeness check is satisfied.</Empty> : null}
            {missing.map((m) => <tr key={m.check_key}><td className="muted">{humanize(m.section)}</td><td>{m.label}</td><td>{m.is_critical ? <Badge value="critical" tone="bad" /> : <Badge value="gap" tone="warn" />}</td></tr>)}
          </tbody>
        </table>
      </Panel>
      <Panel title={`Research tasks (${open.length} open of ${tasks.length})`} flush>
        <table>
          <thead><tr><th className="num">Pri</th><th>Task</th><th>Type</th><th>Raised by</th><th>Needs</th><th>Created</th><th>Status</th><th>Update</th></tr></thead>
          <tbody>
            {tasks.length === 0 ? <Empty cols={8}>No tasks. Gap analysis runs at the end of every research run.</Empty> : null}
            {tasks.map((t) => (
              <tr key={t.id} style={['open', 'in_progress', 'blocked'].includes(t.status) ? undefined : { opacity: 0.55 }}>
                <td className="num">P{t.priority}</td>
                <td style={{ maxWidth: 520 }}><b>{t.title}</b>
                  {t.description ? <div className="muted small">{t.description}</div> : null}
                  {t.instructions ? <div className="faint small">How: {t.instructions}</div> : null}
                  {t.template_key ? <div className="faint small">Template: <span className="mono">research/templates/{t.template_key}.md</span></div> : null}
                  {t.resolution_note ? <div className="small">→ {t.resolution_note}</div> : null}</td>
                <td className="small">{humanize(t.task_type)}</td>
                <td className="mono small faint">{t.generated_by}</td>
                <td>{t.requires_human ? <Badge value="human" tone="info" /> : <Badge value="automatable" />}</td>
                <td className="mono small">{date(t.created_at)}</td>
                <td><Badge value={t.status} /></td>
                <td>
                  <form action={updateTask} className="inline">
                    <input type="hidden" name="task_id" value={t.id} /><input type="hidden" name="back" value={back} />
                    <select name="status" defaultValue={t.status === 'auto_closed' ? 'done' : t.status} style={{ width: 110 }}>
                      <option value="open">Open</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option>
                      <option value="done">Done</option><option value="cancelled">Cancelled</option></select>
                    <input name="note" placeholder="note" style={{ width: 130 }} />
                    <button type="submit" disabled={!editor}>Set</button>
                  </form>
                </td>
              </tr>))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
