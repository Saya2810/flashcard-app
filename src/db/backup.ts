import { toCsv } from '../lib/csv';
import { DEFAULT_SETTINGS, type AppSettings, type DayStats, type LearningSession, type Lesson, type ReviewEvent, type SchedState, type Vocab } from '../types';
import { db, SCHEMA_VERSION, type AppDB } from './db';
import { getSettings } from './repo';

export const BACKUP_FORMAT = 'persisch-karten-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  schemaVersion: number;
  exportedAt: string;
  data: {
    vocab: Vocab[];
    lessons: Lesson[];
    states: SchedState[];
    reviews: ReviewEvent[];
    sessions: LearningSession[];
    days: DayStats[];
    settings: AppSettings;
  };
}

export async function createBackup(database: AppDB = db): Promise<BackupFile> {
  const d = database;
  return d.transaction('r', [d.vocab, d.lessons, d.states, d.reviews, d.sessions, d.days, d.settings], async () => ({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      vocab: await d.vocab.toArray(),
      lessons: await d.lessons.toArray(),
      states: await d.states.toArray(),
      reviews: await d.reviews.toArray(),
      sessions: await d.sessions.toArray(),
      days: await d.days.toArray(),
      settings: await getSettings(d),
    },
  }));
}

export interface BackupCheck {
  ok: boolean;
  errors: string[];
  summary: { vocab: number; lessons: number; reviews: number; exportedAt: string } | null;
  backup: BackupFile | null;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Upgrade older backup formats to the current one. Add one step here per future version. */
function migrateBackup(raw: Record<string, unknown>): Record<string, unknown> {
  // if (raw.version === 1) { …transform…; raw.version = 2; }
  return raw;
}

/** Validates a backup file completely BEFORE anything is written. */
export function validateBackup(text: string): BackupCheck {
  const fail = (...errors: string[]): BackupCheck => ({ ok: false, errors, summary: null, backup: null });
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail('Die Datei ist kein gültiges JSON.'); }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) return fail('Das ist keine Sicherung dieser App.');
  if (!isNum(raw.version)) return fail('Die Versionsangabe der Sicherung fehlt.');
  if (raw.version > BACKUP_VERSION) return fail(`Die Sicherung stammt aus einer neueren App-Version (Format ${raw.version}). Bitte zuerst die App aktualisieren.`);
  raw = migrateBackup(raw);
  const data = (raw as Record<string, unknown>).data;
  if (!isObj(data)) return fail('Der Datenteil der Sicherung fehlt.');
  const errors: string[] = [];
  const tables = ['vocab', 'lessons', 'states', 'reviews', 'sessions', 'days'] as const;
  for (const t of tables) if (!Array.isArray(data[t])) errors.push(`Tabelle „${t}“ fehlt oder ist beschädigt.`);
  if (errors.length) return fail(...errors);

  const vocab = data.vocab as unknown[];
  const vocabIds = new Set<string>();
  vocab.forEach((v, i) => {
    if (!isObj(v) || !isStr(v.id) || !isStr(v.persian) || !isStr(v.german) || !v.persian || !v.german || !Array.isArray(v.tags) || !Array.isArray(v.altGerman) || !isNum(v.priority)) {
      if (errors.length < 5) errors.push(`Vokabel Nr. ${i + 1} ist unvollständig.`);
    } else vocabIds.add(v.id);
  });
  (data.lessons as unknown[]).forEach((l, i) => {
    if (!isObj(l) || !isStr(l.id) || !isStr(l.name)) if (errors.length < 5) errors.push(`Lektion Nr. ${i + 1} ist unvollständig.`);
  });
  (data.states as unknown[]).forEach((s, i) => {
    if (!isObj(s) || !isStr(s.id) || !isStr(s.vocabId) || !vocabIds.has(s.vocabId) || !isNum(s.due) || !isNum(s.stability) || (s.direction !== 'fa-de' && s.direction !== 'de-fa')) {
      if (errors.length < 5) errors.push(`Planungszustand Nr. ${i + 1} ist beschädigt.`);
    }
  });
  (data.reviews as unknown[]).forEach((r, i) => {
    if (!isObj(r) || !isStr(r.id) || !isStr(r.vocabId) || !isNum(r.ts) || typeof r.correct !== 'boolean') {
      if (errors.length < 5) errors.push(`Antwort Nr. ${i + 1} im Verlauf ist beschädigt.`);
    }
  });
  (data.days as unknown[]).forEach((d, i) => {
    if (!isObj(d) || !isStr(d.day) || !/^\d{4}-\d{2}-\d{2}$/.test(d.day)) if (errors.length < 5) errors.push(`Tagesstatistik Nr. ${i + 1} ist beschädigt.`);
  });
  if (errors.length) return fail(...errors);
  const backup = raw as unknown as BackupFile;
  backup.data.settings = { ...DEFAULT_SETTINGS, ...(isObj(data.settings) ? (data.settings as Partial<AppSettings>) : {}), key: 'app' };
  return {
    ok: true,
    errors: [],
    summary: { vocab: vocab.length, lessons: backup.data.lessons.length, reviews: backup.data.reviews.length, exportedAt: isStr(raw && (raw as Record<string, unknown>).exportedAt) ? backup.exportedAt : '' },
    backup,
  };
}

export type RestoreMode = 'merge' | 'replace';

/**
 * merge   – only adds what does not exist yet (by ID); existing data is left untouched.
 * replace – replaces everything. Only call after explicit confirmation.
 * Runs in ONE transaction: if anything fails, the previous state is fully preserved.
 */
export async function restoreBackup(backup: BackupFile, mode: RestoreMode, database: AppDB = db): Promise<{ added: number }> {
  const d = database;
  const { data } = backup;
  return d.transaction('rw', [d.vocab, d.lessons, d.states, d.reviews, d.sessions, d.days, d.settings], async () => {
    if (mode === 'replace') {
      await Promise.all([d.vocab.clear(), d.lessons.clear(), d.states.clear(), d.reviews.clear(), d.sessions.clear(), d.days.clear()]);
      await d.vocab.bulkAdd(data.vocab);
      await d.lessons.bulkAdd(data.lessons);
      await d.states.bulkAdd(data.states);
      await d.reviews.bulkAdd(data.reviews);
      await d.sessions.bulkAdd(data.sessions);
      await d.days.bulkAdd(data.days);
      await d.settings.put(data.settings);
      return { added: data.vocab.length };
    }
    const missing = async <T>(table: { bulkGet(keys: string[]): Promise<(T | undefined)[]> }, rows: T[], key: (r: T) => string) => {
      const found = await table.bulkGet(rows.map(key));
      return rows.filter((_, i) => !found[i]);
    };
    const newVocab = await missing(d.vocab, data.vocab, (r) => r.id);
    // Reuse existing lessons with the same name instead of creating duplicates.
    const lessonMap = new Map<string, string>();
    for (const l of data.lessons) {
      const byId = await d.lessons.get(l.id);
      if (byId) continue;
      const byName = await d.lessons.where('name').equals(l.name).first();
      if (byName) lessonMap.set(l.id, byName.id);
      else await d.lessons.add(l);
    }
    await d.vocab.bulkAdd(newVocab.map((v) => ({ ...v, lessonId: lessonMap.get(v.lessonId) ?? v.lessonId })));
    const added = new Set(newVocab.map((v) => v.id));
    // Only take over progress for newly added items – existing progress is never overwritten.
    await d.states.bulkAdd((await missing(d.states, data.states, (r) => r.id)).filter((s) => added.has(s.vocabId)));
    await d.reviews.bulkAdd((await missing(d.reviews, data.reviews, (r) => r.id)).filter((r) => added.has(r.vocabId)));
    await d.sessions.bulkAdd(await missing(d.sessions, data.sessions, (r) => r.id));
    await d.days.bulkAdd(await missing(d.days, data.days, (r) => r.day));
    return { added: newVocab.length };
  });
}

export const CSV_HEADER = ['Persian', 'German', 'Transliteration', 'Lesson', 'Priority', 'Notes', 'Tags', 'Grammar', 'ExamplePersian', 'ExampleGerman'];

export async function exportCsv(database: AppDB = db): Promise<string> {
  const lessons = new Map((await database.lessons.toArray()).map((l) => [l.id, l.name]));
  const rows = (await database.vocab.orderBy('createdAt').toArray()).map((v) => [
    v.persian, [v.german, ...v.altGerman].join(' | '), v.translit, lessons.get(v.lessonId) ?? '', v.priority, v.notes, v.tags.join(', '), v.grammar, v.exampleFa, v.exampleDe,
  ]);
  return toCsv([CSV_HEADER, ...rows]);
}

export const backupFileName = (ext: string) => `persisch-karten-${new Date().toISOString().slice(0, 10)}.${ext}`;
