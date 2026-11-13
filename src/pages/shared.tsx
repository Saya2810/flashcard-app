import { Link } from 'react-router-dom';
import { cx } from '../components/ui';
import type { DirectionChoice } from '../types';

export const DIRECTION_OPTIONS: { value: DirectionChoice; label: string }[] = [
  { value: 'fwd', label: 'Vorder → Rück' },
  { value: 'rev', label: 'Rück → Vorder' },
  { value: 'mixed', label: 'Gemischt' },
];

export function SectionTabs({ active }: { active: 'stapel' | 'karten' | 'problem' }) {
  const tabs = [['stapel', '/stapel', 'Stapel'], ['karten', '/karten', 'Alle Karten'], ['problem', '/problemkarten', 'Problemkarten']] as const;
  return (
    <nav aria-label="Bereiche" className="mb-4 flex rounded-2xl bg-sunken p-1">
      {tabs.map(([k, to, label]) => (
        <Link key={k} to={to} replace aria-current={active === k ? 'page' : undefined}
          className={cx('grid min-h-[2.5rem] flex-1 place-items-center rounded-xl px-1 text-center text-sm font-semibold transition', active === k ? 'bg-surface text-ink shadow-sm' : 'text-muted')}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '–');
