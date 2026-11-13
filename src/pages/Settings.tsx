import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnswerDiff } from '../components/AnswerDiff';
import { Button, Card, Confirm, Page, Segmented, Stepper, toast } from '../components/ui';
import { Link } from 'react-router-dom';
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
import { LANGUAGES, plural, t } from '../i18n';

function Row({ title, hint, children, stack }: { title: string; hint?: string; children: ReactNode; stack?: boolean }) {
  return (
    <div className={stack ? 'space-y-2 py-3' : 'flex items-center justify-between gap-4 py-3'}>
      <div className="min-w-0"><div className="font-medium">{title}</div>{hint && <div className="text-xs text-muted">{hint}</div>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
function Section({ title, id, hint, children, plain }: { title: string; id?: string; hint?: string; children: ReactNode; plain?: boolean }) {
  return (
    <section id={id} data-testid={id ? `section-${id}` : undefined}>
      <h2 className="px-1 text-sm font-semibold text-muted">{title}</h2>
      {hint ? <p className="mb-2 px-1 text-xs text-muted">{hint}</p> : <div className="mb-2" />}
      <Card className={plain ? 'space-y-3' : 'divide-y divide-line !py-1'}>{children}</Card>
    </section>
  );
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
    toast(t('Sicherung erstellt'));
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
      toast(mode === 'replace' ? t('Sicherung wiederhergestellt') : t('{n} Karten und {v} Verben hinzugefügt', { n: r.added, v: r.addedVerbs }));
      setCheck(null); setConfirmReplace(false);
    } catch { toast(t('Wiederherstellen fehlgeschlagen – es wurde nichts verändert.')); }
  };

  return (
    <Page title={t('Einstellungen')}>
      <div className="space-y-6 pb-6">
        <Section id="allgemein" title={t('Allgemein')}>
          <Row title={t('Sprache der App')} stack hint={t('Gilt für Menüs, Beschriftungen und Meldungen. Die Sprache deiner Karten und Verben ist davon unabhängig.')}>
            <Segmented label={t('Sprache der App')} value={s.uiLanguage} onChange={(uiLanguage) => set({ uiLanguage })} options={LANGUAGES.map((l) => ({ value: l.code, label: l.name, raw: true }))} />
          </Row>
          <Row title={t('Erscheinungsbild')} stack>
            <Segmented label={t('Erscheinungsbild')} value={s.theme} onChange={(theme) => set({ theme })} options={[{ value: 'system', label: 'Automatisch' }, { value: 'light', label: 'Hell' }, { value: 'dark', label: 'Dunkel' }]} />
          </Row>
        </Section>

        <Section id="darstellung" title={t('Darstellung und Sprache')}>
          <Row title={t('Schrift der App')} stack>
            <Segmented label={t('Schrift der App')} value={s.uiFont} onChange={(uiFont) => set({ uiFont })} options={[{ value: 'rounded', label: 'Abgerundet' }, { value: 'system', label: 'System' }, { value: 'serif', label: 'Serif' }]} />
          </Row>
          <Row title={t('Textgröße auf Karten')} stack hint={t('Wirkt zusätzlich zu den Schrift-Einstellungen jedes Stapels.')}>
            <Segmented label={t('Textgröße auf Karten')} value={String(s.cardFontScale)} onChange={(v) => set({ cardFontScale: Number(v) })} options={[{ value: '0.85', label: 'Klein' }, { value: '1', label: 'Normal' }, { value: '1.2', label: 'Groß' }, { value: '1.4', label: 'Sehr groß' }]} />
          </Row>
          <Row title={t('Textgröße in Antwortfeldern')} stack hint={t('Für das Eintippen von Antworten und Verbformen.')}>
            <Segmented label={t('Textgröße in Antwortfeldern')} value={String(s.answerFontScale)} onChange={(v) => set({ answerFontScale: Number(v) })} options={[{ value: '0.85', label: 'Klein' }, { value: '1', label: 'Normal' }, { value: '1.2', label: 'Groß' }, { value: '1.4', label: 'Sehr groß' }]} />
            <div className="rounded-2xl bg-sunken p-3" aria-label={t('Vorschau')}>
              <input readOnly value="gehen · ich gehe" aria-label={t('Vorschau')} className="w-full rounded-xl border border-line bg-surface px-3 py-2" style={{ fontSize: `${s.answerFontScale}rem` }} data-testid="answer-font-preview" />
            </div>
          </Row>
          <Row title={t('Schrift und Schreibrichtung der Inhalte')} stack hint={t('Schrift, Größe und Schreibrichtung (auch Rechts → Links für Persisch) stellst du je Seite eines Stapels und je Verb-Schema ein. Sie bleiben unverändert erhalten.')}>
            <div className="flex gap-2"><Link to="/stapel" className="text-sm font-semibold text-accent">{t('Zu den Stapeln')}</Link><Link to="/verben/schemata" className="text-sm font-semibold text-accent">{t('Zu den Schemata')}</Link></div>
          </Row>
          <Row title={t('Kartenanimation')} hint={t('Die Systemeinstellung „Bewegung reduzieren“ hat Vorrang.')}>
            <Toggle label={t('Kartenanimation')} checked={s.animations} onChange={(animations) => set({ animations })} />
          </Row>
          <p className="py-3 text-xs text-muted">{t('Die Bildschirmtastatur (z. B. die persische Tastatur) wählst du in den iOS-Einstellungen unter Allgemein → Tastatur. Die App verändert sie nicht.')}</p>
        </Section>

        <Section id="lernen" title={t('Lernen')}>
          <Row title={t('Antwort vor dem Umdrehen eintippen')} hint={t('Nach dem Umdrehen siehst du deine Antwort neben der Lösung, Unterschiede sind rot markiert. Die App bewertet nichts – du entscheidest weiter selbst mit Richtig oder Falsch.')}>
            <Toggle label={t('Antwort vor dem Umdrehen eintippen')} checked={s.typedAnswer} onChange={(typedAnswer) => set({ typedAnswer })} testId="toggle-typed" />
          </Row>
          {s.typedAnswer && <>
            <Row title={t('Groß-/Kleinschreibung ignorieren')}><Toggle label={t('Groß-/Kleinschreibung ignorieren')} checked={s.diffIgnoreCase} onChange={(diffIgnoreCase) => set({ diffIgnoreCase })} /></Row>
            <Row title={t('Satzzeichen ignorieren')}><Toggle label={t('Satzzeichen ignorieren')} checked={s.diffIgnorePunctuation} onChange={(diffIgnorePunctuation) => set({ diffIgnorePunctuation })} /></Row>
            <div className="py-3">
              <div className="mb-2 text-xs font-semibold text-muted">{t('Beispiel')}</div>
              <AnswerDiff typed="die Bibilothek" answers={['die Bibliothek']} rich={false} look={{ dir: 'ltr' }} options={{ ignoreCase: s.diffIgnoreCase, ignorePunctuation: s.diffIgnorePunctuation }} />
            </div>
          </>}
          <Row title={t('Standardrichtung')} stack>
            <Segmented label={t('Standardrichtung')} value={s.defaultDirection} onChange={(defaultDirection) => set({ defaultDirection })} options={DIRECTION_OPTIONS} />
          </Row>
          <Row title={t('Tagesziel')} hint={t('Wiederholungen pro Tag')}><Stepper label={t('Tagesziel')} value={s.dailyGoal} onChange={(dailyGoal) => set({ dailyGoal })} min={5} max={500} step={5} /></Row>
          <Row title={t('Neue Karten')} hint={t('Pro Tag, gilt für „Intelligentes Lernen“.')}><Stepper label={t('Neue Karten pro Tag')} value={s.newPerDay} onChange={(newPerDay) => set({ newPerDay })} min={0} max={300} step={5} /></Row>
          <Row title={t('Maximale Wiederholungen')} hint={t('Pro Tag, gilt für „Intelligentes Lernen“.')}><Stepper label={t('Maximale Wiederholungen pro Tag')} value={s.maxReviewsPerDay} onChange={(maxReviewsPerDay) => set({ maxReviewsPerDay })} min={10} max={2000} step={10} /></Row>
          <Row title={t('Karten pro Sitzung')}><Stepper label={t('Karten pro Sitzung')} value={s.sessionSize} onChange={(sessionSize) => set({ sessionSize })} min={5} max={300} step={5} /></Row>
          <Row title={t('Problemkarten automatisch einbeziehen')} hint={t('Mischt schwierige Karten zusätzlich in „Intelligentes Lernen“, auch wenn sie noch nicht fällig sind.')}>
            <Toggle label={t('Problemkarten automatisch einbeziehen')} checked={s.autoIncludeProblems} onChange={(autoIncludeProblems) => set({ autoIncludeProblems })} />
          </Row>
        </Section>

        <section id="sicherung" data-testid="section-sicherung">
          <h2 className="px-1 text-sm font-semibold text-muted">{t('Daten und Updates')}</h2>
          <p className="mb-2 px-1 text-xs text-muted">{t('Sicherung, Import und Export deiner Daten.')}</p>
          <Card className="space-y-3">
            <h3 className="font-bold">{t('Sicherung')}</h3>
            <p className="text-sm">{t('Alle Karten, Verben und dein Lernfortschritt liegen nur auf diesem Gerät. Es gibt keine Synchronisierung mit einer Cloud. Wenn du die Website-Daten in Safari löschst oder die App vom Home-Bildschirm entfernst, sind die Daten weg. Erstelle deshalb regelmäßig eine Sicherung und bewahre sie außerhalb des Geräts auf, zum Beispiel in iCloud Drive.')}</p>
            <p className="text-sm">{t('Öffne die App auf dem iPhone immer über ihr Symbol auf dem Home-Bildschirm. Safari-Tab und installierte App haben getrennte Speicher.')}</p>
            <p className="text-xs text-muted">
              {t('Letzte Sicherung: {d}.', { d: s.lastBackupAt ? formatDate(s.lastBackupAt) : t('noch keine') })}{' '}
              {persisted === true ? t('Der Browser hat dauerhaften Speicher zugesagt.') : persisted === false ? t('Der Browser hat dauerhaften Speicher bisher nicht zugesagt.') : ''}
            </p>
            {persisted === false && <Button variant="soft" size="sm" onClick={async () => setPersisted(await requestPersistence())}>{t('Dauerhaften Speicher anfragen')}</Button>}
            <Button className="w-full" onClick={() => void backup()} data-testid="create-backup">{t('Vollständige Sicherung erstellen (JSON)')}</Button>
            <Button variant="soft" className="w-full" onClick={async () => { await saveFile(backupFileName('csv'), 'text/csv', await exportCsv()); toast(t('CSV exportiert')); }} data-testid="export-csv">{t('Alle Karten als CSV exportieren')}</Button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onRestoreFile(e.target.files?.[0])} data-testid="restore-input" />
            <Button variant="soft" className="w-full" onClick={() => fileRef.current?.click()}>{t('Sicherung wiederherstellen …')}</Button>
            <p className="text-xs text-muted">{t('Auch Sicherungen der früheren Persisch-Deutsch-App lassen sich hier einlesen.')}</p>
            <Button variant="ghost" size="sm" className="w-full" onClick={async () => toast(t('{n} ungenutzte Bilder entfernt', { n: await pruneMedia() }))}>{t('Ungenutzte Bilder aufräumen')}</Button>
          </Card>
        </section>

        <section id="updates" data-testid="section-updates">
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted">{t('Updates')}</h2>
          <Card className="space-y-2">
            <p className="text-sm">{t('Hier erscheint später die Update-Verwaltung der App.')}</p>
            <p className="text-xs text-muted">{t('Deine Daten bleiben bei Updates erhalten.')}</p>
          </Card>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted">{t('Persisch-Deutsch-Version')}</h2>
          <Card className="space-y-3">
            <p className="text-sm">{t('Die ursprüngliche Persisch-Deutsch-App ist weiter erreichbar. Ihre Daten werden beim ersten Start automatisch als Stapel „Persisch – Deutsch“ übernommen, ohne das Original zu verändern.')}</p>
            {legacy !== null && legacy > 0 && (
              <Button variant="soft" className="w-full" data-testid="import-legacy" onClick={async () => {
                const data = await readLegacyDb();
                if (!data) return;
                const r = await importConverted(convertLegacy(data), { first: false });
                toast(r.added ? t('{n} neue Vokabeln übernommen', { n: r.added }) : t('Alles ist schon übernommen'));
              }}>{t('Erneut aus der Persisch-Version übernehmen ({n} Vokabeln)', { n: legacy })}</Button>
            )}
            <a href="./legacy/" className="block text-center text-sm font-semibold text-accent">{t('Ursprüngliche Version öffnen')}</a>
          </Card>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted">{t('Beispiele')}</h2>
          <Card className="space-y-3">
            <p className="text-sm">{sampleCount > 0 ? t('Beispielstapel sind geladen. Sie sind als „Beispiel“ markiert.') : t('Vier kleine Beispielstapel: Persisch, Analysis mit Formeln, Physik und Python-Code.')}</p>
            {sampleCount > 0
              ? <Button variant="danger" className="w-full" onClick={() => setConfirmSample(true)} data-testid="remove-sample">{t('Beispiele entfernen')}</Button>
              : <Button variant="soft" className="w-full" onClick={async () => { toast(t('{n} Beispielkarten geladen', { n: await loadSampleData() })); }} data-testid="load-sample">{t('Beispiele laden')}</Button>}
          </Card>
        </section>
        <p className="px-1 text-center text-xs text-muted">{t('Lernkarten 2.0 – kostenlos, ohne Konto, ohne Werbung. Funktioniert offline.')}</p>
      </div>

      <Confirm open={!!check && !check.ok} title={t('Sicherung nicht lesbar')} confirmLabel={t('Verstanden')} onConfirm={() => setCheck(null)} onCancel={() => setCheck(null)}
        text={<ul className="list-disc space-y-1 pl-4">{check?.errors.map((e) => <li key={e}>{e}</li>)}</ul>} />

      <Confirm open={!!check?.ok && !confirmReplace} title={t('Sicherung wiederherstellen')} confirmLabel={t('Zusammenführen')} onConfirm={() => void restore('merge')} onCancel={() => setCheck(null)}
        text={check?.summary && <>
          <p data-testid="restore-summary">
            {check.kind === 'legacy' ? t('Sicherung der Persisch-Deutsch-App: ') : t('Die Datei enthält ')}
            {check.summary.cards} {plural(check.summary.cards, 'Karte', 'Karten')} {t('in')} {check.summary.decks} {plural(check.summary.decks, 'Stapel', 'Stapeln')}
            {check.summary.verbs > 0 ? `, ${check.summary.verbs} ${plural(check.summary.verbs, 'Verb', 'Verben')}` : ''} {t('und')} {check.summary.reviews} {t('Antworten')}
            {check.summary.exportedAt ? ` (${t('erstellt am {d}', { d: formatDate(Date.parse(check.summary.exportedAt)) })})` : ''}.
          </p>
          <p className="mt-2"><b>{t('Zusammenführen')}</b> {t('fügt nur hinzu, was hier noch fehlt. Vorhandene Karten und ihr Lernstand bleiben unverändert.')}</p>
        </>}>
        <Button variant="danger" className="mt-4 w-full" onClick={() => setConfirmReplace(true)} data-testid="restore-replace">{t('Stattdessen alles ersetzen …')}</Button>
      </Confirm>

      <Confirm open={confirmReplace} danger title={t('Alle aktuellen Daten ersetzen?')} confirmLabel={t('Ja, alles ersetzen')} onConfirm={() => void restore('replace')} onCancel={() => setConfirmReplace(false)}
        text={t('Alle Stapel, Karten, Bilder und der gesamte Lernfortschritt auf diesem Gerät werden gelöscht und durch den Inhalt der Sicherung ersetzt. Das lässt sich nicht rückgängig machen.')} />

      <Confirm open={confirmSample} danger title={t('Beispiele entfernen?')} confirmLabel={t('Beispiele entfernen')} onCancel={() => setConfirmSample(false)}
        onConfirm={async () => { const n = await removeSampleData(); toast(t('{n} Beispielkarten entfernt', { n })); setConfirmSample(false); }}
        text={t('Die Beispielstapel und ihr Lernverlauf werden gelöscht. Deine eigenen Karten bleiben unberührt.')} />
    </Page>
  );
}
