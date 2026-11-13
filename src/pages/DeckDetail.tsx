import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Confirm, EmptyState, Field, Icon, IconButton, Page, ProgressBar, Sheet, deckTint, inputCls, toast } from '../components/ui';
import { db } from '../db/db';
import { addLesson, deleteLesson, updateLesson, ValidationError } from '../db/repo';
import { relativeDay } from '../lib/dates';
import { loadDeckStats } from '../stats/stats';
import type { Lesson, SessionConfig } from '../types';
import { pct } from './shared';
import { useSettings } from '../hooks/useSettings';
import { exportCsv, backupFileName } from '../db/backup';
import { saveFile } from '../lib/csv';

export default function DeckDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const settings = useSettings();
  const all = useLiveQuery(() => loadDeckStats(), []);
  const s = all?.find((x) => x.deck.id === id);
  const missing = useLiveQuery(async () => !(await db.decks.get(id)), [id]);
  const [edit, setEdit] = useState<{ id: string | null; name: string; description: string } | null>(null);
  const [error, setError] = useState('');
  const [del, setDel] = useState<Lesson | null>(null);
  const [delCards, setDelCards] = useState(false);

  if (missing) return <Page title="Stapel" back="/stapel"><EmptyState title="Nicht gefunden" text="Diesen Stapel gibt es nicht mehr." /></Page>;
  if (!s) return <Page title="Stapel" back>{null}</Page>;
  const deck = s.deck;
  const learn = (lessonIds: string[] = []) => {
    const cfg: SessionConfig = { mode: lessonIds.length ? 'lesson' : 'smart', direction: deck.reverse ? settings.defaultDirection : 'fwd', deckIds: [deck.id], lessonIds, priorities: [], size: settings.sessionSize };
    nav('/lernen/sitzung', { state: cfg });
  };
  const save = async () => {
    if (!edit) return;
    try {
      if (edit.id) await updateLesson(edit.id, edit.name, edit.description);
      else await addLesson(deck.id, edit.name, edit.description);
      toast('Lektion gespeichert'); setEdit(null); setError('');
    } catch (e) { setError(e instanceof ValidationError ? e.message : 'Speichern fehlgeschlagen.'); }
  };
  const delCount = del ? s.lessons.find((l) => l.lesson?.id === del.id)?.total ?? 0 : 0;

  return (
    <Page title={deck.name} back="/stapel" actions={<IconButton icon="edit" label="Stapel bearbeiten" onClick={() => nav(`/stapel/${deck.id}/bearbeiten`)} />}>
      <div className="space-y-4 pb-6">
        <Card className="overflow-hidden !p-0">
          <div className="px-4 pb-4 pt-4" style={deckTint(deck.color)}>
            <div className="text-xs font-semibold opacity-80">{deck.subject || 'Ohne Fach'}</div>
            <div className="mt-0.5 text-lg font-bold">{deck.front.label} → {deck.back.label}{deck.reverse ? ' und zurück' : ''}</div>
            {deck.description && <p className="mt-1 text-sm opacity-90">{deck.description}</p>}
          </div>
          <div className="grid grid-cols-4 divide-x divide-line border-b border-line text-center">
            {[['Karten', s.total], ['Fällig', s.due], ['Schwierig', s.difficult], ['Fehlerquote', pct(s.incorrect, s.reviews)]].map(([k, v]) => (
              <div key={k} className="px-1 py-3"><div className="text-lg font-bold tabular-nums">{v}</div><div className="text-[0.68rem] text-muted">{k}</div></div>
            ))}
          </div>
          <div className="p-4">
            <ProgressBar value={s.progress} color={`rgb(var(--deck-${deck.color}-ink))`} />
            <p className="mt-1.5 text-xs text-muted">{Math.round(s.progress * 100)} % Lernfortschritt, {s.mastered} sicher beherrscht</p>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" className="col-span-2" onClick={() => learn()} disabled={!s.total} data-testid="deck-learn">Stapel lernen</Button>
          <Button variant="soft" onClick={() => nav(`/karten/neu?stapel=${deck.id}`)} data-testid="deck-add-card"><Icon name="plus" size={20} />Karte</Button>
          <Button variant="soft" onClick={() => nav(`/import?stapel=${deck.id}`)}><Icon name="upload" size={20} />Import</Button>
          <Button variant="soft" onClick={() => nav(`/karten?stapel=${deck.id}`)}><Icon name="list" size={20} />Alle Karten</Button>
          <Button variant="soft" onClick={async () => { await saveFile(backupFileName('csv', deck.name.replace(/[^\p{L}\p{N}]+/gu, '-')), 'text/csv', await exportCsv(deck.id)); }}><Icon name="download" size={20} />CSV</Button>
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="font-bold">Lektionen</h2>
            <Button size="sm" variant="ghost" onClick={() => { setError(''); setEdit({ id: null, name: '', description: '' }); }} data-testid="add-lesson"><Icon name="plus" size={18} />Lektion</Button>
          </div>
          {s.lessons.length === 0 ? (
            <p className="rounded-card border border-dashed border-line p-4 text-sm text-muted">Noch keine Karten. Lektionen sind optional – sie helfen, einen Stapel in Kapitel zu teilen.</p>
          ) : (
            <ul className="space-y-2">
              {s.lessons.map((l) => (
                <li key={l.lesson?.id ?? 'none'} data-testid="lesson-row">
                  <Card className="!p-3.5">
                    <div className="flex items-start gap-1">
                      <Link to={`/karten?stapel=${deck.id}&lektion=${l.lesson?.id ?? ''}`} className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{l.lesson?.name ?? 'Ohne Lektion'}</div>
                        <div className="text-xs text-muted">
                          {l.total} Karten, {l.due} fällig, {l.difficult} schwierig{l.lesson?.lastPracticedAt ? `, zuletzt ${relativeDay(l.lesson.lastPracticedAt).toLowerCase()}` : ''}
                        </div>
                      </Link>
                      {l.lesson && <>
                        <IconButton icon="edit" label={`${l.lesson.name} umbenennen`} className="-my-1.5 h-10 w-10 text-muted" onClick={() => { setError(''); setEdit({ id: l.lesson!.id, name: l.lesson!.name, description: l.lesson!.description }); }} />
                        <IconButton icon="trash" label={`${l.lesson.name} löschen`} className="-my-1.5 -mr-2 h-10 w-10 text-muted" onClick={() => { setDelCards(false); setDel(l.lesson); }} />
                      </>}
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex-1"><ProgressBar value={l.progress} color={`rgb(var(--deck-${deck.color}-ink))`} /></div>
                      {l.total > 0 && l.lesson && <Button size="sm" variant="soft" onClick={() => learn([l.lesson!.id])}>Lernen</Button>}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Lektion bearbeiten' : 'Neue Lektion'} footer={<Button className="w-full" onClick={() => void save()} data-testid="save-lesson">Speichern</Button>}>
        {edit && (
          <div className="space-y-4">
            <Field label="Name"><input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Kapitel 1" className={inputCls} data-testid="in-lesson-name" /></Field>
            <Field label="Beschreibung (optional)"><input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className={inputCls} /></Field>
            {error && <p role="alert" className="rounded-2xl bg-bad-soft p-3 text-sm font-medium text-bad">{error}</p>}
          </div>
        )}
      </Sheet>

      <Confirm open={!!del} danger title={`„${del?.name}“ löschen?`} confirmLabel={delCards ? 'Lektion und Karten löschen' : 'Nur Lektion löschen'}
        text={delCount ? `Die ${delCount} Karten dieser Lektion bleiben im Stapel und stehen danach unter „Ohne Lektion“.` : 'Die Lektion enthält keine Karten.'}
        onCancel={() => setDel(null)} onConfirm={async () => { await deleteLesson(del!.id, delCards); toast('Lektion gelöscht'); setDel(null); }}>
        {delCount > 0 && (
          <label className="mt-3 flex items-start gap-3 rounded-2xl bg-bad-soft p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[rgb(var(--bad))]" checked={delCards} onChange={(e) => setDelCards(e.target.checked)} data-testid="del-with-cards" />
            <span>Auch die {delCount} Karten samt Lernverlauf endgültig löschen</span>
          </label>
        )}
      </Confirm>
    </Page>
  );
}
