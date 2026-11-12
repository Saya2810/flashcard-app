import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Chip, Icon, Page, Segmented, Sheet, Stepper } from '../components/ui';
import { db } from '../db/db';
import { useSettings } from '../hooks/useSettings';
import { loadOverview } from '../stats/stats';
import { MODE_LABEL, PRIORITY_LABEL, type DirectionChoice, type Mode, type SessionConfig } from '../types';

const MODES: { mode: Mode; icon: string; text: string }[] = [
  { mode: 'smart', icon: 'target', text: 'Fällige Wiederholungen zuerst, dazu Problemvokabeln und einige neue.' },
  { mode: 'problem', icon: 'alert', text: 'Nur Vokabeln, die du oft falsch beantwortest.' },
  { mode: 'new', icon: 'sparkle', text: 'Nur Vokabeln, die du in dieser Richtung noch nie geübt hast.' },
  { mode: 'lesson', icon: 'book', text: 'Alle Vokabeln ausgewählter Lektionen.' },
  { mode: 'exam', icon: 'check', text: 'Intensiv nach Lektion und Priorität – die schwächsten Wörter zuerst.' },
  { mode: 'free', icon: 'eye', text: 'Karten frei durchblättern. Zählt nicht für den Lernplan.' },
];

export const DIRECTION_OPTIONS: { value: DirectionChoice; label: string }[] = [
  { value: 'fa-de', label: 'Persisch → Deutsch' },
  { value: 'de-fa', label: 'Deutsch → Persisch' },
  { value: 'mixed', label: 'Gemischt' },
];

export default function Learn() {
  const settings = useSettings();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const lessons = useLiveQuery(() => db.lessons.orderBy('name').toArray(), [], []);
  const o = useLiveQuery(() => loadOverview(settings.defaultDirection), [settings.defaultDirection]);

  const [mode, setMode] = useState<Mode | null>(null);
  const [direction, setDirection] = useState<DirectionChoice>(settings.defaultDirection);
  const [lessonIds, setLessonIds] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<number[]>([]);
  const [size, setSize] = useState(settings.sessionSize);

  useEffect(() => { setDirection(settings.defaultDirection); setSize(settings.sessionSize); }, [settings.defaultDirection, settings.sessionSize]);
  useEffect(() => {
    const m = params.get('modus') as Mode | null;
    const l = params.get('lektion');
    if (m && MODE_LABEL[m]) { setMode(m); if (l) setLessonIds([l]); }
  }, [params]);

  const close = () => { setMode(null); if (params.size) setParams({}, { replace: true }); };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const start = () => {
    if (!mode) return;
    const cfg: SessionConfig = { mode, direction, lessonIds: mode === 'problem' ? [] : lessonIds, priorities: mode === 'exam' ? priorities : [], size };
    nav('/lernen/sitzung', { state: cfg });
  };
  const hint: Partial<Record<Mode, string>> = o ? {
    smart: `${o.dueToday} fällig, ${o.newAvailable} neu`,
    problem: `${o.problemCount} erkannt`,
    new: `${o.newAvailable} verfügbar`,
  } : {};
  const showLessons = mode !== 'problem';

  return (
    <Page title="Lernen" subtitle="Wähle, wie du üben möchtest.">
      <div className="space-y-3">
        {MODES.map((m) => (
          <button key={m.mode} type="button" onClick={() => setMode(m.mode)} data-testid={`mode-${m.mode}`}
            className="flex w-full items-center gap-4 rounded-card bg-surface p-4 text-left shadow-card active:scale-[0.99]">
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${m.mode === 'smart' ? 'bg-accent text-on-accent' : 'bg-sunken text-accent'}`}><Icon name={m.icon} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-bold">{MODE_LABEL[m.mode]}</span>
                {hint[m.mode] && <span className="shrink-0 text-xs font-medium text-muted">{hint[m.mode]}</span>}
              </span>
              <span className="block text-sm text-muted">{m.text}</span>
            </span>
          </button>
        ))}
      </div>

      <Sheet open={!!mode} onClose={close} title={mode ? MODE_LABEL[mode] : ''} footer={<Button size="lg" className="w-full" onClick={start} data-testid="start-session">Sitzung starten</Button>}>
        <div className="space-y-5">
          {mode === 'free' ? (
            <p className="rounded-2xl bg-sunken p-3 text-sm">Freies Lernen verändert weder den Lernplan noch die Statistik.</p>
          ) : (
            <p className="rounded-2xl bg-sunken p-3 text-sm">Diese Sitzung zählt für Lernplan und Statistik.</p>
          )}
          <div>
            <h3 className="mb-2 text-sm font-semibold">Richtung</h3>
            <Segmented label="Richtung" value={direction} onChange={setDirection} options={DIRECTION_OPTIONS.map((d) => ({ ...d, label: d.value === 'mixed' ? 'Gemischt' : d.value === 'fa-de' ? 'Pers. → Dt.' : 'Dt. → Pers.' }))} />
          </div>
          {showLessons && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Lektionen</h3>
              <div className="flex flex-wrap gap-2">
                <Chip active={lessonIds.length === 0} onClick={() => setLessonIds([])}>Alle</Chip>
                {lessons.map((l) => <Chip key={l.id} active={lessonIds.includes(l.id)} onClick={() => setLessonIds(toggle(lessonIds, l.id))}>{l.name}</Chip>)}
              </div>
              {lessons.length === 0 && <p className="mt-2 text-sm text-muted">Noch keine Lektionen angelegt.</p>}
            </div>
          )}
          {mode === 'exam' && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Prioritäten</h3>
              <div className="flex flex-wrap gap-2">
                <Chip active={priorities.length === 0} onClick={() => setPriorities([])}>Alle</Chip>
                {[5, 4, 3, 2, 1].map((p) => <Chip key={p} active={priorities.includes(p)} onClick={() => setPriorities(toggle(priorities, p))}>{p} – {PRIORITY_LABEL[p]}</Chip>)}
              </div>
            </div>
          )}
          <Card className="flex items-center justify-between !shadow-none border border-line">
            <span className="font-semibold">Anzahl Karten</span>
            <Stepper label="Anzahl Karten" value={size} onChange={setSize} min={5} max={500} step={5} />
          </Card>
        </div>
      </Sheet>
    </Page>
  );
}
