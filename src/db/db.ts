import Dexie, { type Table } from 'dexie';
import type { AppSettings, DayStats, LearningSession, Lesson, ReviewEvent, SchedState, Vocab } from '../types';

/**
 * IndexedDB schema.
 *
 * Migrations: append a NEW version for every schema change, never edit an existing one:
 *
 *   this.version(2).stores({ vocab: '..., newField' }).upgrade(async (tx) => {
 *     await tx.table('vocab').toCollection().modify((v) => { v.newField = ''; });
 *   });
 *
 * Dexie runs all missing upgrades in order inside one transaction.
 */
export const SCHEMA_VERSION = 1;

export class AppDB extends Dexie {
  vocab!: Table<Vocab, string>;
  lessons!: Table<Lesson, string>;
  states!: Table<SchedState, string>;
  reviews!: Table<ReviewEvent, string>;
  sessions!: Table<LearningSession, string>;
  days!: Table<DayStats, string>;
  settings!: Table<AppSettings, string>;

  constructor(name = 'persisch-karten') {
    super(name);
    this.version(1).stores({
      // Tags are a multi-entry index (*tags) – the tag list is derived from its keys.
      vocab: 'id, persianNorm, lessonId, priority, status, problem, sample, createdAt, *tags',
      lessons: 'id, name, sample',
      states: 'id, vocabId, direction, due, problem, [direction+due]',
      reviews: 'id, vocabId, ts, day, sessionId, [vocabId+ts]',
      sessions: 'id, startedAt',
      days: 'day',
      settings: 'key',
    });
  }
}

export const db = new AppDB();

export const stateId = (vocabId: string, direction: string) => `${vocabId}|${direction}`;

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
