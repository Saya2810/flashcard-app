import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AnswerDiff } from '../components/AnswerDiff';
import { lookStyle, RichText } from '../components/RichText';
import { Button, Card, DeckDot, EmptyState, Icon, IconButton, ProgressBar, cx, inputCls } from '../components/ui';
import { schemeLook } from '../conj/look';
import { buildConjugationQueue, buildFormQueue, type ConjugationItem, type FormItem } from '../conj/queue';
import { definedCells } from '../conj/repo';
import { recordFormAnswer } from '../conj/review';
import { type ConjScheme, type ConjSessionConfig, type FormState, type Verb } from '../conj/types';
import { db } from '../db/db';
import { useSettings } from '../hooks/useSettings';
import { plural, t } from '../i18n';
import { closest, isIdentical } from '../lib/diff';
import { newId } from '../lib/text';
import { requeueWrong } from '../srs/queue';
import type { Deck } from '../types';

interface Loaded {
  verbs: Map<string, Verb>; schemes: Map<string, ConjScheme>; decks: Map<string, Deck>; sessionId: string;
  full: ConjugationItem[]; forms: FormItem[];
}
interface WrongForm { verbId: string; tenseId: string; personId: string; label: string; solution: string }

/** Training of the conjugation module: complete conjugations (mode 1) or single difficult forms (mode 2). */
export default function ConjSession() {
  const cfg = useLocation().state as ConjSessionConfig | null;
  const nav = useNavigate();
  const settings = useSettings();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [run, setRun] = useState(0);
  const started = useRef(-1);
  const [fullQueue, setFullQueue] = useState<ConjugationItem[]>([]);
  const [formQueue, setFormQueue] = useState<FormItem[]>([]);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState({ correct: 0, incorrect: 0, wrong: [] as WrongForm[] });

  // mode 1 state
  const [typed, setTyped] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [grades, setGrades] = useState<(boolean | null)[]>([]);
  // mode 2 state
  const [single, setSingle] = useState('');
  const [revealed, setRevealed] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const diffOptions = useMemo(() => ({ ignoreCase: settings.diffIgnoreCase, ignorePunctuation: settings.diffIgnorePunctuation }), [settings.diffIgnoreCase, settings.diffIgnorePunctuation]);
  const isFull = cfg?.mode === 'conj-full';

  useEffect(() => {
    if (!cfg || started.current === run) return;
    started.current = run;
    void (async () => {
      const now = Date.now();
      const [verbs, schemes, states, decks] = await Promise.all([db.verbs.toArray(), db.schemes.toArray(), db.formStates.toArray(), db.decks.toArray()]);
      const data = { verbs, schemes, states: states as FormState[], now };
      const full = cfg.mode === 'conj-full' ? buildConjugationQueue(cfg, data) : [];
      const forms = cfg.mode === 'conj-forms' ? buildFormQueue(cfg, data) : [];
      const planned = full.length || forms.length;
      const sessionId = newId();
      if (planned) {
        await db.sessions.add({ id: sessionId, mode: cfg.mode, direction: 'fwd', deckIds: cfg.deckIds, lessonIds: cfg.lessonIds, startedAt: now, endedAt: now, planned, answered: 0, correct: 0, incorrect: 0 });
      }
      setFullQueue(full); setFormQueue(forms); setDone(0); setResult({ correct: 0, incorrect: 0, wrong: [] });
      setTyped([]); setChecked(false); setGrades([]); setSingle(''); setRevealed(false);
      setLoaded({ verbs: new Map(verbs.map((v) => [v.id, v])), schemes: new Map(schemes.map((s) => [s.id, s])), decks: new Map(decks.map((d) => [d.id, d])), sessionId, full, forms });
    })();
  }, [cfg, run]);

  const curFull = fullQueue[0];
  const curForm = formQueue[0];
  const cur = isFull ? curFull : curForm;
  const verb = cur ? loaded?.verbs.get(cur.verbId) : undefined;
  const scheme = verb ? loaded?.schemes.get(verb.schemeId) : undefined;
  const deck = verb ? loaded?.decks.get(verb.deckId) : undefined;
  const look = schemeLook(scheme, 500);
  const inputStyle = lookStyle({ ...look, scale: Math.min(1.4, look.scale ?? 1) * settings.answerFontScale }, 1.05);

  const cells = useMemo(() => (verb && scheme && curFull ? definedCells(verb, scheme, [curFull.tenseId]) : []), [verb, scheme, curFull]);
  const tenseLabel = (s: ConjScheme | undefined, id: string) => s?.tenses.find((x) => x.id === id)?.label ?? '';
  const personLabel = (s: ConjScheme | undefined, id: string) => s?.persons.find((x) => x.id === id)?.label ?? '';

  // Fresh inputs for every new conjugation / form.
  useEffect(() => {
    if (!isFull || !curFull) return;
    setTyped(cells.map(() => '')); setChecked(false); setGrades(cells.map(() => null));
    const id = requestAnimationFrame(() => inputs.current[0]?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [isFull, curFull, cells, done]);
  useEffect(() => { setSingle(''); setRevealed(false); }, [curForm, done]);
  useEffect(() => { if (!isFull && curForm && !revealed) inputRef.current?.focus({ preventScroll: true }); }, [isFull, curForm, revealed, done]);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!cfg) return <Navigate to="/verben" replace />;

  const total = isFull ? done + fullQueue.length : done + formQueue.length;
  const header = (
    <header className="safe-top flex items-center gap-3 px-4 pb-3">
      <IconButton icon="x" label={t('Sitzung beenden')} className="-ml-2 text-muted" onClick={() => nav(-1)} />
      <div className="flex-1">
        <div className="mb-1.5 flex justify-between gap-2 text-xs font-medium text-muted">
          <span className="flex min-w-0 items-center gap-1.5">{deck && <DeckDot color={deck.color} size={8} />}<span className="truncate">{deck?.name ?? (isFull ? t('Konjugation üben') : t('Schwierige Formen'))}</span></span>
          <span className="shrink-0 tabular-nums" data-testid="progress">{done} / {total}</span>
        </div>
        <ProgressBar value={total ? done / total : 0} />
      </div>
    </header>
  );

  if (!loaded) return <div className="mx-auto flex min-h-full max-w-xl flex-col">{header}</div>;

  if ((isFull ? loaded.full : loaded.forms).length === 0) {
    return (
      <div className="mx-auto flex min-h-full max-w-xl flex-col">
        {header}
        <EmptyState icon="check" title={t('Nichts zu üben')}
          text={isFull ? t('Zu dieser Auswahl gibt es keine Konjugationen mit eingetragenen Formen.') : t('Aktuell gibt es keine schwierigen Formen. Sie erscheinen hier, sobald du einzelne Formen falsch beantwortest.')}>
          <Button onClick={() => nav('/verben/lernen', { replace: true })}>{t('Auswahl ändern')}</Button>
          <Button variant="soft" onClick={() => nav('/', { replace: true })}>{t('Zur Startseite')}</Button>
        </EmptyState>
      </div>
    );
  }

  if ((isFull ? fullQueue : formQueue).length === 0) {
    const n = result.correct + result.incorrect;
    return (
      <div className="pop-in mx-auto flex min-h-full max-w-xl flex-col px-4 safe-bottom" data-testid="summary">
        <div className="safe-top" />
        <h1 className="mt-6 text-[1.9rem] font-bold tracking-tight">{t('Sitzung beendet')}</h1>
        <p className="text-muted">{t('{n} {forms} geübt, {p} % beim ersten Versuch richtig.', { n, forms: plural(n, 'Form', 'Formen'), p: n ? Math.round((result.correct / n) * 100) : 0 })}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Card className="!bg-ok-soft"><div className="flex items-center gap-2 text-ok"><Icon name="check" /><span className="text-sm font-semibold">{t('Richtig')}</span></div><div className="mt-1 text-3xl font-bold tabular-nums" data-testid="sum-correct">{result.correct}</div></Card>
          <Card className="!bg-bad-soft"><div className="flex items-center gap-2 text-bad"><Icon name="x" /><span className="text-sm font-semibold">{t('Falsch')}</span></div><div className="mt-1 text-3xl font-bold tabular-nums" data-testid="sum-incorrect">{result.incorrect}</div></Card>
        </div>
        {result.wrong.length > 0 && (
          <Card className="mt-4">
            <h2 className="mb-2 font-bold">{t('Diese Formen kommen bald wieder')}</h2>
            <ul className="divide-y divide-line">
              {result.wrong.map((w, i) => {
                const v = loaded.verbs.get(w.verbId); const s = v && loaded.schemes.get(v.schemeId);
                return (
                  <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-muted" dir="auto">{v?.infinitive} · {w.label}</span>
                    <span className="shrink-0 font-semibold" dir={s?.dir} lang={s?.lang || undefined}>{w.solution}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        <div className="mt-auto flex flex-col gap-2 pt-6">
          <Button size="lg" onClick={() => { setLoaded(null); setRun((r) => r + 1); }}>{t('Weiterlernen')}</Button>
          <Button variant="soft" onClick={() => nav('/verben', { replace: true })}>{t('Zu den Verben')}</Button>
        </div>
      </div>
    );
  }

  if (!verb || !scheme || !cur) return <div className="mx-auto flex min-h-full max-w-xl flex-col">{header}</div>;

  const wrongEntry = (tenseId: string, personId: string, solution: string): WrongForm => ({ verbId: verb.id, tenseId, personId, label: `${tenseLabel(scheme, tenseId)} – ${personLabel(scheme, personId)}`, solution });

  // ---------------- Mode 1: complete conjugation ----------------
  if (isFull && curFull) {
    const focusAt = (i: number) => inputs.current[i]?.focus({ preventScroll: true });
    const graded = grades.filter((g) => g !== null).length;
    const right = grades.filter((g) => g === true).length;
    const exact = cells.map((c, i) => isIdentical(closest(typed[i] ?? '', c.answers, diffOptions).parts) && !!(typed[i] ?? '').trim());
    const acceptExact = () => setGrades((g) => g.map((x, i) => (x === null && exact[i] ? true : x)));
    const save = async () => {
      if (busy || graded < cells.length) return;
      setBusy(true);
      try {
        const wrong: WrongForm[] = [];
        let c = 0;
        for (let i = 0; i < cells.length; i++) {
          const ok = grades[i] === true;
          await recordFormAnswer({ verbId: verb.id, tenseId: cells[i].tenseId, personId: cells[i].personId, correct: ok, sessionId: loaded.sessionId, source: 'full', typed: typed[i] || undefined });
          if (ok) c++; else wrong.push(wrongEntry(cells[i].tenseId, cells[i].personId, cells[i].answers[0]));
        }
        setResult((r) => ({ correct: r.correct + c, incorrect: r.incorrect + (cells.length - c), wrong: [...r.wrong, ...wrong] }));
        setFullQueue((q) => q.slice(1));
        setDone((d) => d + 1);
      } finally { setBusy(false); }
    };

    return (
      <div className="mx-auto flex min-h-full max-w-xl flex-col">
        {header}
        <main className="flex-1 space-y-3 px-4 pb-4">
          <Card>
            <div className="flex items-baseline justify-between gap-3">
              <RichText text={verb.infinitive} rich={false} look={{ ...look, weight: 700 }} baseRem={1.6} />
              <span className="text-sm font-semibold text-accent" dir="auto" data-testid="tense-title">{tenseLabel(scheme, curFull.tenseId)}</span>
            </div>
            {verb.translation && <p className="text-sm text-muted" dir="auto">{verb.translation}</p>}
          </Card>

          {!checked ? (
            <Card className="space-y-2">
              {cells.map((c, i) => (
                <label key={c.personId} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm font-medium" dir="auto" lang={scheme.lang || undefined}>{personLabel(scheme, c.personId)}</span>
                  <input ref={(el) => { inputs.current[i] = el; }} value={typed[i] ?? ''} data-testid={`conj-input-${i}`} aria-label={personLabel(scheme, c.personId)}
                    onChange={(e) => setTyped((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                    onKeyDown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); if (i < cells.length - 1) focusAt(i + 1); else setChecked(true); }}
                    dir={look.dir} lang={look.lang || undefined} autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint={i < cells.length - 1 ? 'next' : 'done'}
                    className={cx(inputCls, '!py-2')} style={inputStyle} />
                </label>
              ))}
            </Card>
          ) : (
            <div className="space-y-3" data-testid="conj-results">
              <Card className="space-y-2">
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span data-testid="conj-progress">{t('{a} von {b} bewertet', { a: graded, b: cells.length })}</span>
                  <span className="text-ok" data-testid="conj-score">{t('{a} von {b} richtig', { a: right, b: cells.length })}</span>
                </div>
                <ProgressBar value={cells.length ? graded / cells.length : 0} />
                <p className="text-xs text-muted">{t('Rot durchgestrichen: zu viel oder anders; rot unterstrichen: fehlt.')} {t('Du entscheidest selbst, ob es richtig war.')}</p>
              </Card>
              {cells.map((c, i) => (
                <Card key={c.personId} className="space-y-2" data-testid={`form-result-${i}`}>
                  <div className="text-sm font-semibold text-muted" dir="auto">{personLabel(scheme, c.personId)}</div>
                  <AnswerDiff typed={typed[i] ?? ''} answers={c.answers} rich={false} look={look} options={diffOptions} alwaysShowSolution hideNote />
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant={grades[i] === false ? 'bad' : 'soft'} size="sm" aria-pressed={grades[i] === false} onClick={() => setGrades((g) => g.map((x, j) => (j === i ? false : x)))} data-testid={`btn-wrong-${i}`}><Icon name="x" size={18} />{t('Falsch')}</Button>
                    <Button variant={grades[i] === true ? 'ok' : 'soft'} size="sm" aria-pressed={grades[i] === true} onClick={() => setGrades((g) => g.map((x, j) => (j === i ? true : x)))} data-testid={`btn-right-${i}`}><Icon name="check" size={18} />{t('Richtig')}</Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </main>
        <footer className="safe-bottom space-y-2 px-4 pt-2">
          {!checked ? (
            <Button size="lg" className="w-full" onClick={() => setChecked(true)} data-testid="conj-check">{t('Auswerten')}</Button>
          ) : (
            <>
              {exact.some((x, i) => x && grades[i] === null) && <Button variant="soft" className="w-full" onClick={acceptExact} data-testid="accept-matches">{t('Exakte Treffer als richtig übernehmen')}</Button>}
              <Button size="lg" className="w-full" disabled={busy || graded < cells.length} onClick={() => void save()} data-testid="conj-save">{done + 1 >= total ? t('Fertig') : t('Speichern und weiter')}</Button>
            </>
          )}
        </footer>
      </div>
    );
  }

  // ---------------- Mode 2: single difficult forms ----------------
  if (!curForm) return null;
  const cell = definedCells(verb, scheme, [curForm.tenseId]).find((c) => c.personId === curForm.personId);
  const answers = cell?.answers ?? [];
  const answer = async (correct: boolean) => {
    if (busy || !cell) return;
    setBusy(true);
    try {
      await recordFormAnswer({ verbId: verb.id, tenseId: curForm.tenseId, personId: curForm.personId, correct, sessionId: loaded.sessionId, source: 'forms', kind: curForm.relearn ? 'relearn' : 'scheduled', typed: single || undefined });
      if (!curForm.relearn) setResult((r) => ({ correct: r.correct + (correct ? 1 : 0), incorrect: r.incorrect + (correct ? 0 : 1), wrong: correct ? r.wrong : [...r.wrong, wrongEntry(curForm.tenseId, curForm.personId, answers[0])] }));
      const rest = formQueue.slice(1);
      setFormQueue(correct ? rest : requeueWrong(rest, curForm));
      setDone((d) => d + 1);
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col">
      {header}
      <div className="px-4 text-center text-xs font-medium text-muted">{curForm.relearn ? t('Noch einmal – vorhin falsch beantwortet') : ' '}</div>
      <main className="flex flex-1 flex-col justify-center gap-3 px-4 py-4">
        <Card className="text-center">
          <RichText text={verb.infinitive} rich={false} look={{ ...look, weight: 700 }} baseRem={1.9} />
          {verb.translation && <p className="text-sm text-muted" dir="auto">{verb.translation}</p>}
          <p className="mt-3 text-sm font-semibold text-accent" dir="auto" data-testid="form-prompt">{tenseLabel(scheme, curForm.tenseId)} · {personLabel(scheme, curForm.personId)}</p>
        </Card>
        {revealed && <AnswerDiff typed={single} answers={answers} rich={false} look={look} options={diffOptions} alwaysShowSolution />}
      </main>
      <footer className="safe-bottom space-y-3 px-4 pt-2">
        {!revealed && (
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">{t('Deine Antwort')}</span>
            <input ref={inputRef} value={single} onChange={(e) => setSingle(e.target.value)} data-testid="typed-input" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setRevealed(true); } }}
              dir={look.dir} lang={look.lang || undefined} autoCapitalize="off" autoCorrect="off" spellCheck={false} className={inputCls} style={inputStyle} />
          </label>
        )}
        {revealed ? (
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="bad" disabled={busy} onClick={() => void answer(false)} data-testid="btn-wrong"><Icon name="x" />{t('Falsch')}</Button>
            <Button size="lg" variant="ok" disabled={busy} onClick={() => void answer(true)} data-testid="btn-right"><Icon name="check" />{t('Richtig')}</Button>
          </div>
        ) : (
          <Button size="lg" variant="soft" className="w-full" onClick={() => setRevealed(true)} data-testid="reveal">{t('Lösung vergleichen')}</Button>
        )}
      </footer>
    </div>
  );
}
