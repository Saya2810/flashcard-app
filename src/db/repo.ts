import { DEFAULT_SETTINGS, defaultSide, type AppSettings, type Card, type CustomField, type Deck, type DeckColor, type Lesson, type Priority, type SideStyle } from '../types';
import { dupKey, newId } from '../lib/text';
import { dueForPriority } from '../srs/scheduler';
import { db, type AppDB } from './db';

export class ValidationError extends Error {}

export const clampPriority = (p: unknown): Priority => {
  const n = Math.round(Number(p));
  return (Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3) as Priority;
};
const cleanList = (list: string[] | undefined) => [...new Set((list ?? []).map((t) => t.trim()).filter(Boolean))];

// ---------- Decks ----------

export interface DeckInput {
  name: string;
  subject?: string;
  description?: string;
  color?: DeckColor;
  front?: Partial<SideStyle>;
  back?: Partial<SideStyle>;
  reverse?: boolean;
  rich?: boolean;
  fields?: CustomField[];
  sample?: 0 | 1;
}

export function buildDeck(input: DeckInput, now = Date.now()): Deck {
  const name = input.name.trim();
  if (!name) throw new ValidationError('Bitte einen Namen für den Stapel eintragen.');
  return {
    id: newId(),
    name,
    subject: input.subject?.trim() ?? '',
    description: input.description?.trim() ?? '',
    color: input.color ?? 'rose',
    front: { ...defaultSide('Vorderseite'), ...input.front },
    back: { ...defaultSide('Rückseite'), ...input.back },
    reverse: input.reverse ?? false,
    rich: input.rich ?? true,
    fields: input.fields ?? [],
    createdAt: now,
    lastPracticedAt: 0,
    sample: input.sample ?? 0,
  };
}

export async function addDeck(input: DeckInput, database: AppDB = db): Promise<Deck> {
  const d = buildDeck(input);
  if (await database.decks.where('name').equals(d.name).count()) throw new ValidationError(`Den Stapel „${d.name}“ gibt es schon.`);
  await database.decks.add(d);
  return d;
}

export async function updateDeck(id: string, patch: Partial<Omit<Deck, 'id'>>, database: AppDB = db): Promise<void> {
  if (patch.name !== undefined) {
    patch.name = patch.name.trim();
    if (!patch.name) throw new ValidationError('Bitte einen Namen für den Stapel eintragen.');
    const clash = await database.decks.where('name').equals(patch.name).first();
    if (clash && clash.id !== id) throw new ValidationError(`Den Stapel „${patch.name}“ gibt es schon.`);
  }
  await database.decks.update(id, patch);
}

/** Deletes a deck with all its lessons, cards, states and review history. */
export async function deleteDeck(id: string, database: AppDB = db): Promise<void> {
  const d = database;
  await d.transaction('rw', [d.decks, d.lessons, d.cards, d.states, d.reviews], async () => {
    const ids = await d.cards.where('deckId').equals(id).primaryKeys();
    await deleteCards(ids, d);
    await d.lessons.where('deckId').equals(id).delete();
    await d.decks.delete(id);
  });
}

export async function deckIdByName(name: string, cache: Map<string, string>, database: AppDB = db): Promise<string> {
  const n = name.trim();
  const hit = cache.get(n);
  if (hit) return hit;
  const existing = await database.decks.where('name').equals(n).first();
  const id = existing?.id ?? (await addDeck({ name: n }, database)).id;
  cache.set(n, id);
  return id;
}

// ---------- Lessons ----------

export async function addLesson(deckId: string, name: string, description = '', database: AppDB = db): Promise<Lesson> {
  const n = name.trim();
  if (!n) throw new ValidationError('Bitte einen Namen für die Lektion eintragen.');
  if (await database.lessons.where('[deckId+name]').equals([deckId, n]).count()) throw new ValidationError(`Die Lektion „${n}“ gibt es in diesem Stapel schon.`);
  const lesson: Lesson = { id: newId(), deckId, name: n, description: description.trim(), createdAt: Date.now(), lastPracticedAt: 0 };
  await database.lessons.add(lesson);
  return lesson;
}

export async function updateLesson(id: string, name: string, description: string, database: AppDB = db): Promise<void> {
  const n = name.trim();
  if (!n) throw new ValidationError('Bitte einen Namen für die Lektion eintragen.');
  const lesson = await database.lessons.get(id);
  if (!lesson) return;
  const clash = await database.lessons.where('[deckId+name]').equals([lesson.deckId, n]).first();
  if (clash && clash.id !== id) throw new ValidationError(`Die Lektion „${n}“ gibt es in diesem Stapel schon.`);
  await database.lessons.update(id, { name: n, description: description.trim() });
}

/** withCards=false (default): cards are kept and end up without a lesson. */
export async function deleteLesson(id: string, withCards = false, database: AppDB = db): Promise<void> {
  const d = database;
  await d.transaction('rw', [d.lessons, d.cards, d.states, d.reviews], async () => {
    const ids = await d.cards.where('lessonId').equals(id).primaryKeys();
    if (withCards) await deleteCards(ids, d);
    else await d.cards.where('id').anyOf(ids).modify({ lessonId: '' });
    await d.lessons.delete(id);
  });
}

export async function lessonIdByName(deckId: string, name: string, cache: Map<string, string>, database: AppDB = db): Promise<string> {
  const n = name.trim();
  if (!n) return '';
  const k = `${deckId}\u0000${n}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const existing = await database.lessons.where('[deckId+name]').equals([deckId, n]).first();
  const id = existing?.id ?? (await addLesson(deckId, n, '', database)).id;
  cache.set(k, id);
  return id;
}

// ---------- Cards ----------

export interface CardInput {
  deckId: string;
  front: string;
  back: string;
  altBack?: string[];
  fields?: Record<string, string>;
  notes?: string;
  lessonId?: string;
  priority?: number;
  tags?: string[];
  sample?: 0 | 1;
}

export function buildCard(input: CardInput, now = Date.now()): Card {
  const front = input.front.trim();
  const back = input.back.trim();
  if (!input.deckId) throw new ValidationError('Bitte einen Stapel wählen.');
  if (!front) throw new ValidationError('Bitte die Vorderseite ausfüllen.');
  if (!back) throw new ValidationError('Bitte die Rückseite ausfüllen.');
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.fields ?? {})) if (v?.trim()) fields[k] = v.trim();
  return {
    id: newId(),
    deckId: input.deckId,
    lessonId: input.lessonId ?? '',
    front,
    back,
    altBack: cleanList(input.altBack).filter((a) => a !== back),
    fields,
    notes: input.notes?.trim() ?? '',
    priority: clampPriority(input.priority ?? 3),
    tags: cleanList(input.tags),
    frontKey: dupKey(front),
    createdAt: now,
    updatedAt: now,
    lastReviewAt: 0,
    status: 'neu',
    problem: 0,
    sample: input.sample ?? 0,
  };
}

export async function addCard(input: CardInput, database: AppDB = db): Promise<Card> {
  const c = buildCard(input);
  await database.cards.add(c);
  return c;
}

export async function updateCard(id: string, input: CardInput, database: AppDB = db): Promise<void> {
  const b = buildCard(input);
  const d = database;
  await d.transaction('rw', [d.cards, d.states, d.reviews], async () => {
    const old = await d.cards.get(id);
    if (!old) throw new ValidationError('Diese Karte gibt es nicht mehr.');
    await d.cards.update(id, {
      deckId: b.deckId, lessonId: b.lessonId, front: b.front, back: b.back, altBack: b.altBack, fields: b.fields,
      notes: b.notes, tags: b.tags, frontKey: b.frontKey, updatedAt: Date.now(),
    });
    if (old.deckId !== b.deckId) {
      await d.states.where('cardId').equals(id).modify({ deckId: b.deckId });
      await d.reviews.where('cardId').equals(id).modify({ deckId: b.deckId });
    }
    if (old.priority !== b.priority) await setPriority(id, b.priority, d);
  });
}

/** Change priority: the memory state stays, only the due date follows the new target retention. */
export async function setPriority(id: string, priority: number, database: AppDB = db): Promise<void> {
  const p = clampPriority(priority);
  await database.transaction('rw', database.cards, database.states, async () => {
    await database.cards.update(id, { priority: p, updatedAt: Date.now() });
    const states = await database.states.where('cardId').equals(id).toArray();
    for (const s of states) await database.states.update(s.id, dueForPriority(s, p));
  });
}

/** Deletes cards with their states and review log. Daily activity counts are kept. */
export async function deleteCards(ids: string[], database: AppDB = db): Promise<void> {
  const d = database;
  await d.transaction('rw', d.cards, d.states, d.reviews, async () => {
    await d.reviews.where('cardId').anyOf(ids).delete();
    await d.states.where('cardId').anyOf(ids).delete();
    await d.cards.bulkDelete(ids);
  });
}

/** Moves cards to another lesson (and, if that lesson belongs to another deck, to that deck). */
export async function moveCards(ids: string[], target: { deckId: string; lessonId: string }, database: AppDB = db): Promise<void> {
  const d = database;
  await d.transaction('rw', d.cards, d.states, d.reviews, async () => {
    await d.cards.where('id').anyOf(ids).modify({ deckId: target.deckId, lessonId: target.lessonId, updatedAt: Date.now() });
    await d.states.where('cardId').anyOf(ids).modify({ deckId: target.deckId });
    await d.reviews.where('cardId').anyOf(ids).modify({ deckId: target.deckId });
  });
}

export interface DuplicateInfo { exact: Card[]; sameFront: Card[] }

export async function findDuplicates(deckId: string, front: string, back: string, excludeId?: string, database: AppDB = db): Promise<DuplicateInfo> {
  const key = dupKey(front);
  if (!key) return { exact: [], sameFront: [] };
  const hits = (await database.cards.where('frontKey').equals(key).toArray()).filter((c) => c.id !== excludeId && c.deckId === deckId);
  const b = dupKey(back);
  const exact = hits.filter((c) => [c.back, ...c.altBack].some((x) => dupKey(x) === b));
  return { exact, sameFront: hits.filter((c) => !exact.includes(c)) };
}

// ---------- Settings ----------

export async function getSettings(database: AppDB = db): Promise<AppSettings> {
  return { ...DEFAULT_SETTINGS, ...((await database.settings.get('app')) ?? {}) };
}

export async function saveSettings(patch: Partial<AppSettings>, database: AppDB = db): Promise<void> {
  const cur = await getSettings(database);
  await database.settings.put({ ...cur, ...patch, key: 'app' });
}
