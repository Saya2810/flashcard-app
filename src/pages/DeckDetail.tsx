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
import { t } from '../i18n';

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

  if (missing) return <Page title={t("Stapel")} back="/stapel"><EmptyState title={t("Nicht gefunden")} text={t("Diesen Stapel gibt es nicht mehr.")} /></Page>;
  if (!s) return <Page title={t("Stapel")} back>{null}</Page>;
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
      toast(t('Lektion gespeichert')); setEdit(null); setError('');
    } catch (e) { setError(e instanceof ValidationError ? e.message : t('Speichern fehlgeschlagen.')); }
  };
  const delCount = del ? s.lessons.find((l) => l.lesson?.id === del.id)?.total ?? 0 : 0;

  return (
    <Page title={deck.name} back="/stapel" actions={<IconButton icon="edit" label={t("Stapel bearbeiten")} onClick={() => nav(`/stapel/${deck.id}/bearbeiten`)} />}>
      <div className="space-y-4 pb-6">
        <Card className="overflow-hidden !p-0">
          <div className="px-4 pb-4 pt-4" style={deckTint(deck.color)}>
            <div className="text-xs font-semibold opacity-80">{deck.subject || t('Ohne Fach')}</div>
            <div className="mt-0.5 text-lg font-bold">{deck.front.label} → {deck.back.label}{deck.reverse ? t(' und zurück') : ''}</div>
            {deck.description && <p className="mt-1 text-sm opacity-90">{deck.description}</p>}
          </div>
          <div className="grid grid-cols-4 divide-x divide-line border-b border-line text-center">
            {[[t('Karten'), s.total], [t('Fällig'), s.due], [t('Schwierig'), s.difficult], [t('Fehlerquote'), pct(s.incorrect, s.reviews)]].map(([k, v]) => (
              <div key={k} className="px-1 py-3"><div className="text-lg font-bold tabular-nums">{v}</div><div className="text-[0.68rem] text-muted">{k}</div></div>
            ))}
          </div>
          <div className="p-4">
            <ProgressBar value={s.progress} color={`rgb(var(--deck-${deck.color}-ink))`} />
            <p className="mt-1.5 text-xs text-muted">{t('{p} % Lernfortschritt, {m} sicher beherrscht', { p: Math.round(s.progress * 100), m: s.mastered })}</p>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" className="col-span-2" onClick={() => learn()} disabled={!s.total} data-testid="deck-learn">{t('Stapel lernen')}</Button>
          <Button variant="soft" onClick={() => nav(`/karten/neu?stapel=${deck.id}`)} data-testid="deck-add-card"><Icon name="plus" size={20} />{t('Karte')}</Button>
          <Button variant="soft" onClick={() => nav(`/import?stapel=${deck.id}`)}><Icon name="upload" size={20} />{t('Import')}</Button>
          <Button variant="soft" onClick={() => nav(`/karten?stapel=${deck.id}`)}><Icon name="list" size={20} />{t('Alle Karten')}</Button>
          <Button variant="soft" onClick={async () => { await saveFile(backupFileName('csv', deck.name.replace(/[^\p{L}\p{N}]+/gu, '-')), 'text/csv', await exportCsv(deck.id)); }}><Icon name="download" size={20} />{t('CSV')}</Button>
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="font-bold">{t('Lektionen')}</h2>
            <Button size="sm" variant="ghost" onClick={() => { setError(''); setEdit({ id: null, name: '', description: '' }); }} data-testid="add-lesson"><Icon name="plus" size={18} />{t('Lektion')}</Button>
          </div>
          {s.lessons.length === 0 ? (
            <p className="rounded-card border border-dashed border-line p-4 text-sm text-muted">{t('Noch keine Karten. Lektionen sind optional – sie helfen, einen Stapel in Kapitel zu teilen.')}</p>
          ) : (
            <ul className="space-y-2">
              {s.lessons.map((l) => (
                <li key={l.lesson?.id ?? 'none'} data-testid="lesson-row">
                  <Card className="!p-3.5">
                    <div className="flex items-start gap-1">
                      <Link to={`/karten?stapel=${deck.id}&lektion=${l.lesson?.id ?? ''}`} className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{l.lesson?.name ?? t('Ohne Lektion')}</div>
                        <div className="text-xs text-muted">
                          {t('{total} Karten, {due} fällig, {hard} schwierig', { total: l.total, due: l.due, hard: l.difficult })}{l.lesson?.lastPracticedAt ? t(', zuletzt {when}', { when: relativeDay(l.lesson.lastPracticedAt).toLowerCase() }) : ''}
                        </div>
                      </Link>
                      {l.lesson && <>
                        <IconButton icon="edit" label={t('{name} umbenennen', { name: l.lesson.name })} className="-my-1.5 h-10 w-10 text-muted" onClick={() => { setError(''); setEdit({ id: l.lesson!.id, name: l.lesson!.name, description: l.lesson!.description }); }} />
                        <IconButton icon="trash" label={t('{name} löschen', { name: l.lesson.name })} className="-my-1.5 -mr-2 h-10 w-10 text-muted" onClick={() => { setDelCards(false); setDel(l.lesson); }} />
                      </>}
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex-1"><ProgressBar value={l.progress} color={`rgb(var(--deck-${deck.color}-ink))`} /></div>
                      {l.total > 0 && l.lesson && <Button size="sm" variant="soft" onClick={() => learn([l.lesson!.id])}>{t('Lernen')}</Button>}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('Lektion bearbeiten') : t('Neue Lektion')} footer={<Button className="w-full" onClick={() => void save()} data-testid="save-lesson">{t('Speichern')}</Button>}>
        {edit && (
          <div className="space-y-4">
            <Field label={t("Name")}><input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={t("Kapitel 1")} className={inputCls} data-testid="in-lesson-name" /></Field>
            <Field label={t("Beschreibung (optional)")}><input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className={inputCls} /></Field>
            {error && <p role="alert" className="rounded-2xl bg-bad-soft p-3 text-sm font-medium text-bad">{error}</p>}
          </div>
        )}
      </Sheet>

      <Confirm open={!!del} danger title={t('„{name}“ löschen?', { name: del?.name ?? '' })} confirmLabel={delCards ? t('Lektion und Karten löschen') : t('Nur Lektion löschen')}
        text={delCount ? t('Die {n} Karten dieser Lektion bleiben im Stapel und stehen danach unter „Ohne Lektion“.', { n: delCount }) : t('Die Lektion enthält keine Karten.')}
        onCancel={() => setDel(null)} onConfirm={async () => { await deleteLesson(del!.id, delCards); toast(t('Lektion gelöscht')); setDel(null); }}>
        {delCount > 0 && (
          <label className="mt-3 flex items-start gap-3 rounded-2xl bg-bad-soft p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[rgb(var(--bad))]" checked={delCards} onChange={(e) => setDelCards(e.target.checked)} data-testid="del-with-cards" />
            <span>{t('Auch die {n} Karten samt Lernverlauf endgültig löschen', { n: delCount })}</span>
          </label>
        )}
      </Confirm>
    </Page>
  );
}
