import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Chip, DeckDot, Icon, Page, Segmented, Sheet, Stepper } from '../components/ui';
import { db } from '../db/db';
import { useSettings } from '../hooks/useSettings';
import { loadOverview } from '../stats/stats';
import { MODE_LABEL, PRIORITY_LABEL, type DirectionChoice, type Mode, type SessionConfig } from '../types';
import { DIRECTION_OPTIONS } from './shared';
import { locale, t } from '../i18n';

const MODES: { mode: Mode; icon: string; text: string }[] = [
  { mode: 'smart', icon: 'target', text: 'Fällige Wiederholungen zuerst, dazu Problemkarten und einige neue.' },
  { mode: 'problem', icon: 'alert', text: 'Nur Karten, die du oft falsch beantwortest.' },
  { mode: 'new', icon: 'sparkle', text: 'Nur Karten, die du in dieser Richtung noch nie gelernt hast.' },
  { mode: 'lesson', icon: 'layers', text: 'Ganze Stapel oder einzelne Lektionen durcharbeiten.' },
  { mode: 'exam', icon: 'check', text: 'Intensiv nach Stapel, Lektion und Priorität – die schwächsten Karten zuerst.' },
  { mode: 'free', icon: 'eye', text: 'Karten frei durchblättern. Zählt nicht für den Lernplan.' },
];

const CONJ_MODES: { mode: 'conj-full' | 'conj-forms'; icon: string; title: string; text: string }[] = [
  { mode: 'conj-full', icon: 'keyboard', title: 'Konjugation üben', text: 'Alle Formen einer Zeitform nacheinander schreiben und vergleichen.' },
  { mode: 'conj-forms', icon: 'alert', title: 'Schwierige Formen', text: 'Einzelne Formen üben, die du oft falsch hast.' },
];

export default function Learn() {
  const settings = useSettings();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), [], []);
  const lessons = useLiveQuery(() => db.lessons.toArray(), [], []);
  const o = useLiveQuery(() => loadOverview(settings.defaultDirection), [settings.defaultDirection]);

  const [mode, setMode] = useState<Mode | null>(null);
  const [direction, setDirection] = useState<DirectionChoice>(settings.defaultDirection);
  const [deckIds, setDeckIds] = useState<string[]>([]);
  const [lessonIds, setLessonIds] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<number[]>([]);
  const [size, setSize] = useState(settings.sessionSize);

  useEffect(() => { setDirection(settings.defaultDirection); setSize(settings.sessionSize); }, [settings.defaultDirection, settings.sessionSize]);
  useEffect(() => {
    const m = params.get('modus') as Mode | null;
    if (m && MODE_LABEL[m]) {
      setMode(m);
      const d = params.get('stapel'); const l = params.get('lektion');
      setDeckIds(d ? [d] : []); setLessonIds(l ? [l] : []);
    }
  }, [params]);

  const lessonsOfSelected = useMemo(() => lessons.filter((l) => deckIds.includes(l.deckId)).sort((a, b) => a.name.localeCompare(b.name, locale(), { numeric: true })), [lessons, deckIds]);
  const close = () => { setMode(null); if (params.size) setParams({}, { replace: true }); };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const start = () => {
    if (!mode) return;
    const keepLessons = lessonIds.filter((id) => lessonsOfSelected.some((l) => l.id === id));
    const cfg: SessionConfig = { mode, direction, deckIds, lessonIds: keepLessons, priorities: mode === 'exam' ? priorities : [], size };
    nav('/lernen/sitzung', { state: cfg });
  };
  const hint: Partial<Record<Mode, string>> = o ? { smart: t('{due} fällig, {new} neu', { due: o.dueToday, new: o.newAvailable }), problem: t('{n} erkannt', { n: o.problemCount }), new: t('{n} verfügbar', { n: o.newAvailable }) } : {};

  return (
    <Page title={t("Lernen")} subtitle={t("Wähle, wie du üben möchtest.")}>
      <div className="space-y-3">
        {MODES.map((m) => (
          <button key={m.mode} type="button" onClick={() => setMode(m.mode)} data-testid={`mode-${m.mode}`}
            className="flex w-full items-center gap-4 rounded-card bg-surface p-4 text-left shadow-card transition active:scale-[0.99]">
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${m.mode === 'smart' ? 'bg-accent text-on-accent' : 'bg-accent-soft text-accent'}`}><Icon name={m.icon} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-bold">{t(MODE_LABEL[m.mode])}</span>
                {hint[m.mode] && <span className="shrink-0 text-xs font-medium text-muted">{hint[m.mode]}</span>}
              </span>
              <span className="block text-sm text-muted">{t(m.text)}</span>
            </span>
          </button>
        ))}
        <h2 className="px-1 pt-2 text-sm font-bold text-muted">{t('Konjugation')}</h2>
        {CONJ_MODES.map((m) => (
          <button key={m.mode} type="button" onClick={() => nav(`/verben/lernen?modus=${m.mode}`)} data-testid={`mode-${m.mode}`}
            className="flex w-full items-center gap-4 rounded-card bg-surface p-4 text-left shadow-card transition active:scale-[0.99]">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent"><Icon name={m.icon} /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{t(m.title)}</span>
              <span className="block text-sm text-muted">{t(m.text)}</span>
            </span>
          </button>
        ))}
      </div>

      <Sheet open={!!mode} onClose={close} title={mode ? t(MODE_LABEL[mode]) : ''} footer={<Button size="lg" className="w-full" onClick={start} data-testid="start-session">{t('Sitzung starten')}</Button>}>
        <div className="space-y-5">
          <p className="rounded-2xl bg-sunken p-3 text-sm">
            {mode === 'free' ? t('Freies Lernen verändert weder den Lernplan noch die Statistik.') : t('Diese Sitzung zählt für Lernplan und Statistik.')}
            {settings.typedAnswer && mode !== 'free' && ' ' + t('Antwort-Eingabe ist eingeschaltet.')}
          </p>
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('Richtung')}</h3>
            <Segmented label={t("Richtung")} value={direction} onChange={setDirection} options={DIRECTION_OPTIONS} />
            <p className="mt-1.5 text-xs text-muted">{t('Rück → Vorder gilt nur für Stapel, bei denen die Gegenrichtung eingeschaltet ist.')}</p>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('Stapel')}</h3>
            <div className="flex flex-wrap gap-2">
              <Chip active={deckIds.length === 0} onClick={() => { setDeckIds([]); setLessonIds([]); }}>{t('Alle')}</Chip>
              {decks.map((d) => (
                <Chip key={d.id} active={deckIds.includes(d.id)} onClick={() => setDeckIds(toggle(deckIds, d.id))}>
                  <span className="inline-flex items-center gap-1.5"><DeckDot color={d.color} size={9} />{d.name}</span>
                </Chip>
              ))}
            </div>
          </div>
          {lessonsOfSelected.length > 0 && mode !== 'problem' && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('Lektionen')}</h3>
              <div className="flex flex-wrap gap-2">
                <Chip active={lessonIds.length === 0} onClick={() => setLessonIds([])}>{t('Alle')}</Chip>
                {lessonsOfSelected.map((l) => <Chip key={l.id} active={lessonIds.includes(l.id)} onClick={() => setLessonIds(toggle(lessonIds, l.id))}>{l.name}</Chip>)}
              </div>
            </div>
          )}
          {mode === 'exam' && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('Prioritäten')}</h3>
              <div className="flex flex-wrap gap-2">
                <Chip active={priorities.length === 0} onClick={() => setPriorities([])}>{t('Alle')}</Chip>
                {[5, 4, 3, 2, 1].map((p) => <Chip key={p} active={priorities.includes(p)} onClick={() => setPriorities(toggle(priorities, p))}>{p} – {t(PRIORITY_LABEL[p])}</Chip>)}
              </div>
            </div>
          )}
          <Card className="flex items-center justify-between border border-line !shadow-none">
            <span className="font-semibold">{t('Anzahl Karten')}</span>
            <Stepper label={t("Anzahl Karten")} value={size} onChange={setSize} min={5} max={500} step={5} />
          </Card>
        </div>
      </Sheet>
    </Page>
  );
}
