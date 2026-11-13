import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RichText, sideLook } from '../components/RichText';
import { Button, Card, Confirm, DeckDot, EmptyState, Icon, IconButton, Page, Stars, StatusBadge, toast } from '../components/ui';
import { db } from '../db/db';
import { deleteCards, setPriority } from '../db/repo';
import { formatDate, formatDateTime, relativeDay } from '../lib/dates';
import { MIN_REVIEWS } from '../srs/metrics';
import { retrievability } from '../srs/scheduler';
import type { Deck, Direction, SchedState } from '../types';

const pct = (n: number) => `${(n * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;
export const dirLabel = (deck: Deck | undefined, d: Direction) => (deck ? (d === 'fwd' ? `${deck.front.label} → ${deck.back.label}` : `${deck.back.label} → ${deck.front.label}`) : d);

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-muted">{label}</dt><dd className="text-right font-semibold tabular-nums">{value}</dd></div>;
}

function DirectionStats({ title, s, dir }: { title: string; s: SchedState | undefined; dir: Direction }) {
  const r = retrievability(s, Date.now());
  return (
    <Card data-testid={`stats-${dir}`}>
      <div className="mb-1 flex items-center justify-between gap-2"><h3 className="font-bold">{title}</h3><StatusBadge status={s?.status ?? 'neu'} /></div>
      {!s || s.total === 0 ? <p className="text-sm text-muted">In dieser Richtung noch nicht gelernt.</p> : (
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

export default function CardDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [limit, setLimit] = useState(30);
  const data = useLiveQuery(async () => {
    const c = await db.cards.get(id);
    if (!c) return { c: null };
    const [deck, lesson, states, history] = await Promise.all([
      db.decks.get(c.deckId), c.lessonId ? db.lessons.get(c.lessonId) : undefined,
      db.states.where('cardId').equals(id).toArray(),
      db.reviews.where('[cardId+ts]').between([id, 0], [id, Infinity]).reverse().limit(limit + 1).toArray(),
    ]);
    return { c, deck, lesson, states, history };
  }, [id, limit]);

  if (!data) return <Page title="Karte" back>{null}</Page>;
  if (!data.c || !data.deck) return <Page title="Karte" back="/karten"><EmptyState title="Nicht gefunden" text="Diese Karte gibt es nicht mehr." /></Page>;
  const { c, deck, lesson, states = [], history = [] } = data;
  const dirs: Direction[] = deck.reverse ? ['fwd', 'rev'] : ['fwd'];

  return (
    <Page title="Karte" back actions={<>
      <IconButton icon="copy" label="Duplizieren" onClick={() => nav(`/karten/neu?kopie=${c.id}`)} />
      <IconButton icon="edit" label="Bearbeiten" onClick={() => nav(`/karten/${c.id}/bearbeiten`)} />
      <IconButton icon="trash" label="Löschen" className="text-bad" onClick={() => setConfirm(true)} />
    </>}>
      <div className="space-y-4 pb-6">
        <Card className="space-y-4 text-center">
          <Link to={`/stapel/${deck.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-3 py-1 text-xs font-semibold"><DeckDot color={deck.color} size={8} />{deck.name}{lesson ? `, ${lesson.name}` : ''}</Link>
          <div><div className="mb-1 text-xs font-semibold text-muted">{deck.front.label}</div><RichText text={c.front} rich={deck.rich} look={sideLook(deck.front)} baseRem={1.6} testId="detail-front" /></div>
          <div className="border-t border-line pt-4"><div className="mb-1 text-xs font-semibold text-muted">{deck.back.label}</div><RichText text={c.back} rich={deck.rich} look={sideLook(deck.back)} baseRem={1.4} testId="detail-back" />
            {c.altBack.length > 0 && <div className="mt-1 text-sm text-muted" dir="auto">auch: {c.altBack.join(', ')}</div>}</div>
          {deck.fields.filter((f) => c.fields[f.key]).map((f) => (
            <div key={f.key} className="text-start"><div className="text-xs font-semibold text-muted">{f.label}</div><RichText text={c.fields[f.key]} rich={deck.rich} look={{ dir: f.dir, font: f.font }} /></div>
          ))}
          {c.notes && <div className="text-start"><div className="text-xs font-semibold text-muted">Notiz</div><RichText text={c.notes} rich={deck.rich} look={{ dir: 'auto' }} className="text-sm" /></div>}
          <div className="flex flex-wrap justify-center gap-2 text-xs text-muted">
            <StatusBadge status={c.status} />
            {c.problem === 1 && <span className="font-semibold text-bad">Problemkarte</span>}
            {c.sample === 1 && <span className="rounded-full bg-sunken px-2 py-0.5">Beispiel</span>}
            {c.tags.map((t) => <span key={t} className="rounded-full bg-sunken px-2 py-0.5">{t}</span>)}
          </div>
        </Card>

        <Card>
          <h3 className="mb-1 font-bold">Priorität</h3>
          <Stars value={c.priority} onChange={async (p) => { await setPriority(c.id, p); toast('Priorität geändert'); }} />
          <p className="mt-1 text-xs text-muted">Höhere Priorität bedeutet kürzere Abstände zwischen den Wiederholungen.</p>
        </Card>

        {dirs.map((d) => <DirectionStats key={d} dir={d} title={d === 'fwd' ? `${deck.front.label} → ${deck.back.label}` : `${deck.back.label} → ${deck.front.label}`} s={states.find((s) => s.direction === d)} />)}

        <Card>
          <h3 className="mb-2 font-bold">Verlauf</h3>
          {history.length === 0 ? <p className="text-sm text-muted">Noch keine Antworten.</p> : (
            <ol className="divide-y divide-line" data-testid="history">
              {history.slice(0, limit).map((e) => (
                <li key={e.id} className="flex items-start gap-3 py-2 text-sm">
                  <span className={e.correct ? 'mt-0.5 text-ok' : 'mt-0.5 text-bad'}><Icon name={e.correct ? 'check' : 'x'} size={18} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{e.correct ? 'Richtig' : 'Falsch'}</span>
                    <span className="text-muted"> {dirLabel(deck, e.direction)}{e.kind === 'relearn' ? ', Wiederholung in der Sitzung' : ''}</span>
                    {e.typed && <span className="block truncate text-xs text-muted" dir="auto">Getippt: {e.typed}</span>}
                    {e.meta && <span className="block text-xs text-muted">nächstes Intervall {e.meta.intervalDays} {e.meta.intervalDays === 1 ? 'Tag' : 'Tage'}</span>}
                  </span>
                  <time className="shrink-0 text-xs tabular-nums text-muted">{formatDateTime(e.ts)}</time>
                </li>
              ))}
            </ol>
          )}
          {history.length > limit && <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setLimit(limit + 50)}>Ältere anzeigen</Button>}
        </Card>
        <p className="text-center text-xs text-muted">Angelegt am {formatDate(c.createdAt)}{c.lastReviewAt ? `, zuletzt gelernt am ${formatDate(c.lastReviewAt)}` : ''}</p>
      </div>
      <Confirm open={confirm} danger title="Karte löschen?" text="Die Karte und ihr gesamter Lernverlauf werden endgültig gelöscht." confirmLabel="Endgültig löschen"
        onCancel={() => setConfirm(false)} onConfirm={async () => { await deleteCards([c.id]); toast('Gelöscht'); nav(`/stapel/${deck.id}`, { replace: true }); }} />
    </Page>
  );
}
