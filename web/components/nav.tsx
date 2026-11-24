'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavCounts { review: number; tasks: number; runs: number; stale: number; conflicts: number }

const GROUPS: { title: string; items: { href: string; label: string; count?: keyof NavCounts }[] }[] = [
  { title: 'Research', items: [
    { href: '/', label: 'Overview' },
    { href: '/catalogue', label: 'Business catalogue' },
    { href: '/tasks', label: 'Research tasks', count: 'tasks' },
    { href: '/runs', label: 'Job queue', count: 'runs' },
  ] },
  { title: 'Evidence', items: [
    { href: '/evidence', label: 'Evidence explorer' },
    { href: '/sources', label: 'Source registry' },
    { href: '/suppliers', label: 'Suppliers & quotes' },
    { href: '/interviews', label: 'Ground Truth' },
  ] },
  { title: 'Reference', items: [
    { href: '/geography', label: 'Geography' },
    { href: '/regulatory', label: 'Regulatory' },
  ] },
  { title: 'Control', items: [
    { href: '/review', label: 'Review inbox', count: 'review' },
    { href: '/publication', label: 'Publication' },
    { href: '/quality', label: 'Data quality', count: 'stale' },
    { href: '/costs', label: 'Research costs' },
    { href: '/audit', label: 'Audit history' },
  ] },
];

export function Nav({ counts }: { counts: NavCounts }) {
  const path = usePathname();
  return (
    <nav className="nav">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div className="nav-group">{g.title}</div>
          {g.items.map((item) => {
            const active = item.href === '/' ? path === '/' : path.startsWith(item.href) || (item.href === '/catalogue' && path.startsWith('/business'));
            const n = item.count ? counts[item.count] : undefined;
            return (
              <Link key={item.href} href={item.href} className={active ? 'active' : undefined}>
                <span>{item.label}</span>
                {n ? <span className={`count ${item.count === 'review' || item.count === 'stale' ? 'hot' : ''}`}>{n}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
