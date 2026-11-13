import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Chip, DeckDot, EmptyState, Icon, Page, cx } from '../components/ui';
import { db } from '../db/db';
import { useSettings } from '../hooks/useSettings';
import { plainText } from '../lib/text';
import { MIN_REVIEWS } from '../srs/metrics';
import { loadProblemRows, sortProblems, type ProblemRow, type ProblemSort } from '../stats/stats';
import type { SessionConfig } from '../types';
import { SectionTabs } from './shared';
import { LineText } from './CardList';
import { t } from '../i18n';

const SORTS: { value: ProblemSort; label: string }[] = [
  { value: 'errors', label: 'Meiste Fehler' },
  { value: 'rate', label: 'Höchste Fehlerquote' },
  { value: 'recent', label: 'Neueste Fehler' },
  { value: 'strength', label: 'Geringste Gedächtnisstärke' },
];

function Table({ rows, selected, onToggle }: { rows: ProblemRow[]; selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="w-9 py-1.5"><span className="sr-only">{t('Auswahl')}</span></th>
          <th className="py-1.5 font-semibold">{t('Karte')}</th>
          <th className="w-14 py-1.5 text-right font-semibold">{t('Fehler')}</th>
          <th className="w-16 py-1.5 pl-2 text-right font-semibold">{t('Quote')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const on = selected.has(r.card.id);
          const deck = r.deck;
          const q = r.state.direction === 'fwd' ? r.card.front : r.card.back;
          const a = r.state.direction === 'fwd' ? r.card.back : r.card.front;
          return (
            <tr key={r.state.id} className="border-t border-line align-middle">
              <td className="py-1">
                <button type="button" role="checkbox" aria-checked={on} aria-label={t('{name} auswählen', { name: plainText(r.card.front) })} onClick={() => onToggle(r.card.id)} className="grid h-11 w-9 place-items-center">
                  <span className={cx('grid h-6 w-6 place-items-center rounded-full border-2', on ? 'border-accent bg-accent text-on-accent' : 'border-line')}>{on && <Icon name="check" size={14} />}</span>
                </button>
              </td>
              <td className="py-2">
                <Link to={`/karten/${r.card.id}`} className="block min-w-0">
                  {deck && <LineText text={q} deck={deck} side={r.state.direction === 'fwd' ? 'front' : 'back'} className="block" />}
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                    {deck && <DeckDot color={deck.color} size={7} />}
                    {deck ? <LineText text={a} deck={deck} side={r.state.direction === 'fwd' ? 'back' : 'front'} small /> : <span className="truncate" dir="auto">{plainText(a)}</span>}
                    {deck?.reverse && <span className="shrink-0">({r.state.direction === 'fwd' ? '→' : '←'})</span>}
                  </span>
                </Link>
              </td>
              <td className="py-2 text-right font-semibold tabular-nums">{r.state.incorrect}<span className="font-normal text-muted">/{r.state.total}</span></td>
              <td className="py-2 pl-2 text-right tabular-nums">{Math.round(r.errorRate * 100)} %</td>
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
  const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), [], []);
  const [deckId, setDeckId] = useState('');
  const data = useLiveQuery(() => loadProblemRows(deckId || undefined), [deckId]);
  const [sort, setSort] = useState<ProblemSort>('errors');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const problems = useMemo(() => sortProblems(data?.problems ?? [], sort), [data, sort]);
  const watch = useMemo(() => sortProblems(data?.watch ?? [], 'recent'), [data]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const start = (cardIds?: string[]) => {
    const cfg: SessionConfig = { mode: 'problem', direction: 'mixed', deckIds: deckId ? [deckId] : [], lessonIds: [], priorities: [], size: cardIds?.length ?? Math.max(settings.sessionSize, 20), cardIds };
    nav('/lernen/sitzung', { state: cfg });
  };

  return (
    <Page title={t("Stapel")}>
      <SectionTabs active="problem" />
      {decks.length > 1 && (
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
          <Chip active={!deckId} onClick={() => setDeckId('')}>{t('Alle Stapel')}</Chip>
          {decks.map((d) => <Chip key={d.id} active={deckId === d.id} onClick={() => setDeckId(d.id)}><span className="inline-flex items-center gap-1.5"><DeckDot color={d.color} size={9} />{d.name}</span></Chip>)}
        </div>
      )}
      {data && problems.length === 0 && watch.length === 0 ? (
        <EmptyState icon="check" title={t("Keine Problemkarten")} text={t("Karten, die du wiederholt falsch beantwortest, werden hier automatisch gesammelt.")} />
      ) : (
        <div className="space-y-4 pb-24">
          {problems.length > 0 && (
            <>
              <Button size="lg" className="w-full" onClick={() => start()} data-testid="practice-problems">{t('Problemkarten üben')}</Button>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold">{t('Sortieren nach')}</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as ProblemSort)} className="min-h-[2.5rem] rounded-full border border-line bg-surface px-3 text-sm font-medium">
                  {SORTS.map((s) => <option key={s.value} value={s.value}>{t(s.label)}</option>)}
                </select>
              </label>
              <Card className="!px-3" data-testid="problem-table"><Table rows={problems} selected={selected} onToggle={toggle} /></Card>
            </>
          )}
          {watch.length > 0 && (
            <Card className="!px-3">
              <h2 className="px-1 font-bold">{t('Noch zu wenig Daten')}</h2>
              <p className="mb-1 px-1 text-xs text-muted">{t('Diese Karten hatten Fehler, wurden aber weniger als {n}-mal gelernt. Ihre Fehlerquote ist noch nicht aussagekräftig.', { n: MIN_REVIEWS })}</p>
              <Table rows={watch} selected={selected} onToggle={toggle} />
            </Card>
          )}
        </div>
      )}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 z-30 mx-auto max-w-xl px-4" style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}>
          <Button className="w-full shadow-lift" onClick={() => start([...selected])} data-testid="practice-selected">{t('Auswahl üben ({n})', { n: selected.size })}</Button>
        </div>
      )}
    </Page>
  );
}
