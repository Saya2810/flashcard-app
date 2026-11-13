import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnswerDiff } from '../components/AnswerDiff';
import { Button, Card, Confirm, Page, Segmented, Stepper, toast } from '../components/ui';
import { backupFileName, createBackup, exportCsv, restoreBackup, validateBackup, type BackupCheck } from '../db/backup';
import { db, requestPersistence } from '../db/db';
import { convertLegacy, importConverted, readLegacyDb } from '../db/legacy';
import { pruneMedia } from '../db/media';
import { saveSettings } from '../db/repo';
import { loadSampleData, removeSampleData } from '../db/sample';
import { useSettings } from '../hooks/useSettings';
import { saveFile } from '../lib/csv';
import { formatDate } from '../lib/dates';
import type { AppSettings } from '../types';
import { DIRECTION_OPTIONS } from './shared';

function Row({ title, hint, children, stack }: { title: string; hint?: string; children: ReactNode; stack?: boolean }) {
  return (
    <div className={stack ? 'space-y-2 py-3' : 'flex items-center justify-between gap-4 py-3'}>
      <div className="min-w-0"><div className="font-medium">{title}</div>{hint && <div className="text-xs text-muted">{hint}</div>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return <section id={id}><h2 className="mb-2 px-1 text-sm font-semibold text-muted">{title}</h2><Card className="divide-y divide-line !py-1">{children}</Card></section>;
}
function Toggle({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} data-testid={testId}
      className={`relative h-8 w-14 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}>
      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-7' : 'left-1'}`} />
    </button>
  );
}

export default function SettingsPage() {
  const s = useSettings();
  const set = (patch: Partial<AppSettings>) => void saveSettings(patch);
  const sampleCount = useLiveQuery(async () => (await db.decks.where('sample').equals(1).count()) + (await db.cards.where('sample').equals(1).count()), [], 0);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [legacy, setLegacy] = useState<number | null>(null);
  const [check, setCheck] = useState<BackupCheck | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmSample, setConfirmSample] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null)); }, []);
  useEffect(() => { void readLegacyDb().then((d) => setLegacy(d?.vocab.length ?? 0)); }, []);

  const backup = async () => {
    await saveFile(backupFileName('json'), 'application/json', JSON.stringify(await createBackup()));
    await saveSettings({ lastBackupAt: Date.now() });
    toast('Sicherung erstellt');
  };
  const onRestoreFile = async (file: File | undefined) => {
    if (!file) return;
    setCheck(validateBackup(await file.text()));
    if (fileRef.current) fileRef.current.value = '';
  };
  const restore = async (mode: 'merge' | 'replace') => {
    if (!check?.ok) return;
    try {
      const r = await restoreBackup(check, mode);
      toast(mode === 'replace' ? 'Sicherung wiederhergestellt' : `${r.added} Karten hinzugefügt`);
      setCheck(null); setConfirmReplace(false);
    } catch { toast('Wiederherstellen fehlgeschlagen – es wurde nichts verändert.'); }
  };

  return (
    <Page title="Einstellungen">
      <div className="space-y-6 pb-6">
        <Section title="Darstellung">
          <Row title="Erscheinungsbild" stack>
            <Segmented label="Erscheinungsbild" value={s.theme} onChange={(theme) => set({ theme })} options={[{ value: 'system', label: 'Automatisch' }, { value: 'light', label: 'Hell' }, { value: 'dark', label: 'Dunkel' }]} />
          </Row>
          <Row title="Schrift der App" stack>
            <Segmented label="Schrift der App" value={s.uiFont} onChange={(uiFont) => set({ uiFont })} options={[{ value: 'rounded', label: 'Abgerundet' }, { value: 'system', label: 'System' }, { value: 'serif', label: 'Serif' }]} />
          </Row>
          <Row title="Textgröße auf Karten" stack hint="Wirkt zusätzlich zu den Schrift-Einstellungen jedes Stapels.">
            <Segmented label="Textgröße auf Karten" value={String(s.cardFontScale)} onChange={(v) => set({ cardFontScale: Number(v) })} options={[{ value: '0.85', label: 'Klein' }, { value: '1', label: 'Normal' }, { value: '1.2', label: 'Groß' }, { value: '1.4', label: 'Sehr groß' }]} />
          </Row>
          <Row title="Kartenanimation" hint="Die Systemeinstellung „Bewegung reduzieren“ hat Vorrang.">
            <Toggle label="Kartenanimation" checked={s.animations} onChange={(animations) => set({ animations })} />
          </Row>
        </Section>

        <Section title="Antwort eintippen">
          <Row title="Antwort vor dem Umdrehen eintippen" hint="Nach dem Umdrehen siehst du deine Antwort neben der Lösung, Unterschiede sind rot markiert. Die App bewertet nichts – du entscheidest weiter selbst mit Richtig oder Falsch.">
            <Toggle label="Antwort vor dem Umdrehen eintippen" checked={s.typedAnswer} onChange={(typedAnswer) => set({ typedAnswer })} testId="toggle-typed" />
          </Row>
          {s.typedAnswer && <>
            <Row title="Groß-/Kleinschreibung ignorieren"><Toggle label="Groß-/Kleinschreibung ignorieren" checked={s.diffIgnoreCase} onChange={(diffIgnoreCase) => set({ diffIgnoreCase })} /></Row>
            <Row title="Satzzeichen ignorieren"><Toggle label="Satzzeichen ignorieren" checked={s.diffIgnorePunctuation} onChange={(diffIgnorePunctuation) => set({ diffIgnorePunctuation })} /></Row>
            <div className="py-3">
              <div className="mb-2 text-xs font-semibold text-muted">Beispiel</div>
              <AnswerDiff typed="die Bibilothek" answers={['die Bibliothek']} rich={false} look={{ dir: 'ltr' }} options={{ ignoreCase: s.diffIgnoreCase, ignorePunctuation: s.diffIgnorePunctuation }} />
            </div>
          </>}
        </Section>

        <Section title="Lernen">
          <Row title="Standardrichtung" stack>
            <Segmented label="Standardrichtung" value={s.defaultDirection} onChange={(defaultDirection) => set({ defaultDirection })} options={DIRECTION_OPTIONS} />
          </Row>
          <Row title="Tagesziel" hint="Wiederholungen pro Tag"><Stepper label="Tagesziel" value={s.dailyGoal} onChange={(dailyGoal) => set({ dailyGoal })} min={5} max={500} step={5} /></Row>
          <Row title="Neue Karten" hint="Pro Tag, gilt für „Intelligentes Lernen“."><Stepper label="Neue Karten pro Tag" value={s.newPerDay} onChange={(newPerDay) => set({ newPerDay })} min={0} max={300} step={5} /></Row>
          <Row title="Maximale Wiederholungen" hint="Pro Tag, gilt für „Intelligentes Lernen“."><Stepper label="Maximale Wiederholungen pro Tag" value={s.maxReviewsPerDay} onChange={(maxReviewsPerDay) => set({ maxReviewsPerDay })} min={10} max={2000} step={10} /></Row>
          <Row title="Karten pro Sitzung"><Stepper label="Karten pro Sitzung" value={s.sessionSize} onChange={(sessionSize) => set({ sessionSize })} min={5} max={300} step={5} /></Row>
          <Row title="Problemkarten automatisch einbeziehen" hint="Mischt schwierige Karten zusätzlich in „Intelligentes Lernen“, auch wenn sie noch nicht fällig sind.">
            <Toggle label="Problemkarten automatisch einbeziehen" checked={s.autoIncludeProblems} onChange={(autoIncludeProblems) => set({ autoIncludeProblems })} />
          </Row>
        </Section>

        <section id="sicherung">
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted">Sicherung</h2>
          <Card className="space-y-3">
            <p className="text-sm">
              Alle Karten und dein Lernfortschritt liegen <b>nur auf diesem Gerät</b>. Es gibt keine Synchronisierung mit einer Cloud.
              Wenn du die Website-Daten in Safari löschst oder die App vom Home-Bildschirm entfernst, sind die Daten weg. Erstelle deshalb regelmäßig eine Sicherung und bewahre sie außerhalb des Geräts auf, zum Beispiel in iCloud Drive.
            </p>
            <p className="text-sm">Öffne die App auf dem iPhone immer über ihr Symbol auf dem Home-Bildschirm. Safari-Tab und installierte App haben getrennte Speicher.</p>
            <p className="text-xs text-muted">
              Letzte Sicherung: {s.lastBackupAt ? formatDate(s.lastBackupAt) : 'noch keine'}.{' '}
              {persisted === true ? 'Der Browser hat dauerhaften Speicher zugesagt.' : persisted === false ? 'Der Browser hat dauerhaften Speicher bisher nicht zugesagt.' : ''}
            </p>
            {persisted === false && <Button variant="soft" size="sm" onClick={async () => setPersisted(await requestPersistence())}>Dauerhaften Speicher anfragen</Button>}
            <Button className="w-full" onClick={() => void backup()} data-testid="create-backup">Vollständige Sicherung erstellen (JSON)</Button>
            <Button variant="soft" className="w-full" onClick={async () => { await saveFile(backupFileName('csv'), 'text/csv', await exportCsv()); toast('CSV exportiert'); }} data-testid="export-csv">Alle Karten als CSV exportieren</Button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onRestoreFile(e.target.files?.[0])} data-testid="restore-input" />
            <Button variant="soft" className="w-full" onClick={() => fileRef.current?.click()}>Sicherung wiederherstellen …</Button>
            <p className="text-xs text-muted">Auch Sicherungen der früheren Persisch-Deutsch-App lassen sich hier einlesen.</p>
            <Button variant="ghost" size="sm" className="w-full" onClick={async () => toast(`${await pruneMedia()} ungenutzte Bilder entfernt`)}>Ungenutzte Bilder aufräumen</Button>
          </Card>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted">Persisch-Deutsch-Version</h2>
          <Card className="space-y-3">
            <p className="text-sm">Die ursprüngliche Persisch-Deutsch-App ist weiter erreichbar. Ihre Daten werden beim ersten Start automatisch als Stapel „Persisch – Deutsch“ übernommen, ohne das Original zu verändern.</p>
            {legacy !== null && legacy > 0 && (
              <Button variant="soft" className="w-full" data-testid="import-legacy" onClick={async () => {
                const data = await readLegacyDb();
                if (!data) return;
                const r = await importConverted(convertLegacy(data), { first: false });
                toast(r.added ? `${r.added} neue Vokabeln übernommen` : 'Alles ist schon übernommen');
              }}>Erneut aus der Persisch-Version übernehmen ({legacy} Vokabeln)</Button>
            )}
            <a href="./legacy/" className="block text-center text-sm font-semibold text-accent">Ursprüngliche Version öffnen</a>
          </Card>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted">Beispiele</h2>
          <Card className="space-y-3">
            <p className="text-sm">{sampleCount > 0 ? 'Beispielstapel sind geladen. Sie sind als „Beispiel“ markiert.' : 'Vier kleine Beispielstapel: Persisch, Analysis mit Formeln, Physik und Python-Code.'}</p>
            {sampleCount > 0
              ? <Button variant="danger" className="w-full" onClick={() => setConfirmSample(true)} data-testid="remove-sample">Beispiele entfernen</Button>
              : <Button variant="soft" className="w-full" onClick={async () => { toast(`${await loadSampleData()} Beispielkarten geladen`); }} data-testid="load-sample">Beispiele laden</Button>}
          </Card>
        </section>
        <p className="px-1 text-center text-xs text-muted">Lernkarten 2.0 – kostenlos, ohne Konto, ohne Werbung. Funktioniert offline.</p>
      </div>

      <Confirm open={!!check && !check.ok} title="Sicherung nicht lesbar" confirmLabel="Verstanden" onConfirm={() => setCheck(null)} onCancel={() => setCheck(null)}
        text={<ul className="list-disc space-y-1 pl-4">{check?.errors.map((e) => <li key={e}>{e}</li>)}</ul>} />

      <Confirm open={!!check?.ok && !confirmReplace} title="Sicherung wiederherstellen" confirmLabel="Zusammenführen" onConfirm={() => void restore('merge')} onCancel={() => setCheck(null)}
        text={check?.summary && <>
          <p data-testid="restore-summary">{check.kind === 'legacy' ? 'Sicherung der Persisch-Deutsch-App: ' : 'Die Datei enthält '}{check.summary.cards} Karten in {check.summary.decks} {check.summary.decks === 1 ? 'Stapel' : 'Stapeln'} und {check.summary.reviews} Antworten{check.summary.exportedAt ? ` (erstellt am ${formatDate(Date.parse(check.summary.exportedAt))})` : ''}.</p>
          <p className="mt-2"><b>Zusammenführen</b> fügt nur hinzu, was hier noch fehlt. Vorhandene Karten und ihr Lernstand bleiben unverändert.</p>
        </>}>
        <Button variant="danger" className="mt-4 w-full" onClick={() => setConfirmReplace(true)} data-testid="restore-replace">Stattdessen alles ersetzen …</Button>
      </Confirm>

      <Confirm open={confirmReplace} danger title="Alle aktuellen Daten ersetzen?" confirmLabel="Ja, alles ersetzen" onConfirm={() => void restore('replace')} onCancel={() => setConfirmReplace(false)}
        text="Alle Stapel, Karten, Bilder und der gesamte Lernfortschritt auf diesem Gerät werden gelöscht und durch den Inhalt der Sicherung ersetzt. Das lässt sich nicht rückgängig machen." />

      <Confirm open={confirmSample} danger title="Beispiele entfernen?" confirmLabel="Beispiele entfernen" onCancel={() => setConfirmSample(false)}
        onConfirm={async () => { const n = await removeSampleData(); toast(`${n} Beispielkarten entfernt`); setConfirmSample(false); }}
        text="Die Beispielstapel und ihr Lernverlauf werden gelöscht. Deine eigenen Karten bleiben unberührt." />
    </Page>
  );
}
