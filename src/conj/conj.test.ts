import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup, restoreBackup, validateBackup } from '../db/backup';
import { AppDB, db } from '../db/db';
import { addLesson, deleteDeck, deleteLesson, saveSettings } from '../db/repo';
import { DAY_MS, dayKey } from '../lib/dates';
import { newId } from '../lib/text';
import { card, deck, resetDb } from '../test/helpers';
import { SCHEME_PRESETS } from './presets';
import { buildConjugationQueue, buildFormQueue, formReviewPriority, scopedVerbs } from './queue';
import { addScheme, addVerb, definedCells, deleteScheme, deleteVerbs, parseAnswers, schemeFromPreset, updateScheme, updateVerb } from './repo';
import { recordFormAnswer } from './review';
import { loadFormOverview } from './stats';
import { formKey, formStateId, type ConjScheme, type ConjSessionConfig, type Verb } from './types';

beforeEach(resetDb);

const T0 = new Date(2026, 0, 10, 10, 0).getTime();
const cfg = (p: Partial<ConjSessionConfig> = {}): ConjSessionConfig => ({ mode: 'conj-forms', deckIds: [], lessonIds: [], langs: [], tenseLabels: [], size: 50, ...p });

async function germanScheme(): Promise<ConjScheme> {
  return addScheme(schemeFromPreset(SCHEME_PRESETS.find((p) => p.id === 'de')!));
}
/** gehen with a complete Präsens (9 forms as in the task description via a custom person list) + Präteritum. */
async function gehen(scheme: ConjScheme, deckId: string, extra: Partial<Parameters<typeof addVerb>[0]> = {}): Promise<Verb> {
  const present = scheme.tenses[0], past = scheme.tenses[1];
  const forms: Record<string, string[]> = {};
  const pres = ['gehe', 'gehst', 'geht', 'gehen', 'geht', 'gehen'];
  const pret = ['ging', 'gingst', 'ging', 'gingen', 'gingt', 'gingen'];
  scheme.persons.forEach((p, i) => { forms[formKey(present.id, p.id)] = [pres[i]]; forms[formKey(past.id, p.id)] = [pret[i]]; });
  return addVerb({ deckId, schemeId: scheme.id, infinitive: 'gehen', translation: 'to go', forms, ...extra });
}
const ans = (v: Verb, tenseId: string, personId: string, correct: boolean, now: number, sessionId = 's1') =>
  recordFormAnswer({ verbId: v.id, tenseId, personId, correct, sessionId, source: 'forms', now });

describe('Schemes are generic data, not hard-coded grammar', () => {
  it('creates German, Persian and fully custom schemes from presets or from scratch', async () => {
    const de = await germanScheme();
    expect(de.persons.map((p) => p.label)).toContain('er/sie/es');
    const fa = await addScheme(schemeFromPreset(SCHEME_PRESETS.find((p) => p.id === 'fa')!));
    expect(fa).toMatchObject({ lang: 'fa', dir: 'rtl', font: 'vazirmatn' });
    const custom = await addScheme({ name: 'Latein', lang: 'la', persons: [{ id: 'a', label: 'ego' }, { id: 'b', label: 'tu' }], tenses: [{ id: 'x', label: 'Perfectum' }] });
    expect(custom.tenses).toHaveLength(1);
    await expect(addScheme({ name: 'Leer', persons: [], tenses: [{ id: 'x', label: 'a' }] })).rejects.toThrow();
  });

  it('renaming, reordering and adding keep ids – verbs and learning history survive', async () => {
    const d = await deck();
    const s = await germanScheme();
    const v = await gehen(s, d.id);
    await ans(v, s.tenses[0].id, s.persons[0].id, false, T0);
    await updateScheme(s.id, { name: 'Deutsch neu', persons: [{ id: 'new', label: 'Sie (höflich)' }, ...[...s.persons].reverse().map((p, i) => (i === 0 ? { ...p, label: 'sie' } : p))], tenses: s.tenses });
    const after = (await db.schemes.get(s.id))!;
    expect(after.persons).toHaveLength(7);
    expect(after.persons.find((p) => p.id === s.persons[0].id)?.id).toBe(s.persons[0].id);
    expect((await db.verbs.get(v.id))!.forms[formKey(s.tenses[0].id, s.persons[0].id)]).toEqual(['gehe']);
    expect((await db.formStates.get(formStateId(v.id, s.tenses[0].id, s.persons[0].id)))!.total).toBe(1);
  });

  it('a scheme that is still in use cannot be deleted', async () => {
    const d = await deck();
    const s = await germanScheme();
    const v = await gehen(s, d.id);
    await expect(deleteScheme(s.id)).rejects.toThrow(/1/);
    await deleteVerbs([v.id]);
    await deleteScheme(s.id);
    expect(await db.schemes.count()).toBe(0);
  });

  it('parses alternative forms, drops empty ones and rejects duplicates in the same deck', async () => {
    expect(parseAnswers(' a | b ||a ')).toEqual(['a', 'b']);
    const d = await deck();
    const s = await germanScheme();
    await gehen(s, d.id);
    await expect(gehen(s, d.id)).rejects.toThrow(/schon/);
    const v2 = await addVerb({ deckId: d.id, schemeId: s.id, infinitive: 'sehen', forms: { [formKey(s.tenses[0].id, s.persons[0].id)]: ['sehe', ''], 'kaputt|x': [] } });
    expect(Object.keys(v2.forms)).toEqual([formKey(s.tenses[0].id, s.persons[0].id)]);
    await updateVerb(v2.id, { deckId: d.id, schemeId: s.id, infinitive: 'sehen', forms: { [formKey(s.tenses[0].id, s.persons[1].id)]: ['siehst'] } });
    expect(definedCells((await db.verbs.get(v2.id))!, s)).toHaveLength(1);
  });
});

describe('Every verb × tense × person has its own learning history', () => {
  it('records one form without touching its siblings, other verbs or the card statistics', async () => {
    const d = await deck();
    const c = await card('Hund', 'dog', { deckId: d.id });
    const s = await germanScheme();
    const v = await gehen(s, d.id);
    const [tp, tpast] = s.tenses; const [ich, du] = s.persons;
    await ans(v, tp.id, ich.id, false, T0);
    await ans(v, tp.id, ich.id, true, T0 + DAY_MS);
    await ans(v, tp.id, du.id, true, T0);
    const a = (await db.formStates.get(formStateId(v.id, tp.id, ich.id)))!;
    const b = (await db.formStates.get(formStateId(v.id, tp.id, du.id)))!;
    expect(a).toMatchObject({ total: 2, incorrect: 1, correct: 1 });
    expect(b).toMatchObject({ total: 1, incorrect: 0, correct: 1 });
    expect(await db.formStates.get(formStateId(v.id, tpast.id, ich.id))).toBeUndefined();
    expect(await db.states.count()).toBe(0);
    expect(c).toBeTruthy();
    expect(a.stability).toBeGreaterThan(0);
    expect(a.due).toBeGreaterThan(T0);
    expect(await db.formReviews.where('verbId').equals(v.id).count()).toBe(3);
  });

  it('own FSRS scheduling: a wrong form is due sooner than a correct one', async () => {
    const d = await deck();
    const s = await germanScheme();
    const v = await gehen(s, d.id);
    const t = s.tenses[0].id;
    await ans(v, t, s.persons[0].id, true, T0);
    await ans(v, t, s.persons[1].id, false, T0);
    const ok = (await db.formStates.get(formStateId(v.id, t, s.persons[0].id)))!;
    const bad = (await db.formStates.get(formStateId(v.id, t, s.persons[1].id)))!;
    expect(bad.due).toBeLessThan(ok.due);
  });

  it('relearn repeats are logged but change neither FSRS nor error counters', async () => {
    const d = await deck();
    const s = await germanScheme();
    const v = await gehen(s, d.id);
    const t = s.tenses[0].id, p = s.persons[0].id;
    await ans(v, t, p, false, T0);
    const before = (await db.formStates.get(formStateId(v.id, t, p)))!;
    await recordFormAnswer({ verbId: v.id, tenseId: t, personId: p, correct: true, sessionId: 's1', source: 'forms', kind: 'relearn', now: T0 + 1000 });
    expect(await db.formStates.get(formStateId(v.id, t, p))).toEqual(before);
    expect(await db.formReviews.count()).toBe(2);
  });

  it('updates the shared daily statistics and the session', async () => {
    const d = await deck();
    const s = await germanScheme();
    const v = await gehen(s, d.id);
    const sid = newId();
    await db.sessions.add({ id: sid, mode: 'conj-full', direction: 'fwd', deckIds: [], lessonIds: [], startedAt: T0, endedAt: T0, planned: 2, answered: 0, correct: 0, incorrect: 0 });
    await ans(v, s.tenses[0].id, s.persons[0].id, true, T0, sid);
    await ans(v, s.tenses[0].id, s.persons[1].id, false, T0, sid);
    const day = (await db.days.get(dayKey(T0)))!;
    expect(day).toMatchObject({ reviews: 2, correct: 1, incorrect: 1, newCards: 2 });
    expect(await db.sessions.get(sid)).toMatchObject({ answered: 2, correct: 1, incorrect: 1 });
    expect(await loadFormOverview(T0 + 1000)).toMatchObject({ verbCount: 1, practiced: 2, reviews: 2, incorrect: 1 });
  });
});

describe('Review priority and queues', () => {
  it('a frequently wrong form gets a higher priority than a clean one and than a barely wrong one', async () => {
    const d = await deck();
    const s = await germanScheme();
    const v = await gehen(s, d.id);
    const t = s.tenses[0].id;
    const [p0, p1, p2] = s.persons;
    for (let i = 0; i < 6; i++) await ans(v, t, p0.id, i % 3 === 0, T0 + i * DAY_MS);   // mostly wrong
    for (let i = 0; i < 6; i++) await ans(v, t, p1.id, i !== 0, T0 + i * DAY_MS);        // 1 of 6 wrong
    for (let i = 0; i < 6; i++) await ans(v, t, p2.id, true, T0 + i * DAY_MS);           // never wrong
    const get = async (p: string) => formReviewPriority(await db.formStates.get(formStateId(v.id, t, p)), v.priority);
    const [hard, some, clean] = [await get(p0.id), await get(p1.id), await get(p2.id)];
    expect(hard).toBeGreaterThan(some);
    expect(some).toBeGreaterThan(clean);
    expect(formReviewPriority(undefined, 5)).toBeGreaterThan(formReviewPriority(undefined, 1));
  });

  it('mode 2 contains only forms with mistakes and puts the most difficult first', async () => {
    const d = await deck();
    const s = await germanScheme();
    const v = await gehen(s, d.id);
    const t = s.tenses[0].id;
    const [p0, p1, p2] = s.persons;
    const late = T0 + 10 * DAY_MS;
    for (let i = 0; i < 5; i++) await ans(v, t, p0.id, false, late - (5 - i) * 1000);
    await ans(v, t, p1.id, false, late - 9000);
    await ans(v, t, p1.id, true, late - 8000); await ans(v, t, p1.id, true, late - 7000);
    await ans(v, t, p2.id, true, late - 6000);
    const states = await db.formStates.toArray();
    const q = buildFormQueue(cfg(), { verbs: await db.verbs.toArray(), schemes: await db.schemes.toArray(), states, now: late });
    expect(q.map((x) => x.personId)).toContain(p0.id);
    expect(q.map((x) => x.personId)).not.toContain(p2.id);
    expect(q[0].personId).toBe(p0.id);
    expect(q.every((x) => x.tenseId === t)).toBe(true);
  });

  it('scopes by deck, lesson, language, tense label and explicit verbs; mode 1 ranks weak conjugations first', async () => {
    const d1 = await deck(); const d2 = await deck();
    const l = await addLesson(d1.id, 'L1');
    const de = await germanScheme();
    const fa = await addScheme(schemeFromPreset(SCHEME_PRESETS.find((p) => p.id === 'fa')!));
    const v1 = await gehen(de, d1.id, { lessonId: l.id });
    const v2 = await addVerb({ deckId: d2.id, schemeId: fa.id, infinitive: 'رفتن', forms: { [formKey(fa.tenses[0].id, fa.persons[0].id)]: ['می‌روم'] } });
    const data = async () => ({ verbs: await db.verbs.toArray(), schemes: await db.schemes.toArray(), states: await db.formStates.toArray(), now: T0 });
    const scope = async (c: Partial<ConjSessionConfig>) => scopedVerbs(cfg(c), (await data()).verbs, (await data()).schemes).map((x) => x.verb.id).sort();
    expect(await scope({})).toEqual([v1.id, v2.id].sort());
    expect(await scope({ deckIds: [d1.id] })).toEqual([v1.id]);
    expect(await scope({ lessonIds: [l.id] })).toEqual([v1.id]);
    expect(await scope({ langs: ['fa'] })).toEqual([v2.id]);
    expect(await scope({ verbIds: [v2.id], deckIds: [d1.id] })).toEqual([v2.id]);
    expect(await scope({ tenseLabels: ['Futur II'] })).toEqual([]);
    // Mode 1: of two studied tenses the one with mistakes comes first (unseen forms count as fully forgotten, so they are included too)
    for (const p of de.persons) {
      await ans(v1, de.tenses[0].id, p.id, false, T0 - 5 * DAY_MS);
      await ans(v1, de.tenses[1].id, p.id, true, T0 - 5 * DAY_MS);
    }
    const q = buildConjugationQueue(cfg({ mode: 'conj-full', verbIds: [v1.id], size: 5 }), await data());
    expect(q).toHaveLength(2);
    expect(q[0].tenseId).toBe(de.tenses[0].id);
    expect(buildConjugationQueue(cfg({ mode: 'conj-full', verbIds: [v1.id], size: 1 }), await data())).toHaveLength(1);
  });
});

describe('Data safety', () => {
  it('deleting a lesson or deck removes only its verbs and form history', async () => {
    const d = await deck(); const keep = await deck();
    const l = await addLesson(d.id, 'L');
    const s = await germanScheme();
    const a = await gehen(s, d.id, { lessonId: l.id, infinitive: 'gehen' });
    const b = await gehen(s, keep.id, { infinitive: 'gehen' });
    await ans(a, s.tenses[0].id, s.persons[0].id, true, T0);
    await ans(b, s.tenses[0].id, s.persons[0].id, true, T0);
    await deleteLesson(l.id, false);
    expect((await db.verbs.get(a.id))!.lessonId).toBe('');
    await deleteLesson((await addLesson(d.id, 'M')).id, true);
    expect(await db.verbs.count()).toBe(2);
    await deleteDeck(d.id);
    expect(await db.verbs.toArray()).toHaveLength(1);
    expect(await db.formStates.toArray()).toHaveLength(1);
    expect((await db.formStates.toArray())[0].verbId).toBe(b.id);
    expect(await db.formReviews.count()).toBe(1);
  });

  it('upgrading a version-1 database keeps every row and adds the conjugation tables', async () => {
    const name = 'lernkarten-migration-test';
    await Dexie.delete(name);
    const old = new Dexie(name);
    old.version(1).stores({
      decks: 'id, name, subject, sample', lessons: 'id, deckId, name, [deckId+name]', cards: 'id, deckId, lessonId, frontKey, priority, status, problem, sample, createdAt, *tags',
      media: 'id', states: 'id, cardId, deckId, direction, due, problem, [direction+due]', reviews: 'id, cardId, deckId, ts, day, sessionId, [cardId+ts]', sessions: 'id, startedAt', days: 'day', settings: 'key',
    });
    await old.open();
    await old.table('decks').add({ id: 'd1', name: 'Alt', subject: '', sample: 0 });
    await old.table('cards').add({ id: 'c1', deckId: 'd1', lessonId: '', frontKey: 'x', priority: 3, status: 'neu', problem: 0, sample: 0, createdAt: 1, tags: ['a'], front: 'Hund', back: 'dog' });
    await old.table('settings').add({ key: 'app', dailyGoal: 77 });
    old.close();

    const upgraded = new AppDB(name);
    await upgraded.open();
    expect(await upgraded.decks.count()).toBe(1);
    expect((await upgraded.cards.get('c1'))!).toMatchObject({ front: 'Hund', tags: ['a'] });
    expect(await upgraded.settings.get('app')).toMatchObject({ dailyGoal: 77 });
    expect(await upgraded.verbs.count()).toBe(0);
    await upgraded.schemes.add({ id: 's', name: 'x', lang: '', dir: 'auto', font: 'system', scale: 1, persons: [], tenses: [], createdAt: 1, updatedAt: 1 });
    expect(await upgraded.schemes.count()).toBe(1);
    upgraded.close();
    await Dexie.delete(name);
  });

  it('backups round-trip verbs, schemes and form history; old version-1 backups still restore', async () => {
    const d = await deck();
    const s = await germanScheme();
    const v = await gehen(s, d.id);
    await ans(v, s.tenses[0].id, s.persons[0].id, false, T0);
    await card('Hund', 'dog', { deckId: d.id });
    const full = JSON.stringify(await createBackup());
    const before = { verbs: await db.verbs.toArray(), schemes: await db.schemes.toArray(), formStates: await db.formStates.toArray(), formReviews: await db.formReviews.toArray() };
    await resetDb();
    const check = validateBackup(full);
    expect(check).toMatchObject({ ok: true, kind: 'current', summary: { verbs: 1, cards: 1 } });
    await restoreBackup(check, 'replace');
    expect(await db.verbs.toArray()).toEqual(before.verbs);
    expect(await db.schemes.toArray()).toEqual(before.schemes);
    expect(await db.formStates.toArray()).toEqual(before.formStates);
    expect(await db.formReviews.toArray()).toEqual(before.formReviews);

    // merge adds nothing twice
    const merged = await restoreBackup(validateBackup(full), 'merge');
    expect(merged.addedVerbs).toBe(0);
    expect(await db.verbs.count()).toBe(1);

    // version 1 file (no conjugation tables)
    const v1 = JSON.parse(full);
    v1.version = 1;
    for (const tb of ['schemes', 'verbs', 'formStates', 'formReviews']) delete v1.data[tb];
    await resetDb();
    const old = validateBackup(JSON.stringify(v1));
    expect(old.ok).toBe(true);
    await restoreBackup(old, 'replace');
    expect(await db.cards.count()).toBe(1);
    expect(await db.verbs.count()).toBe(0);
  });

  it('settings keep working: language and answer font scale are stored with defaults for old data', async () => {
    await db.settings.put({ key: 'app', dailyGoal: 12 } as never);
    const { getSettings } = await import('../db/repo');
    expect(await getSettings()).toMatchObject({ dailyGoal: 12, uiLanguage: 'de', answerFontScale: 1 });
    await saveSettings({ uiLanguage: 'en', answerFontScale: 1.2 });
    expect(await getSettings()).toMatchObject({ dailyGoal: 12, uiLanguage: 'en', answerFontScale: 1.2 });
  });
});
