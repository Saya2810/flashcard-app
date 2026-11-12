import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, ChartCard, HBarList, LineChart, SegmentBar, type Series } from '../components/charts';
import { Card, EmptyState, Fa, Page, ProgressBar, Segmented, statusColor } from '../components/ui';
import { useSettings } from '../hooks/useSettings';
import { shortDay } from '../lib/dates';
import { loadDaySeries, loadForecast, loadLessonStats, loadOverview, loadProblemRows, sortProblems } from '../stats/stats';
import { STATUS_LABEL, STATUS_ORDER } from '../types';

const OK: Series = { name: 'Richtig', color: 'var(--c-ok)' };
const BAD: Series = { name: 'Falsch', color: 'var(--c-bad)' };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '–');

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-sunken px-3 py-2.5">
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

export default function Stats() {
  const settings = useSettings();
  const [range, setRange] = useState<'14' | '30' | '90'>('14');
  const n = Number(range);
  const o = useLiveQuery(() => loadOverview(settings.defaultDirection), [settings.defaultDirection]);
  const days = useLiveQuery(() => loadDaySeries(n), [n]);
  const forecast = useLiveQuery(() => loadForecast(14), []);
  const lessons = useLiveQuery(() => loadLessonStats(), []);
  const problems = useLiveQuery(() => loadProblemRows(), []);
  const hardest = useMemo(() => sortProblems([...(problems?.problems ?? [])], 'errors').slice(0, 8), [problems]);

  const progress = useMemo(() => {
    // Days without study carry over the last known snapshot.
    let last: { started: number; solid: number } | null = null;
    return (days ?? []).map((d) => {
      if (d.snapshot) last = { started: d.snapshot.unsicher + d.snapshot.bearbeitung + d.snapshot.gut + d.snapshot.sicher, solid: d.snapshot.gut + d.snapshot.sicher };
      return { label: shortDay(d.day), values: [last?.started ?? 0, last?.solid ?? 0] };
    });
  }, [days]);

  if (!o) return <Page title="Statistik">{null}</Page>;
  if (o.vocabCount === 0) return <Page title="Statistik"><EmptyState icon="chart" title="Noch nichts auszuwerten" text="Sobald du Vokabeln angelegt und gelernt hast, erscheint hier dein Fortschritt." /></Page>;
  const dayData = (days ?? []).map((d) => ({ label: shortDay(d.day), values: [d.correct, d.incorrect] }));

  return (
    <Page title="Statistik">
      <div className="space-y-4 pb-6">
        <Card>
          <h2 className="mb-3 font-bold">Heute</h2>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Wiederholungen" value={o.today.reviews} />
            <Stat label="Richtig" value={o.today.correct} />
            <Stat label="Falsch" value={o.today.incorrect} />
            <Stat label="Neu gelernt" value={o.today.newCards} />
            <Stat label="Heute fällig" value={o.dueToday} />
            <Stat label="Morgen fällig" value={o.dueTomorrow} />
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 font-bold">Insgesamt</h2>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Vokabeln" value={o.vocabCount} />
            <Stat label="Erfolgsquote" value={pct(o.totals.correct, o.totals.reviews)} />
            <Stat label="Wiederholungen" value={o.totals.reviews} />
            <Stat label="Lernserie (Tage)" value={o.streaks.current} />
            <Stat label="Längste Serie" value={o.streaks.longest} />
            <Stat label="Problemvokabeln" value={o.problemCount} />
          </div>
        </Card>

        <ChartCard title="Lernstand" hint="Jede Vokabel zählt mit ihrer schwächsten geübten Richtung."
          table={{ head: ['Status', 'Vokabeln'], rows: STATUS_ORDER.map((s) => [STATUS_LABEL[s], o.status[s]]) }}>
          <SegmentBar parts={STATUS_ORDER.map((s) => ({ label: STATUS_LABEL[s], value: o.status[s], color: statusColor(s) }))} />
        </ChartCard>

        <Segmented label="Zeitraum" value={range} onChange={setRange} options={[{ value: '14', label: '14 Tage' }, { value: '30', label: '30 Tage' }, { value: '90', label: '90 Tage' }]} />

        <ChartCard title="Lernaktivität pro Tag" hint="Gewertete Antworten, aufgeteilt in richtig und falsch." series={[OK, BAD]}
          table={{ head: ['Tag', 'Richtig', 'Falsch'], rows: dayData.map((d) => [d.label, ...d.values]) }}>
          <BarChart data={dayData} series={[OK, BAD]} />
        </ChartCard>

        <ChartCard title="Erfolgsquote pro Tag" hint="Anteil richtiger Antworten in Prozent, nur an Tagen mit Antworten."
          table={{ head: ['Tag', 'Erfolgsquote'], rows: (days ?? []).filter((d) => d.reviews).map((d) => [shortDay(d.day), pct(d.correct, d.reviews)]) }}>
          <BarChart data={(days ?? []).map((d) => ({ label: shortDay(d.day), values: [d.reviews ? Math.round((d.correct / d.reviews) * 100) : 0] }))} series={[{ name: 'Erfolgsquote in %', color: 'var(--c-ok)' }]} />
        </ChartCard>

        <ChartCard title="Lernfortschritt" hint="Wie viele Vokabeln du begonnen hast und wie viele davon gut sitzen."
          series={[{ name: 'Begonnen', color: 'var(--c-bearbeitung)' }, { name: 'Gut gelernt oder sicher', color: 'var(--c-sicher)' }]}
          table={{ head: ['Tag', 'Begonnen', 'Gut oder sicher'], rows: progress.map((d) => [d.label, ...d.values]) }}>
          <LineChart data={progress} series={[{ name: 'Begonnen', color: 'var(--c-bearbeitung)' }, { name: 'Gut oder sicher', color: 'var(--c-sicher)' }]} />
        </ChartCard>

        <ChartCard title="Schwierigste Vokabeln" hint="Nach Anzahl der Fehler; daneben die Fehlerquote."
          table={{ head: ['Vokabel', 'Deutsch', 'Fehler', 'Quote'], rows: hardest.map((r) => [r.vocab.persian, r.vocab.german, r.state.incorrect, `${Math.round(r.errorRate * 100)} %`]) }}>
          {hardest.length === 0 ? <p className="text-sm text-muted">Bisher keine Problemvokabeln erkannt.</p> : (
            <>
              <HBarList color="var(--c-bad)" rows={hardest.map((r) => ({ key: r.state.id, value: r.state.incorrect, note: `${Math.round(r.errorRate * 100)} %`, label: <><Fa className="font-semibold">{r.vocab.persian}</Fa><span className="ml-2 text-muted">{r.vocab.german}</span></> }))} />
              <Link to="/problemvokabeln" className="mt-3 block text-center text-sm font-semibold text-accent">Alle Problemvokabeln ansehen</Link>
            </>
          )}
        </ChartCard>

        <ChartCard title="Anstehende Wiederholungen" hint="Fällige Karten der nächsten 14 Tage. „Heute“ enthält Überfälliges."
          table={{ head: ['Tag', 'Fällig'], rows: (forecast ?? []).map((f, i) => [i === 0 ? 'Heute' : shortDay(f.day), f.count]) }}>
          <BarChart data={(forecast ?? []).map((f, i) => ({ label: i === 0 ? 'Heute' : shortDay(f.day), values: [f.count] }))} series={[{ name: 'Fällig', color: 'var(--c-ok)' }]} labelEvery={3} />
        </ChartCard>

        <Card>
          <h2 className="mb-3 font-bold">Lektionen</h2>
          <ul className="space-y-4">
            {(lessons ?? []).map((s) => (
              <li key={s.lesson?.id ?? 'none'} data-testid="lesson-stat">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold">{s.lesson?.name ?? 'Ohne Lektion'}</span>
                  <span className="shrink-0 text-xs text-muted">{Math.round(s.progress * 100)} % Fortschritt</span>
                </div>
                <ProgressBar value={s.progress} />
                <dl className="mt-2 grid grid-cols-4 gap-x-2 gap-y-1 text-xs">
                  {[
                    ['Vokabeln', s.total], ['Wiederh.', s.reviews], ['Richtig', s.correct], ['Falsch', s.incorrect],
                    ['Fehlerquote', pct(s.incorrect, s.reviews)], ['Sicher', s.mastered], ['Schwierig', s.difficult], ['Begonnen', s.started],
                  ].map(([k, v]) => <div key={k}><dt className="text-muted">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>)}
                </dl>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
