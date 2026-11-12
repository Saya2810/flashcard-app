import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, Fa, Icon, Ring, toast } from '../components/ui';
import { loadSampleData } from '../db/sample';
import { useSettings } from '../hooks/useSettings';
import { DAY_MS, greeting } from '../lib/dates';
import { loadOverview } from '../stats/stats';
import type { SessionConfig } from '../types';

const FA_GREETING: Record<string, string> = {
  'Guten Morgen!': 'صبح بخیر',
  'Guten Tag!': 'روز بخیر',
  'Guten Abend!': 'عصر بخیر',
  'Gute Nacht!': 'شب بخیر',
};

function Tile({ to, icon, value, label, tone }: { to: string; icon: string; value: number | string; label: string; tone?: string }) {
  return (
    <Link to={to} className="rounded-card bg-surface p-4 shadow-card active:scale-[0.98]">
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
  const hello = greeting();
  const start = () => {
    const cfg: SessionConfig = { mode: 'smart', direction: settings.defaultDirection, lessonIds: [], priorities: [], size: settings.sessionSize };
    nav('/lernen/sitzung', { state: cfg });
  };

  return (
    <div className="mx-auto min-h-full max-w-xl px-4 nav-space">
      <header className="safe-top pb-4">
        <div className="flex items-end justify-between pt-3">
          <h1 className="text-[2rem] font-bold leading-tight tracking-tight">{hello}</h1>
          <Fa className="pb-1 text-lg text-muted">{FA_GREETING[hello]}</Fa>
        </div>
        <p className="text-sm text-muted">{new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </header>

      {!o ? null : o.vocabCount === 0 ? (
        <Card>
          <EmptyState title="Noch keine Vokabeln" text="Lege deine erste Vokabel an, importiere eine Liste oder probiere die App mit Beispieldaten aus.">
            <Button onClick={() => nav('/vokabeln/neu')}><Icon name="plus" size={20} />Erste Vokabel anlegen</Button>
            <Button variant="soft" onClick={() => nav('/vokabeln/import')}>Liste importieren</Button>
            <Button variant="ghost" onClick={async () => { const n = await loadSampleData(); toast(`${n} Beispielvokabeln geladen`); }}>Beispieldaten laden</Button>
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="flex items-center gap-5">
            <Ring value={settings.dailyGoal ? o.today.reviews / settings.dailyGoal : 0}>
              <div>
                <div className="text-2xl font-bold tabular-nums leading-none">{o.today.reviews}</div>
                <div className="text-xs text-muted">von {settings.dailyGoal}</div>
              </div>
            </Ring>
            <div className="min-w-0 flex-1">
              <h2 className="font-bold">Tagesziel</h2>
              <p className="text-sm text-muted">
                {o.today.reviews >= settings.dailyGoal ? 'Für heute geschafft.' : `Noch ${settings.dailyGoal - o.today.reviews} Wiederholungen bis zum Ziel.`}
              </p>
              {o.today.reviews > 0 && (
                <p className="mt-2 text-sm"><span className="font-semibold">{o.today.correct}</span> richtig, <span className="font-semibold">{o.today.incorrect}</span> falsch</p>
              )}
            </div>
          </Card>

          <Button size="lg" className="w-full" onClick={start} data-testid="start-learning">Jetzt lernen</Button>

          <div className="grid grid-cols-2 gap-3">
            <Tile to="/lernen" icon="target" value={o.dueToday} label="Heute fällig" />
            <Tile to="/lernen?modus=new" icon="sparkle" value={o.newAvailable} label="Neue Vokabeln" />
            <Tile to="/problemvokabeln" icon="alert" value={o.problemCount} label="Problemvokabeln" tone="text-bad" />
            <Tile to="/statistik" icon="flame" value={o.streaks.current} label={o.streaks.current === 1 ? 'Tag Lernserie' : 'Tage Lernserie'} tone="text-star" />
          </div>

          <Card className="!p-2">
            <ul>
              {[
                { to: '/problemvokabeln', icon: 'alert', label: 'Problemvokabeln' },
                { to: '/lernen?modus=new', icon: 'sparkle', label: 'Neue Vokabeln' },
                { to: '/lektionen', icon: 'book', label: 'Lektionen' },
                { to: '/statistik', icon: 'chart', label: 'Statistik' },
              ].map((l, i) => (
                <li key={l.label}>
                  <Link to={l.to} className={`flex min-h-[3.25rem] items-center gap-3 px-3 ${i ? 'border-t border-line' : ''}`}>
                    <span className="text-accent"><Icon name={l.icon} /></span>
                    <span className="flex-1 font-medium">{l.label}</span>
                    <span className="text-muted"><Icon name="right" size={18} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          {Date.now() - settings.lastBackupAt > 14 * DAY_MS && o.totals.reviews > 0 && (
            <Link to="/einstellungen" className="block rounded-card border border-line p-4 text-sm text-muted">
              <span className="font-semibold text-ink">Sicherung empfohlen.</span>{' '}
              {settings.lastBackupAt ? 'Die letzte Sicherung ist über zwei Wochen alt.' : 'Du hast noch keine Sicherung erstellt.'} Deine Daten liegen nur auf diesem Gerät.
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
