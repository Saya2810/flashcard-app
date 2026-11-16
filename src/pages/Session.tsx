import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Flashcard } from '../components/Flashcard';
import { lookStyle, RichText, sideLook } from '../components/RichText';
import { Button, Card, DeckDot, EmptyState, Icon, IconButton, ProgressBar, inputCls, cx } from '../components/ui';
import { db } from '../db/db';
import { getSettings } from '../db/repo';
import { useSettings } from '../hooks/useSettings';
import { dayKey } from '../lib/dates';
import { newId } from '../lib/text';
import { buildQueue, requeueWrong, type QueueItem } from '../srs/queue';
import { recordAnswer } from '../srs/review';
import { MODE_LABEL, type Card as CardT, type Deck, type SessionConfig } from '../types';
import { plural, t } from '../i18n';

const EMPTY_TEXT: Record<string, string> = {
  smart: 'Für heute ist nichts mehr fällig und das Limit für neue Karten ist erreicht. Über „Stapel & Lektionen“ kannst du trotzdem weiterüben.',
  problem: 'Aktuell sind keine Problemkarten erkannt. Sie erscheinen hier, sobald du Karten wiederholt falsch beantwortest.',
  new: 'In dieser Richtung hast du schon alle ausgewählten Karten mindestens einmal gelernt.',
  lesson: 'Die Auswahl enthält keine Karten.',
  exam: 'Zu dieser Auswahl gibt es keine Karten.',
  free: 'Zu dieser Auswahl gibt es keine Karten.',
};

interface Loaded { queue: QueueItem[]; cards: Map<string, CardT>; decks: Map<string, Deck>; sessionId: string }

export default function Session() {
  const cfg = useLocation().state as SessionConfig | null;
  const nav = useNavigate();
  const settings = useSettings();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState({ correct: 0, incorrect: 0, wrong: [] as string[] });
  const [freeIdx, setFreeIdx] = useState(0);
  const [run, setRun] = useState(0);
  const started = useRef(-1);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!cfg || started.current === run) return;
    started.current = run;
    (async () => {
      const now = Date.now();
      const s = await getSettings();
      const cards = cfg.cardIds
        ? (await db.cards.bulkGet(cfg.cardIds)).filter((c): c is CardT => !!c)
        : cfg.lessonIds.length ? await db.cards.where('lessonId').anyOf(cfg.lessonIds).toArray()
        : cfg.deckIds.length ? await db.cards.where('deckId').anyOf(cfg.deckIds).toArray()
        : await db.cards.toArray();
      const filtered = cfg.cardIds || cfg.lessonIds.length || cfg.deckIds.length;
      const states = filtered ? await db.states.where('cardId').anyOf(cards.map((c) => c.id)).toArray() : await db.states.toArray();
      const decks = await db.decks.toArray();
      const today = await db.days.get(dayKey(now));
      const q = buildQueue(cfg, cards, states, { now, decks, settings: s, newDoneToday: today?.newCards ?? 0, reviewsDoneToday: today?.reviews ?? 0 });
      const sessionId = newId();
      if (q.length && cfg.mode !== 'free') {
        await db.sessions.add({ id: sessionId, mode: cfg.mode, direction: cfg.direction, deckIds: cfg.deckIds, lessonIds: cfg.lessonIds, startedAt: now, endedAt: now, planned: q.length, answered: 0, correct: 0, incorrect: 0 });
      }
      setQueue(q); setDone(0); setFlipped(false); setFreeIdx(0); setTyped('');
      setResult({ correct: 0, incorrect: 0, wrong: [] });
      setLoaded({ queue: q, cards: new Map(cards.map((c) => [c.id, c])), decks: new Map(decks.map((d) => [d.id, d])), sessionId });
    })();
  }, [cfg, run]);

  const isFree = cfg?.mode === 'free';
  const current = isFree ? loaded?.queue[freeIdx] : queue[0];
  const card = current ? loaded?.cards.get(current.cardId) : undefined;
  const deck = card ? loaded?.decks.get(card.deckId) : undefined;
  const total = isFree ? loaded?.queue.length ?? 0 : done + queue.length;
  const typing = settings.typedAnswer;
  const diffOptions = useMemo(() => ({ ignoreCase: settings.diffIgnoreCase, ignorePunctuation: settings.diffIgnorePunctuation }), [settings.diffIgnoreCase, settings.diffIgnorePunctuation]);
  const wrongCards = useMemo(() => [...new Set(result.wrong)].map((id) => loaded?.cards.get(id)).filter((c): c is CardT => !!c), [result.wrong, loaded]);

  useEffect(() => { if (typing && !flipped && card) inputRef.current?.focus({ preventScroll: true }); }, [typing, flipped, card, done, freeIdx]);

  if (!cfg) return <Navigate to="/lernen" replace />;

  const next = () => { setFlipped(false); setTyped(''); };
  const answer = async (correct: boolean) => {
    if (!current || !loaded || busy) return;
    setBusy(true);
    try {
      await recordAnswer({ cardId: current.cardId, direction: current.direction, correct, sessionId: loaded.sessionId, kind: current.relearn ? 'relearn' : 'scheduled', typed: typing ? typed : undefined });
      if (!current.relearn) {
        setResult((r) => ({ correct: r.correct + (correct ? 1 : 0), incorrect: r.incorrect + (correct ? 0 : 1), wrong: correct ? r.wrong : [...r.wrong, current.cardId] }));
      }
      const rest = queue.slice(1);
      setQueue(correct ? rest : requeueWrong(rest, current));
      setDone((d) => d + 1);
      next();
    } finally { setBusy(false); }
  };

  const header = (
    <header className="safe-top flex items-center gap-3 px-4 pb-3">
      <IconButton icon="x" label={t("Sitzung beenden")} className="-ml-2 text-muted" onClick={() => nav(-1)} />
      <div className="flex-1">
        <div className="mb-1.5 flex justify-between gap-2 text-xs font-medium text-muted">
          <span className="flex min-w-0 items-center gap-1.5">{deck && <DeckDot color={deck.color} size={8} />}<span className="truncate">{deck?.name ?? t(MODE_LABEL[cfg.mode])}</span></span>
          <span className="shrink-0 tabular-nums" data-testid="progress">{isFree ? `${Math.min(freeIdx + 1, total)} / ${total}` : `${done} / ${total}`}</span>
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
        <EmptyState icon="check" title={t("Nichts zu lernen")} text={t(EMPTY_TEXT[cfg.mode])}>
          <Button onClick={() => nav('/lernen', { replace: true })}>{t('Anderen Modus wählen')}</Button>
          <Button variant="soft" onClick={() => nav('/', { replace: true })}>{t('Zur Startseite')}</Button>
        </EmptyState>
      </div>
    );
  }

  if (!isFree && queue.length === 0) {
    const n = result.correct + result.incorrect;
    return (
      <div className="pop-in mx-auto flex min-h-full max-w-xl flex-col px-4 safe-bottom" data-testid="summary">
        <div className="safe-top" />
        <h1 className="mt-6 text-[1.9rem] font-bold tracking-tight">{t('Sitzung beendet')}</h1>
        <p className="text-muted">{t('{n} {cards} gelernt, {p} % beim ersten Versuch richtig.', { n, cards: plural(n, 'Karte', 'Karten'), p: n ? Math.round((result.correct / n) * 100) : 0 })}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Card className="!bg-ok-soft"><div className="flex items-center gap-2 text-ok"><Icon name="check" /><span className="text-sm font-semibold">{t('Richtig')}</span></div><div className="mt-1 text-3xl font-bold tabular-nums" data-testid="sum-correct">{result.correct}</div></Card>
          <Card className="!bg-bad-soft"><div className="flex items-center gap-2 text-bad"><Icon name="x" /><span className="text-sm font-semibold">{t('Falsch')}</span></div><div className="mt-1 text-3xl font-bold tabular-nums" data-testid="sum-incorrect">{result.incorrect}</div></Card>
        </div>
        {wrongCards.length > 0 && (
          <Card className="mt-4">
            <h2 className="mb-2 font-bold">{t('Diese Karten kommen bald wieder')}</h2>
            <ul className="divide-y divide-line">
              {wrongCards.map((c) => {
                const d = loaded.decks.get(c.deckId)!;
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <RichText text={c.front} rich={d.rich} look={{ ...sideLook(d.front), scale: 1, weight: 600 }} className="clamp-2 min-w-0" />
                    <RichText text={c.back} rich={d.rich} look={{ ...sideLook(d.back), scale: 1, weight: 400 }} className="clamp-2 min-w-0 text-muted" />
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        <div className="mt-auto flex flex-col gap-2 pt-6">
          <Button size="lg" onClick={() => { setLoaded(null); setRun((r) => r + 1); }}>{t('Weiterlernen')}</Button>
          <Button variant="soft" onClick={() => nav('/', { replace: true })}>{t('Zur Startseite')}</Button>
        </div>
      </div>
    );
  }

  const answerSide = deck && current ? (current.direction === 'fwd' ? deck.back : deck.front) : null;

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col">
      {header}
      <div className="px-4 text-center text-xs font-medium text-muted">
        {isFree ? t('Freies Lernen – zählt nicht für den Lernplan') : current?.relearn ? t('Noch einmal – vorhin falsch beantwortet') : current?.isNew ? t('Neue Karte') : ' '}
      </div>
      <main className="flex flex-1 flex-col justify-center px-4 py-4">
        {card && deck && current && (
          <Flashcard key={`${current.cardId}-${current.direction}-${isFree ? freeIdx : done}`} card={card} deck={deck} direction={current.direction}
            flipped={flipped} onFlip={() => setFlipped((f) => !f)} animations={settings.animations}
            typed={typing ? typed : null} diffOptions={diffOptions} />
        )}
      </main>
      <footer className="safe-bottom space-y-3 px-4 pt-2">
        {typing && !flipped && answerSide && (
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">{t('Deine Antwort')} ({answerSide.label})</span>
            <textarea ref={inputRef} rows={2} value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="typed-input"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setFlipped(true); } }}
              dir={answerSide.dir} lang={answerSide.lang || undefined} autoCapitalize="off" autoCorrect="off" spellCheck={false}
              className={cx(inputCls, 'resize-none')} style={lookStyle({ ...sideLook(answerSide), weight: 400, scale: Math.min(answerSide.scale, 1.2) }, 1.05)} />
          </label>
        )}
        {isFree ? (
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="soft" disabled={freeIdx === 0} onClick={() => { setFreeIdx(freeIdx - 1); next(); }}>{t('Zurück')}</Button>
            {freeIdx < total - 1
              ? <Button size="lg" onClick={() => { setFreeIdx(freeIdx + 1); next(); }}>{t('Weiter')}</Button>
              : <Button size="lg" onClick={() => nav(-1)}>{t('Fertig')}</Button>}
          </div>
        ) : flipped ? (
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="bad" disabled={busy} onClick={() => void answer(false)} data-testid="btn-wrong"><Icon name="x" />{t('Falsch')}</Button>
            <Button size="lg" variant="ok" disabled={busy} onClick={() => void answer(true)} data-testid="btn-right"><Icon name="check" />{t('Richtig')}</Button>
          </div>
        ) : (
          <Button size="lg" variant="soft" className="w-full" onClick={() => setFlipped(true)} data-testid="reveal">{typing ? t('Lösung vergleichen') : t('Lösung zeigen')}</Button>
        )}
      </footer>
    </div>
  );
}
