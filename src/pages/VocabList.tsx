import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Chip, Confirm, EmptyState, Fa, Icon, IconButton, Page, Sheet, Stars, StatusBadge, cx, inputCls, toast } from '../components/ui';
import { db } from '../db/db';
import { deleteVocab, moveVocab } from '../db/repo';
import { hasPersian, normalizeFa, normalizeLatin } from '../lib/persian';
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_ORDER, type Status, type Vocab } from '../types';

type Sort = 'newest' | 'german' | 'persian' | 'priority' | 'errors' | 'reviewed';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Neueste zuerst' },
  { value: 'german', label: 'Deutsch A–Z' },
  { value: 'persian', label: 'Persisch الف–ی' },
  { value: 'priority', label: 'Priorität' },
  { value: 'errors', label: 'Meiste Fehler' },
  { value: 'reviewed', label: 'Zuletzt gelernt' },
];
type ErrFilter = '' | 'any' | 'rate30' | 'rate50';
const ERR_FILTERS: { value: ErrFilter; label: string }[] = [
  { value: '', label: 'Alle' },
  { value: 'any', label: 'Mit Fehlern' },
  { value: 'rate30', label: 'Fehlerquote ab 30 %' },
  { value: 'rate50', label: 'Fehlerquote ab 50 %' },
];

export function SectionTabs({ active }: { active: 'vokabeln' | 'lektionen' | 'problem' }) {
  const tabs = [['vokabeln', '/vokabeln', 'Alle Vokabeln'], ['lektionen', '/lektionen', 'Lektionen'], ['problem', '/problemvokabeln', 'Problemvokabeln']] as const;
  return (
    <div className="mb-3 flex rounded-2xl bg-sunken p-1">
      {tabs.map(([k, to, label]) => (
        <Link key={k} to={to} replace aria-current={active === k ? 'page' : undefined}
          className={cx('grid min-h-[2.5rem] flex-1 place-items-center rounded-xl px-1 text-center text-sm font-semibold', active === k ? 'bg-surface text-ink shadow-sm' : 'text-muted')}>
          {label}
        </Link>
      ))}
    </div>
  );
}

const PAGE = 60;

export default function VocabList() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const lessonFilter = params.get('lektion');
  const vocab = useLiveQuery(() => db.vocab.toArray(), []);
  const lessons = useLiveQuery(() => db.lessons.orderBy('name').toArray(), [], []);
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
    await db.states.each((s) => {
      const e = m.get(s.vocabId) ?? { total: 0, incorrect: 0 };
      e.total += s.total; e.incorrect += s.incorrect;
      m.set(s.vocabId, e);
    });
    return m;
  }, [needErrors]);

  const allTags = useMemo(() => [...new Set((vocab ?? []).flatMap((v) => v.tags))].sort((a, b) => a.localeCompare(b, 'de')), [vocab]);
  const lessonName = useMemo(() => new Map(lessons.map((l) => [l.id, l.name])), [lessons]);

  const list = useMemo(() => {
    if (!vocab) return [];
    const qFa = normalizeFa(q);
    const qLat = normalizeLatin(q);
    const useFa = hasPersian(q);
    let out = vocab.filter((v) => {
      if (lessonFilter !== null && v.lessonId !== lessonFilter) return false;
      if (prio.length && !prio.includes(v.priority)) return false;
      if (status.length && !status.includes(v.status)) return false;
      if (tags.length && !tags.some((t) => v.tags.includes(t))) return false;
      if (err) {
        const e = errors?.get(v.id);
        if (!e || e.incorrect === 0) return false;
        if (err === 'rate30' && e.incorrect / e.total < 0.3) return false;
        if (err === 'rate50' && e.incorrect / e.total < 0.5) return false;
      }
      if (!q.trim()) return true;
      if (useFa) return v.persianNorm.includes(qFa) || normalizeFa(v.exampleFa).includes(qFa);
      return [v.german, ...v.altGerman, v.translit, v.notes, v.grammar, ...v.tags].some((s) => normalizeLatin(s).includes(qLat));
    });
    const cmp: Record<Sort, (a: Vocab, b: Vocab) => number> = {
      newest: (a, b) => b.createdAt - a.createdAt,
      german: (a, b) => a.german.localeCompare(b.german, 'de'),
      persian: (a, b) => a.persian.localeCompare(b.persian, 'fa'),
      priority: (a, b) => b.priority - a.priority || b.createdAt - a.createdAt,
      errors: (a, b) => (errors?.get(b.id)?.incorrect ?? 0) - (errors?.get(a.id)?.incorrect ?? 0),
      reviewed: (a, b) => b.lastReviewAt - a.lastReviewAt,
    };
    out = [...out].sort(cmp[sort]);
    return out;
  }, [vocab, q, sort, prio, status, tags, err, errors, lessonFilter]);

  useEffect(() => setLimit(PAGE), [q, sort, prio, status, tags, err, lessonFilter]);
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

  return (
    <Page title="Vokabeln" actions={<>
      <IconButton icon="upload" label="Importieren" onClick={() => nav('/vokabeln/import')} />
      <IconButton icon="plus" label="Vokabel hinzufügen" onClick={() => nav(`/vokabeln/neu${lessonFilter ? `?lektion=${lessonFilter}` : ''}`)} />
    </>}>
      <SectionTabs active="vokabeln" />
      <div className="relative mb-2">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"><Icon name="search" size={20} /></span>
        <input type="search" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen (Deutsch, Persisch, Umschrift)" aria-label="Vokabeln durchsuchen" className={cx(inputCls, 'pl-11')} />
      </div>
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={activeFilters > 0} onClick={() => setFilterOpen(true)}><span className="inline-flex items-center gap-1.5"><Icon name="filter" size={16} />Filter{activeFilters ? ` (${activeFilters})` : ''}</span></Chip>
        <select aria-label="Sortierung" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="min-h-[2.5rem] rounded-full border border-line bg-surface px-3 text-sm font-medium">
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {lessonFilter !== null && <Chip active onClick={() => setParams({}, { replace: true })}>{lessonFilter ? lessonName.get(lessonFilter) ?? 'Lektion' : 'Ohne Lektion'} ✕</Chip>}
        <Chip active={selecting} onClick={() => (selecting ? endSelect() : setSelecting(true))}>{selecting ? 'Fertig' : 'Auswählen'}</Chip>
      </div>

      {vocab && vocab.length === 0 ? (
        <EmptyState title="Noch keine Vokabeln" text="Lege deine erste Vokabel an oder importiere eine Liste.">
          <Button onClick={() => nav('/vokabeln/neu')}>Vokabel hinzufügen</Button>
          <Button variant="soft" onClick={() => nav('/vokabeln/import')}>Importieren</Button>
        </EmptyState>
      ) : vocab && list.length === 0 ? (
        <EmptyState icon="search" title="Nichts gefunden" text="Zu dieser Suche oder diesen Filtern gibt es keine Vokabeln." />
      ) : (
        <>
          <p className="mb-2 text-xs text-muted" data-testid="vocab-count">{list.length} {list.length === 1 ? 'Vokabel' : 'Vokabeln'}</p>
          <ul className="overflow-hidden rounded-card bg-surface shadow-card">
            {list.slice(0, limit).map((v, i) => {
              const row = (
                <>
                  {selecting && (
                    <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full border-2', selected.has(v.id) ? 'border-accent bg-accent text-on-accent' : 'border-line')}>
                      {selected.has(v.id) && <Icon name="check" size={14} />}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-semibold" lang="de">{v.german}</span>
                      <Fa className="max-w-[55%] shrink-0 truncate font-semibold">{v.persian}</Fa>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <StatusBadge status={v.status} />
                        {v.problem === 1 && <span className="text-xs font-semibold text-bad">Problem</span>}
                        {v.sample === 1 && <span className="rounded-full bg-sunken px-2 text-[0.68rem] font-medium text-muted">Beispiel</span>}
                      </span>
                      <Stars value={v.priority} size={13} />
                    </span>
                  </span>
                </>
              );
              const cls = cx('flex min-h-[4rem] w-full items-center gap-3 px-4 py-2.5 text-left', i > 0 && 'border-t border-line');
              return (
                <li key={v.id}>
                  {selecting
                    ? <button type="button" className={cls} aria-pressed={selected.has(v.id)} onClick={() => toggleSel(v.id)}>{row}</button>
                    : <Link to={`/vokabeln/${v.id}`} className={cls}>{row}</Link>}
                </li>
              );
            })}
          </ul>
          <div ref={sentinel} className="h-4" />
        </>
      )}

      {selecting && (
        <div className="fixed inset-x-0 z-30 mx-auto flex max-w-xl items-center gap-2 px-4" style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom))' }}>
          <div className="flex flex-1 items-center gap-2 rounded-2xl bg-ink p-2 text-bg shadow-card">
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
            <h3 className="mb-2 text-sm font-semibold">Lektion</h3>
            <div className="flex flex-wrap gap-2">
              <Chip active={lessonFilter === null} onClick={() => setParams({}, { replace: true })}>Alle</Chip>
              {lessons.map((l) => <Chip key={l.id} active={lessonFilter === l.id} onClick={() => setParams({ lektion: l.id }, { replace: true })}>{l.name}</Chip>)}
              <Chip active={lessonFilter === ''} onClick={() => setParams({ lektion: '' }, { replace: true })}>Ohne Lektion</Chip>
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Priorität</h3>
            <div className="flex flex-wrap gap-2">{[5, 4, 3, 2, 1].map((p) => <Chip key={p} active={prio.includes(p)} onClick={() => setPrio(toggle(prio, p))}>{p} – {PRIORITY_LABEL[p]}</Chip>)}</div>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Lernstatus</h3>
            <div className="flex flex-wrap gap-2">{STATUS_ORDER.map((s) => <Chip key={s} active={status.includes(s)} onClick={() => setStatus(toggle(status, s))}>{STATUS_LABEL[s]}</Chip>)}</div>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Fehlerhäufigkeit</h3>
            <div className="flex flex-wrap gap-2">{ERR_FILTERS.map((f) => <Chip key={f.value} active={err === f.value} onClick={() => setErr(f.value)}>{f.label}</Chip>)}</div>
          </div>
          {allTags.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Tags</h3>
              <div className="flex flex-wrap gap-2">{allTags.map((t) => <Chip key={t} active={tags.includes(t)} onClick={() => setTags(toggle(tags, t))}>{t}</Chip>)}</div>
            </div>
          )}
        </div>
      </Sheet>

      <Sheet open={moveOpen} onClose={() => setMoveOpen(false)} title="In Lektion verschieben">
        <ul className="space-y-2">
          {[{ id: '', name: 'Ohne Lektion' }, ...lessons].map((l) => (
            <li key={l.id}>
              <Button variant="soft" className="w-full !justify-start" onClick={async () => { await moveVocab([...selected], l.id); toast(`${selected.size} verschoben`); setMoveOpen(false); endSelect(); }}>{l.name}</Button>
            </li>
          ))}
        </ul>
      </Sheet>

      <Confirm open={confirmDelete} danger title={`${selected.size} ${selected.size === 1 ? 'Vokabel' : 'Vokabeln'} löschen?`}
        text="Die Vokabeln und ihr gesamter Lernverlauf werden endgültig gelöscht." confirmLabel="Endgültig löschen"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => { await deleteVocab([...selected]); toast('Gelöscht'); setConfirmDelete(false); endSelect(); }} />
    </Page>
  );
}
