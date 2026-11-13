import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, DeckDot, EmptyState, Icon, ProgressBar, Ring, toast } from '../components/ui';
import { loadSampleData } from '../db/sample';
import { useSettings } from '../hooks/useSettings';
import { DAY_MS, greeting } from '../lib/dates';
import { loadDeckStats, loadOverview } from '../stats/stats';
import type { SessionConfig } from '../types';
import { locale, plural, t } from '../i18n';

function Tile({ to, icon, value, label, tone }: { to: string; icon: string; value: number | string; label: string; tone?: string }) {
  return (
    <Link to={to} className="rounded-card bg-surface p-4 shadow-card transition active:scale-[0.98]">
      <div className={`mb-2 ${tone ?? 'text-accent'}`}><Icon name={icon} /></div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-sm text-muted">{label}</div>
    </Link>
  );
}

export default function Home() {
  const settings = useSettings();
  const nav = useNavigate();
  const o = useLiveQuery(() => loadOverview(settings.defaultDirection), [settings.defaultDirection]);
  const decks = useLiveQuery(() => loadDeckStats(), []);
  const start = (deckIds: string[] = []) => {
    const cfg: SessionConfig = { mode: 'smart', direction: settings.defaultDirection, deckIds, lessonIds: [], priorities: [], size: settings.sessionSize };
    nav('/lernen/sitzung', { state: cfg });
  };
  const goal = settings.dailyGoal;

  return (
    <div className="mx-auto min-h-full max-w-xl px-4 nav-space">
      <header className="safe-top pb-5 pt-3">
        <h1 className="text-[2.1rem] font-bold leading-tight tracking-tight">{greeting()}</h1>
        <p className="text-sm text-muted">{new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </header>

      {!o ? null : o.cardCount === 0 ? (
        <Card>
          <EmptyState icon="layers" title={t("Willkommen!")} text={t("Lege einen Stapel für ein Fach an – Vokabeln, Formeln, Definitionen, Code – oder schau dir die Beispiele an.")}>
            <Button onClick={() => nav('/stapel/neu')}><Icon name="plus" size={20} />{t('Ersten Stapel anlegen')}</Button>
            <Button variant="soft" onClick={() => nav('/import')}>{t('CSV oder Liste importieren')}</Button>
            <Button variant="ghost" onClick={async () => { const n = await loadSampleData(); toast(t('{n} Beispielkarten geladen', { n })); }} data-testid="home-load-sample">{t('Beispiele laden')}</Button>
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="flex items-center gap-5">
            <Ring value={goal ? o.today.reviews / goal : 0}>
              <div>
                <div className="text-2xl font-bold tabular-nums leading-none">{o.today.reviews}</div>
                <div className="text-xs text-muted">von {goal}</div>
              </div>
            </Ring>
            <div className="min-w-0 flex-1">
              <h2 className="font-bold">{t('Tagesziel')}</h2>
              <p className="text-sm text-muted">{o.today.reviews >= goal ? t('Für heute geschafft.') : t('Noch {n} Wiederholungen bis zum Ziel.', { n: goal - o.today.reviews })}</p>
              {o.today.reviews > 0 && <p className="mt-2 text-sm"><span className="font-semibold text-ok">{o.today.correct}</span> {t('richtig,')} <span className="font-semibold text-bad">{o.today.incorrect}</span> {t('falsch')}</p>}
            </div>
          </Card>

          <Button size="lg" className="w-full" onClick={() => start()} data-testid="start-learning">{t('Jetzt lernen')}</Button>

          <div className="grid grid-cols-2 gap-3">
            <Tile to="/lernen" icon="target" value={o.dueToday} label={t("Heute fällig")} />
            <Tile to="/lernen?modus=new" icon="sparkle" value={o.newAvailable} label={t("Neue Karten")} />
            <Tile to="/problemkarten" icon="alert" value={o.problemCount} label={t("Problemkarten")} tone="text-bad" />
            <Tile to="/statistik" icon="flame" value={o.streaks.current} label={plural(o.streaks.current, 'Tag Lernserie', 'Tage Lernserie')} tone="text-star" />
          </div>

          {decks && decks.length > 0 && (
            <section>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h2 className="font-bold">{t('Deine Stapel')}</h2>
                <Link to="/stapel" className="text-sm font-semibold text-accent">{t('Alle')}</Link>
              </div>
              <ul className="space-y-2">
                {[...decks].sort((a, b) => b.deck.lastPracticedAt - a.deck.lastPracticedAt || b.due - a.due).slice(0, 4).map((s) => (
                  <li key={s.deck.id}>
                    <div className="flex items-center gap-3 rounded-card bg-surface p-3 pl-4 shadow-card">
                      <Link to={`/stapel/${s.deck.id}`} className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><DeckDot color={s.deck.color} /><span className="truncate font-semibold">{s.deck.name}</span></div>
                        <div className="mt-1.5"><ProgressBar value={s.progress} color={`rgb(var(--deck-${s.deck.color}-ink))`} /></div>
                        <div className="mt-1 text-xs text-muted">{t('{total} Karten, {due} fällig', { total: s.total, due: s.due })}</div>
                      </Link>
                      <Button size="sm" variant="soft" onClick={() => start([s.deck.id])} aria-label={t('{name} lernen', { name: s.deck.name })}>{t('Lernen')}</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {Date.now() - settings.lastBackupAt > 14 * DAY_MS && o.totals.reviews > 0 && (
            <Link to="/einstellungen#sicherung" className="block rounded-card border border-line bg-surface/60 p-4 text-sm text-muted">
              <span className="font-semibold text-ink">{t('Sicherung empfohlen.')}</span>{' '}
              {settings.lastBackupAt ? t('Die letzte Sicherung ist über zwei Wochen alt.') : t('Du hast noch keine Sicherung erstellt.')} {t('Deine Daten liegen nur auf diesem Gerät.')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
