import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { RichText, sideLook } from '../components/RichText';
import { Button, Chip, Confirm, DeckDot, EmptyState, Icon, IconButton, Page, Sheet, Stars, StatusBadge, cx, inputCls, toast } from '../components/ui';
import { db } from '../db/db';
import { deleteCards, moveCards } from '../db/repo';
import { plainText, searchKey } from '../lib/text';
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_ORDER, type Card, type Deck, type Status } from '../types';
import { SectionTabs } from './shared';

type Sort = 'newest' | 'front' | 'back' | 'priority' | 'errors' | 'reviewed';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Neueste zuerst' },
  { value: 'front', label: 'Vorderseite A–Z' },
  { value: 'back', label: 'Rückseite A–Z' },
  { value: 'priority', label: 'Priorität' },
  { value: 'errors', label: 'Meiste Fehler' },
  { value: 'reviewed', label: 'Zuletzt gelernt' },
];
type ErrFilter = '' | 'any' | 'rate30' | 'rate50';
const ERR_FILTERS: { value: ErrFilter; label: string }[] = [
  { value: '', label: 'Alle' }, { value: 'any', label: 'Mit Fehlern' }, { value: 'rate30', label: 'Fehlerquote ab 30 %' }, { value: 'rate50', label: 'Fehlerquote ab 50 %' },
];
const PAGE = 60;

/** One-line preview: formulas and formatting rendered, code blocks shown as plain monospace text. */
export function LineText({ text, deck, side, className, small }: { text: string; deck: Deck; side: 'front' | 'back'; className?: string; small?: boolean }) {
  const style = deck[side];
  const code = /```/.test(text);
  const first = code ? plainText(text).split('\n')[0] : text.split('\n').find((l) => l.trim() && !/^!\[/.test(l)) ?? text;
  return (
    <RichText text={first} rich={deck.rich && !code} look={{ ...sideLook(style), scale: small ? 0.75 : 1, weight: small ? 400 : side === 'front' ? 600 : 400, ...(code ? { font: 'mono' as const } : {}) }}
      className={cx('min-w-0 truncate !whitespace-nowrap [&_.katex]:!text-[1em] [&_p]:inline [&_p]:!m-0', className)} />
  );
}

function Row({ c, deck }: { c: Card; deck: Deck | undefined }) {
  if (!deck) return null;
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline justify-between gap-3">
        <LineText text={c.front} deck={deck} side="front" />
        <LineText text={c.back} deck={deck} side="back" className="max-w-[50%] shrink-0 text-muted" />
      </span>
      <span className="mt-0.5 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <StatusBadge status={c.status} />
          {c.problem === 1 && <span className="text-xs font-semibold text-bad">Problem</span>}
          {c.sample === 1 && <span className="rounded-full bg-sunken px-2 text-[0.68rem] font-medium text-muted">Beispiel</span>}
        </span>
        <Stars value={c.priority} size={13} />
      </span>
    </span>
  );
}

export default function CardList() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const deckFilter = params.get('stapel');
  const lessonFilter = params.get('lektion');
  const cards = useLiveQuery(() => (deckFilter ? db.cards.where('deckId').equals(deckFilter).toArray() : db.cards.toArray()), [deckFilter]);
  const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), [], []);
  const lessons = useLiveQuery(() => db.lessons.toArray(), [], []);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [prio, setPrio] = useState<number[]>([]);
  const [status, setStatus] = useState<Status[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [err, setErr] = useState<ErrFilter>('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  // Error counts are only loaded when sorting or filtering by them.
  const needErrors = sort === 'errors' || err !== '';
  const errors = useLiveQuery(async () => {
    const m = new Map<string, { total: number; incorrect: number }>();
    if (!needErrors) return m;
    await db.states.each((s) => { const e = m.get(s.cardId) ?? { total: 0, incorrect: 0 }; e.total += s.total; e.incorrect += s.incorrect; m.set(s.cardId, e); });
    return m;
  }, [needErrors]);

  const deckById = useMemo(() => new Map(decks.map((d) => [d.id, d])), [decks]);
  const allTags = useMemo(() => [...new Set((cards ?? []).flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b, 'de')), [cards]);
  const deckLessons = useMemo(() => lessons.filter((l) => l.deckId === deckFilter).sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true })), [lessons, deckFilter]);

  const list = useMemo(() => {
    if (!cards) return [];
    const k = searchKey(q);
    const out = cards.filter((c) => {
      if (lessonFilter !== null && c.lessonId !== lessonFilter) return false;
      if (prio.length && !prio.includes(c.priority)) return false;
      if (status.length && !status.includes(c.status)) return false;
      if (tags.length && !tags.some((t) => c.tags.includes(t))) return false;
      if (err) {
        const e = errors?.get(c.id);
        if (!e || e.incorrect === 0) return false;
        if (err === 'rate30' && e.incorrect / e.total < 0.3) return false;
        if (err === 'rate50' && e.incorrect / e.total < 0.5) return false;
      }
      if (!k) return true;
      return [c.front, c.back, ...c.altBack, c.notes, ...c.tags, ...Object.values(c.fields)].some((s) => searchKey(s).includes(k));
    });
    const cmp: Record<Sort, (a: Card, b: Card) => number> = {
      newest: (a, b) => b.createdAt - a.createdAt,
      front: (a, b) => plainText(a.front).localeCompare(plainText(b.front), undefined, { numeric: true }),
      back: (a, b) => plainText(a.back).localeCompare(plainText(b.back), undefined, { numeric: true }),
      priority: (a, b) => b.priority - a.priority || b.createdAt - a.createdAt,
      errors: (a, b) => (errors?.get(b.id)?.incorrect ?? 0) - (errors?.get(a.id)?.incorrect ?? 0),
      reviewed: (a, b) => b.lastReviewAt - a.lastReviewAt,
    };
    return out.sort(cmp[sort]);
  }, [cards, q, sort, prio, status, tags, err, errors, lessonFilter]);

  useEffect(() => setLimit(PAGE), [q, sort, prio, status, tags, err, deckFilter, lessonFilter]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setLimit((l) => l + PAGE), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list.length]);

  const activeFilters = prio.length + status.length + tags.length + (err ? 1 : 0);
  const toggle = <T,>(l: T[], v: T) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]);
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const endSelect = () => { setSelecting(false); setSelected(new Set()); };
  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v === null) p.delete(k); else p.set(k, v); if (k === 'stapel') p.delete('lektion'); setParams(p, { replace: true }); };
  const currentDeck = deckFilter ? deckById.get(deckFilter) : undefined;

  return (
    <Page title={currentDeck?.name ?? 'Karten'} back={currentDeck ? `/stapel/${currentDeck.id}` : undefined} actions={<>
      <IconButton icon="upload" label="Importieren" onClick={() => nav(`/import${deckFilter ? `?stapel=${deckFilter}` : ''}`)} />
      <IconButton icon="plus" label="Karte hinzufügen" onClick={() => nav(`/karten/neu?${new URLSearchParams({ ...(deckFilter ? { stapel: deckFilter } : {}), ...(lessonFilter ? { lektion: lessonFilter } : {}) })}`)} />
    </>}>
      {!currentDeck && <SectionTabs active="karten" />}
      <div className="relative mb-2">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"><Icon name="search" size={20} /></span>
        <input type="search" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen in allen Feldern" aria-label="Karten durchsuchen" className={cx(inputCls, 'pl-11')} />
      </div>
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={activeFilters > 0} onClick={() => setFilterOpen(true)}><span className="inline-flex items-center gap-1.5"><Icon name="filter" size={16} />Filter{activeFilters ? ` (${activeFilters})` : ''}</span></Chip>
        <select aria-label="Sortierung" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="min-h-[2.5rem] rounded-full border border-line bg-surface px-3 text-sm font-medium">
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {lessonFilter !== null && <Chip active onClick={() => setParam('lektion', null)}>{lessonFilter ? lessons.find((l) => l.id === lessonFilter)?.name ?? 'Lektion' : 'Ohne Lektion'} ✕</Chip>}
        <Chip active={selecting} onClick={() => (selecting ? endSelect() : setSelecting(true))}>{selecting ? 'Fertig' : 'Auswählen'}</Chip>
      </div>

      {cards && cards.length === 0 ? (
        <EmptyState icon="cards" title="Noch keine Karten" text="Lege eine Karte an oder importiere eine Liste.">
          <Button onClick={() => nav(`/karten/neu${deckFilter ? `?stapel=${deckFilter}` : ''}`)}>Karte hinzufügen</Button>
          <Button variant="soft" onClick={() => nav(`/import${deckFilter ? `?stapel=${deckFilter}` : ''}`)}>Importieren</Button>
        </EmptyState>
      ) : cards && list.length === 0 ? (
        <EmptyState icon="search" title="Nichts gefunden" text="Zu dieser Suche oder diesen Filtern gibt es keine Karten." />
      ) : (
        <>
          <p className="mb-2 text-xs text-muted" data-testid="card-count">{list.length} {list.length === 1 ? 'Karte' : 'Karten'}</p>
          <ul className="overflow-hidden rounded-card bg-surface shadow-card">
            {list.slice(0, limit).map((c, i) => {
              const deck = deckById.get(c.deckId);
              const body = (
                <>
                  {selecting && (
                    <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full border-2', selected.has(c.id) ? 'border-accent bg-accent text-on-accent' : 'border-line')}>{selected.has(c.id) && <Icon name="check" size={14} />}</span>
                  )}
                  {!currentDeck && deck && <DeckDot color={deck.color} size={8} />}
                  <Row c={c} deck={deck} />
                </>
              );
              const cls = cx('flex min-h-[4rem] w-full items-center gap-3 px-4 py-2.5 text-left', i > 0 && 'border-t border-line');
              return <li key={c.id}>{selecting ? <button type="button" className={cls} aria-pressed={selected.has(c.id)} onClick={() => toggleSel(c.id)}>{body}</button> : <Link to={`/karten/${c.id}`} className={cls}>{body}</Link>}</li>;
            })}
          </ul>
          <div ref={sentinel} className="h-4" />
        </>
      )}

      {selecting && (
        <div className="fixed inset-x-0 z-30 mx-auto flex max-w-xl px-4" style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}>
          <div className="flex flex-1 items-center gap-2 rounded-2xl bg-ink p-2 text-bg shadow-lift">
            <span className="flex-1 pl-2 text-sm font-semibold">{selected.size} ausgewählt</span>
            <Button size="sm" variant="soft" disabled={!selected.size} onClick={() => setMoveOpen(true)}>Verschieben</Button>
            <Button size="sm" variant="bad" disabled={!selected.size} onClick={() => setConfirmDelete(true)}>Löschen</Button>
          </div>
        </div>
      )}

      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter"
        footer={<div className="flex gap-2"><Button variant="soft" className="flex-1" onClick={() => { setPrio([]); setStatus([]); setTags([]); setErr(''); }}>Zurücksetzen</Button><Button className="flex-1" onClick={() => setFilterOpen(false)}>Anzeigen</Button></div>}>
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Stapel</h3>
            <div className="flex flex-wrap gap-2">
              <Chip active={!deckFilter} onClick={() => setParam('stapel', null)}>Alle</Chip>
              {decks.map((d) => <Chip key={d.id} active={deckFilter === d.id} onClick={() => setParam('stapel', d.id)}><span className="inline-flex items-center gap-1.5"><DeckDot color={d.color} size={9} />{d.name}</span></Chip>)}
            </div>
          </div>
          {deckFilter && (deckLessons.length > 0) && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Lektion</h3>
              <div className="flex flex-wrap gap-2">
                <Chip active={lessonFilter === null} onClick={() => setParam('lektion', null)}>Alle</Chip>
                {deckLessons.map((l) => <Chip key={l.id} active={lessonFilter === l.id} onClick={() => setParam('lektion', l.id)}>{l.name}</Chip>)}
                <Chip active={lessonFilter === ''} onClick={() => setParam('lektion', '')}>Ohne Lektion</Chip>
              </div>
            </div>
          )}
          <div><h3 className="mb-2 text-sm font-semibold">Priorität</h3><div className="flex flex-wrap gap-2">{[5, 4, 3, 2, 1].map((p) => <Chip key={p} active={prio.includes(p)} onClick={() => setPrio(toggle(prio, p))}>{p} – {PRIORITY_LABEL[p]}</Chip>)}</div></div>
          <div><h3 className="mb-2 text-sm font-semibold">Lernstatus</h3><div className="flex flex-wrap gap-2">{STATUS_ORDER.map((s) => <Chip key={s} active={status.includes(s)} onClick={() => setStatus(toggle(status, s))}>{STATUS_LABEL[s]}</Chip>)}</div></div>
          <div><h3 className="mb-2 text-sm font-semibold">Fehlerhäufigkeit</h3><div className="flex flex-wrap gap-2">{ERR_FILTERS.map((f) => <Chip key={f.value} active={err === f.value} onClick={() => setErr(f.value)}>{f.label}</Chip>)}</div></div>
          {allTags.length > 0 && <div><h3 className="mb-2 text-sm font-semibold">Tags</h3><div className="flex flex-wrap gap-2">{allTags.map((t) => <Chip key={t} active={tags.includes(t)} onClick={() => setTags(toggle(tags, t))}>{t}</Chip>)}</div></div>}
        </div>
      </Sheet>

      <Sheet open={moveOpen} onClose={() => setMoveOpen(false)} title="Verschieben nach">
        <ul className="space-y-4">
          {decks.map((d) => (
            <li key={d.id}>
              <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold"><DeckDot color={d.color} />{d.name}</div>
              <div className="flex flex-wrap gap-2">
                {[{ id: '', name: 'Ohne Lektion' }, ...lessons.filter((l) => l.deckId === d.id)].map((l) => (
                  <Chip key={l.id} onClick={async () => { await moveCards([...selected], { deckId: d.id, lessonId: l.id }); toast(`${selected.size} verschoben`); setMoveOpen(false); endSelect(); }}>{l.name}</Chip>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Sheet>

      <Confirm open={confirmDelete} danger title={`${selected.size} ${selected.size === 1 ? 'Karte' : 'Karten'} löschen?`} text="Die Karten und ihr gesamter Lernverlauf werden endgültig gelöscht." confirmLabel="Endgültig löschen"
        onCancel={() => setConfirmDelete(false)} onConfirm={async () => { await deleteCards([...selected]); toast('Gelöscht'); setConfirmDelete(false); endSelect(); }} />
    </Page>
  );
}
