import Dexie from 'dexie';
import { dupKey } from '../lib/text';
import { cardStatus } from '../srs/metrics';
import type { AppSettings, Card, DayStats, Deck, Direction, DirectionChoice, LearningSession, Lesson, ReviewEvent, SchedState } from '../types';
import { db, type AppDB } from './db';
import { buildDeck, getSettings, saveSettings } from './repo';

/**
 * Bridge to the original Persian–German app (branch legacy/persian-german).
 * Its IndexedDB „persisch-karten“ and its backup files („persisch-karten-backup“) are read and
 * converted; the old database itself is never modified.
 */
export const LEGACY_DB = 'persisch-karten';
export const LEGACY_BACKUP_FORMAT = 'persisch-karten-backup';
export const LEGACY_DECK_ID = 'legacy-persisch-deutsch';

/* Shapes of the legacy data (only the fields we read). */
export interface LegacyVocab {
  id: string; persian: string; german: string; altGerman?: string[]; translit?: string; grammar?: string;
  exampleFa?: string; exampleDe?: string; notes?: string; lessonId?: string; priority?: number; tags?: string[];
  createdAt?: number; updatedAt?: number; lastReviewAt?: number; sample?: 0 | 1;
}
export interface LegacyData {
  vocab: LegacyVocab[];
  lessons: { id: string; name: string; description?: string; createdAt?: number; lastPracticedAt?: number }[];
  states: (Omit<SchedState, 'id' | 'cardId' | 'deckId' | 'direction'> & { id: string; vocabId: string; direction: string })[];
  reviews: (Omit<ReviewEvent, 'cardId' | 'deckId' | 'direction'> & { vocabId: string; direction: string })[];
  sessions: (Omit<LearningSession, 'deckIds' | 'direction'> & { direction: string })[];
  days: DayStats[];
  settings?: Partial<Record<string, unknown>> | null;
}

const DIR: Record<string, Direction> = { 'fa-de': 'fwd', 'de-fa': 'rev' };
const DIR_CHOICE: Record<string, DirectionChoice> = { 'fa-de': 'fwd', 'de-fa': 'rev', mixed: 'mixed' };

export function legacyDeck(persianScale = 1): Deck {
  return {
    ...buildDeck({
      name: 'Persisch – Deutsch',
      subject: 'Sprachen',
      description: 'Übernommen aus der ursprünglichen Persisch-Deutsch-App',
      color: 'rose',
      front: { label: 'Persisch', lang: 'fa', dir: 'rtl', font: 'vazirmatn', scale: Math.min(1.8, Math.max(0.7, persianScale * 1.1)), weight: 600 },
      back: { label: 'Deutsch', lang: 'de', dir: 'ltr', font: 'system', scale: 1, weight: 700 },
      reverse: true,
      rich: false,
      fields: [
        { key: 'umschrift', label: 'Umschrift', dir: 'ltr', font: 'system' },
        { key: 'grammatik', label: 'Grammatik', dir: 'auto', font: 'system' },
        { key: 'beispiel_fa', label: 'Beispiel (Persisch)', dir: 'rtl', font: 'vazirmatn' },
        { key: 'beispiel_de', label: 'Beispiel (Deutsch)', dir: 'ltr', font: 'system' },
      ],
    }),
    id: LEGACY_DECK_ID,
  };
}

export interface Converted {
  deck: Deck;
  lessons: Lesson[];
  cards: Card[];
  states: SchedState[];
  reviews: ReviewEvent[];
  sessions: LearningSession[];
  days: DayStats[];
  settings: Partial<AppSettings>;
}

/** Pure conversion of legacy data into the universal model. IDs are kept, so re-importing is idempotent. */
export function convertLegacy(data: LegacyData): Converted {
  const s = data.settings ?? {};
  const deck = legacyDeck(typeof s.persianFontScale === 'number' ? s.persianFontScale : 1);
  const lessons: Lesson[] = data.lessons.map((l) => ({
    id: l.id, deckId: deck.id, name: l.name, description: l.description ?? '', createdAt: l.createdAt ?? Date.now(), lastPracticedAt: l.lastPracticedAt ?? 0,
  }));
  const states: SchedState[] = data.states.filter((x) => DIR[x.direction]).map(({ vocabId, direction, ...rest }) => ({
    ...rest, id: `${vocabId}|${DIR[direction]}`, cardId: vocabId, deckId: deck.id, direction: DIR[direction],
  }));
  const byCard = new Map<string, SchedState[]>();
  for (const st of states) byCard.set(st.cardId, [...(byCard.get(st.cardId) ?? []), st]);
  const cards: Card[] = data.vocab.map((v) => {
    const fields: Record<string, string> = {};
    if (v.translit) fields.umschrift = v.translit;
    if (v.grammar) fields.grammatik = v.grammar;
    if (v.exampleFa) fields.beispiel_fa = v.exampleFa;
    if (v.exampleDe) fields.beispiel_de = v.exampleDe;
    const st = byCard.get(v.id) ?? [];
    return {
      id: v.id, deckId: deck.id, lessonId: v.lessonId ?? '', front: v.persian, back: v.german, altBack: v.altGerman ?? [],
      fields, notes: v.notes ?? '', priority: (Math.min(5, Math.max(1, Math.round(v.priority ?? 3)))) as Card['priority'],
      tags: v.tags ?? [], frontKey: dupKey(v.persian), createdAt: v.createdAt ?? Date.now(), updatedAt: v.updatedAt ?? Date.now(),
      lastReviewAt: v.lastReviewAt ?? 0, status: cardStatus(st), problem: st.some((x) => x.problem) ? 1 : 0, sample: v.sample ?? 0,
    };
  });
  const reviews: ReviewEvent[] = data.reviews.filter((r) => DIR[r.direction]).map(({ vocabId, direction, ...rest }) => ({
    ...rest, cardId: vocabId, deckId: deck.id, direction: DIR[direction],
  }));
  const sessions: LearningSession[] = data.sessions.map(({ direction, ...rest }) => ({
    ...rest, direction: DIR_CHOICE[direction] ?? 'mixed', deckIds: [deck.id], lessonIds: (rest as { lessonIds?: string[] }).lessonIds ?? [],
  }));
  const settings: Partial<AppSettings> = {};
  if (s.theme === 'light' || s.theme === 'dark' || s.theme === 'system') settings.theme = s.theme;
  if (typeof s.defaultDirection === 'string' && DIR_CHOICE[s.defaultDirection]) settings.defaultDirection = DIR_CHOICE[s.defaultDirection];
  for (const k of ['dailyGoal', 'newPerDay', 'maxReviewsPerDay', 'sessionSize', 'cardFontScale'] as const) if (typeof s[k] === 'number') settings[k] = s[k] as number;
  for (const k of ['animations', 'autoIncludeProblems'] as const) if (typeof s[k] === 'boolean') settings[k] = s[k] as boolean;
  return { deck, lessons, cards, states, reviews, sessions, days: data.days, settings };
}

export async function legacyDbExists(): Promise<boolean> {
  try { return await Dexie.exists(LEGACY_DB); } catch { return false; }
}

/** Reads the legacy database read-only. Returns null if it does not exist or is empty. */
export async function readLegacyDb(): Promise<LegacyData | null> {
  if (!(await legacyDbExists())) return null;
  const old = new Dexie(LEGACY_DB);
  old.version(1).stores({
    vocab: 'id, persianNorm, lessonId, priority, status, problem, sample, createdAt, *tags',
    lessons: 'id, name, sample',
    states: 'id, vocabId, direction, due, problem, [direction+due]',
    reviews: 'id, vocabId, ts, day, sessionId, [vocabId+ts]',
    sessions: 'id, startedAt',
    days: 'day',
    settings: 'key',
  });
  try {
    await old.open();
    const data: LegacyData = {
      vocab: await old.table('vocab').toArray(),
      lessons: await old.table('lessons').toArray(),
      states: await old.table('states').toArray(),
      reviews: await old.table('reviews').toArray(),
      sessions: await old.table('sessions').toArray(),
      days: await old.table('days').toArray(),
      settings: (await old.table('settings').get('app')) ?? null,
    };
    return data.vocab.length ? data : null;
  } catch {
    return null;
  } finally {
    old.close();
  }
}

/**
 * Merges converted legacy data into the database. Existing cards (same ID) and their progress are
 * never overwritten. Daily activity and settings are taken over only on the first import.
 */
export async function importConverted(c: Converted, opts: { first: boolean }, database: AppDB = db): Promise<{ added: number }> {
  const d = database;
  return d.transaction('rw', [d.decks, d.lessons, d.cards, d.states, d.reviews, d.sessions, d.days, d.settings], async () => {
    if (!(await d.decks.get(c.deck.id))) {
      let name = c.deck.name;
      for (let i = 2; await d.decks.where('name').equals(name).count(); i++) name = `${c.deck.name} (${i})`;
      await d.decks.add({ ...c.deck, name });
    }
    const existingLessons = new Set(await d.lessons.where('deckId').equals(c.deck.id).primaryKeys());
    await d.lessons.bulkPut(c.lessons.filter((l) => !existingLessons.has(l.id)));
    const have = await d.cards.bulkGet(c.cards.map((x) => x.id));
    const fresh = c.cards.filter((_, i) => !have[i]);
    const added = new Set(fresh.map((x) => x.id));
    await d.cards.bulkAdd(fresh);
    await d.states.bulkPut(c.states.filter((s) => added.has(s.cardId)));
    await d.reviews.bulkPut(c.reviews.filter((r) => added.has(r.cardId)));
    const haveSessions = await d.sessions.bulkGet(c.sessions.map((s) => s.id));
    await d.sessions.bulkAdd(c.sessions.filter((_, i) => !haveSessions[i]));
    if (opts.first) {
      for (const day of c.days) {
        const row = await d.days.get(day.day);
        if (!row) await d.days.add(day);
        else await d.days.put({ ...row, reviews: row.reviews + day.reviews, correct: row.correct + day.correct, incorrect: row.incorrect + day.incorrect, newCards: row.newCards + day.newCards, relearn: row.relearn + day.relearn });
      }
      await saveSettings({ ...c.settings, legacyImportedAt: Date.now() }, d);
    }
    return { added: fresh.length };
  });
}

/** Runs once on start: copies the Persian–German data into the new app if it exists and was not imported yet. */
export async function autoImportLegacy(database: AppDB = db): Promise<number> {
  const s = await getSettings(database);
  if (s.legacyImportedAt) return 0;
  const data = await readLegacyDb();
  if (!data) { await saveSettings({ legacyImportedAt: -1 }, database); return 0; }
  const r = await importConverted(convertLegacy(data), { first: true }, database);
  return r.added;
}
