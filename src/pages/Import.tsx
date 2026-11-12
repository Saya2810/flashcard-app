import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Fa, Field, Page, Segmented, cx, inputCls, toast } from '../components/ui';
import { db } from '../db/db';
import { guessMapping, IMPORT_FIELDS, importRows, markDuplicates, parseBulk, rowsFromTable, type ImportField, type ImportRow } from '../db/import';
import { parseCsv } from '../lib/csv';

type Mapping = Partial<Record<ImportField, number>>;

function Preview({ rows, skipDuplicates }: { rows: ImportRow[]; skipDuplicates: boolean }) {
  const errors = rows.filter((r) => r.error);
  const dups = rows.filter((r) => r.duplicate);
  const ok = rows.filter((r) => !r.error && !(skipDuplicates && r.duplicate));
  return (
    <Card data-testid="import-preview">
      <h3 className="font-bold">Vorschau</h3>
      <p className="text-sm text-muted" data-testid="import-summary">
        {ok.length} werden importiert{dups.length ? `, ${dups.length} ${dups.length === 1 ? 'Duplikat' : 'Duplikate'}` : ''}{errors.length ? `, ${errors.length} mit Fehlern` : ''}.
      </p>
      {errors.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-2xl bg-bad/10 p-3 text-sm text-bad">
          {errors.slice(0, 8).map((r) => <li key={r.line}>Zeile {r.line}: {r.error}</li>)}
          {errors.length > 8 && <li>… und {errors.length - 8} weitere</li>}
        </ul>
      )}
      <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto">
        {rows.filter((r) => !r.error).slice(0, 100).map((r) => (
          <li key={r.line} className={cx('flex items-center justify-between gap-3 py-2 text-sm', r.duplicate && skipDuplicates && 'opacity-45')}>
            <span className="min-w-0">
              <span className="block truncate font-medium">{r.input.german}{r.input.altGerman?.length ? `, ${r.input.altGerman.join(', ')}` : ''}</span>
              <span className="block truncate text-xs text-muted">{[r.input.translit, r.lessonName, r.duplicate ? 'Duplikat' : ''].filter(Boolean).join(', ')}</span>
            </span>
            <Fa className="shrink-0 font-semibold">{r.input.persian}</Fa>
          </li>
        ))}
      </ul>
      {rows.length > 100 && <p className="mt-1 text-xs text-muted">Die Vorschau zeigt die ersten 100 Zeilen.</p>}
    </Card>
  );
}

export default function ImportPage() {
  const nav = useNavigate();
  const lessons = useLiveQuery(() => db.lessons.orderBy('name').toArray(), [], []);
  const [tab, setTab] = useState<'csv' | 'bulk'>('bulk');
  const [bulk, setBulk] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<Mapping>({});
  const [fileError, setFileError] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [rows, setRows] = useState<ImportRow[]>([]);

  const parsed = useMemo(() => {
    if (tab === 'bulk') return parseBulk(bulk);
    if (!table || mapping.persian === undefined || mapping.german === undefined) return [];
    return rowsFromTable(hasHeader ? table.slice(1) : table, mapping, hasHeader ? 2 : 1);
  }, [tab, bulk, table, mapping, hasHeader]);

  useEffect(() => { let on = true; void markDuplicates(parsed).then((r) => on && setRows(r)); return () => { on = false; }; }, [parsed]);

  const onFile = async (file: File | undefined) => {
    setFileError(''); setTable(null);
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      // fatal: true → invalid UTF-8 is reported instead of silently turning into "�".
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      const t = parseCsv(text);
      if (!t.length) { setFileError('Die Datei enthält keine Zeilen.'); return; }
      const guess = guessMapping(t[0]);
      setHasHeader(!!guess);
      setMapping(guess ?? { persian: 0, german: 1, ...(t[0].length > 2 ? { translit: 2 } : {}) });
      setTable(t);
    } catch {
      setFileError('Die Datei ist nicht als UTF-8 gespeichert. Bitte in der Tabellenkalkulation als „CSV UTF-8“ exportieren.');
    }
  };

  const importable = rows.filter((r) => !r.error && !(skipDuplicates && r.duplicate)).length;
  const run = async () => {
    const res = await importRows(rows, { skipDuplicates, defaultLessonId: lessonId });
    toast(`${res.imported} Vokabeln importiert`);
    nav('/vokabeln', { replace: true });
  };
  const header = table ? (hasHeader ? table[0] : table[0].map((_, i) => `Spalte ${i + 1}`)) : [];

  return (
    <Page title="Importieren" back>
      <div className="space-y-4 pb-6">
        <Segmented label="Importart" value={tab} onChange={setTab} options={[{ value: 'bulk', label: 'Schnelleingabe' }, { value: 'csv', label: 'CSV-Datei' }]} />

        {tab === 'bulk' ? (
          <Field label="Eine Vokabel pro Zeile" hint="Format: Persisch ; Deutsch ; Umschrift (optional). Mehrere deutsche Übersetzungen mit Komma trennen.">
            <textarea dir="auto" rows={7} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'آمدن ; kommen\nرفتن ; gehen\nماندن ; bleiben'} className={cx(inputCls, 'leading-loose')} data-testid="bulk-input" />
          </Field>
        ) : (
          <Card className="space-y-3">
            <Field label="CSV-Datei wählen" hint="UTF-8, getrennt durch Komma, Semikolon oder Tab. Spalten: Persian, German, Transliteration, Lesson, Priority, Notes, Tags.">
              <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} className="block w-full text-sm file:mr-3 file:min-h-[2.75rem] file:rounded-xl file:border-0 file:bg-sunken file:px-4 file:font-semibold file:text-ink" data-testid="csv-input" />
            </Field>
            {fileError && <p role="alert" className="rounded-2xl bg-bad/10 p-3 text-sm text-bad">{fileError}</p>}
            {table && (
              <>
                <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />Erste Zeile enthält Spaltenüberschriften</label>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Spalten zuordnen</h3>
                  <div className="space-y-2">
                    {IMPORT_FIELDS.map((f) => (
                      <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
                        <span>{f.label}{(f.key === 'persian' || f.key === 'german') && <span className="text-bad"> *</span>}</span>
                        <select aria-label={`Spalte für ${f.label}`} className="min-h-[2.5rem] w-44 rounded-xl border border-line bg-surface px-2" value={mapping[f.key] ?? -1}
                          onChange={(e) => { const v = Number(e.target.value); setMapping((m) => { const n = { ...m }; if (v < 0) delete n[f.key]; else n[f.key] = v; return n; }); }}>
                          <option value={-1}>nicht importieren</option>
                          {header.map((h, i) => <option key={i} value={i}>{h || `Spalte ${i + 1}`}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </Card>
        )}

        {rows.length > 0 && (
          <>
            <Card className="space-y-3">
              <Field label="Lektion" hint={tab === 'csv' ? 'Gilt für Zeilen ohne eigene Lektionsangabe.' : undefined}>
                <select value={lessonId} onChange={(e) => setLessonId(e.target.value)} className={inputCls}>
                  <option value="">Ohne Lektion</option>
                  {lessons.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
              <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />Duplikate überspringen</label>
            </Card>
            <Preview rows={rows} skipDuplicates={skipDuplicates} />
            <Button size="lg" className="w-full" disabled={!importable} onClick={() => void run()} data-testid="run-import">{importable} {importable === 1 ? 'Vokabel' : 'Vokabeln'} importieren</Button>
          </>
        )}
      </div>
    </Page>
  );
}
