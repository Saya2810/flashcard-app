import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Flashcard } from '../components/Flashcard';
import { Button, Card, EmptyState, Fa, Icon, IconButton, ProgressBar } from '../components/ui';
import { db } from '../db/db';
import { getSettings } from '../db/repo';
import { useSettings } from '../hooks/useSettings';
import { dayKey } from '../lib/dates';
import { newId } from '../lib/persian';
import { buildQueue, requeueWrong, type QueueItem } from '../srs/queue';
import { recordAnswer } from '../srs/review';
import { MODE_LABEL, type SessionConfig, type Vocab } from '../types';

const EMPTY_TEXT: Record<string, string> = {
  smart: 'Für heute ist nichts mehr fällig und es gibt keine neuen Vokabeln im Tageslimit. Über „Lektion lernen“ kannst du trotzdem weiterüben.',
  problem: 'Aktuell sind keine Problemvokabeln erkannt. Sie erscheinen hier, sobald du Wörter wiederholt falsch beantwortest.',
  new: 'In dieser Richtung hast du schon alle Vokabeln mindestens einmal geübt.',
  lesson: 'Die ausgewählten Lektionen enthalten keine Vokabeln.',
  exam: 'Zu dieser Auswahl gibt es keine Vokabeln.',
  free: 'Zu dieser Auswahl gibt es keine Vokabeln.',
};

interface Loaded { queue: QueueItem[]; vocab: Map<string, Vocab>; sessionId: string }

export default function Session() {
  const cfg = useLocation().state as SessionConfig | null;
  const nav = useNavigate();
  const settings = useSettings();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState({ correct: 0, incorrect: 0, wrong: [] as string[] });
  const [freeIdx, setFreeIdx] = useState(0);
  const [run, setRun] = useState(0);
  const started = useRef(-1);

  useEffect(() => {
    if (!cfg || started.current === run) return;
    started.current = run;
    (async () => {
      const now = Date.now();
      const s = await getSettings();
      const vocab = cfg.vocabIds
        ? (await db.vocab.bulkGet(cfg.vocabIds)).filter((v): v is Vocab => !!v)
        : cfg.lessonIds.length ? await db.vocab.where('lessonId').anyOf(cfg.lessonIds).toArray() : await db.vocab.toArray();
      const states = cfg.lessonIds.length || cfg.vocabIds ? await db.states.where('vocabId').anyOf(vocab.map((v) => v.id)).toArray() : await db.states.toArray();
      const today = await db.days.get(dayKey(now));
      const q = buildQueue(cfg, vocab, states, { now, settings: s, newDoneToday: today?.newCards ?? 0, reviewsDoneToday: today?.reviews ?? 0 });
      const sessionId = newId();
      if (q.length && cfg.mode !== 'free') {
        await db.sessions.add({ id: sessionId, mode: cfg.mode, direction: cfg.direction, lessonIds: cfg.lessonIds, startedAt: now, endedAt: now, planned: q.length, answered: 0, correct: 0, incorrect: 0 });
      }
      setQueue(q); setDone(0); setFlipped(false); setFreeIdx(0);
      setResult({ correct: 0, incorrect: 0, wrong: [] });
      setLoaded({ queue: q, vocab: new Map(vocab.map((v) => [v.id, v])), sessionId });
    })();
  }, [cfg, run]);

  const isFree = cfg?.mode === 'free';
  const current = isFree ? loaded?.queue[freeIdx] : queue[0];
  const vocab = current ? loaded?.vocab.get(current.vocabId) : undefined;
  const total = isFree ? loaded?.queue.length ?? 0 : done + queue.length;
  const wrongWords = useMemo(() => [...new Set(result.wrong)].map((id) => loaded?.vocab.get(id)).filter((v): v is Vocab => !!v), [result.wrong, loaded]);

  if (!cfg) return <Navigate to="/lernen" replace />;

  const answer = async (correct: boolean) => {
    if (!current || !loaded || busy) return;
    setBusy(true);
    try {
      await recordAnswer({ vocabId: current.vocabId, direction: current.direction, correct, sessionId: loaded.sessionId, kind: current.relearn ? 'relearn' : 'scheduled' });
      if (!current.relearn) {
        setResult((r) => ({ correct: r.correct + (correct ? 1 : 0), incorrect: r.incorrect + (correct ? 0 : 1), wrong: correct ? r.wrong : [...r.wrong, current.vocabId] }));
      }
      const rest = queue.slice(1);
      setQueue(correct ? rest : requeueWrong(rest, current));
      setDone((d) => d + 1);
      setFlipped(false);
    } finally { setBusy(false); }
  };

  const header = (
    <header className="safe-top flex items-center gap-3 px-4 pb-3">
      <IconButton icon="x" label="Sitzung beenden" className="-ml-2 text-muted" onClick={() => nav(-1)} />
      <div className="flex-1">
        <div className="mb-1.5 flex justify-between text-xs font-medium text-muted">
          <span>{MODE_LABEL[cfg.mode]}</span>
          <span className="tabular-nums" data-testid="progress">{isFree ? `${Math.min(freeIdx + 1, total)} / ${total}` : `${done} / ${total}`}</span>
        </div>
        <ProgressBar value={total ? (isFree ? (freeIdx + 1) / total : done / total) : 0} />
      </div>
    </header>
  );

  if (!loaded) return <div className="mx-auto flex min-h-full max-w-xl flex-col">{header}</div>;

  if (loaded.queue.length === 0) {
    return (
      <div className="mx-auto flex min-h-full max-w-xl flex-col">
        {header}
        <EmptyState icon="check" title="Nichts zu lernen" text={EMPTY_TEXT[cfg.mode]}>
          <Button onClick={() => nav('/lernen', { replace: true })}>Anderen Modus wählen</Button>
          <Button variant="soft" onClick={() => nav('/', { replace: true })}>Zur Startseite</Button>
        </EmptyState>
      </div>
    );
  }

  if (!isFree && queue.length === 0) {
    const n = result.correct + result.incorrect;
    return (
      <div className="mx-auto flex min-h-full max-w-xl flex-col px-4 safe-bottom" data-testid="summary">
        <div className="safe-top" />
        <h1 className="mt-6 text-[1.75rem] font-bold tracking-tight">Sitzung beendet</h1>
        <p className="text-muted">{n} {n === 1 ? 'Vokabel' : 'Vokabeln'} geübt, {n ? Math.round((result.correct / n) * 100) : 0} % beim ersten Versuch richtig.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Card><div className="flex items-center gap-2 text-ok"><Icon name="check" /><span className="text-sm font-semibold">Richtig</span></div><div className="mt-1 text-3xl font-bold tabular-nums" data-testid="sum-correct">{result.correct}</div></Card>
          <Card><div className="flex items-center gap-2 text-bad"><Icon name="x" /><span className="text-sm font-semibold">Falsch</span></div><div className="mt-1 text-3xl font-bold tabular-nums" data-testid="sum-incorrect">{result.incorrect}</div></Card>
        </div>
        {wrongWords.length > 0 && (
          <Card className="mt-4">
            <h2 className="mb-2 font-bold">Diese Wörter kommen bald wieder</h2>
            <ul className="divide-y divide-line">
              {wrongWords.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-sm">{v.german}</span>
                  <Fa className="shrink-0">{v.persian}</Fa>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <div className="mt-auto flex flex-col gap-2 pt-6">
          <Button size="lg" onClick={() => { setLoaded(null); setRun((r) => r + 1); }}>Weiterlernen</Button>
          <Button variant="soft" onClick={() => nav('/', { replace: true })}>Zur Startseite</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col">
      {header}
      <div className="px-4 text-center text-xs text-muted">
        {isFree ? 'Freies Lernen – zählt nicht für den Lernplan' : current?.relearn ? 'Noch einmal – vorhin falsch beantwortet' : current?.isNew ? 'Neue Vokabel' : ' '}
      </div>
      <main className="flex flex-1 flex-col justify-center px-4 py-4">
        {vocab && current && (
          <Flashcard key={`${current.vocabId}-${current.direction}-${isFree ? freeIdx : done}`} vocab={vocab} direction={current.direction} flipped={flipped} onFlip={() => setFlipped((f) => !f)} animations={settings.animations} />
        )}
      </main>
      <footer className="safe-bottom px-4 pt-2">
        {isFree ? (
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="soft" disabled={freeIdx === 0} onClick={() => { setFreeIdx(freeIdx - 1); setFlipped(false); }}>Zurück</Button>
            {freeIdx < total - 1
              ? <Button size="lg" onClick={() => { setFreeIdx(freeIdx + 1); setFlipped(false); }}>Weiter</Button>
              : <Button size="lg" onClick={() => nav(-1)}>Fertig</Button>}
          </div>
        ) : flipped ? (
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="bad" disabled={busy} onClick={() => void answer(false)} data-testid="btn-wrong"><Icon name="x" />Falsch</Button>
            <Button size="lg" variant="ok" disabled={busy} onClick={() => void answer(true)} data-testid="btn-right"><Icon name="check" />Richtig</Button>
          </div>
        ) : (
          <Button size="lg" variant="soft" className="w-full" onClick={() => setFlipped(true)}>Antwort zeigen</Button>
        )}
      </footer>
    </div>
  );
}
