import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Confirm, EmptyState, Field, Icon, IconButton, Page, ProgressBar, Sheet, inputCls, toast } from '../components/ui';
import { addLesson, deleteLesson, updateLesson, ValidationError } from '../db/repo';
import { relativeDay } from '../lib/dates';
import { loadLessonStats, type LessonStats } from '../stats/stats';
import { SectionTabs } from './VocabList';

export default function Lessons() {
  const nav = useNavigate();
  const stats = useLiveQuery(() => loadLessonStats(), []);
  const [edit, setEdit] = useState<{ id: string | null; name: string; description: string } | null>(null);
  const [error, setError] = useState('');
  const [del, setDel] = useState<LessonStats | null>(null);
  const [delVocab, setDelVocab] = useState(false);

  const save = async () => {
    if (!edit) return;
    try {
      if (edit.id) await updateLesson(edit.id, edit.name, edit.description);
      else await addLesson(edit.name, edit.description);
      toast('Lektion gespeichert'); setEdit(null); setError('');
    } catch (e) { setError(e instanceof ValidationError ? e.message : 'Speichern fehlgeschlagen.'); }
  };

  return (
    <Page title="Vokabeln" actions={<IconButton icon="plus" label="Lektion anlegen" onClick={() => { setError(''); setEdit({ id: null, name: '', description: '' }); }} />}>
      <SectionTabs active="lektionen" />
      {stats && stats.filter((s) => s.lesson).length === 0 && (
        <EmptyState icon="book" title="Noch keine Lektionen" text="Lektionen bündeln Vokabeln, zum Beispiel „Persisch III – Lektion 1“ oder „Verben“.">
          <Button onClick={() => setEdit({ id: null, name: '', description: '' })}>Lektion anlegen</Button>
        </EmptyState>
      )}
      <div className="space-y-3">
        {stats?.map((s) => (
          <Card key={s.lesson?.id ?? 'none'} data-testid="lesson-card">
            <div className="flex items-start gap-2">
              <Link to={`/vokabeln?lektion=${s.lesson?.id ?? ''}`} className="min-w-0 flex-1">
                <h2 className="truncate font-bold">{s.lesson?.name ?? 'Ohne Lektion'}</h2>
                {s.lesson?.description && <p className="truncate text-sm text-muted">{s.lesson.description}</p>}
              </Link>
              {s.lesson && <>
                <IconButton icon="edit" label={`${s.lesson.name} umbenennen`} className="-my-1 text-muted" onClick={() => { setError(''); setEdit({ id: s.lesson!.id, name: s.lesson!.name, description: s.lesson!.description }); }} />
                <IconButton icon="trash" label={`${s.lesson.name} löschen`} className="-my-1 -mr-2 text-muted" onClick={() => { setDelVocab(false); setDel(s); }} />
              </>}
            </div>
            <div className="mt-3"><ProgressBar value={s.progress} /></div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span><b className="text-ink">{s.total}</b> {s.total === 1 ? 'Vokabel' : 'Vokabeln'}</span>
              <span><b className="text-ink">{s.mastered}</b> sicher</span>
              <span><b className="text-ink">{s.difficult}</b> schwierig</span>
              <span>{Math.round(s.progress * 100)} % Fortschritt</span>
              {s.lesson && <span>zuletzt geübt: {s.lesson.lastPracticedAt ? relativeDay(s.lesson.lastPracticedAt).toLowerCase() : 'nie'}</span>}
            </div>
            {s.lesson && s.total > 0 && (
              <Button size="sm" variant="soft" className="mt-3 w-full" onClick={() => nav(`/lernen?modus=lesson&lektion=${s.lesson!.id}`)}><Icon name="cards" size={18} />Lektion lernen</Button>
            )}
          </Card>
        ))}
      </div>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Lektion bearbeiten' : 'Neue Lektion'} footer={<Button className="w-full" onClick={() => void save()} data-testid="save-lesson">Speichern</Button>}>
        {edit && (
          <div className="space-y-4">
            <Field label="Name"><input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Persisch III – Lektion 1" className={inputCls} data-testid="in-lesson-name" /></Field>
            <Field label="Beschreibung (optional)"><input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className={inputCls} /></Field>
            {error && <p role="alert" className="rounded-2xl bg-bad/10 p-3 text-sm font-medium text-bad">{error}</p>}
          </div>
        )}
      </Sheet>

      <Confirm open={!!del} danger title={`„${del?.lesson?.name}“ löschen?`} confirmLabel={delVocab ? 'Lektion und Vokabeln löschen' : 'Nur Lektion löschen'}
        text={del?.total ? `Die ${del.total} Vokabeln dieser Lektion bleiben erhalten und stehen danach unter „Ohne Lektion“.` : 'Die Lektion enthält keine Vokabeln.'}
        onCancel={() => setDel(null)}
        onConfirm={async () => { await deleteLesson(del!.lesson!.id, delVocab); toast('Lektion gelöscht'); setDel(null); }}>
        {!!del?.total && (
          <label className="mt-3 flex items-start gap-3 rounded-2xl bg-bad/10 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[rgb(var(--bad))]" checked={delVocab} onChange={(e) => setDelVocab(e.target.checked)} data-testid="del-with-vocab" />
            <span>Auch die {del.total} Vokabeln samt Lernverlauf endgültig löschen</span>
          </label>
        )}
      </Confirm>
    </Page>
  );
}
