import { DEFAULT_SETTINGS, type AppSettings, type Lesson, type Priority, type Vocab } from '../types';
import { newId, normalizeFa, normalizeLatin } from '../lib/persian';
import { dueForPriority } from '../srs/scheduler';
import { db, type AppDB } from './db';

export interface VocabInput {
  persian: string;
  german: string;
  altGerman?: string[];
  translit?: string;
  grammar?: string;
  exampleFa?: string;
  exampleDe?: string;
  notes?: string;
  lessonId?: string;
  priority?: number;
  tags?: string[];
  sample?: 0 | 1;
}

export class ValidationError extends Error {}

export const clampPriority = (p: unknown): Priority => {
  const n = Math.round(Number(p));
  return (Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3) as Priority;
};

const cleanList = (list: string[] | undefined) => [...new Set((list ?? []).map((t) => t.trim()).filter(Boolean))];

export function buildVocab(input: VocabInput, now = Date.now()): Vocab {
  const persian = input.persian.trim();
  const german = input.german.trim();
  if (!persian) throw new ValidationError('Bitte das persische Wort eintragen.');
  if (!german) throw new ValidationError('Bitte die deutsche Übersetzung eintragen.');
  return {
    id: newId(),
    persian,
    persianNorm: normalizeFa(persian),
    german,
    altGerman: cleanList(input.altGerman).filter((a) => a !== german),
    translit: input.translit?.trim() ?? '',
    grammar: input.grammar?.trim() ?? '',
    exampleFa: input.exampleFa?.trim() ?? '',
    exampleDe: input.exampleDe?.trim() ?? '',
    notes: input.notes?.trim() ?? '',
    lessonId: input.lessonId ?? '',
    priority: clampPriority(input.priority ?? 3),
    tags: cleanList(input.tags),
    createdAt: now,
    updatedAt: now,
    lastReviewAt: 0,
    status: 'neu',
    problem: 0,
    sample: input.sample ?? 0,
  };
}

export async function addVocab(input: VocabInput, database: AppDB = db): Promise<Vocab> {
  const v = buildVocab(input);
  await database.vocab.add(v);
  return v;
}

export async function updateVocab(id: string, input: VocabInput, database: AppDB = db): Promise<void> {
  const built = buildVocab(input);
  const { persian, persianNorm, german, altGerman, translit, grammar, exampleFa, exampleDe, notes, lessonId, tags, priority } = built;
  await database.transaction('rw', database.vocab, database.states, async () => {
    const old = await database.vocab.get(id);
    if (!old) throw new ValidationError('Diese Vokabel gibt es nicht mehr.');
    await database.vocab.update(id, { persian, persianNorm, german, altGerman, translit, grammar, exampleFa, exampleDe, notes, lessonId, tags, updatedAt: Date.now() });
    if (old.priority !== priority) await setPriority(id, priority, database);
  });
}

/** Change priority: the memory state stays, only the due date is adjusted to the new target retention. */
export async function setPriority(id: string, priority: number, database: AppDB = db): Promise<void> {
  const p = clampPriority(priority);
  await database.transaction('rw', database.vocab, database.states, async () => {
    await database.vocab.update(id, { priority: p, updatedAt: Date.now() });
    const states = await database.states.where('vocabId').equals(id).toArray();
    for (const s of states) await database.states.update(s.id, dueForPriority(s, p));
  });
}

/** Deletes items together with their scheduling states and review log. Daily activity is kept. */
export async function deleteVocab(ids: string[], database: AppDB = db): Promise<void> {
  await database.transaction('rw', database.vocab, database.states, database.reviews, async () => {
    await database.reviews.where('vocabId').anyOf(ids).delete();
    await database.states.where('vocabId').anyOf(ids).delete();
    await database.vocab.bulkDelete(ids);
  });
}

export interface DuplicateInfo { exact: Vocab[]; samePersian: Vocab[] }

export async function findDuplicates(persian: string, german: string, excludeId?: string, database: AppDB = db): Promise<DuplicateInfo> {
  const norm = normalizeFa(persian);
  if (!norm) return { exact: [], samePersian: [] };
  const hits = (await database.vocab.where('persianNorm').equals(norm).toArray()).filter((v) => v.id !== excludeId);
  const g = normalizeLatin(german);
  const exact = hits.filter((v) => [v.german, ...v.altGerman].some((x) => normalizeLatin(x) === g));
  return { exact, samePersian: hits.filter((v) => !exact.includes(v)) };
}

export async function moveVocab(ids: string[], lessonId: string, database: AppDB = db): Promise<void> {
  await database.vocab.where('id').anyOf(ids).modify({ lessonId, updatedAt: Date.now() });
}

// ---------- Lessons ----------

export async function addLesson(name: string, description = '', sample: 0 | 1 = 0, database: AppDB = db): Promise<Lesson> {
  const n = name.trim();
  if (!n) throw new ValidationError('Bitte einen Namen für die Lektion eintragen.');
  if (await database.lessons.where('name').equals(n).count()) throw new ValidationError(`Die Lektion „${n}“ gibt es schon.`);
  const lesson: Lesson = { id: newId(), name: n, description: description.trim(), createdAt: Date.now(), lastPracticedAt: 0, sample };
  await database.lessons.add(lesson);
  return lesson;
}

export async function updateLesson(id: string, name: string, description: string, database: AppDB = db): Promise<void> {
  const n = name.trim();
  if (!n) throw new ValidationError('Bitte einen Namen für die Lektion eintragen.');
  const clash = await database.lessons.where('name').equals(n).first();
  if (clash && clash.id !== id) throw new ValidationError(`Die Lektion „${n}“ gibt es schon.`);
  await database.lessons.update(id, { name: n, description: description.trim() });
}

/** withVocab=false (default): items are kept and end up without a lesson. */
export async function deleteLesson(id: string, withVocab = false, database: AppDB = db): Promise<void> {
  await database.transaction('rw', database.lessons, database.vocab, database.states, database.reviews, async () => {
    const ids = await database.vocab.where('lessonId').equals(id).primaryKeys();
    if (withVocab) await deleteVocab(ids, database);
    else await moveVocab(ids, '', database);
    await database.lessons.delete(id);
  });
}

/** Finds a lesson by name or creates it (for imports). */
export async function lessonIdByName(name: string, cache: Map<string, string>, database: AppDB = db): Promise<string> {
  const n = name.trim();
  if (!n) return '';
  const hit = cache.get(n);
  if (hit) return hit;
  const existing = await database.lessons.where('name').equals(n).first();
  const id = existing?.id ?? (await addLesson(n, '', 0, database)).id;
  cache.set(n, id);
  return id;
}

// ---------- Settings ----------

export async function getSettings(database: AppDB = db): Promise<AppSettings> {
  return { ...DEFAULT_SETTINGS, ...((await database.settings.get('app')) ?? {}) };
}

export async function saveSettings(patch: Partial<AppSettings>, database: AppDB = db): Promise<void> {
  const cur = await getSettings(database);
  await database.settings.put({ ...cur, ...patch, key: 'app' });
}
