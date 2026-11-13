import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Chip, Page, Segmented, Stepper } from '../components/ui';
import { scopedVerbs } from '../conj/queue';
import type { ConjMode, ConjSessionConfig } from '../conj/types';
import { db } from '../db/db';
import { t, locale } from '../i18n';
import { LANGUAGES } from './DeckForm';

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Set-up screen of the two conjugation training modes. */
export default function ConjLearn() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), [], []);
  const lessons = useLiveQuery(() => db.lessons.toArray(), [], []);
  const schemes = useLiveQuery(() => db.schemes.toArray(), [], []);
  const verbs = useLiveQuery(() => db.verbs.toArray(), [], []);

  const verbParam = params.get('verb');
  const [mode, setMode] = useState<ConjMode>(params.get('modus') === 'conj-forms' ? 'conj-forms' : 'conj-full');
  const [deckIds, setDeckIds] = useState<string[]>(params.get('stapel') ? [params.get('stapel')!] : []);
  const [lessonIds, setLessonIds] = useState<string[]>(params.get('lektion') ? [params.get('lektion')!] : []);
  const [langs, setLangs] = useState<string[]>([]);
  const [tenseLabels, setTenseLabels] = useState<string[]>([]);
  const [size, setSize] = useState(mode === 'conj-full' ? 5 : 15);
  useEffect(() => { setSize(mode === 'conj-full' ? 5 : 15); }, [mode]);

  const usedDeckIds = useMemo(() => new Set(verbs.map((v) => v.deckId)), [verbs]);
  const lessonsOfSelected = useMemo(() => lessons.filter((l) => deckIds.includes(l.deckId)).sort((a, b) => a.name.localeCompare(b.name, locale(), { numeric: true })), [lessons, deckIds]);
  const langOptions = useMemo(() => [...new Set(schemes.map((s) => s.lang))].sort(), [schemes]);
  const tenseOptions = useMemo(() => [...new Set(schemes.flatMap((s) => s.tenses.map((x) => x.label)))], [schemes]);
  const langName = (tag: string) => t(LANGUAGES.find((l) => l.tag === tag)?.label ?? 'Keine Angabe');

  const cfg: ConjSessionConfig = {
    mode, deckIds, lessonIds: lessonIds.filter((id) => lessonsOfSelected.some((l) => l.id === id)), langs, tenseLabels, size,
    ...(verbParam ? { verbIds: [verbParam] } : {}),
  };
  const matching = scopedVerbs(cfg, verbs, schemes).length;

  return (
    <Page title={t('Konjugation üben')} back="/verben">
      <div className="space-y-4 pb-8">
        <Card className="space-y-3">
          <Segmented label={t('Übungsmodus')} value={mode} onChange={setMode} options={[{ value: 'conj-full', label: 'Vollständig' }, { value: 'conj-forms', label: 'Schwierige Formen' }]} />
          <p className="text-sm text-muted" data-testid="mode-hint">
            {mode === 'conj-full'
              ? t('Du schreibst alle Formen einer Zeitform nacheinander (Enter springt zum nächsten Feld) und siehst danach jede Abweichung farbig.')
              : t('Nur einzelne Formen, die du oft falsch hast. Jede Kombination aus Verb, Zeitform und Person wird einzeln geplant – häufige Fehler kommen öfter.')}
          </p>
        </Card>

        {verbParam ? (
          <Card><p className="text-sm">{t('Nur dieses eine Verb wird geübt.')}</p></Card>
        ) : (
          <Card className="space-y-4">
            <div>
              <h2 className="mb-2 text-sm font-semibold">{t('Stapel')}</h2>
              <div className="flex flex-wrap gap-2">
                {decks.filter((d) => usedDeckIds.has(d.id)).map((d) => <Chip key={d.id} active={deckIds.includes(d.id)} onClick={() => setDeckIds(toggle(deckIds, d.id))}>{d.name}</Chip>)}
                {usedDeckIds.size === 0 && <span className="text-sm text-muted">{t('Noch keine Verben')}</span>}
              </div>
            </div>
            {lessonsOfSelected.length > 0 && (
              <div>
                <h2 className="mb-2 text-sm font-semibold">{t('Lektion')}</h2>
                <div className="flex flex-wrap gap-2">{lessonsOfSelected.map((l) => <Chip key={l.id} active={lessonIds.includes(l.id)} onClick={() => setLessonIds(toggle(lessonIds, l.id))}>{l.name}</Chip>)}</div>
              </div>
            )}
            {langOptions.length > 1 && (
              <div>
                <h2 className="mb-2 text-sm font-semibold">{t('Sprache')}</h2>
                <div className="flex flex-wrap gap-2">{langOptions.map((l) => <Chip key={l || '-'} active={langs.includes(l)} onClick={() => setLangs(toggle(langs, l))}>{langName(l)}</Chip>)}</div>
              </div>
            )}
          </Card>
        )}

        {tenseOptions.length > 1 && (
          <Card>
            <h2 className="mb-2 text-sm font-semibold">{t('Zeitformen')}</h2>
            <div className="flex flex-wrap gap-2">{tenseOptions.map((l) => <Chip key={l} active={tenseLabels.includes(l)} onClick={() => setTenseLabels(toggle(tenseLabels, l))}><span dir="auto">{l}</span></Chip>)}</div>
            <p className="mt-2 text-xs text-muted">{t('Ohne Auswahl werden alle Zeitformen geübt.')}</p>
          </Card>
        )}

        <Card className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">{mode === 'conj-full' ? t('Anzahl Konjugationen') : t('Anzahl Formen')}</span>
          <Stepper label={mode === 'conj-full' ? t('Anzahl Konjugationen') : t('Anzahl Formen')} value={size} onChange={setSize} min={1} max={mode === 'conj-full' ? 50 : 100} />
        </Card>

        <Button size="lg" className="w-full" disabled={matching === 0} onClick={() => nav('/verben/sitzung', { state: cfg })} data-testid="start-conj">{t('Übung starten')}</Button>
        {matching === 0 && <p className="text-center text-sm text-muted">{t('Zu dieser Auswahl gibt es keine Verben.')}</p>}
      </div>
    </Page>
  );
}
