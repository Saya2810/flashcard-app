import { dupKey, fieldKey } from '../lib/text';
import type { CustomField } from '../types';
import { db, type AppDB } from './db';
import { buildCard, clampPriority, deckIdByName, lessonIdByName } from './repo';
import { t } from '../i18n';

/** What a CSV column is used for. 'field' = a custom field of the deck (label given by the user). */
export type ColumnTarget = 'ignore' | 'front' | 'back' | 'alt' | 'deck' | 'lesson' | 'priority' | 'tags' | 'notes' | 'field';
export interface ColumnMap { target: ColumnTarget; label: string }

export const TARGET_LABEL: Record<ColumnTarget, string> = {
  ignore: 'nicht importieren',
  front: 'Vorderseite',
  back: 'Rückseite',
  alt: 'Weitere Antworten',
  deck: 'Stapel',
  lesson: 'Lektion',
  priority: 'Priorität',
  tags: 'Tags',
  notes: 'Notizen',
  field: 'Eigenes Feld',
};

const ALIASES: [ColumnTarget, string[], string?][] = [
  ['front', ['front', 'vorderseite', 'frage', 'question', 'term', 'begriff', 'wort', 'persian', 'persisch', 'farsi']],
  ['back', ['back', 'rückseite', 'rueckseite', 'antwort', 'answer', 'definition', 'lösung', 'loesung', 'german', 'deutsch', 'übersetzung']],
  ['alt', ['alternatives', 'alternativen', 'weitere antworten', 'auch']],
  ['deck', ['deck', 'stapel', 'fach', 'subject']],
  ['lesson', ['lesson', 'lektion', 'kapitel', 'chapter']],
  ['priority', ['priority', 'priorität', 'prio']],
  ['tags', ['tags', 'tag', 'schlagwörter']],
  ['notes', ['notes', 'notizen', 'notiz', 'anmerkung', 'comment']],
  ['field', ['transliteration', 'umschrift', 'translit', 'lautschrift'], 'Umschrift'],
  ['field', ['grammar', 'grammatik', 'wortart'], 'Grammatik'],
  ['field', ['examplepersian', 'beispiel persisch', 'beispiel (persisch)'], 'Beispiel (Persisch)'],
  ['field', ['examplegerman', 'beispiel deutsch', 'beispiel (deutsch)'], 'Beispiel (Deutsch)'],
  ['field', ['example', 'beispiel', 'beispielsatz'], 'Beispiel'],
];

/** Guesses a mapping from the header row; null = the first row does not look like a header. */
export function guessMapping(header: string[]): ColumnMap[] | null {
  const used = new Set<ColumnTarget>();
  const map = header.map((h): ColumnMap => {
    const n = h.trim().toLowerCase();
    for (const [target, names, label] of ALIASES) {
      if (!names.includes(n)) continue;
      if (target !== 'field' && used.has(target)) break;
      used.add(target);
      return { target, label: target === 'field' ? label ?? h.trim() : '' };
    }
    return { target: 'ignore', label: h.trim() };
  });
  return used.has('front') && used.has('back') ? map : null;
}

/** Without a header: column 1 = front, 2 = back, everything else ignored. */
export const defaultMapping = (n: number): ColumnMap[] =>
  Array.from({ length: n }, (_, i) => ({ target: i === 0 ? 'front' : i === 1 ? 'back' : 'ignore', label: t('Spalte {n}', { n: i + 1 }) }));

export interface ImportRow {
  line: number;
  deckName: string;
  lessonName: string;
  front: string;
  back: string;
  altBack: string[];
  /** Custom field values keyed by LABEL (mapped to keys per deck on import). */
  fields: Record<string, string>;
  notes: string;
  tags: string[];
  priority: number;
  error: string | null;
  duplicate: boolean;
}

const splitAlt = (s: string) => s.split(/\s*\|\s*/).map((x) => x.trim()).filter(Boolean);

export function rowsFromTable(rows: string[][], mapping: ColumnMap[], firstLine = 1): ImportRow[] {
  return rows.map((r, i) => {
    const row: ImportRow = { line: firstLine + i, deckName: '', lessonName: '', front: '', back: '', altBack: [], fields: {}, notes: '', tags: [], priority: 3, error: null, duplicate: false };
    let prioRaw = '';
    mapping.forEach((m, col) => {
      const v = (r[col] ?? '').trim();
      switch (m.target) {
        case 'front': row.front = v; break;
        case 'back': { const [first = '', ...rest] = splitAlt(v); row.back = first; row.altBack.push(...rest); break; }
        case 'alt': row.altBack.push(...splitAlt(v)); break;
        case 'deck': row.deckName = v; break;
        case 'lesson': row.lessonName = v; break;
        case 'priority': prioRaw = v; break;
        case 'tags': row.tags = v.split(/[,|]/).map((t) => t.trim()).filter(Boolean); break;
        case 'notes': row.notes = v; break;
        case 'field': if (v && m.label.trim()) row.fields[m.label.trim()] = v; break;
      }
    });
    if (!row.front) row.error = t('Vorderseite fehlt');
    else if (!row.back) row.error = t('Rückseite fehlt');
    else if (prioRaw && !/^[1-5]$/.test(prioRaw)) row.error = t('Priorität „{value}“ ungültig (1–5)', { value: prioRaw });
    else if (prioRaw) row.priority = clampPriority(prioRaw);
    return row;
  });
}

/**
 * Quick entry: one card per line, „Vorderseite ; Rückseite“ (a tab works too).
 * A third part becomes a note. Several accepted answers are separated by „|“.
 */
export function parseBulk(text: string): ImportRow[] {
  const out: ImportRow[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/\s*;\s*|\t+/).map((p) => p.trim());
    const [front = '', backRaw = '', ...rest] = parts;
    const [back = '', ...alt] = splitAlt(backRaw);
    out.push({
      line: i + 1, deckName: '', lessonName: '', front, back, altBack: alt, fields: {}, notes: rest.join('; '), tags: [], priority: 3, duplicate: false,
      error: parts.length < 2 || !front || !back ? t('Trennzeichen „;“ oder Rückseite fehlt') : null,
    });
  });
  return out;
}

/** Marks duplicates against existing cards of the target deck AND within the import itself. */
export async function markDuplicates(rows: ImportRow[], defaultDeckId: string, database: AppDB = db): Promise<ImportRow[]> {
  const deckIds = new Map<string, string>();
  for (const name of new Set(rows.map((r) => r.deckName).filter(Boolean))) {
    const d = await database.decks.where('name').equals(name).first();
    if (d) deckIds.set(name, d.id);
  }
  const keys = [...new Set(rows.filter((r) => !r.error).map((r) => dupKey(r.front)))];
  const existing = keys.length ? await database.cards.where('frontKey').anyOf(keys).toArray() : [];
  const seen = new Set<string>();
  const k = (deck: string, f: string, b: string) => `${deck}\u0000${dupKey(f)}\u0000${dupKey(b)}`;
  for (const c of existing) for (const b of [c.back, ...c.altBack]) seen.add(k(c.deckId, c.front, b));
  return rows.map((r) => {
    if (r.error) return { ...r, duplicate: false };
    const deck = r.deckName ? deckIds.get(r.deckName) ?? `new:${r.deckName}` : defaultDeckId;
    const key = k(deck, r.front, r.back);
    const duplicate = seen.has(key);
    seen.add(key);
    return { ...r, duplicate };
  });
}

export interface ImportOptions { defaultDeckId: string; defaultLessonId: string; skipDuplicates: boolean }

/** Imports in one transaction; creates missing decks, lessons and custom fields as needed. */
export async function importRows(rows: ImportRow[], opts: ImportOptions, database: AppDB = db): Promise<{ imported: number; skipped: number; decks: number; lessons: number }> {
  const d = database;
  return d.transaction('rw', d.cards, d.lessons, d.decks, async () => {
    const deckCache = new Map<string, string>();
    const lessonCache = new Map<string, string>();
    const decksBefore = await d.decks.count();
    const lessonsBefore = await d.lessons.count();
    const fieldKeys = new Map<string, Map<string, string>>(); // deckId → label → key
    const good = rows.filter((r) => !r.error && !(opts.skipDuplicates && r.duplicate));
    let t = Date.now();
    const cards = [];
    for (const r of good) {
      const deckId = r.deckName ? await deckIdByName(r.deckName, deckCache, d) : opts.defaultDeckId;
      const lessonId = r.lessonName ? await lessonIdByName(deckId, r.lessonName, lessonCache, d) : r.deckName ? '' : opts.defaultLessonId;
      const labels = Object.keys(r.fields);
      let keys = fieldKeys.get(deckId);
      if (!keys) {
        const deck = await d.decks.get(deckId);
        keys = new Map((deck?.fields ?? []).map((f) => [f.label, f.key]));
        fieldKeys.set(deckId, keys);
      }
      const missing = labels.filter((l) => !keys!.has(l));
      if (missing.length) {
        const deck = (await d.decks.get(deckId))!;
        const fields: CustomField[] = [...deck.fields];
        for (const label of missing) {
          const key = fieldKey(label, fields.map((f) => f.key));
          fields.push({ key, label, dir: 'auto', font: 'system' });
          keys.set(label, key);
        }
        await d.decks.update(deckId, { fields });
      }
      const fields: Record<string, string> = {};
      for (const [label, v] of Object.entries(r.fields)) fields[keys.get(label)!] = v;
      cards.push(buildCard({ deckId, lessonId, front: r.front, back: r.back, altBack: r.altBack, fields, notes: r.notes, tags: r.tags, priority: r.priority }, t++));
    }
    await d.cards.bulkAdd(cards);
    return {
      imported: cards.length,
      skipped: rows.length - cards.length,
      decks: (await d.decks.count()) - decksBefore,
      lessons: (await d.lessons.count()) - lessonsBefore,
    };
  });
}
