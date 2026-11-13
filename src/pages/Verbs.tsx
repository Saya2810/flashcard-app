import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RichText } from '../components/RichText';
import { Button, DeckDot, EmptyState, Icon, IconButton, Page, cx, inputCls } from '../components/ui';
import { schemeLook } from '../conj/look';
import { definedCells } from '../conj/repo';
import { loadFormOverview } from '../conj/stats';
import type { ConjSessionConfig } from '../conj/types';
import { db } from '../db/db';
import { plural, t, locale } from '../i18n';
import { plainText, searchKey } from '../lib/text';
import { SectionTabs } from './shared';
import { LANGUAGES } from './DeckForm';

type Sort = 'az' | 'newest' | 'priority' | 'errors';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'az', label: 'A–Z' }, { value: 'newest', label: 'Neueste zuerst' }, { value: 'priority', label: 'Priorität' }, { value: 'errors', label: 'Meiste Fehler' },
];
const PAGE = 80;

export default function Verbs() {
  const nav = useNavigate();
  const verbs = useLiveQuery(() => db.verbs.toArray(), []);
  const schemes = useLiveQuery(() => db.schemes.toArray(), [], []);
  const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), [], []);
  const lessons = useLiveQuery(() => db.lessons.toArray(), [], []);
  const states = useLiveQuery(() => db.formStates.toArray(), [], []);
  const overview = useLiveQuery(() => loadFormOverview(), []);
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('*');
  const [subject, setSubject] = useState('');
  const [deckId, setDeckId] = useState('');
  const [lessonId, setLessonId] = useState('*');
  const [sort, setSort] = useState<Sort>('az');
  const [limit, setLimit] = useState(PAGE);

  const schemeById = useMemo(() => new Map(schemes.map((s) => [s.id, s])), [schemes]);
  const deckById = useMemo(() => new Map(decks.map((d) => [d.id, d])), [decks]);
  const langs = useMemo(() => [...new Set(schemes.map((s) => s.lang))].sort(), [schemes]);
  const subjects = useMemo(() => [...new Set(decks.map((d) => d.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b, locale())), [decks]);
  const deckLessons = useMemo(() => lessons.filter((l) => l.deckId === deckId).sort((a, b) => a.name.localeCompare(b.name, locale(), { numeric: true })), [lessons, deckId]);
  const stats = useMemo(() => {
    const m = new Map<string, { problems: number; errors: number }>();
    for (const s of states) { const e = m.get(s.verbId) ?? { problems: 0, errors: 0 }; e.problems += s.problem; e.errors += s.incorrect; m.set(s.verbId, e); }
    return m;
  }, [states]);
  const langName = (tag: string) => t(LANGUAGES.find((l) => l.tag === tag)?.label ?? 'Keine Angabe');

  const list = useMemo(() => {
    const k = searchKey(q);
    const out = (verbs ?? []).filter((v) => {
      const sch = schemeById.get(v.schemeId);
      const deck = deckById.get(v.deckId);
      if (lang !== '*' && sch?.lang !== lang) return false;
      if (subject && deck?.subject !== subject) return false;
      if (deckId && v.deckId !== deckId) return false;
      if (deckId && lessonId !== '*' && v.lessonId !== lessonId) return false;
      if (!k) return true;
      return [v.infinitive, v.translation, v.notes, ...v.tags, ...Object.values(v.forms).flat()].some((x) => searchKey(x).includes(k));
    });
    const cmp: Record<Sort, (a: typeof out[number], b: typeof out[number]) => number> = {
      az: (a, b) => a.infinitive.localeCompare(b.infinitive, undefined, { numeric: true }),
      newest: (a, b) => b.createdAt - a.createdAt,
      priority: (a, b) => b.priority - a.priority || a.infinitive.localeCompare(b.infinitive),
      errors: (a, b) => (stats.get(b.id)?.errors ?? 0) - (stats.get(a.id)?.errors ?? 0),
    };
    return out.sort(cmp[sort]);
  }, [verbs, q, lang, subject, deckId, lessonId, sort, schemeById, deckById, stats]);

  const train = (mode: ConjSessionConfig['mode']) => nav(`/verben/lernen?modus=${mode}`);
  const select = 'min-h-[2.5rem] rounded-full border border-line bg-surface px-3 text-sm font-medium';

  return (
    <Page title={t('Verben')} actions={<>
      <IconButton icon="table" label={t('Schemata verwalten')} onClick={() => nav('/verben/schemata')} data-testid="open-schemes" />
      <IconButton icon="plus" label={t('Verb hinzufügen')} onClick={() => nav('/verben/neu')} data-testid="add-verb" />
    </>}>
      <SectionTabs active="verben" />
      {verbs && verbs.length === 0 ? (
        <EmptyState icon="book" title={t('Noch keine Verben')} text={schemes.length === 0
          ? t('Lege zuerst ein Schema an: Es legt fest, welche Personen und Zeitformen du übst – für jede Sprache.')
          : t('Lege ein Verb mit seinen Konjugationsformen an und übe es danach vollständig oder formweise.')}>
          {schemes.length === 0
            ? <Button onClick={() => nav('/verben/schemata')} data-testid="empty-create-scheme"><Icon name="plus" size={20} />{t('Schema anlegen')}</Button>
            : <Button onClick={() => nav('/verben/neu')}><Icon name="plus" size={20} />{t('Verb hinzufügen')}</Button>}
        </EmptyState>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <Button onClick={() => train('conj-full')} data-testid="train-full"><Icon name="keyboard" size={20} />{t('Konjugation üben')}</Button>
            <Button variant="soft" onClick={() => train('conj-forms')} data-testid="train-forms"><Icon name="alert" size={20} />{t('Schwierige Formen')}{overview && overview.problemCount > 0 ? ` (${overview.problemCount})` : ''}</Button>
          </div>
          <div className="relative mb-2">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"><Icon name="search" size={20} /></span>
            <input type="search" dir="auto" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder={t('Suchen in Infinitiv, Übersetzung und Formen')} aria-label={t('Verben durchsuchen')} className={cx(inputCls, 'pl-11')} data-testid="verb-search" />
          </div>
          <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
            {langs.length > 1 && (
              <select aria-label={t('Sprache')} value={lang} onChange={(e) => setLang(e.target.value)} className={select} data-testid="filter-lang">
                <option value="*">{t('Alle Sprachen')}</option>
                {langs.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
              </select>
            )}
            {subjects.length > 0 && (
              <select aria-label={t('Fach')} value={subject} onChange={(e) => setSubject(e.target.value)} className={select} data-testid="filter-subject">
                <option value="">{t('Alle Fächer')}</option>
                {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <select aria-label={t('Stapel')} value={deckId} onChange={(e) => { setDeckId(e.target.value); setLessonId('*'); }} className={select} data-testid="filter-deck">
              <option value="">{t('Alle Stapel')}</option>
              {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {deckId && deckLessons.length > 0 && (
              <select aria-label={t('Lektion')} value={lessonId} onChange={(e) => setLessonId(e.target.value)} className={select} data-testid="filter-lesson">
                <option value="*">{t('Alle Lektionen')}</option>
                {deckLessons.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                <option value="">{t('Ohne Lektion')}</option>
              </select>
            )}
            <select aria-label={t('Sortierung')} value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={select}>
              {SORTS.map((s) => <option key={s.value} value={s.value}>{t(s.label)}</option>)}
            </select>
          </div>
          {verbs && list.length === 0 ? (
            <EmptyState icon="search" title={t('Nichts gefunden')} text={t('Zu dieser Suche oder diesen Filtern gibt es keine Verben.')} />
          ) : (
            <>
              <p className="mb-2 text-xs text-muted" data-testid="verb-count">{list.length} {plural(list.length, 'Verb', 'Verben')}</p>
              <ul className="overflow-hidden rounded-card bg-surface shadow-card">
                {list.slice(0, limit).map((v, i) => {
                  const sch = schemeById.get(v.schemeId);
                  const deck = deckById.get(v.deckId);
                  const cells = sch ? definedCells(v, sch).length : 0;
                  const total = sch ? sch.tenses.length * sch.persons.length : 0;
                  const st = stats.get(v.id);
                  return (
                    <li key={v.id}>
                      <Link to={`/verben/${v.id}`} data-testid="verb-row" className={cx('flex min-h-[4rem] items-center gap-3 px-4 py-2.5', i > 0 && 'border-t border-line')}>
                        {deck && <DeckDot color={deck.color} size={8} />}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-3">
                            <RichText text={v.infinitive} rich={false} look={schemeLook(sch, 600)} className="min-w-0 truncate" />
                            <span className="max-w-[45%] shrink-0 truncate text-sm text-muted" dir="auto">{plainText(v.translation)}</span>
                          </span>
                          <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted">
                            <span className="truncate">{sch?.name}{deck ? ` · ${deck.name}` : ''}</span>
                            <span className="shrink-0">
                              {st && st.problems > 0 && <span className="mr-2 font-semibold text-bad">{t('{n} schwierig', { n: st.problems })}</span>}
                              {t('{a}/{b} Formen', { a: cells, b: total })}
                            </span>
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {list.length > limit && <Button variant="ghost" className="mt-2 w-full" onClick={() => setLimit(limit + PAGE)}>{t('Mehr anzeigen')}</Button>}
            </>
          )}
        </>
      )}
    </Page>
  );
}

