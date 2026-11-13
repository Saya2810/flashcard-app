import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../lib/csv';
import { closest, diff, isIdentical } from '../lib/diff';
import { renderMarkdown, mediaRefs } from '../lib/markdown';
import { detectDir, dupKey, fieldKey, hasRtl, plainText, searchKey } from '../lib/text';
import { answers, card, deck, resetDb } from '../test/helpers';
import { BACKUP_FORMAT, createBackup, exportCsv, restoreBackup, validateBackup } from './backup';
import { db, stateId } from './db';
import { defaultMapping, guessMapping, importRows, markDuplicates, parseBulk, rowsFromTable } from './import';
import { autoImportLegacy, convertLegacy, LEGACY_DB, LEGACY_DECK_ID, type LegacyData } from './legacy';
import { pruneMedia } from './media';
import { addLesson, getSettings, saveSettings } from './repo';
import { loadSampleData, removeSampleData } from './sample';

beforeEach(async () => {
  await resetDb();
  await Dexie.delete(LEGACY_DB);
});

describe('Text in any script', () => {
  it('normalises Arabic/Persian variants and Latin accents for search only', () => {
    expect(searchKey('كتابي')).toBe(searchKey('کتابی'));
    expect(searchKey('مي‌روم')).toBe(searchKey('می روم'));
    expect(searchKey('Âmadan')).toBe('amadan');
    expect(searchKey('Café')).toBe('cafe');
    expect(dupKey('Bär')).not.toBe(dupKey('Bar')); // duplicates keep accents
    expect(dupKey('  Hallo   Welt ')).toBe('hallo welt');
    expect(hasRtl('kommen')).toBe(false);
    expect(hasRtl('שלום')).toBe(true);
    expect(detectDir('۱۲ آمدن')).toBe('rtl');
    expect(detectDir('E = mc²')).toBe('ltr');
  });

  it('plain text strips Markdown and LaTeX delimiters', () => {
    expect(plainText('**fett** und *kursiv* $E = mc^2$')).toBe('fett und kursiv E = mc^2');
    expect(plainText('```python\nprint(1)\n```')).toBe('print(1)');
    expect(plainText('![](media:abc)\nText')).toBe('Text');
  });

  it('creates unique field keys from labels', () => {
    expect(fieldKey('Beispiel (Deutsch)')).toBe('beispiel_deutsch');
    expect(fieldKey('Umschrift', ['umschrift'])).toBe('umschrift_2');
  });
});

describe('Typed-answer diff (informational only)', () => {
  it('marks extra and missing characters exactly', () => {
    const parts = diff('Bibilothek', 'Bibliothek');
    expect(parts.filter((p) => p.op !== 'same').map((p) => `${p.op}:${p.text}`)).toEqual(['missing:l', 'extra:l']);
    expect(diff('kommen', 'kommen')).toEqual([{ op: 'same', text: 'kommen' }]);
    expect(isIdentical(diff('Haus', 'Haus'))).toBe(true);
  });

  it('handles missing words, extra words and empty input', () => {
    const p = diff('die Katze', 'die schwarze Katze');
    expect(p.filter((x) => x.op === 'missing').map((x) => x.text).join('')).toBe('schwarze ');
    expect(diff('', 'abc')).toEqual([{ op: 'missing', text: 'abc' }]);
    expect(diff('abc', '')).toEqual([{ op: 'extra', text: 'abc' }]);
  });

  it('keeps Persian letters and combining marks intact (grapheme clusters)', () => {
    const p = diff('کتب', 'کتاب');
    expect(p.find((x) => x.op === 'missing')?.text).toBe('ا');
    const accents = diff('café', 'café');
    expect(isIdentical(accents)).toBe(true); // NFC-equal
  });

  it('options ignore case and punctuation; closest picks the nearest accepted answer', () => {
    expect(isIdentical(diff('hallo welt', 'Hallo Welt', { ignoreCase: true }))).toBe(true);
    expect(isIdentical(diff('Hallo Welt', 'Hallo, Welt!', { ignorePunctuation: true }))).toBe(true);
    expect(isIdentical(diff('Hallo Welt', 'Hallo, Welt!'))).toBe(false);
    expect(closest('fahren', ['gehen', 'fahren']).answer).toBe('fahren');
  });

  it('scales to long answers', () => {
    const long = 'Lorem ipsum dolor sit amet '.repeat(150);
    const t = performance.now();
    const p = diff(long, long + 'x');
    expect(performance.now() - t).toBeLessThan(3000);
    expect(p[p.length - 1]).toEqual({ op: 'missing', text: ' x' }); // word-level fallback above 3000 characters
  });
});

describe('Rich content', () => {
  it('renders Markdown, inline and display LaTeX, and code blocks', () => {
    const html = renderMarkdown('**Satz:** $a^2+b^2=c^2$\n\n$$\\int_0^1 x\\,dx$$\n\n```js\nconst x = 1 < 2;\n```');
    expect(html).toContain('<strong>Satz:</strong>');
    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
    expect(html).toContain('<pre><code');
    expect(html).toContain('1 &lt; 2');
  });

  it('sanitises dangerous HTML and keeps media references', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> <script>alert(1)</script> [link](javascript:alert(1)) ![](media:abc-1)');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('src="media:abc-1"');
    expect(mediaRefs('a ![](media:abc-1) b ![x](media:def)')).toEqual(['abc-1', 'def']);
  });

  it('does not treat prices as formulas', () => {
    expect(renderMarkdown('kostet $5 und $10')).not.toContain('katex');
  });
});

describe('CSV import', () => {
  const CSV = '﻿Deck,Lesson,Front,Back,Alternatives,Priority,Tags,Notes,Umschrift\r\n' +
    'Persisch,Lektion 3,آمدن,kommen | ankommen,herkommen,5,"Verb, Bewegung","Notiz, mit Komma",âmadan\r\n' +
    'Persisch,Lektion 4,رفتن,gehen,,9,,,\r\n' +
    'Mathe,Ableitungen,Ableitung von $e^x$,$e^x$,,4,,,\r\n' +
    ',,,leer,,,,,\r\n' +
    '"Persisch","Lektion 4","کتاب‌خانه","Bibliothek ""Uni""",,,,,\r\n';

  it('reads UTF-8 with BOM, quotes and Persian characters', () => {
    const t = parseCsv(CSV);
    expect(t).toHaveLength(6);
    expect(t[1][2]).toBe('آمدن');
    expect(t[1][7]).toBe('Notiz, mit Komma');
    expect(t[5][2]).toBe('کتاب‌خانه');
    expect(t[5][3]).toBe('Bibliothek "Uni"');
  });

  it('maps columns automatically, including custom fields', () => {
    const map = guessMapping(parseCsv(CSV)[0])!;
    expect(map.map((m) => m.target)).toEqual(['deck', 'lesson', 'front', 'back', 'alt', 'priority', 'tags', 'notes', 'field']);
    expect(map[8].label).toBe('Umschrift');
    expect(guessMapping(['آب', 'Wasser'])).toBeNull();
    expect(defaultMapping(3).map((m) => m.target)).toEqual(['front', 'back', 'ignore']);
    // Legacy export headers are understood too
    expect(guessMapping(['Persian', 'German', 'Transliteration', 'Lesson'])!.map((m) => m.target)).toEqual(['front', 'back', 'field', 'lesson']);
  });

  it('validates rows and reports errors per line', () => {
    const t = parseCsv(CSV);
    const rows = rowsFromTable(t.slice(1), guessMapping(t[0])!, 2);
    expect(rows[0]).toMatchObject({ deckName: 'Persisch', lessonName: 'Lektion 3', front: 'آمدن', back: 'kommen', altBack: ['ankommen', 'herkommen'], priority: 5, tags: ['Verb', 'Bewegung'], fields: { Umschrift: 'âmadan' } });
    expect(rows[1].error).toMatch(/Priorität/);
    expect(rows[1].line).toBe(3);
    expect(rows[3].error).toBe('Vorderseite fehlt');
  });

  it('imports several decks and lessons at once, creating custom fields', async () => {
    const t = parseCsv(CSV);
    const target = await deck({ name: 'Standard' });
    const rows = await markDuplicates(rowsFromTable(t.slice(1), guessMapping(t[0])!, 2), target.id);
    const res = await importRows(rows, { skipDuplicates: true, defaultDeckId: target.id, defaultLessonId: '' });
    expect(res).toMatchObject({ imported: 3, skipped: 2, decks: 2, lessons: 3 });
    const fa = await db.decks.where('name').equals('Persisch').first();
    expect(fa?.fields.map((f) => f.label)).toEqual(['Umschrift']);
    const c = await db.cards.where('frontKey').equals(dupKey('آمدن')).first();
    expect(c?.fields[fa!.fields[0].key]).toBe('âmadan');
    expect((await db.lessons.get(c!.lessonId))?.name).toBe('Lektion 3');
    const lib = await db.cards.where('frontKey').equals(dupKey('کتاب‌خانه')).first();
    expect(lib?.front).toBe('کتاب‌خانه');
    expect(await db.cards.where('deckId').equals(target.id).count()).toBe(0);
  });

  it('flags duplicates against the target deck and within the import', async () => {
    const d = await deck();
    await card('آمدن', 'kommen', { deckId: d.id });
    const rows = await markDuplicates(parseBulk('آمدن ; kommen\nرفتن ; gehen\nرفتن ; gehen'), d.id);
    expect(rows.map((r) => r.duplicate)).toEqual([true, false, true]);
    const other = await deck();
    expect((await markDuplicates(parseBulk('آمدن ; kommen'), other.id))[0].duplicate).toBe(false);
  });

  it('quick entry: semicolons, alternatives, notes and invalid lines into a lesson', async () => {
    const d = await deck();
    const l = await addLesson(d.id, 'Kapitel 1');
    const rows = parseBulk('the cat ; die Katze\nrun ; laufen | rennen ; unregelmäßig\nE = mc^2 ; Energie\n\nnur eine Seite');
    expect(rows[1]).toMatchObject({ front: 'run', back: 'laufen', altBack: ['rennen'], notes: 'unregelmäßig' });
    expect(rows[2]).toMatchObject({ front: 'E = mc^2', back: 'Energie' });
    expect(rows[3].error).toBeTruthy();
    const res = await importRows(await markDuplicates(rows, d.id), { skipDuplicates: true, defaultDeckId: d.id, defaultLessonId: l.id });
    expect(res.imported).toBe(3);
    expect(await db.cards.where('lessonId').equals(l.id).count()).toBe(3);
  });

  it('CSV export round-trips including custom fields', async () => {
    const d = await deck({ name: 'Vokabeln', fields: [{ key: 'um', label: 'Umschrift', dir: 'ltr', font: 'system' }] });
    const l = await addLesson(d.id, 'Verben');
    await card('آمدن', 'kommen', { deckId: d.id, altBack: ['ankommen'], lessonId: l.id, notes: 'a "b", c', tags: ['x', 'y'], priority: 4, fields: { um: 'âmadan' } });
    const t = parseCsv(await exportCsv());
    expect(t[0]).toEqual(['Deck', 'Lesson', 'Front', 'Back', 'Alternatives', 'Priority', 'Tags', 'Notes', 'Umschrift']);
    expect(t[1]).toEqual(['Vokabeln', 'Verben', 'آمدن', 'kommen', 'ankommen', '4', 'x, y', 'a "b", c', 'âmadan']);
    const back = rowsFromTable(t.slice(1), guessMapping(t[0])!);
    expect(back[0]).toMatchObject({ front: 'آمدن', back: 'kommen', altBack: ['ankommen'], fields: { Umschrift: 'âmadan' } });
    expect(toCsv([['a,b', 'c']])).toContain('"a,b",c');
  });
});

describe('Backup and restore', () => {
  async function seed() {
    const d = await deck({ name: 'Physik', reverse: true });
    const l = await addLesson(d.id, 'Mechanik');
    const a = await card('Impuls', '$p = mv$', { deckId: d.id, lessonId: l.id, priority: 5, tags: ['F'] });
    const b = await card('Kraft', '$F = ma$', { deckId: d.id });
    await answers(a.id, '0011');
    await answers(a.id, '1', { direction: 'rev' });
    await db.media.add({ id: 'img1', mime: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 1, height: 1, createdAt: 1 });
    await saveSettings({ dailyGoal: 35, theme: 'dark', typedAnswer: true });
    return { a, b, d };
  }

  it('contains everything and restores the full state', async () => {
    const { a } = await seed();
    const text = JSON.stringify(await createBackup());
    const before = { decks: await db.decks.toArray(), cards: await db.cards.toArray(), states: await db.states.toArray(), reviews: await db.reviews.toArray(), days: await db.days.toArray(), lessons: await db.lessons.toArray(), media: await db.media.toArray() };
    await resetDb();
    const check = validateBackup(text);
    expect(check).toMatchObject({ ok: true, kind: 'current', summary: { decks: 1, cards: 2, reviews: 5 } });
    await restoreBackup(check, 'replace');
    for (const [k, v] of Object.entries(before)) expect(await (db as unknown as Record<string, { toArray(): Promise<unknown[]> }>)[k].toArray()).toEqual(v);
    expect(await getSettings()).toMatchObject({ dailyGoal: 35, theme: 'dark', typedAnswer: true });
    expect((await db.states.get(stateId(a.id, 'fwd')))?.total).toBe(4);
  });

  it('rejects invalid files without changing anything', async () => {
    await seed();
    const good = await createBackup();
    const cases: [string, RegExp][] = [
      ['kein json {', /JSON/],
      ['{"foo":1}', /keine Sicherung/],
      [JSON.stringify({ ...good, version: 99 }), /neueren/],
      [JSON.stringify({ ...good, data: { ...good.data, cards: 'x' } }), /cards/],
      [JSON.stringify({ ...good, data: { ...good.data, cards: [{ id: 1 }] } }), /Karte Nr. 1/],
      [JSON.stringify({ ...good, data: { ...good.data, cards: [{ ...good.data.cards[0], deckId: 'gibt-es-nicht' }] } }), /Karte Nr. 1/],
      [JSON.stringify({ ...good, data: { ...good.data, states: [{ ...good.data.states[0], cardId: 'gibt-es-nicht' }] } }), /Planungszustand/],
      [JSON.stringify({ ...good, data: { ...good.data, media: [{ id: 'x', dataUrl: 'javascript:1' }] } }), /Bild/],
      [JSON.stringify({ format: BACKUP_FORMAT, version: 1 }), /Datenteil/],
    ];
    for (const [text, msg] of cases) {
      const c = validateBackup(text);
      expect(c.ok).toBe(false);
      expect(c.errors.join(' ')).toMatch(msg);
    }
    expect(await db.cards.count()).toBe(2);
  });

  it('merge never overwrites existing progress and reuses decks by name', async () => {
    const { a } = await seed();
    const backup = validateBackup(JSON.stringify(await createBackup()));
    await answers(a.id, '1111', { start: new Date(2026, 1, 20).getTime() });
    const progressed = await db.states.get(stateId(a.id, 'fwd'));
    const extra = await card('Arbeit', '$W = F s$', { deckId: a.deckId });
    expect((await restoreBackup(backup, 'merge')).added).toBe(0);
    expect(await db.states.get(stateId(a.id, 'fwd'))).toEqual(progressed);
    expect(await db.cards.get(extra.id)).toBeTruthy();
    expect(await db.decks.count()).toBe(1);
  });

  it('merge into another device adds missing cards with their progress', async () => {
    const { a } = await seed();
    const backup = validateBackup(JSON.stringify(await createBackup()));
    await resetDb();
    const own = await deck({ name: 'Physik' }); // same name, different id
    const r = await restoreBackup(backup, 'merge');
    expect(r.added).toBe(2);
    expect(await db.decks.count()).toBe(1);
    expect((await db.cards.get(a.id))?.deckId).toBe(own.id);
    expect((await db.states.get(stateId(a.id, 'fwd')))?.total).toBe(4);
    expect(await db.media.count()).toBe(1);
  });

  it('a failed replace leaves the old data fully intact', async () => {
    await seed();
    const backup = validateBackup(JSON.stringify(await createBackup()));
    backup.backup!.data.cards = [backup.backup!.data.cards[0], backup.backup!.data.cards[0]];
    await expect(restoreBackup(backup, 'replace')).rejects.toBeTruthy();
    expect(await db.cards.count()).toBe(2);
    expect(await db.reviews.count()).toBe(5);
  });

  it('removes unused images', async () => {
    await seed();
    await card('Bild', 'x ![](media:img1)');
    await db.media.add({ id: 'orphan', mime: 'image/png', dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1, createdAt: 1 });
    expect(await pruneMedia()).toBe(1);
    expect(await db.media.toCollection().primaryKeys()).toEqual(['img1']);
  });
});

/* -------- Legacy Persian–German data -------- */
const T = new Date(2026, 0, 10, 10).getTime();
function legacyData(): LegacyData {
  return {
    vocab: [
      { id: 'v1', persian: 'آمدن', german: 'kommen', altGerman: ['ankommen'], translit: 'âmadan', grammar: 'Verb', exampleFa: 'من می‌آیم.', exampleDe: 'Ich komme.', notes: 'n', lessonId: 'L1', priority: 5, tags: ['Verb'], createdAt: T, updatedAt: T, lastReviewAt: T, sample: 0 },
      { id: 'v2', persian: 'رفتن', german: 'gehen', lessonId: '', priority: 3, tags: [], createdAt: T + 1 },
    ],
    lessons: [{ id: 'L1', name: 'Lektion 1', description: '', createdAt: T, lastPracticedAt: T }],
    states: [
      { id: 'v1|fa-de', vocabId: 'v1', direction: 'fa-de', due: T + 86_400_000, stability: 3, difficulty: 5, reps: 2, lapses: 0, fsrsState: 2, lastReview: T, scheduledDays: 3, total: 3, correct: 1, incorrect: 2, curCorrect: 0, curIncorrect: 2, maxIncorrect: 2, lastIncorrectAt: T, firstReviewAt: T, recent: '100', status: 'unsicher', problem: 1 },
      { id: 'v1|de-fa', vocabId: 'v1', direction: 'de-fa', due: T + 86_400_000, stability: 8, difficulty: 4, reps: 1, lapses: 0, fsrsState: 2, lastReview: T, scheduledDays: 8, total: 1, correct: 1, incorrect: 0, curCorrect: 1, curIncorrect: 0, maxIncorrect: 0, lastIncorrectAt: 0, firstReviewAt: T, recent: '1', status: 'gut', problem: 0 },
    ],
    reviews: [
      { id: 'r1', vocabId: 'v1', direction: 'fa-de', ts: T, day: '2026-01-10', correct: false, sessionId: 's1', kind: 'scheduled', meta: null },
      { id: 'r2', vocabId: 'v1', direction: 'de-fa', ts: T, day: '2026-01-10', correct: true, sessionId: 's1', kind: 'scheduled', meta: null },
    ],
    sessions: [{ id: 's1', mode: 'smart', direction: 'mixed', lessonIds: [], startedAt: T, endedAt: T, planned: 2, answered: 2, correct: 1, incorrect: 1 }],
    days: [{ day: '2026-01-10', reviews: 2, correct: 1, incorrect: 1, newCards: 1, relearn: 0, snapshot: null }],
    settings: { key: 'app', theme: 'dark', dailyGoal: 40, defaultDirection: 'de-fa', persianFontScale: 1.2 },
  };
}

async function writeLegacyDb(data: LegacyData) {
  const old = new Dexie(LEGACY_DB);
  old.version(1).stores({ vocab: 'id', lessons: 'id', states: 'id', reviews: 'id', sessions: 'id', days: 'day', settings: 'key' });
  await old.open();
  await old.table('vocab').bulkAdd(data.vocab);
  await old.table('lessons').bulkAdd(data.lessons);
  await old.table('states').bulkAdd(data.states);
  await old.table('reviews').bulkAdd(data.reviews);
  await old.table('sessions').bulkAdd(data.sessions);
  await old.table('days').bulkAdd(data.days);
  await old.table('settings').put(data.settings);
  old.close();
}

describe('Migration from the Persian–German version', () => {
  it('converts vocabulary, both directions, history and settings', () => {
    const c = convertLegacy(legacyData());
    expect(c.deck).toMatchObject({ id: LEGACY_DECK_ID, name: 'Persisch – Deutsch', reverse: true, rich: false, front: { lang: 'fa', dir: 'rtl', font: 'vazirmatn' }, back: { lang: 'de' } });
    expect(c.cards[0]).toMatchObject({ id: 'v1', front: 'آمدن', back: 'kommen', altBack: ['ankommen'], fields: { umschrift: 'âmadan', grammatik: 'Verb', beispiel_fa: 'من می‌آیم.', beispiel_de: 'Ich komme.' }, lessonId: 'L1', status: 'unsicher', problem: 1 });
    expect(c.states.map((s) => s.id)).toEqual(['v1|fwd', 'v1|rev']);
    expect(c.reviews.map((r) => r.direction)).toEqual(['fwd', 'rev']);
    expect(c.lessons[0]).toMatchObject({ id: 'L1', deckId: LEGACY_DECK_ID });
    expect(c.settings).toMatchObject({ theme: 'dark', dailyGoal: 40, defaultDirection: 'rev' });
  });

  it('imports the old database once on start, read-only, and keeps everything usable', async () => {
    await writeLegacyDb(legacyData());
    expect(await autoImportLegacy()).toBe(2);
    expect(await db.cards.count()).toBe(2);
    expect((await db.states.get('v1|fwd'))?.incorrect).toBe(2);
    expect((await db.cards.get('v1'))?.problem).toBe(1);
    expect(await db.days.get('2026-01-10')).toMatchObject({ reviews: 2 });
    expect(await getSettings()).toMatchObject({ dailyGoal: 40, theme: 'dark' });
    // second start: nothing happens; the old database is untouched
    expect(await autoImportLegacy()).toBe(0);
    expect(await db.cards.count()).toBe(2);
    const old = new Dexie(LEGACY_DB); old.version(1).stores({ vocab: 'id' }); await old.open();
    expect(await old.table('vocab').count()).toBe(2);
    old.close();
  });

  it('without an old database nothing is imported', async () => {
    expect(await autoImportLegacy()).toBe(0);
    expect(await db.decks.count()).toBe(0);
  });

  it('accepts legacy backup files and merges without duplicating', async () => {
    const file = JSON.stringify({ format: 'persisch-karten-backup', version: 1, exportedAt: '2026-01-11T10:00:00Z', data: legacyData() });
    const check = validateBackup(file);
    expect(check).toMatchObject({ ok: true, kind: 'legacy', summary: { cards: 2, decks: 1 } });
    expect((await restoreBackup(check, 'merge')).added).toBe(2);
    expect((await restoreBackup(validateBackup(file), 'merge')).added).toBe(0);
    expect(await db.decks.count()).toBe(1);
    expect(validateBackup(JSON.stringify({ format: 'persisch-karten-backup', version: 1, data: { ...legacyData(), vocab: [{ id: 'x' }] } })).ok).toBe(false);
  });
});

describe('Sample data', () => {
  it('is marked, loads once and is removed cleanly', async () => {
    const own = await card('Meer', 'sea');
    await answers(own.id, '10');
    const n = await loadSampleData();
    expect(n).toBeGreaterThan(10);
    expect(await loadSampleData()).toBe(0);
    expect(await db.decks.where('sample').equals(1).count()).toBe(4);
    const sample = await db.cards.where('sample').equals(1).toArray();
    expect(sample.every((c) => c.tags.includes('Beispiel'))).toBe(true);
    await answers(sample[0].id, '00');
    expect((await db.days.get('2026-01-10'))?.reviews).toBe(2);
    expect(await removeSampleData()).toBe(n);
    expect(await db.decks.count()).toBe(1);
    expect(await db.cards.count()).toBe(1);
    expect((await db.days.get('2026-01-10'))?.reviews).toBe(1);
    expect((await db.states.get(stateId(own.id, 'fwd')))?.total).toBe(2);
  });
});
