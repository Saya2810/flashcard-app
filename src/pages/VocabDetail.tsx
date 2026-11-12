import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Confirm, EmptyState, Fa, Icon, IconButton, Page, Stars, StatusBadge, toast } from '../components/ui';
import { db } from '../db/db';
import { deleteVocab, setPriority } from '../db/repo';
import { formatDate, formatDateTime, relativeDay } from '../lib/dates';
import { MIN_REVIEWS } from '../srs/metrics';
import { retrievability } from '../srs/scheduler';
import { DIRECTIONS, type Direction, type SchedState } from '../types';

export const DIR_LABEL: Record<Direction, string> = { 'fa-de': 'Persisch → Deutsch', 'de-fa': 'Deutsch → Persisch' };
const pct = (n: number) => `${(n * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-muted">{label}</dt><dd className="text-right font-semibold tabular-nums">{value}</dd></div>;
}

function DirectionStats({ dir, s }: { dir: Direction; s: SchedState | undefined }) {
  const r = retrievability(s, Date.now());
  return (
    <Card data-testid={`stats-${dir}`}>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-bold">{DIR_LABEL[dir]}</h3>
        <StatusBadge status={s?.status ?? 'neu'} />
      </div>
      {!s || s.total === 0 ? (
        <p className="text-sm text-muted">In dieser Richtung noch nicht geübt.</p>
      ) : (
        <dl className="divide-y divide-line">
          <Row label="Wiederholungen" value={s.total} />
          <Row label="Richtig" value={s.correct} />
          <Row label="Falsch" value={s.incorrect} />
          <Row label="Fehlerquote" value={<>{pct(s.incorrect / s.total)}{s.total < MIN_REVIEWS && <span className="ml-1 text-xs font-normal text-muted">(wenig Daten)</span>}</>} />
          <Row label="Richtig in Folge" value={s.curCorrect} />
          <Row label="Falsch in Folge" value={s.curIncorrect} />
          <Row label="Längste Fehlerserie" value={s.maxIncorrect} />
          <Row label="Letzter Fehler" value={s.lastIncorrectAt ? formatDate(s.lastIncorrectAt) : 'nie'} />
          <Row label="Gedächtnisstärke" value={r === null ? '–' : `${Math.round(r * 100)} %`} />
          <Row label="Stabilität" value={`${s.stability.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Tage`} />
          <Row label="Nächste Wiederholung" value={relativeDay(s.due)} />
        </dl>
      )}
    </Card>
  );
}

export default function VocabDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [limit, setLimit] = useState(30);
  const data = useLiveQuery(async () => {
    const v = await db.vocab.get(id);
    if (!v) return { v: null };
    const states = await db.states.where('vocabId').equals(id).toArray();
    const history = await db.reviews.where('[vocabId+ts]').between([id, 0], [id, Infinity]).reverse().limit(limit + 1).toArray();
    const lesson = v.lessonId ? await db.lessons.get(v.lessonId) : undefined;
    return { v, states, history, lesson };
  }, [id, limit]);

  if (!data) return <Page title="Vokabel" back>{null}</Page>;
  if (!data.v) return <Page title="Vokabel" back="/vokabeln"><EmptyState title="Nicht gefunden" text="Diese Vokabel gibt es nicht mehr." /></Page>;
  const { v, states = [], history = [], lesson } = data;

  return (
    <Page title="Vokabel" back actions={<>
      <IconButton icon="copy" label="Duplizieren" onClick={() => nav(`/vokabeln/neu?kopie=${v.id}`)} />
      <IconButton icon="edit" label="Bearbeiten" onClick={() => nav(`/vokabeln/${v.id}/bearbeiten`)} />
      <IconButton icon="trash" label="Löschen" className="text-bad" onClick={() => setConfirm(true)} />
    </>}>
      <div className="space-y-4 pb-4">
        <Card className="text-center">
          <Fa className="block text-4xl font-semibold" >{v.persian}</Fa>
          {v.translit && <div className="mt-1 italic text-muted">{v.translit}</div>}
          <div className="mt-3 text-2xl font-bold" lang="de">{v.german}</div>
          {v.altGerman.length > 0 && <div className="mt-1 text-sm text-muted" lang="de">auch: {v.altGerman.join(', ')}</div>}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-muted">
            <StatusBadge status={v.status} />
            {v.problem === 1 && <span className="font-semibold text-bad">Problemvokabel</span>}
            {v.sample === 1 && <span className="rounded-full bg-sunken px-2 py-0.5">Beispieldaten</span>}
            {lesson && <span className="rounded-full bg-sunken px-2 py-0.5">{lesson.name}</span>}
            {v.tags.map((t) => <span key={t} className="rounded-full bg-sunken px-2 py-0.5">{t}</span>)}
          </div>
        </Card>

        <Card>
          <h3 className="mb-1 font-bold">Priorität</h3>
          <Stars value={v.priority} onChange={async (p) => { await setPriority(v.id, p); toast('Priorität geändert'); }} />
          <p className="mt-1 text-xs text-muted">Höhere Priorität bedeutet kürzere Abstände zwischen den Wiederholungen.</p>
        </Card>

        {(v.grammar || v.exampleFa || v.exampleDe || v.notes) && (
          <Card className="space-y-3 text-sm">
            {v.grammar && <div><div className="text-xs font-semibold text-muted">Grammatik</div><div dir="auto">{v.grammar}</div></div>}
            {(v.exampleFa || v.exampleDe) && (
              <div><div className="text-xs font-semibold text-muted">Beispiel</div>
                {v.exampleFa && <Fa className="block">{v.exampleFa}</Fa>}
                {v.exampleDe && <div lang="de" className="text-muted">{v.exampleDe}</div>}
              </div>
            )}
            {v.notes && <div><div className="text-xs font-semibold text-muted">Notizen</div><div dir="auto" className="whitespace-pre-wrap">{v.notes}</div></div>}
          </Card>
        )}

        {DIRECTIONS.map((d) => <DirectionStats key={d} dir={d} s={states.find((s) => s.direction === d)} />)}

        <Card>
          <h3 className="mb-2 font-bold">Verlauf</h3>
          {history.length === 0 ? <p className="text-sm text-muted">Noch keine Antworten.</p> : (
            <ol className="divide-y divide-line" data-testid="history">
              {history.slice(0, limit).map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className={e.correct ? 'text-ok' : 'text-bad'}><Icon name={e.correct ? 'check' : 'x'} size={18} /></span>
                  <span className="flex-1">
                    <span className="font-semibold">{e.correct ? 'Richtig' : 'Falsch'}</span>
                    <span className="text-muted">{' '}{e.direction === 'fa-de' ? 'Persisch → Dt.' : 'Dt. → Persisch'}{e.kind === 'relearn' ? ', Wiederholung in der Sitzung' : ''}</span>
                    {e.meta && <span className="block text-xs text-muted">nächstes Intervall {e.meta.intervalDays} {e.meta.intervalDays === 1 ? 'Tag' : 'Tage'}</span>}
                  </span>
                  <time className="shrink-0 text-xs tabular-nums text-muted">{formatDateTime(e.ts)}</time>
                </li>
              ))}
            </ol>
          )}
          {history.length > limit && <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setLimit(limit + 50)}>Ältere anzeigen</Button>}
        </Card>
        <p className="text-center text-xs text-muted">Angelegt am {formatDate(v.createdAt)}{v.lastReviewAt ? `, zuletzt gelernt am ${formatDate(v.lastReviewAt)}` : ''}</p>
      </div>
      <Confirm open={confirm} danger title="Vokabel löschen?" text="Die Vokabel und ihr gesamter Lernverlauf werden endgültig gelöscht." confirmLabel="Endgültig löschen"
        onCancel={() => setConfirm(false)} onConfirm={async () => { await deleteVocab([v.id]); toast('Gelöscht'); nav('/vokabeln', { replace: true }); }} />
    </Page>
  );
}
