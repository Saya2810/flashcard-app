import type { ConjScheme, FormReview, FormState, Verb } from '../conj/types';
import { toCsv } from '../lib/csv';
import { DEFAULT_SETTINGS, type AppSettings, type Card, type DayStats, type Deck, type LearningSession, type Lesson, type Media, type ReviewEvent, type SchedState } from '../types';
import { db, SCHEMA_VERSION, type AppDB } from './db';
import { getSettings } from './repo';
import { t } from '../i18n';

export const BACKUP_FORMAT = 'lernkarten-backup';
export const BACKUP_VERSION = 2;

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
    /** Conjugation trainer (backup format 2). Older files simply do not have them. */
    schemes: ConjScheme[];
    verbs: Verb[];
    formStates: FormState[];
    formReviews: FormReview[];
  };
}

const TABLES = ['decks', 'lessons', 'cards', 'media', 'states', 'reviews', 'sessions', 'days'] as const;
const CONJ_TABLES = ['schemes', 'verbs', 'formStates', 'formReviews'] as const;

export async function createBackup(database: AppDB = db): Promise<BackupFile> {
  const d = database;
  return d.transaction('r', [d.decks, d.lessons, d.cards, d.media, d.states, d.reviews, d.sessions, d.days, d.settings, d.schemes, d.verbs, d.formStates, d.formReviews], async () => ({
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
      schemes: await d.schemes.toArray(),
      verbs: await d.verbs.toArray(),
      formStates: await d.formStates.toArray(),
      formReviews: await d.formReviews.toArray(),
    },
  }));
}

export interface BackupCheck {
  ok: boolean;
  errors: string[];
  kind: 'current' | null;
  summary: { decks: number; cards: number; reviews: number; verbs: number; exportedAt: string } | null;
  backup: BackupFile | null;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Upgrade older backup formats to the current one. Add one step here per future version. */
function migrateBackup(raw: Record<string, unknown>): Record<string, unknown> {
  // v1 → v2: the conjugation tables did not exist yet.
  if (raw.version === 1 && isObj(raw.data)) {
    for (const tb of CONJ_TABLES) if (!Array.isArray(raw.data[tb])) raw.data[tb] = [];
    raw.version = 2;
  }
  return raw;
}

/** Validates a backup file completely BEFORE anything is written. */
export function validateBackup(text: string): BackupCheck {
  const fail = (...errors: string[]): BackupCheck => ({ ok: false, errors, kind: null, summary: null, backup: null });
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail(t('Die Datei ist kein gültiges JSON.')); }
  if (!isObj(raw)) return fail(t('Das ist keine Sicherung dieser App.'));
  if (raw.format !== BACKUP_FORMAT) return fail(t('Das ist keine Sicherung dieser App.'));
  if (!isNum(raw.version)) return fail(t('Die Versionsangabe der Sicherung fehlt.'));
  if (raw.version > BACKUP_VERSION) return fail(t('Die Sicherung stammt aus einer neueren App-Version (Format {v}). Bitte zuerst die App aktualisieren.', { v: raw.version }));
  raw = migrateBackup(raw);
  const data = (raw as Record<string, unknown>).data;
  if (!isObj(data)) return fail(t('Der Datenteil der Sicherung fehlt.'));
  const errors: string[] = [];
  for (const tb of TABLES) if (!Array.isArray(data[tb])) errors.push(t('Tabelle „{name}“ fehlt oder ist beschädigt.', { name: tb }));
  if (errors.length) return fail(...errors);
  const add = (msg: string) => { if (errors.length < 5) errors.push(msg); };

  const deckIds = new Set<string>();
  (data.decks as unknown[]).forEach((x, i) => {
    if (!isObj(x) || !isStr(x.id) || !isStr(x.name) || !isObj(x.front) || !isObj(x.back) || !Array.isArray(x.fields)) add(t('Stapel Nr. {n} ist unvollständig.', { n: i + 1 }));
    else deckIds.add(x.id);
  });
  const cardIds = new Set<string>();
  (data.cards as unknown[]).forEach((x, i) => {
    if (!isObj(x) || !isStr(x.id) || !isStr(x.front) || !isStr(x.back) || !x.front || !x.back || !isStr(x.deckId) || !deckIds.has(x.deckId) || !Array.isArray(x.tags) || !Array.isArray(x.altBack) || !isObj(x.fields) || !isNum(x.priority)) add(t('Karte Nr. {n} ist unvollständig.', { n: i + 1 }));
    else cardIds.add(x.id);
  });
  (data.lessons as unknown[]).forEach((x, i) => { if (!isObj(x) || !isStr(x.id) || !isStr(x.name) || !isStr(x.deckId)) add(t('Lektion Nr. {n} ist unvollständig.', { n: i + 1 })); });
  (data.media as unknown[]).forEach((x, i) => { if (!isObj(x) || !isStr(x.id) || !isStr(x.dataUrl) || !x.dataUrl.startsWith('data:image/')) add(t('Bild Nr. {n} ist beschädigt.', { n: i + 1 })); });
  (data.states as unknown[]).forEach((x, i) => {
    if (!isObj(x) || !isStr(x.id) || !isStr(x.cardId) || !cardIds.has(x.cardId) || !isNum(x.due) || !isNum(x.stability) || (x.direction !== 'fwd' && x.direction !== 'rev')) add(t('Planungszustand Nr. {n} ist beschädigt.', { n: i + 1 }));
  });
  (data.reviews as unknown[]).forEach((x, i) => { if (!isObj(x) || !isStr(x.id) || !isStr(x.cardId) || !isNum(x.ts) || typeof x.correct !== 'boolean') add(t('Antwort Nr. {n} im Verlauf ist beschädigt.', { n: i + 1 })); });
  for (const tb of CONJ_TABLES) if (!Array.isArray(data[tb])) data[tb] = [];
  (data.schemes as unknown[]).forEach((x, i) => { if (!isObj(x) || !isStr(x.id) || !isStr(x.name) || !Array.isArray(x.persons) || !Array.isArray(x.tenses)) add(t('Schema Nr. {n} ist unvollständig.', { n: i + 1 })); });
  const verbIds = new Set<string>();
  (data.verbs as unknown[]).forEach((x, i) => {
    if (!isObj(x) || !isStr(x.id) || !isStr(x.infinitive) || !x.infinitive || !isStr(x.deckId) || !deckIds.has(x.deckId) || !isStr(x.schemeId) || !isObj(x.forms) || !Array.isArray(x.tags) || !isNum(x.priority)) add(t('Verb Nr. {n} ist unvollständig.', { n: i + 1 }));
    else verbIds.add(x.id);
  });
  (data.formStates as unknown[]).forEach((x, i) => { if (!isObj(x) || !isStr(x.id) || !isStr(x.verbId) || !verbIds.has(x.verbId) || !isNum(x.due) || !isNum(x.stability)) add(t('Formzustand Nr. {n} ist beschädigt.', { n: i + 1 })); });
  (data.formReviews as unknown[]).forEach((x, i) => { if (!isObj(x) || !isStr(x.id) || !isStr(x.verbId) || !isNum(x.ts) || typeof x.correct !== 'boolean') add(t('Formantwort Nr. {n} im Verlauf ist beschädigt.', { n: i + 1 })); });
  (data.days as unknown[]).forEach((x, i) => { if (!isObj(x) || !isStr(x.day) || !/^\d{4}-\d{2}-\d{2}$/.test(x.day)) add(t('Tagesstatistik Nr. {n} ist beschädigt.', { n: i + 1 })); });
  if (errors.length) return fail(...errors);
  const backup = raw as unknown as BackupFile;
  backup.data.settings = { ...DEFAULT_SETTINGS, ...(isObj(data.settings) ? (data.settings as Partial<AppSettings>) : {}), key: 'app' };
  return {
    ok: true, errors: [], kind: 'current', backup,
    summary: { decks: backup.data.decks.length, cards: backup.data.cards.length, reviews: backup.data.reviews.length + backup.data.formReviews.length, verbs: backup.data.verbs.length, exportedAt: isStr(backup.exportedAt) ? backup.exportedAt : '' },
  };
}

export type RestoreMode = 'merge' | 'replace';

async function clearAll(d: AppDB) {
  await Promise.all([d.decks.clear(), d.lessons.clear(), d.cards.clear(), d.media.clear(), d.states.clear(), d.reviews.clear(), d.sessions.clear(), d.days.clear(), d.schemes.clear(), d.verbs.clear(), d.formStates.clear(), d.formReviews.clear()]);
}

/**
 * merge   – only adds what does not exist yet (by ID); existing data is left untouched.
 * replace – replaces everything. Only call after explicit confirmation.
 * Runs in ONE transaction: if anything fails, the previous state is fully preserved.
 */
export async function restoreBackup(check: BackupCheck, mode: RestoreMode, database: AppDB = db): Promise<{ added: number; addedVerbs: number }> {
  const d = database;
  return d.transaction('rw', [d.decks, d.lessons, d.cards, d.media, d.states, d.reviews, d.sessions, d.days, d.settings, d.schemes, d.verbs, d.formStates, d.formReviews], async () => {
    const data = check.backup!.data;
    if (mode === 'replace') {
      await clearAll(d);
      for (const tb of [...TABLES, ...CONJ_TABLES]) await (d[tb] as unknown as { bulkAdd(rows: unknown[]): Promise<unknown> }).bulkAdd(data[tb]);
      await d.settings.put(data.settings);
      return { added: data.cards.length, addedVerbs: data.verbs.length };
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
    // Conjugation trainer: schemes by id; verbs follow the deck/lesson mapping; form history only for newly added verbs.
    await d.schemes.bulkAdd(await missing(d.schemes, data.schemes, (r) => r.id));
    const newVerbs = await missing(d.verbs, data.verbs, (r) => r.id);
    await d.verbs.bulkAdd(newVerbs.map((v) => ({ ...v, deckId: mapDeck(v.deckId), lessonId: lessonMap.get(v.lessonId) ?? v.lessonId })));
    const addedVerbs = new Set(newVerbs.map((v) => v.id));
    await d.formStates.bulkAdd((await missing(d.formStates, data.formStates, (r) => r.id)).filter((s) => addedVerbs.has(s.verbId)).map((s) => ({ ...s, deckId: mapDeck(s.deckId) })));
    await d.formReviews.bulkAdd((await missing(d.formReviews, data.formReviews, (r) => r.id)).filter((r) => addedVerbs.has(r.verbId)).map((r) => ({ ...r, deckId: mapDeck(r.deckId) })));
    return { added: newCards.length, addedVerbs: newVerbs.length };
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
