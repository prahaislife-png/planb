import Link from 'next/link';
import { can, requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { num } from '@/lib/format';
import { Empty, PageHead, Panel } from '@/components/ui';

type Search = { schema?: string; table?: string; action?: string; actor?: string; row?: string; from?: string; to?: string; before?: string };

const PAGE = 100;
const VALUE_CHARS = 400; // values are cut to this length in SQL so one page stays a reasonable size
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ACTIONS = ['INSERT', 'UPDATE', 'DELETE'] as const;
const ACTION_TONE: Record<string, string> = { INSERT: 'good', UPDATE: 'info', DELETE: 'bad' };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isDay = (v: string): boolean => DAY.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

function Value({ value }: { value: string | null | undefined }) {
  if (value === null || value === undefined) return <span className="faint">null</span>;
  if (value === '') return <span className="faint">(empty)</span>;
  return <span className="mono small wrap">{value}{value.length >= VALUE_CHARS ? <span className="faint"> … (truncated)</span> : null}</span>;
}

export default async function Audit({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const schema = IDENT.test(str(sp.schema)) ? str(sp.schema) : null;
  const table = IDENT.test(str(sp.table)) ? str(sp.table) : null;
  const action = (ACTIONS as readonly string[]).includes(str(sp.action)) ? str(sp.action) : null;
  const actorRaw = str(sp.actor);
  const actorUser = UUID.test(actorRaw) ? actorRaw : null;
  const actorRole = actorRaw.startsWith('role:') && IDENT.test(actorRaw.slice(5)) ? actorRaw.slice(5) : null;
  const row = str(sp.row).slice(0, 80) || null;
  const from = isDay(str(sp.from)) ? str(sp.from) : null;
  const to = isDay(str(sp.to)) ? str(sp.to) : null;
  const before = /^\d{1,15}$/.test(str(sp.before)) ? Number(sp.before) : null;
  const allowed = can(user, 'admin', 'reviewer');

  const d = await asUser(user.id, async (sql) => {
    const rows = await sql`
      select a.id, a.occurred_at, a.schema_name, a.table_name, a.row_id, a.action, a.actor_user_id, a.actor_db_role, a.research_run_id,
             a.changed_fields, st.display_name as actor_name,
             (a.old_row is null and a.new_row is null) as redacted,
             case when a.action = 'UPDATE' and a.old_row is not null and a.new_row is not null then
               (select jsonb_object_agg(k, jsonb_build_array(left(a.old_row ->> k, ${VALUE_CHARS}), left(a.new_row ->> k, ${VALUE_CHARS})))
                from unnest(a.changed_fields) k) end as diff,
             case when a.action <> 'UPDATE' and coalesce(a.new_row, a.old_row) is not null then
               (select jsonb_object_agg(e.key, left(e.value, ${VALUE_CHARS}))
                from jsonb_each_text(coalesce(a.new_row, a.old_row)) e where e.value is not null) end as snapshot
      from ops.audit_log a
      left join ops.staff_members st on st.user_id = a.actor_user_id
      where (${schema}::text is null or a.schema_name = ${schema})
        and (${table}::text is null or a.table_name = ${table})
        and (${action}::text is null or a.action = ${action})
        and (${actorUser}::uuid is null or a.actor_user_id = ${actorUser}::uuid)
        and (${actorRole}::text is null or (a.actor_db_role = ${actorRole} and a.actor_user_id is null))
        and (${row}::text is null or a.row_id = ${row} or a.row_id like ${(row ?? '').replace(/[\\%_]/g, '\\$&') + '%'})
        and (${from}::date is null or a.occurred_at >= ${from}::date)
        and (${to}::date is null or a.occurred_at < ${to}::date + 1)
        and (${before}::bigint is null or a.id < ${before}::bigint)
      order by a.id desc
      limit ${PAGE + 1}`;
    const tables = await sql`select distinct schema_name, table_name from ops.audit_log order by 1, 2`;
    const roles = await sql`select distinct actor_db_role from ops.audit_log where actor_user_id is null order by 1`;
    const staff = await sql`select user_id, display_name from ops.staff_members order by display_name`;
    return { rows, tables, roles, staff };
  });

  const hasMore = d.rows.length > PAGE;
  const rows = d.rows.slice(0, PAGE);
  const schemas = [...new Set(d.tables.map((t) => t.schema_name as string))];
  const tableNames = [...new Set(d.tables.filter((t) => !schema || t.schema_name === schema).map((t) => t.table_name as string))].sort();
  const filters = new URLSearchParams();
  if (schema) filters.set('schema', schema);
  if (table) filters.set('table', table);
  if (action) filters.set('action', action);
  if (actorUser) filters.set('actor', actorUser);
  if (actorRole) filters.set('actor', `role:${actorRole}`);
  if (row) filters.set('row', row);
  if (from) filters.set('from', from);
  if (to) filters.set('to', to);
  const filtered = filters.size > 0;
  const firstHref = `/audit${filtered ? `?${filters.toString()}` : ''}`;
  const older = new URLSearchParams(filters);
  if (hasMore) older.set('before', String(rows[rows.length - 1].id));
  const rowHref = (r: { schema_name: string; table_name: string; row_id: string }) =>
    `/audit?${new URLSearchParams({ schema: r.schema_name, table: r.table_name, row: r.row_id }).toString()}`;

  return (
    <>
      <PageHead title="Audit history"
        sub="Append-only, row-level trail of every change to research, ground-truth, publication and customer records, written by database triggers. It cannot be edited or deleted — not by an admin either." />
      {!allowed ? (
        <div className="notice warn">
          <b>The audit trail is visible to reviewers and admins.</b> You are signed in as {user.roles.join(', ')}, so the database returns no audit rows to you — the table below is empty for that reason, not because nothing was changed.
        </div>
      ) : null}

      <form method="get" className="row" style={{ marginBottom: 10 }}>
        <select name="schema" defaultValue={schema ?? ''} style={{ width: 130 }} aria-label="Schema">
          <option value="">Any schema</option>
          {schemas.map((s) => <option key={s} value={s}>{s}</option>)}
          {schema && !schemas.includes(schema) ? <option value={schema}>{schema}</option> : null}
        </select>
        <select name="table" defaultValue={table ?? ''} style={{ width: 230 }} aria-label="Table">
          <option value="">Any table</option>
          {tableNames.map((t) => <option key={t} value={t}>{t}</option>)}
          {table && !tableNames.includes(table) ? <option value={table}>{table}</option> : null}
        </select>
        <select name="action" defaultValue={action ?? ''} style={{ width: 120 }} aria-label="Action">
          <option value="">Any action</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select name="actor" defaultValue={actorUser ?? (actorRole ? `role:${actorRole}` : '')} style={{ width: 220 }} aria-label="Actor">
          <option value="">Any actor</option>
          <optgroup label="Staff">
            {d.staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.display_name}</option>)}
          </optgroup>
          <optgroup label="Database role (no signed-in user)">
            {d.roles.map((r) => <option key={r.actor_db_role} value={`role:${r.actor_db_role}`}>{r.actor_db_role}</option>)}
            {actorRole && !d.roles.some((r) => r.actor_db_role === actorRole) ? <option value={`role:${actorRole}`}>{actorRole}</option> : null}
          </optgroup>
        </select>
        <input name="row" placeholder="Row id (or its first characters)" defaultValue={row ?? ''} style={{ width: 250 }} className="mono" aria-label="Row id" />
        <span className="muted small">from</span>
        <input type="date" name="from" defaultValue={from ?? ''} style={{ width: 140 }} aria-label="From date (UTC)" />
        <span className="muted small">to</span>
        <input type="date" name="to" defaultValue={to ?? ''} style={{ width: 140 }} aria-label="To date (UTC), inclusive" />
        <button type="submit">Filter</button>
        <Link href="/audit" className="small">reset</Link>
      </form>

      <Panel
        title={`Changes, newest first${before ? ` · older than entry ${before}` : ''}`}
        right={<>
          <span className="muted">{rows.length === 0 ? 'no entries' : `${rows.length} entries · #${rows[0].id} – #${rows[rows.length - 1].id}`}</span>
          {before ? <Link href={firstHref}>← newest</Link> : null}
          {hasMore ? <Link href={`/audit?${older.toString()}`}>older →</Link> : null}
        </>} flush>
        <table>
          <thead><tr>
            <th>Time (UTC)</th><th>Actor</th><th>DB role</th><th>Action</th><th>Table</th><th>Row id</th><th style={{ width: '34%' }}>Changed fields</th><th>Research run</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <Empty cols={8}>{!allowed
                ? 'The audit trail is visible to reviewers and admins only; the database returned no rows for your role.'
                : before && !filtered ? 'There are no older audit entries.'
                : filtered ? 'No audit entry matches these filters.'
                : 'Nothing has been recorded in the audit trail yet.'}</Empty>
            ) : null}
            {rows.map((r) => {
              const fields: string[] = r.changed_fields ?? [];
              return (
                <tr key={r.id}>
                  <td className="mono small nowrap" title={`entry #${r.id}`}>{new Date(r.occurred_at).toISOString().slice(0, 19).replace('T', ' ')}</td>
                  <td>{r.actor_name ?? (r.actor_user_id
                    ? <span className="mono small" title="A user who is not (or no longer) a staff member">{String(r.actor_user_id).slice(0, 8)}…</span>
                    : <span className="mono small muted" title="No signed-in user: a worker, a migration or a database session">{r.actor_db_role}</span>)}</td>
                  <td className="mono small faint">{r.actor_db_role}</td>
                  <td><span className={`badge ${ACTION_TONE[r.action] ?? ''}`}>{r.action}</span></td>
                  <td className="mono small"><span className="faint">{r.schema_name}.</span>{r.table_name}</td>
                  <td className="mono small">{r.row_id
                    ? <Link href={rowHref(r as unknown as { schema_name: string; table_name: string; row_id: string })} title={`${r.row_id} — show the history of this row`}>{r.row_id.length > 13 ? `${r.row_id.slice(0, 13)}…` : r.row_id}</Link>
                    : <span className="faint" title="This table has no id column">—</span>}</td>
                  <td>
                    <details>
                      <summary>
                        {r.action === 'UPDATE'
                          ? <span className="mono">{fields.length > 6 ? `${fields.slice(0, 6).join(', ')} +${fields.length - 6} more` : fields.join(', ')}</span>
                          : r.action === 'INSERT' ? 'new row' : 'row deleted'}
                      </summary>
                      {r.redacted ? (
                        <div className="muted small">Values withheld (personal data). The audit trail records that this change happened{fields.length ? ' and which fields changed' : ''}, but never copies personal data.</div>
                      ) : r.action === 'UPDATE' && r.diff ? (
                        <dl className="kv small" style={{ gridTemplateColumns: 'max-content minmax(0, 1fr)', margin: 0 }}>
                          {fields.map((f) => (
                            <FieldDiff key={f} name={f} pair={(r.diff as Record<string, [string | null, string | null]>)[f]} />
                          ))}
                        </dl>
                      ) : r.snapshot ? (
                        <>
                          <div className="faint small" style={{ marginBottom: 4 }}>{r.action === 'INSERT' ? 'Row as inserted' : 'Row as it was when deleted'} (fields with a value; {num(Object.keys(r.snapshot).length)} shown)</div>
                          <dl className="kv small" style={{ gridTemplateColumns: 'max-content minmax(0, 1fr)', margin: 0 }}>
                            {Object.entries(r.snapshot as Record<string, string>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
                              <div key={k} style={{ display: 'contents' }}><dt className="mono">{k}</dt><dd><Value value={v} /></dd></div>
                            ))}
                          </dl>
                        </>
                      ) : <div className="faint small">No values were recorded for this entry.</div>}
                    </details>
                  </td>
                  <td>{r.research_run_id
                    ? <Link href={`/runs/${r.research_run_id}`} className="mono small" title={r.research_run_id}>{String(r.research_run_id).slice(0, 8)}</Link>
                    : <span className="faint" title="Not made inside a research run">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
      <div className="row" style={{ marginTop: 10 }}>
        {before ? <Link href={firstHref} className="btn">← Newest</Link> : null}
        {hasMore ? <Link href={`/audit?${older.toString()}`} className="btn">Older {PAGE} →</Link> : null}
        <span className="faint small">
          {PAGE} entries per page. High-volume machine tables (document text, run logs, ingestion log, LLM usage) are append-only logs themselves and are not audited row by row.
        </span>
      </div>
    </>
  );
}

function FieldDiff({ name, pair }: { name: string; pair: [string | null, string | null] | undefined }) {
  return (
    <div style={{ display: 'contents' }}>
      <dt className="mono">{name}</dt>
      <dd>
        <div><span className="faint small">old </span><Value value={pair?.[0]} /></div>
        <div><span className="faint small">new </span><Value value={pair?.[1]} /></div>
      </dd>
    </div>
  );
}
