import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Card, Confirm, Fa, Page, Segmented, Stepper, toast } from '../components/ui';
import { backupFileName, createBackup, exportCsv, restoreBackup, validateBackup, type BackupCheck } from '../db/backup';
import { db, requestPersistence } from '../db/db';
import { saveSettings } from '../db/repo';
import { loadSampleData, removeSampleData } from '../db/sample';
import { useSettings } from '../hooks/useSettings';
import { saveFile } from '../lib/csv';
import { formatDate } from '../lib/dates';
import type { AppSettings } from '../types';
import { DIRECTION_OPTIONS } from './Learn';

function Row({ title, hint, children, stack }: { title: string; hint?: string; children: ReactNode; stack?: boolean }) {
  return (
    <div className={stack ? 'space-y-2 py-3' : 'flex items-center justify-between gap-4 py-3'}>
      <div className="min-w-0"><div className="font-medium">{title}</div>{hint && <div className="text-xs text-muted">{hint}</div>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section><h2 className="mb-2 px-1 text-sm font-semibold text-muted">{title}</h2><Card className="divide-y divide-line !py-1">{children}</Card></section>;
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={`relative h-8 w-14 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}>
      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-7' : 'left-1'}`} />
    </button>
  );
}

export default function SettingsPage() {
  const s = useSettings();
  const set = (patch: Partial<AppSettings>) => void saveSettings(patch);
  const sampleCount = useLiveQuery(() => db.vocab.where('sample').equals(1).count(), [], 0);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [check, setCheck] = useState<BackupCheck | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmSample, setConfirmSample] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null)); }, []);

  const backup = async () => {
    const data = await createBackup();
    await saveFile(backupFileName('json'), 'application/json', JSON.stringify(data));
    await saveSettings({ lastBackupAt: Date.now() });
    toast('Sicherung erstellt');
  };
  const onRestoreFile = async (file: File | undefined) => {
    if (!file) return;
    setCheck(validateBackup(await file.text()));
    if (fileRef.current) fileRef.current.value = '';
  };
  const restore = async (mode: 'merge' | 'replace') => {
    if (!check?.backup) return;
    try {
      const r = await restoreBackup(check.backup, mode);
      toast(mode === 'replace' ? 'Sicherung wiederhergestellt' : `${r.added} Vokabeln hinzugefügt`);
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
          <Row title="Schriftgröße der Karten" stack>
            <Segmented label="Schriftgröße der Karten" value={String(s.cardFontScale)} onChange={(v) => set({ cardFontScale: Number(v) })} options={[{ value: '0.85', label: 'Klein' }, { value: '1', label: 'Normal' }, { value: '1.2', label: 'Groß' }, { value: '1.4', label: 'Sehr groß' }]} />
          </Row>
          <Row title="Persische Schriftgröße" stack hint="Gilt überall, wo persischer Text erscheint.">
            <Segmented label="Persische Schriftgröße" value={String(s.persianFontScale)} onChange={(v) => set({ persianFontScale: Number(v) })} options={[{ value: '0.9', label: 'Klein' }, { value: '1', label: 'Normal' }, { value: '1.2', label: 'Groß' }, { value: '1.4', label: 'Sehr groß' }]} />
            <div className="mt-2 rounded-2xl bg-sunken p-3 text-center"><Fa className="text-2xl">دانشگاه</Fa></div>
          </Row>
          <Row title="Kartenanimation" hint="Umdrehen der Karte animieren. Die Systemeinstellung „Bewegung reduzieren“ hat Vorrang.">
            <Toggle label="Kartenanimation" checked={s.animations} onChange={(animations) => set({ animations })} />
          </Row>
        </Section>

        <Section title="Lernen">
          <Row title="Standardrichtung" stack>
            <Segmented label="Standardrichtung" value={s.defaultDirection} onChange={(defaultDirection) => set({ defaultDirection })} options={DIRECTION_OPTIONS.map((d) => ({ ...d, label: d.value === 'mixed' ? 'Gemischt' : d.value === 'fa-de' ? 'Pers. → Dt.' : 'Dt. → Pers.' }))} />
          </Row>
          <Row title="Tagesziel" hint="Wiederholungen pro Tag"><Stepper label="Tagesziel" value={s.dailyGoal} onChange={(dailyGoal) => set({ dailyGoal })} min={5} max={500} step={5} /></Row>
          <Row title="Neue Vokabeln" hint="Pro Tag, gilt für „Intelligentes Lernen“."><Stepper label="Neue Vokabeln pro Tag" value={s.newPerDay} onChange={(newPerDay) => set({ newPerDay })} min={0} max={200} step={5} /></Row>
          <Row title="Maximale Wiederholungen" hint="Pro Tag, gilt für „Intelligentes Lernen“."><Stepper label="Höchstzahl Wiederholungen pro Tag" value={s.maxReviewsPerDay} onChange={(maxReviewsPerDay) => set({ maxReviewsPerDay })} min={10} max={1000} step={10} /></Row>
          <Row title="Karten pro Sitzung"><Stepper label="Karten pro Sitzung" value={s.sessionSize} onChange={(sessionSize) => set({ sessionSize })} min={5} max={200} step={5} /></Row>
          <Row title="Problemvokabeln automatisch einbeziehen" hint="Mischt schwierige Wörter zusätzlich in „Intelligentes Lernen“, auch wenn sie noch nicht fällig sind.">
            <Toggle label="Problemvokabeln automatisch einbeziehen" checked={s.autoIncludeProblems} onChange={(autoIncludeProblems) => set({ autoIncludeProblems })} />
          </Row>
        </Section>

        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted">Sicherung</h2>
          <Card className="space-y-3">
            <p className="text-sm">
              Alle Vokabeln und dein Lernfortschritt liegen <b>nur auf diesem Gerät</b>, im Speicher dieser Web-App. Es gibt keine Synchronisierung mit einer Cloud.
              Wenn du die Website-Daten in Safari löschst oder die App vom Home-Bildschirm entfernst, sind die Daten weg. Erstelle deshalb regelmäßig eine Sicherung und bewahre sie außerhalb des iPhones auf, zum Beispiel in iCloud Drive oder per E-Mail an dich selbst.
            </p>
            <p className="text-sm">Öffne die App auf dem iPhone immer über ihr Symbol auf dem Home-Bildschirm. Im normalen Safari-Tab kann Safari die Daten einer länger nicht besuchten Seite von selbst löschen, und beide haben getrennte Speicher.</p>
            <p className="text-xs text-muted">
              Letzte Sicherung: {s.lastBackupAt ? formatDate(s.lastBackupAt) : 'noch keine'}.{' '}
              {persisted === true ? 'Der Browser hat dauerhaften Speicher zugesagt.' : persisted === false ? 'Der Browser hat dauerhaften Speicher bisher nicht zugesagt.' : ''}
            </p>
            {persisted === false && <Button variant="soft" size="sm" onClick={async () => setPersisted(await requestPersistence())}>Dauerhaften Speicher anfragen</Button>}
            <Button className="w-full" onClick={() => void backup()} data-testid="create-backup">Vollständige Sicherung erstellen (JSON)</Button>
            <Button variant="soft" className="w-full" onClick={async () => { await saveFile(backupFileName('csv'), 'text/csv', await exportCsv()); toast('CSV exportiert'); }} data-testid="export-csv">Vokabelliste als CSV exportieren</Button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onRestoreFile(e.target.files?.[0])} data-testid="restore-input" />
            <Button variant="soft" className="w-full" onClick={() => fileRef.current?.click()}>Sicherung wiederherstellen …</Button>
          </Card>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted">Beispieldaten</h2>
          <Card className="space-y-3">
            <p className="text-sm">{sampleCount > 0 ? `${sampleCount} Beispielvokabeln sind geladen. Sie sind als „Beispiel“ markiert.` : 'Zwei kleine Beispiellektionen zum Ausprobieren der App.'}</p>
            {sampleCount > 0
              ? <Button variant="danger" className="w-full" onClick={() => setConfirmSample(true)} data-testid="remove-sample">Beispieldaten entfernen</Button>
              : <Button variant="soft" className="w-full" onClick={async () => { const n = await loadSampleData(); toast(`${n} Beispielvokabeln geladen`); }} data-testid="load-sample">Beispieldaten laden</Button>}
          </Card>
        </section>
        <p className="px-1 text-center text-xs text-muted">Persisch Karten 1.0 – kostenlos, ohne Konto, ohne Werbung. Funktioniert offline.</p>
      </div>

      <Confirm open={!!check && !check.ok} title="Sicherung nicht lesbar" confirmLabel="Verstanden" onConfirm={() => setCheck(null)} onCancel={() => setCheck(null)}
        text={<ul className="list-disc space-y-1 pl-4">{check?.errors.map((e) => <li key={e}>{e}</li>)}</ul>} />

      <Confirm open={!!check?.ok && !confirmReplace} title="Sicherung wiederherstellen" confirmLabel="Zusammenführen" onConfirm={() => void restore('merge')} onCancel={() => setCheck(null)}
        text={check?.summary && <>
          <p data-testid="restore-summary">Die Datei enthält {check.summary.vocab} Vokabeln, {check.summary.lessons} Lektionen und {check.summary.reviews} Antworten{check.summary.exportedAt ? ` (erstellt am ${formatDate(Date.parse(check.summary.exportedAt))})` : ''}.</p>
          <p className="mt-2"><b>Zusammenführen</b> fügt nur hinzu, was hier noch fehlt. Vorhandene Vokabeln und ihr Lernstand bleiben unverändert.</p>
        </>}>
        <Button variant="danger" className="mt-4 w-full" onClick={() => setConfirmReplace(true)} data-testid="restore-replace">Stattdessen alles ersetzen …</Button>
      </Confirm>

      <Confirm open={confirmReplace} danger title="Alle aktuellen Daten ersetzen?" confirmLabel="Ja, alles ersetzen" onConfirm={() => void restore('replace')} onCancel={() => setConfirmReplace(false)}
        text="Alle Vokabeln, Lektionen und der gesamte Lernfortschritt auf diesem Gerät werden gelöscht und durch den Inhalt der Sicherung ersetzt. Das lässt sich nicht rückgängig machen." />

      <Confirm open={confirmSample} danger title="Beispieldaten entfernen?" confirmLabel="Beispieldaten entfernen" onCancel={() => setConfirmSample(false)}
        onConfirm={async () => { const n = await removeSampleData(); toast(`${n} Beispielvokabeln entfernt`); setConfirmSample(false); }}
        text="Die Beispielvokabeln und ihr Lernverlauf werden gelöscht. Deine eigenen Vokabeln bleiben unberührt." />
    </Page>
  );
}
