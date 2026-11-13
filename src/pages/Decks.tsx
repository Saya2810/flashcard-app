import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, EmptyState, Icon, IconButton, Page, ProgressBar, deckTint, toast } from '../components/ui';
import { loadSampleData } from '../db/sample';
import { loadDeckStats, type DeckStats } from '../stats/stats';
import { SectionTabs } from './shared';
import { locale, plural, t } from '../i18n';

function DeckTile({ s }: { s: DeckStats }) {
  return (
    <Link to={`/stapel/${s.deck.id}`} data-testid="deck-tile" className="block rounded-card bg-surface p-4 shadow-card transition active:scale-[0.99]">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-lg font-bold" style={deckTint(s.deck.color)} aria-hidden="true">
          {Array.from(s.deck.name.replace(/^Beispiel:\s*/, ''))[0]?.toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{s.deck.name}</span>
          <span className="block truncate text-sm text-muted">{s.deck.description || `${s.deck.front.label} → ${s.deck.back.label}`}</span>
        </span>
        {s.due > 0 && <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-on-accent" aria-label={t('{n} fällig', { n: s.due })}>{s.due}</span>}
      </div>
      <div className="mt-3"><ProgressBar value={s.progress} color={`rgb(var(--deck-${s.deck.color}-ink))`} /></div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted">
        <span>{s.total} {plural(s.total, 'Karte', 'Karten')}</span>
        {s.lessons.some((l) => l.lesson) && <span>{t('{n} Lektionen', { n: s.lessons.filter((l) => l.lesson).length })}</span>}
        {s.difficult > 0 && <span className="text-bad">{t('{n} schwierig', { n: s.difficult })}</span>}
        <span>{Math.round(s.progress * 100)} %</span>
      </div>
    </Link>
  );
}

const NO_SUBJECT = '\u0000';

export default function Decks() {
  const nav = useNavigate();
  const stats = useLiveQuery(() => loadDeckStats(), []);
  const groups = useMemo(() => {
    const m = new Map<string, DeckStats[]>();
    for (const s of stats ?? []) m.set(s.deck.subject || NO_SUBJECT, [...(m.get(s.deck.subject || NO_SUBJECT) ?? []), s]);
    return [...m.entries()].sort(([a], [b]) => (a === NO_SUBJECT ? 1 : b === NO_SUBJECT ? -1 : a.localeCompare(b, locale())));
  }, [stats]);

  return (
    <Page title={t("Stapel")} actions={<>
      <IconButton icon="upload" label={t("Importieren")} onClick={() => nav('/import')} />
      <IconButton icon="plus" label={t("Stapel anlegen")} onClick={() => nav('/stapel/neu')} />
    </>}>
      <SectionTabs active="stapel" />
      {stats && stats.length === 0 ? (
        <EmptyState icon="layers" title={t("Noch keine Stapel")} text={t("Ein Stapel sammelt Karten zu einem Thema: eine Sprache, ein Fach, eine Prüfung.")}>
          <Button onClick={() => nav('/stapel/neu')}><Icon name="plus" size={20} />{t('Stapel anlegen')}</Button>
          <Button variant="soft" onClick={() => nav('/import')}>{t('Importieren')}</Button>
          <Button variant="ghost" onClick={async () => { toast(`${await loadSampleData()} Beispielkarten geladen`); }}>{t('Beispiele laden')}</Button>
        </EmptyState>
      ) : (
        <div className="space-y-6 pb-4">
          {groups.map(([subject, list]) => (
            <section key={subject}>
              <h2 className="mb-2 px-1 text-sm font-semibold text-muted">{subject === NO_SUBJECT ? t('Ohne Fach') : subject}</h2>
              <div className="space-y-3">{list.map((s) => <DeckTile key={s.deck.id} s={s} />)}</div>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}
