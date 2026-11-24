import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DEV_USERS, getStaffUser } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { Nav, type NavCounts } from '@/components/nav';
import { switchDevUser } from './actions/session';
import './globals.css';

export const metadata: Metadata = {
  title: 'PlanB Intelligence',
  description: 'Internal research operating system',
  robots: { index: false, follow: false },
};

async function navCounts(userId: string): Promise<NavCounts> {
  const [row] = await asUser(userId, (sql) => sql`
    select
      (select count(*) from intel.evidence_claims where status = 'extracted')
        + (select count(*) from intel.business_versions where status = 'submitted') as review,
      (select count(*) from intel.research_tasks where status in ('open', 'in_progress', 'blocked')) as tasks,
      (select count(*) from ops.research_runs where status in ('queued', 'running', 'waiting_retry')) as runs,
      (select count(*) from intel.v_freshness_queue where days_overdue > 0) as stale,
      (select count(*) from intel.observation_conflicts where status = 'open') as conflicts`);
  return row as unknown as NavCounts;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getStaffUser();
  const counts = user ? await navCounts(user.id) : { review: 0, tasks: 0, runs: 0, stale: 0, conflicts: 0 };
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="side">
            <div className="brand">
              <b>PLANB</b>
              <span>Intelligence</span>
            </div>
            {user ? <Nav counts={counts} /> : null}
          </aside>
          <div className="main">
            <div className="topbar">
              <div className="crumbs">Internal research platform · private · evidence before opinion</div>
              <div className="who">
                {user ? (
                  <>
                    <span>{user.displayName}</span>
                    {user.roles.map((r) => <span key={r} className="badge info">{r}</span>)}
                    {user.authMode === 'dev' ? (
                      <form action={switchDevUser} className="inline">
                        <select name="user" defaultValue={user.id} aria-label="Development identity">
                          {DEV_USERS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                        </select>
                        <button type="submit">Switch</button>
                        <span className="badge warn" title="Development identities. Refused in production builds.">dev auth</span>
                      </form>
                    ) : null}
                  </>
                ) : (
                  <span className="muted">not signed in</span>
                )}
              </div>
            </div>
            <main className="content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
