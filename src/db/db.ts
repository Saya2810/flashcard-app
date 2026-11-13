import Dexie, { type Table } from 'dexie';
import type { AppSettings, Card, DayStats, Deck, LearningSession, Lesson, Media, ReviewEvent, SchedState } from '../types';

/**
 * IndexedDB schema of the universal app (database „lernkarten“).
 *
 * The original Persian–German app used the database „persisch-karten“. It is left untouched
 * (the legacy version keeps working on it) and its content is copied in by src/db/legacy.ts.
 *
 * Migrations: append a NEW version for every schema change, never edit an existing one:
 *
 *   this.version(2).stores({ cards: '..., newField' }).upgrade(async (tx) => {
 *     await tx.table('cards').toCollection().modify((c) => { c.newField = ''; });
 *   });
 */
export const DB_NAME = 'lernkarten';
export const SCHEMA_VERSION = 1;

export class AppDB extends Dexie {
  decks!: Table<Deck, string>;
  lessons!: Table<Lesson, string>;
  cards!: Table<Card, string>;
  media!: Table<Media, string>;
  states!: Table<SchedState, string>;
  reviews!: Table<ReviewEvent, string>;
  sessions!: Table<LearningSession, string>;
  days!: Table<DayStats, string>;
  settings!: Table<AppSettings, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      decks: 'id, name, subject, sample',
      lessons: 'id, deckId, name, [deckId+name]',
      // Tags are a multi-entry index (*tags) – the tag list is derived from its keys.
      cards: 'id, deckId, lessonId, frontKey, priority, status, problem, sample, createdAt, *tags',
      media: 'id',
      states: 'id, cardId, deckId, direction, due, problem, [direction+due]',
      reviews: 'id, cardId, deckId, ts, day, sessionId, [cardId+ts]',
      sessions: 'id, startedAt',
      days: 'day',
      settings: 'key',
    });
  }
}

export const db = new AppDB();

export const stateId = (cardId: string, direction: string) => `${cardId}|${direction}`;

/** Asks the browser not to evict the data automatically. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
