import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, Fa, Icon, Page, cx } from '../components/ui';
import { useSettings } from '../hooks/useSettings';
import { MIN_REVIEWS } from '../srs/metrics';
import { loadProblemRows, sortProblems, type ProblemRow, type ProblemSort } from '../stats/stats';
import type { SessionConfig } from '../types';
import { SectionTabs } from './VocabList';

const SORTS: { value: ProblemSort; label: string }[] = [
  { value: 'errors', label: 'Meiste Fehler' },
  { value: 'rate', label: 'Höchste Fehlerquote' },
  { value: 'recent', label: 'Neueste Fehler' },
  { value: 'strength', label: 'Geringste Gedächtnisstärke' },
];

function Table({ rows, selected, onToggle }: { rows: ProblemRow[]; selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="w-9 py-1.5"><span className="sr-only">Auswahl</span></th>
          <th className="py-1.5 font-semibold">Vokabel</th>
          <th className="py-1.5 text-right font-semibold">Fehler</th>
          <th className="py-1.5 pl-3 text-right font-semibold">Fehlerquote</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const on = selected.has(r.vocab.id);
          return (
            <tr key={r.state.id} className="border-t border-line align-middle">
              <td className="py-1">
                <button type="button" role="checkbox" aria-checked={on} aria-label={`${r.vocab.german} auswählen`} onClick={() => onToggle(r.vocab.id)} className="grid h-11 w-9 place-items-center">
                  <span className={cx('grid h-6 w-6 place-items-center rounded-full border-2', on ? 'border-accent bg-accent text-on-accent' : 'border-line')}>{on && <Icon name="check" size={14} />}</span>
                </button>
              </td>
              <td className="py-2">
                <Link to={`/vokabeln/${r.vocab.id}`} className="block">
                  <Fa className="font-semibold">{r.vocab.persian}</Fa>
                  <span className="block text-xs text-muted">{r.vocab.german}, {r.state.direction === 'fa-de' ? 'Persisch → Dt.' : 'Dt. → Persisch'}</span>
                </Link>
              </td>
              <td className="py-2 text-right font-semibold tabular-nums">{r.state.incorrect}<span className="font-normal text-muted"> / {r.state.total}</span></td>
              <td className="py-2 pl-3 text-right tabular-nums">{Math.round(r.errorRate * 100)} %</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function Problems() {
  const nav = useNavigate();
  const settings = useSettings();
  const data = useLiveQuery(() => loadProblemRows(), []);
  const [sort, setSort] = useState<ProblemSort>('errors');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const problems = useMemo(() => sortProblems(data?.problems ?? [], sort), [data, sort]);
  const watch = useMemo(() => sortProblems(data?.watch ?? [], 'recent'), [data]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const start = (vocabIds?: string[]) => {
    const cfg: SessionConfig = { mode: 'problem', direction: 'mixed', lessonIds: [], priorities: [], size: vocabIds?.length ?? Math.max(settings.sessionSize, 20), vocabIds };
    nav('/lernen/sitzung', { state: cfg });
  };

  return (
    <Page title="Vokabeln">
      <SectionTabs active="problem" />
      {data && problems.length === 0 && watch.length === 0 ? (
        <EmptyState icon="check" title="Keine Problemvokabeln" text="Wörter, die du wiederholt falsch beantwortest, werden hier automatisch gesammelt." />
      ) : (
        <div className="space-y-4 pb-24">
          {problems.length > 0 && (
            <>
              <Button size="lg" className="w-full" onClick={() => start()} data-testid="practice-problems">Problemvokabeln üben</Button>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold">Sortieren nach</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as ProblemSort)} className="min-h-[2.5rem] rounded-full border border-line bg-surface px-3 text-sm font-medium">
                  {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <Card className="!px-3" data-testid="problem-table"><Table rows={problems} selected={selected} onToggle={toggle} /></Card>
            </>
          )}
          {watch.length > 0 && (
            <Card className="!px-3">
              <h2 className="px-1 font-bold">Noch zu wenig Daten</h2>
              <p className="mb-1 px-1 text-xs text-muted">Diese Wörter hatten Fehler, wurden aber weniger als {MIN_REVIEWS}-mal geübt. Ihre Fehlerquote ist noch nicht aussagekräftig und sie zählen nicht als Problemvokabeln.</p>
              <Table rows={watch} selected={selected} onToggle={toggle} />
            </Card>
          )}
        </div>
      )}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 z-30 mx-auto max-w-xl px-4" style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom))' }}>
          <Button className="w-full shadow-card" onClick={() => start([...selected])} data-testid="practice-selected">Auswahl üben ({selected.size})</Button>
        </div>
      )}
    </Page>
  );
}
