import { toCsv } from '../lib/csv';
import { DEFAULT_SETTINGS, type AppSettings, type Card, type DayStats, type Deck, type LearningSession, type Lesson, type Media, type ReviewEvent, type SchedState } from '../types';
import { db, SCHEMA_VERSION, type AppDB } from './db';
import { convertLegacy, importConverted, LEGACY_BACKUP_FORMAT, type Converted, type LegacyData } from './legacy';
import { getSettings } from './repo';

export const BACKUP_FORMAT = 'lernkarten-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  schemaVersion: number;
  exportedAt: string;
  data: {
    decks: Deck[];
    lessons: Lesson[];
    cards: Card[];
    media: Media[];
    states: SchedState[];
    reviews: ReviewEvent[];
    sessions: LearningSession[];
    days: DayStats[];
    settings: AppSettings;
  };
}

const TABLES = ['decks', 'lessons', 'cards', 'media', 'states', 'reviews', 'sessions', 'days'] as const;

export async function createBackup(database: AppDB = db): Promise<BackupFile> {
  const d = database;
  return d.transaction('r', [d.decks, d.lessons, d.cards, d.media, d.states, d.reviews, d.sessions, d.days, d.settings], async () => ({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      decks: await d.decks.toArray(),
      lessons: await d.lessons.toArray(),
      cards: await d.cards.toArray(),
      media: await d.media.toArray(),
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
  /** 'legacy' = backup of the original Persian–German app, converted on restore. */
  kind: 'current' | 'legacy' | null;
  summary: { decks: number; cards: number; reviews: number; exportedAt: string } | null;
  backup: BackupFile | null;
  legacy: Converted | null;
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
  const fail = (...errors: string[]): BackupCheck => ({ ok: false, errors, kind: null, summary: null, backup: null, legacy: null });
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail('Die Datei ist kein gültiges JSON.'); }
  if (!isObj(raw)) return fail('Das ist keine Sicherung dieser App.');
  if (raw.format === LEGACY_BACKUP_FORMAT) return validateLegacy(raw);
  if (raw.format !== BACKUP_FORMAT) return fail('Das ist keine Sicherung dieser App.');
  if (!isNum(raw.version)) return fail('Die Versionsangabe der Sicherung fehlt.');
  if (raw.version > BACKUP_VERSION) return fail(`Die Sicherung stammt aus einer neueren App-Version (Format ${raw.version}). Bitte zuerst die App aktualisieren.`);
  raw = migrateBackup(raw);
  const data = (raw as Record<string, unknown>).data;
  if (!isObj(data)) return fail('Der Datenteil der Sicherung fehlt.');
  const errors: string[] = [];
  for (const t of TABLES) if (!Array.isArray(data[t])) errors.push(`Tabelle „${t}“ fehlt oder ist beschädigt.`);
  if (errors.length) return fail(...errors);
  const add = (msg: string) => { if (errors.length < 5) errors.push(msg); };

  const deckIds = new Set<string>();
  (data.decks as unknown[]).forEach((x, i) => {
    if (!isObj(x) || !isStr(x.id) || !isStr(x.name) || !isObj(x.front) || !isObj(x.back) || !Array.isArray(x.fields)) add(`Stapel Nr. ${i + 1} ist unvollständig.`);
    else deckIds.add(x.id);
  });
  const cardIds = new Set<string>();
  (data.cards as unknown[]).forEach((x, i) => {
    if (!isObj(x) || !isStr(x.id) || !isStr(x.front) || !isStr(x.back) || !x.front || !x.back || !isStr(x.deckId) || !deckIds.has(x.deckId) || !Array.isArray(x.tags) || !Array.isArray(x.altBack) || !isObj(x.fields) || !isNum(x.priority)) add(`Karte Nr. ${i + 1} ist unvollständig.`);
    else cardIds.add(x.id);
  });
  (data.lessons as unknown[]).forEach((x, i) => { if (!isObj(x) || !isStr(x.id) || !isStr(x.name) || !isStr(x.deckId)) add(`Lektion Nr. ${i + 1} ist unvollständig.`); });
  (data.media as unknown[]).forEach((x, i) => { if (!isObj(x) || !isStr(x.id) || !isStr(x.dataUrl) || !x.dataUrl.startsWith('data:image/')) add(`Bild Nr. ${i + 1} ist beschädigt.`); });
  (data.states as unknown[]).forEach((x, i) => {
    if (!isObj(x) || !isStr(x.id) || !isStr(x.cardId) || !cardIds.has(x.cardId) || !isNum(x.due) || !isNum(x.stability) || (x.direction !== 'fwd' && x.direction !== 'rev')) add(`Planungszustand Nr. ${i + 1} ist beschädigt.`);
  });
  (data.reviews as unknown[]).forEach((x, i) => { if (!isObj(x) || !isStr(x.id) || !isStr(x.cardId) || !isNum(x.ts) || typeof x.correct !== 'boolean') add(`Antwort Nr. ${i + 1} im Verlauf ist beschädigt.`); });
  (data.days as unknown[]).forEach((x, i) => { if (!isObj(x) || !isStr(x.day) || !/^\d{4}-\d{2}-\d{2}$/.test(x.day)) add(`Tagesstatistik Nr. ${i + 1} ist beschädigt.`); });
  if (errors.length) return fail(...errors);
  const backup = raw as unknown as BackupFile;
  backup.data.settings = { ...DEFAULT_SETTINGS, ...(isObj(data.settings) ? (data.settings as Partial<AppSettings>) : {}), key: 'app' };
  return {
    ok: true, errors: [], kind: 'current', legacy: null, backup,
    summary: { decks: backup.data.decks.length, cards: backup.data.cards.length, reviews: backup.data.reviews.length, exportedAt: isStr(backup.exportedAt) ? backup.exportedAt : '' },
  };
}

function validateLegacy(raw: Record<string, unknown>): BackupCheck {
  const fail = (e: string): BackupCheck => ({ ok: false, errors: [e], kind: null, summary: null, backup: null, legacy: null });
  const data = raw.data;
  if (!isObj(data)) return fail('Der Datenteil der Sicherung fehlt.');
  for (const t of ['vocab', 'lessons', 'states', 'reviews', 'sessions', 'days']) if (!Array.isArray(data[t])) return fail(`Tabelle „${t}“ fehlt oder ist beschädigt.`);
  const vocab = data.vocab as unknown[];
  const bad = vocab.findIndex((v) => !isObj(v) || !isStr(v.id) || !isStr(v.persian) || !isStr(v.german) || !v.persian || !v.german);
  if (bad >= 0) return fail(`Vokabel Nr. ${bad + 1} ist unvollständig.`);
  const converted = convertLegacy(data as unknown as LegacyData);
  return {
    ok: true, errors: [], kind: 'legacy', backup: null, legacy: converted,
    summary: { decks: 1, cards: converted.cards.length, reviews: converted.reviews.length, exportedAt: isStr(raw.exportedAt) ? raw.exportedAt : '' },
  };
}

export type RestoreMode = 'merge' | 'replace';

async function clearAll(d: AppDB) {
  await Promise.all([d.decks.clear(), d.lessons.clear(), d.cards.clear(), d.media.clear(), d.states.clear(), d.reviews.clear(), d.sessions.clear(), d.days.clear()]);
}

/**
 * merge   – only adds what does not exist yet (by ID); existing data is left untouched.
 * replace – replaces everything. Only call after explicit confirmation.
 * Runs in ONE transaction: if anything fails, the previous state is fully preserved.
 */
export async function restoreBackup(check: BackupCheck, mode: RestoreMode, database: AppDB = db): Promise<{ added: number }> {
  const d = database;
  return d.transaction('rw', [d.decks, d.lessons, d.cards, d.media, d.states, d.reviews, d.sessions, d.days, d.settings], async () => {
    if (check.kind === 'legacy' && check.legacy) {
      if (mode === 'replace') await clearAll(d);
      return importConverted(check.legacy, { first: mode === 'replace' }, d);
    }
    const data = check.backup!.data;
    if (mode === 'replace') {
      await clearAll(d);
      for (const t of TABLES) await (d[t] as unknown as { bulkAdd(rows: unknown[]): Promise<unknown> }).bulkAdd(data[t]);
      await d.settings.put(data.settings);
      return { added: data.cards.length };
    }
    const missing = async <T>(table: { bulkGet(keys: string[]): Promise<(T | undefined)[]> }, rows: T[], key: (r: T) => string) => {
      const found = await table.bulkGet(rows.map(key));
      return rows.filter((_, i) => !found[i]);
    };
    // Reuse existing decks with the same name instead of creating duplicates.
    const deckMap = new Map<string, string>();
    for (const deck of data.decks) {
      if (await d.decks.get(deck.id)) continue;
      const byName = await d.decks.where('name').equals(deck.name).first();
      if (byName) deckMap.set(deck.id, byName.id); else await d.decks.add(deck);
    }
    const mapDeck = (id: string) => deckMap.get(id) ?? id;
    const lessonMap = new Map<string, string>();
    for (const l of data.lessons) {
      if (await d.lessons.get(l.id)) continue;
      const deckId = mapDeck(l.deckId);
      const byName = await d.lessons.where('[deckId+name]').equals([deckId, l.name]).first();
      if (byName) lessonMap.set(l.id, byName.id); else await d.lessons.add({ ...l, deckId });
    }
    const newCards = await missing(d.cards, data.cards, (r) => r.id);
    await d.cards.bulkAdd(newCards.map((c) => ({ ...c, deckId: mapDeck(c.deckId), lessonId: lessonMap.get(c.lessonId) ?? c.lessonId })));
    const added = new Set(newCards.map((c) => c.id));
    // Only take over progress for newly added cards – existing progress is never overwritten.
    await d.states.bulkAdd((await missing(d.states, data.states, (r) => r.id)).filter((s) => added.has(s.cardId)).map((s) => ({ ...s, deckId: mapDeck(s.deckId) })));
    await d.reviews.bulkAdd((await missing(d.reviews, data.reviews, (r) => r.id)).filter((r) => added.has(r.cardId)).map((r) => ({ ...r, deckId: mapDeck(r.deckId) })));
    await d.media.bulkAdd(await missing(d.media, data.media, (r) => r.id));
    await d.sessions.bulkAdd(await missing(d.sessions, data.sessions, (r) => r.id));
    await d.days.bulkAdd(await missing(d.days, data.days, (r) => r.day));
    return { added: newCards.length };
  });
}

/** CSV export of all cards (or one deck). Custom fields become extra columns. */
export async function exportCsv(deckId?: string, database: AppDB = db): Promise<string> {
  const decks = new Map((await database.decks.toArray()).map((d) => [d.id, d]));
  const lessons = new Map((await database.lessons.toArray()).map((l) => [l.id, l.name]));
  const cards = (await database.cards.orderBy('createdAt').toArray()).filter((c) => !deckId || c.deckId === deckId);
  const labels: string[] = [];
  for (const id of new Set(cards.map((c) => c.deckId))) for (const f of decks.get(id)?.fields ?? []) if (!labels.includes(f.label)) labels.push(f.label);
  const header = ['Deck', 'Lesson', 'Front', 'Back', 'Alternatives', 'Priority', 'Tags', 'Notes', ...labels];
  const rows = cards.map((c) => {
    const deck = decks.get(c.deckId);
    const byLabel = new Map((deck?.fields ?? []).map((f) => [f.label, c.fields[f.key] ?? '']));
    return [deck?.name ?? '', lessons.get(c.lessonId) ?? '', c.front, c.back, c.altBack.join(' | '), c.priority, c.tags.join(', '), c.notes, ...labels.map((l) => byLabel.get(l) ?? '')];
  });
  return toCsv([header, ...rows]);
}

export const backupFileName = (ext: string, name = 'lernkarten') => `${name}-${new Date().toISOString().slice(0, 10)}.${ext}`;
