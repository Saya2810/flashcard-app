import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Field, Page, Segmented, cx, inputCls, toast } from '../components/ui';
import { db } from '../db/db';
import { defaultMapping, guessMapping, importRows, markDuplicates, parseBulk, rowsFromTable, TARGET_LABEL, type ColumnMap, type ColumnTarget, type ImportRow } from '../db/import';
import { addDeck, addLesson, ValidationError } from '../db/repo';
import { parseCsv } from '../lib/csv';

const TARGETS = Object.keys(TARGET_LABEL) as ColumnTarget[];
const SINGLE: ColumnTarget[] = ['front', 'back', 'deck', 'lesson', 'priority', 'tags', 'notes'];

function Preview({ rows, skipDuplicates }: { rows: ImportRow[]; skipDuplicates: boolean }) {
  const errors = rows.filter((r) => r.error);
  const dups = rows.filter((r) => r.duplicate);
  const ok = rows.filter((r) => !r.error && !(skipDuplicates && r.duplicate));
  const decks = new Set(ok.map((r) => r.deckName).filter(Boolean));
  const lessons = new Set(ok.map((r) => `${r.deckName}\u0000${r.lessonName}`).filter((k) => !k.endsWith('\u0000')));
  return (
    <Card data-testid="import-preview">
      <h3 className="font-bold">Vorschau</h3>
      <p className="text-sm text-muted" data-testid="import-summary">
        {ok.length} werden importiert{decks.size ? ` in ${decks.size} ${decks.size === 1 ? 'Stapel' : 'Stapel'}` : ''}{lessons.size ? `, ${lessons.size} ${lessons.size === 1 ? 'Lektion' : 'Lektionen'}` : ''}{dups.length ? `, ${dups.length} ${dups.length === 1 ? 'Duplikat' : 'Duplikate'}` : ''}{errors.length ? `, ${errors.length} mit Fehlern` : ''}.
      </p>
      {errors.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-2xl bg-bad-soft p-3 text-sm text-bad">
          {errors.slice(0, 8).map((r) => <li key={r.line}>Zeile {r.line}: {r.error}</li>)}
          {errors.length > 8 && <li>… und {errors.length - 8} weitere</li>}
        </ul>
      )}
      <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto">
        {rows.filter((r) => !r.error).slice(0, 100).map((r) => (
          <li key={r.line} className={cx('flex items-center justify-between gap-3 py-2 text-sm', r.duplicate && skipDuplicates && 'opacity-45')}>
            <span className="min-w-0 truncate font-medium" dir="auto">{r.front}</span>
            <span className="min-w-0 shrink-0 text-end">
              <span className="block max-w-[11rem] truncate" dir="auto">{r.back}{r.altBack.length ? ` | ${r.altBack.join(' | ')}` : ''}</span>
              <span className="block truncate text-xs text-muted">{[r.deckName, r.lessonName, ...Object.keys(r.fields), r.duplicate ? 'Duplikat' : ''].filter(Boolean).join(', ')}</span>
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 100 && <p className="mt-1 text-xs text-muted">Die Vorschau zeigt die ersten 100 Zeilen.</p>}
    </Card>
  );
}

export default function ImportPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const loadedDecks = useLiveQuery(() => db.decks.orderBy('name').toArray(), []);
  const decks = loadedDecks ?? [];
  const [tab, setTab] = useState<'bulk' | 'csv'>('bulk');
  const [deckId, setDeckId] = useState(params.get('stapel') ?? '');
  const [newDeck, setNewDeck] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [newLesson, setNewLesson] = useState('');
  const lessons = useLiveQuery(() => (deckId && deckId !== '__new' ? db.lessons.where('deckId').equals(deckId).sortBy('name') : []), [deckId], []);
  const [bulk, setBulk] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ColumnMap[]>([]);
  const [fileError, setFileError] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (deckId || !loadedDecks) return;
    setDeckId(loadedDecks.length === 1 ? loadedDecks[0].id : '__new');
  }, [loadedDecks, deckId]);

  const parsed = useMemo(() => {
    if (tab === 'bulk') return parseBulk(bulk);
    if (!table || !mapping.some((m) => m.target === 'front') || !mapping.some((m) => m.target === 'back')) return [];
    return rowsFromTable(hasHeader ? table.slice(1) : table, mapping, hasHeader ? 2 : 1);
  }, [tab, bulk, table, mapping, hasHeader]);
  const usesDeckColumn = tab === 'csv' && mapping.some((m) => m.target === 'deck');
  const needsDefaultDeck = !usesDeckColumn || parsed.some((r) => !r.deckName);

  useEffect(() => { let on = true; void markDuplicates(parsed, deckId).then((r) => on && setRows(r)); return () => { on = false; }; }, [parsed, deckId]);

  const onFile = async (file: File | undefined) => {
    setFileError(''); setTable(null);
    if (!file) return;
    try {
      // fatal: true → invalid UTF-8 is reported instead of silently turning into "�".
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      const t = parseCsv(text);
      if (!t.length) { setFileError('Die Datei enthält keine Zeilen.'); return; }
      const width = Math.max(...t.map((r) => r.length));
      const guess = guessMapping(t[0]);
      setHasHeader(!!guess);
      setMapping(guess ?? defaultMapping(width));
      setTable(t);
    } catch {
      setFileError('Die Datei ist nicht als UTF-8 gespeichert. Bitte in der Tabellenkalkulation als „CSV UTF-8“ exportieren.');
    }
  };
  const setCol = (i: number, p: Partial<ColumnMap>) => setMapping((m) => m.map((c, j) => {
    if (j === i) return { ...c, ...p, ...(p.target === 'field' && !c.label ? { label: header[i] } : {}) };
    // Only one column per single-use target.
    if (p.target && SINGLE.includes(p.target) && c.target === p.target) return { ...c, target: 'ignore' };
    return c;
  }));
  const header = table ? (hasHeader ? table[0] : table[0].map((_, i) => `Spalte ${i + 1}`)) : [];
  const importable = rows.filter((r) => !r.error && !(skipDuplicates && r.duplicate)).length;

  const run = async () => {
    setError('');
    try {
      let target = deckId;
      if (needsDefaultDeck && target === '__new') target = (await addDeck({ name: newDeck })).id;
      let lesson = lessonId;
      if (lesson === '__new') lesson = (await addLesson(target, newLesson)).id;
      const res = await importRows(rows, { skipDuplicates, defaultDeckId: target, defaultLessonId: lesson });
      toast(`${res.imported} Karten importiert`);
      nav(needsDefaultDeck && target && target !== '__new' ? `/stapel/${target}` : '/stapel', { replace: true });
    } catch (e) { setError(e instanceof ValidationError ? e.message : 'Import fehlgeschlagen – es wurde nichts verändert.'); }
  };

  return (
    <Page title="Importieren" back>
      <div className="space-y-4 pb-6">
        <Segmented label="Importart" value={tab} onChange={setTab} options={[{ value: 'bulk', label: 'Liste einfügen' }, { value: 'csv', label: 'CSV-Datei' }]} />

        {tab === 'bulk' ? (
          <Field label="Eine Karte pro Zeile" hint="Format: Vorderseite ; Rückseite ; Notiz (optional). Mehrere richtige Antworten mit „|“ trennen.">
            <textarea dir="auto" rows={7} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'آمدن ; kommen\nthe library ; die Bibliothek\nAbleitung von $x^2$ ; $2x$'} className={cx(inputCls, 'leading-loose')} data-testid="bulk-input" />
          </Field>
        ) : (
          <Card className="space-y-3">
            <Field label="CSV-Datei wählen" hint="UTF-8; getrennt durch Komma, Semikolon oder Tab. Mit Spalten für Stapel und Lektion lassen sich viele Lektionen auf einmal importieren.">
              <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} className="block w-full text-sm file:mr-3 file:min-h-[2.75rem] file:rounded-xl file:border-0 file:bg-accent-soft file:px-4 file:font-semibold file:text-accent" data-testid="csv-input" />
            </Field>
            {fileError && <p role="alert" className="rounded-2xl bg-bad-soft p-3 text-sm text-bad">{fileError}</p>}
            {table && (
              <>
                <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-[rgb(var(--accent))]" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />Erste Zeile enthält Spaltenüberschriften</label>
                <div>
                  <h3 className="mb-1 text-sm font-semibold">Spalten zuordnen</h3>
                  <p className="mb-2 text-xs text-muted">Wähle für jede Spalte, wofür sie verwendet wird. „Eigenes Feld“ legt ein Zusatzfeld im Stapel an (z. B. Umschrift, Beispiel, Einheit).</p>
                  <ul className="space-y-2">
                    {header.map((h, i) => (
                      <li key={i} className="rounded-2xl bg-sunken p-2.5">
                        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                          <span className="truncate font-semibold" dir="auto">{h || `Spalte ${i + 1}`}</span>
                          <span className="max-w-[45%] truncate text-xs text-muted" dir="auto">{table[hasHeader ? 1 : 0]?.[i] ?? ''}</span>
                        </div>
                        <div className="flex gap-2">
                          <select aria-label={`Verwendung von ${h || `Spalte ${i + 1}`}`} className="min-h-[2.75rem] flex-1 rounded-xl border border-line bg-surface px-2 text-sm" value={mapping[i]?.target ?? 'ignore'} onChange={(e) => setCol(i, { target: e.target.value as ColumnTarget })} data-testid={`map-${i}`}>
                            {TARGETS.map((t) => <option key={t} value={t}>{TARGET_LABEL[t]}</option>)}
                          </select>
                          {mapping[i]?.target === 'field' && <input aria-label="Feldname" value={mapping[i].label} onChange={(e) => setCol(i, { label: e.target.value })} className="min-h-[2.75rem] w-36 rounded-xl border border-line bg-surface px-2 text-sm" />}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </Card>
        )}

        {rows.length > 0 && (
          <>
            {needsDefaultDeck && (
              <Card className="space-y-3">
                <Field label="Ziel-Stapel" hint={usesDeckColumn ? 'Für Zeilen ohne eigene Stapel-Angabe.' : undefined}>
                  <select value={deckId} onChange={(e) => { setDeckId(e.target.value); setLessonId(''); }} className={inputCls} data-testid="import-deck">
                    {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    <option value="__new">Neuer Stapel …</option>
                  </select>
                </Field>
                {deckId === '__new' && <Field label="Name des neuen Stapels"><input value={newDeck} onChange={(e) => setNewDeck(e.target.value)} className={inputCls} data-testid="import-new-deck" /></Field>}
                <Field label="Lektion" hint={tab === 'csv' && mapping.some((m) => m.target === 'lesson') ? 'Für Zeilen ohne eigene Lektion.' : undefined}>
                  <select value={lessonId} onChange={(e) => setLessonId(e.target.value)} className={inputCls}>
                    <option value="">Ohne Lektion</option>
                    {lessons.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    <option value="__new">Neue Lektion …</option>
                  </select>
                </Field>
                {lessonId === '__new' && <Field label="Name der neuen Lektion"><input value={newLesson} onChange={(e) => setNewLesson(e.target.value)} className={inputCls} /></Field>}
              </Card>
            )}
            <label className="flex items-center gap-3 px-1 text-sm"><input type="checkbox" className="h-5 w-5 accent-[rgb(var(--accent))]" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />Duplikate überspringen</label>
            <Preview rows={rows} skipDuplicates={skipDuplicates} />
            {error && <p role="alert" className="rounded-2xl bg-bad-soft p-3 text-sm font-medium text-bad">{error}</p>}
            <Button size="lg" className="w-full" disabled={!importable} onClick={() => void run()} data-testid="run-import">{importable} {importable === 1 ? 'Karte' : 'Karten'} importieren</Button>
          </>
        )}
      </div>
    </Page>
  );
}
