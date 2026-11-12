import { normalizeFa, normalizeLatin } from '../lib/persian';
import { db, type AppDB } from './db';
import { buildVocab, clampPriority, lessonIdByName, type VocabInput } from './repo';

export type ImportField = 'persian' | 'german' | 'translit' | 'lesson' | 'priority' | 'notes' | 'tags' | 'grammar' | 'exampleFa' | 'exampleDe';
export const IMPORT_FIELDS: { key: ImportField; label: string }[] = [
  { key: 'persian', label: 'Persisch' },
  { key: 'german', label: 'Deutsch' },
  { key: 'translit', label: 'Umschrift' },
  { key: 'lesson', label: 'Lektion' },
  { key: 'priority', label: 'Priorität' },
  { key: 'notes', label: 'Notizen' },
  { key: 'tags', label: 'Tags' },
  { key: 'grammar', label: 'Grammatik' },
  { key: 'exampleFa', label: 'Beispiel (Persisch)' },
  { key: 'exampleDe', label: 'Beispiel (Deutsch)' },
];

const ALIASES: Record<ImportField, string[]> = {
  persian: ['persian', 'persisch', 'farsi', 'fa', 'فارسی'],
  german: ['german', 'deutsch', 'de', 'übersetzung', 'translation'],
  translit: ['transliteration', 'umschrift', 'translit', 'lautschrift'],
  lesson: ['lesson', 'lektion', 'kapitel'],
  priority: ['priority', 'priorität', 'prio'],
  notes: ['notes', 'notizen', 'notiz', 'anmerkung'],
  tags: ['tags', 'tag', 'schlagwörter'],
  grammar: ['grammar', 'grammatik', 'wortart'],
  exampleFa: ['examplepersian', 'beispiel persisch', 'beispiel (persisch)', 'example fa'],
  exampleDe: ['examplegerman', 'beispiel deutsch', 'beispiel (deutsch)', 'example de'],
};

/** Maps column headers automatically; null = the first row is not a header. */
export function guessMapping(header: string[]): Partial<Record<ImportField, number>> | null {
  const map: Partial<Record<ImportField, number>> = {};
  header.forEach((h, i) => {
    const n = h.trim().toLowerCase();
    for (const f of Object.keys(ALIASES) as ImportField[]) if (map[f] === undefined && ALIASES[f].includes(n)) map[f] = i;
  });
  return map.persian !== undefined && map.german !== undefined ? map : null;
}

export interface ImportRow {
  line: number;
  input: VocabInput;
  lessonName: string;
  error: string | null;
  duplicate: boolean;
}

const splitGerman = (s: string) => s.split(/\s*\|\s*/).map((x) => x.trim()).filter(Boolean);

export function rowsFromTable(rows: string[][], mapping: Partial<Record<ImportField, number>>, firstLine = 1): Omit<ImportRow, 'duplicate'>[] {
  const cell = (r: string[], f: ImportField) => (mapping[f] !== undefined ? (r[mapping[f]!] ?? '').trim() : '');
  return rows.map((r, i) => {
    const persian = cell(r, 'persian');
    const [german = '', ...alt] = splitGerman(cell(r, 'german'));
    const prioRaw = cell(r, 'priority');
    let error: string | null = null;
    if (!persian) error = 'Persisch fehlt';
    else if (!german) error = 'Deutsch fehlt';
    else if (prioRaw && !/^[1-5]$/.test(prioRaw)) error = `Priorität „${prioRaw}“ ungültig (1–5)`;
    return {
      line: firstLine + i,
      lessonName: cell(r, 'lesson'),
      error,
      input: {
        persian, german, altGerman: alt,
        translit: cell(r, 'translit'), notes: cell(r, 'notes'), grammar: cell(r, 'grammar'),
        exampleFa: cell(r, 'exampleFa'), exampleDe: cell(r, 'exampleDe'),
        tags: cell(r, 'tags').split(/[,|]/).map((t) => t.trim()).filter(Boolean),
        priority: prioRaw && !error ? clampPriority(prioRaw) : 3,
      },
    };
  });
}

/**
 * Quick entry: one item per line, "Persian ; German" (tab, "=" or " - " also work).
 * The order of the two sides is detected from the script.
 */
export function parseBulk(text: string): Omit<ImportRow, 'duplicate'>[] {
  const out: Omit<ImportRow, 'duplicate'>[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/\s*;\s*|\t+|\s+=\s+|\s+[-–—]\s+/).map((p) => p.trim());
    let [a = '', b = '', translit = ''] = parts;
    const isFa = (s: string) => /[؀-ۿ]/.test(s);
    if (!isFa(a) && isFa(b)) [a, b] = [b, a];
    const [german = '', ...alt] = b.split(/\s*[|,]\s*/).filter(Boolean);
    let error: string | null = null;
    if (parts.length < 2 || !a || !german) error = 'Trennzeichen „;“ oder Übersetzung fehlt';
    else if (!isFa(a)) error = 'Kein persischer Text erkannt';
    out.push({ line: i + 1, lessonName: '', error, input: { persian: a, german, altGerman: alt, translit, priority: 3 } });
  });
  return out;
}

/** Marks duplicates against existing data AND within the import itself. */
export async function markDuplicates(rows: Omit<ImportRow, 'duplicate'>[], database: AppDB = db): Promise<ImportRow[]> {
  const keyOf = (p: string, g: string) => `${normalizeFa(p)}\u0000${normalizeLatin(g)}`;
  const norms = [...new Set(rows.filter((r) => !r.error).map((r) => normalizeFa(r.input.persian)))];
  const existing = norms.length ? await database.vocab.where('persianNorm').anyOf(norms).toArray() : [];
  const seen = new Set<string>();
  for (const v of existing) for (const g of [v.german, ...v.altGerman]) seen.add(keyOf(v.persian, g));
  return rows.map((r) => {
    if (r.error) return { ...r, duplicate: false };
    const k = keyOf(r.input.persian, r.input.german);
    const duplicate = seen.has(k);
    seen.add(k);
    return { ...r, duplicate };
  });
}

export async function importRows(rows: ImportRow[], opts: { skipDuplicates: boolean; defaultLessonId: string }, database: AppDB = db): Promise<{ imported: number; skipped: number }> {
  const d = database;
  return d.transaction('rw', d.vocab, d.lessons, async () => {
    const cache = new Map<string, string>();
    const good = rows.filter((r) => !r.error && !(opts.skipDuplicates && r.duplicate));
    let t = Date.now();
    const items = [];
    for (const r of good) {
      const lessonId = r.lessonName ? await lessonIdByName(r.lessonName, cache, d) : opts.defaultLessonId;
      items.push(buildVocab({ ...r.input, lessonId }, t++));
    }
    await d.vocab.bulkAdd(items);
    return { imported: items.length, skipped: rows.length - items.length };
  });
}
