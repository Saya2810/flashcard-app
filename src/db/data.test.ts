import { beforeEach, describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../lib/csv';
import { hasPersian, normalizeFa, normalizeLatin } from '../lib/persian';
import { answers, resetDb, word } from '../test/helpers';
import { BACKUP_FORMAT, createBackup, exportCsv, restoreBackup, validateBackup } from './backup';
import { db, stateId } from './db';
import { guessMapping, importRows, markDuplicates, parseBulk, rowsFromTable } from './import';
import { addLesson, getSettings, saveSettings } from './repo';
import { loadSampleData, removeSampleData } from './sample';

beforeEach(resetDb);

describe('Persian text', () => {
  it('normalises Arabic variants for search only', () => {
    expect(normalizeFa('كتابي')).toBe(normalizeFa('کتابی'));
    expect(normalizeFa('مي‌روم')).toBe(normalizeFa('می روم'));
    expect(normalizeFa('کِتاب')).toBe('کتاب');
    expect(normalizeFa('۱۲۳')).toBe('123');
    expect(normalizeLatin('Âmadan')).toBe('amadan');
    expect(normalizeLatin('Übung')).toBe('übung');
    expect(hasPersian('kommen')).toBe(false);
    expect(hasPersian('آمدن')).toBe(true);
  });

  it('stores the original text unchanged (incl. half-space and very long expressions)', async () => {
    const long = 'من هر روز صبح زود از خواب بیدار می‌شوم و پیش از رفتن به دانشگاه یک فنجان چای می‌نوشم، سپس کتاب‌هایم را برمی‌دارم و با دوچرخه راه می‌افتم.';
    const v = await word(long, 'Ich stehe jeden Morgen früh auf …');
    const saved = await db.vocab.get(v.id);
    expect(saved?.persian).toBe(long);
    expect(saved?.persian).toContain('‌');
    expect([...saved!.persian].reverse().join('')).not.toBe(saved!.persian);
  });
});

describe('CSV import', () => {
  const CSV = '﻿Persian,German,Transliteration,Lesson,Priority,Notes,Tags\r\n' +
    'آمدن,kommen | ankommen,âmadan,Lektion 3,5,"Notiz, mit Komma","Verb, Bewegung"\r\n' +
    'رفتن,gehen,raftan,Lektion 3,9,,\r\n' +
    ',leer,,,,,\r\n' +
    '"کتاب‌خانه","Bibliothek ""Uni""",,Universität,,,\r\n';

  it('reads UTF-8 with BOM, quotes and Persian characters', () => {
    const t = parseCsv(CSV);
    expect(t).toHaveLength(5);
    expect(t[1][0]).toBe('آمدن');
    expect(t[1][5]).toBe('Notiz, mit Komma');
    expect(t[4][0]).toBe('کتاب‌خانه');
    expect(t[4][1]).toBe('Bibliothek "Uni"');
    expect(parseCsv('آب;Wasser\nنان;Brot')[1]).toEqual(['نان', 'Brot']);
  });

  it('maps columns, validates and reports errors per line', () => {
    const t = parseCsv(CSV);
    const map = guessMapping(t[0])!;
    expect(map).toMatchObject({ persian: 0, german: 1, translit: 2, lesson: 3, priority: 4, notes: 5, tags: 6 });
    expect(guessMapping(['آب', 'Wasser'])).toBeNull();
    const rows = rowsFromTable(t.slice(1), map, 2);
    expect(rows[0].input).toMatchObject({ persian: 'آمدن', german: 'kommen', altGerman: ['ankommen'], priority: 5, tags: ['Verb', 'Bewegung'] });
    expect(rows[1].error).toMatch(/Priorität/);
    expect(rows[1].line).toBe(3);
    expect(rows[2].error).toBe('Persisch fehlt');
    expect(rows[3].error).toBeNull();
  });

  it('imports valid rows, creates lessons and skips duplicates', async () => {
    await word('آمدن', 'kommen');
    const t = parseCsv(CSV);
    const rows = await markDuplicates(rowsFromTable(t.slice(1), guessMapping(t[0])!, 2));
    expect(rows[0].duplicate).toBe(true);
    const res = await importRows(rows, { skipDuplicates: true, defaultLessonId: '' });
    expect(res).toEqual({ imported: 1, skipped: 3 });
    const lib = await db.vocab.where('persianNorm').equals(normalizeFa('کتاب‌خانه')).first();
    expect(lib?.persian).toBe('کتاب‌خانه');
    expect((await db.lessons.get(lib!.lessonId))?.name).toBe('Universität');
    expect(await db.vocab.count()).toBe(2);
  });

  it('quick entry: semicolon lines, swapped order, invalid lines', async () => {
    const rows = parseBulk('آمدن ; kommen\nرفتن ; gehen, fahren ; raftan\nbleiben ; ماندن\n\nnur deutsch\nآمدن ; kommen');
    expect(rows.map((r) => r.input.persian).slice(0, 3)).toEqual(['آمدن', 'رفتن', 'ماندن']);
    expect(rows[1].input).toMatchObject({ german: 'gehen', altGerman: ['fahren'], translit: 'raftan' });
    expect(rows[3].error).toBeTruthy();
    const marked = await markDuplicates(rows);
    expect(marked[4].duplicate).toBe(true); // duplicate within the input
    const res = await importRows(marked, { skipDuplicates: true, defaultLessonId: '' });
    expect(res.imported).toBe(3);
  });

  it('CSV export round-trips without loss', async () => {
    const l = await addLesson('Verben');
    await word('آمدن', 'kommen', { altGerman: ['ankommen'], lessonId: l.id, notes: 'a "b", c', tags: ['x', 'y'], priority: 4 });
    const t = parseCsv(await exportCsv());
    expect(t[1].slice(0, 7)).toEqual(['آمدن', 'kommen | ankommen', '', 'Verben', '4', 'a "b", c', 'x, y']);
    expect(toCsv([['a,b', 'c']])).toContain('"a,b",c');
  });
});

describe('Backup and restore', () => {
  async function seed() {
    const l = await addLesson('Verben');
    const a = await word('آمدن', 'kommen', { lessonId: l.id, priority: 5, tags: ['Verb'] });
    const b = await word('رفتن', 'gehen', { lessonId: l.id });
    await answers(a.id, '0011');
    await answers(a.id, '1', { direction: 'de-fa' });
    await saveSettings({ dailyGoal: 35, theme: 'dark' });
    return { a, b, l };
  }

  it('backup contains everything and restores the full state', async () => {
    const { a } = await seed();
    const text = JSON.stringify(await createBackup());
    const before = { vocab: await db.vocab.toArray(), states: await db.states.toArray(), reviews: await db.reviews.toArray(), days: await db.days.toArray(), lessons: await db.lessons.toArray() };
    await resetDb();
    expect(await db.vocab.count()).toBe(0);
    const check = validateBackup(text);
    expect(check.ok).toBe(true);
    expect(check.summary).toMatchObject({ vocab: 2, lessons: 1, reviews: 5 });
    await restoreBackup(check.backup!, 'replace');
    expect(await db.vocab.toArray()).toEqual(before.vocab);
    expect(await db.states.toArray()).toEqual(before.states);
    expect(await db.reviews.toArray()).toEqual(before.reviews);
    expect(await db.days.toArray()).toEqual(before.days);
    expect(await db.lessons.toArray()).toEqual(before.lessons);
    expect(await getSettings()).toMatchObject({ dailyGoal: 35, theme: 'dark' });
    expect((await db.states.get(stateId(a.id, 'fa-de')))?.total).toBe(4);
  });

  it('rejects invalid files without changing anything', async () => {
    await seed();
    const good = await createBackup();
    const cases: [string, RegExp][] = [
      ['kein json {', /JSON/],
      ['{"foo":1}', /keine Sicherung/],
      [JSON.stringify({ ...good, version: 99 }), /neueren/],
      [JSON.stringify({ ...good, data: { ...good.data, vocab: 'x' } }), /vocab/],
      [JSON.stringify({ ...good, data: { ...good.data, vocab: [{ id: 1 }] } }), /Vokabel Nr. 1/],
      [JSON.stringify({ ...good, data: { ...good.data, states: [{ ...good.data.states[0], vocabId: 'gibt-es-nicht' }] } }), /Planungszustand/],
      [JSON.stringify({ format: BACKUP_FORMAT, version: 1 }), /Datenteil/],
    ];
    for (const [text, msg] of cases) {
      const c = validateBackup(text);
      expect(c.ok).toBe(false);
      expect(c.errors.join(' ')).toMatch(msg);
      expect(c.backup).toBeNull();
    }
    expect(await db.vocab.count()).toBe(2);
  });

  it('merge never overwrites existing progress', async () => {
    const { a } = await seed();
    const backup = await createBackup();
    await answers(a.id, '1111', { start: new Date(2026, 1, 20).getTime() });
    const extra = await word('نان', 'Brot');
    const progressed = await db.states.get(stateId(a.id, 'fa-de'));
    const r = await restoreBackup(backup, 'merge');
    expect(r.added).toBe(0);
    expect(await db.states.get(stateId(a.id, 'fa-de'))).toEqual(progressed);
    expect(await db.vocab.get(extra.id)).toBeTruthy();
    expect(await db.vocab.count()).toBe(3);
  });

  it('merge adds missing items with their progress', async () => {
    const { a } = await seed();
    const backup = await createBackup();
    await resetDb();
    const own = await word('کتاب', 'Buch');
    const r = await restoreBackup(backup, 'merge');
    expect(r.added).toBe(2);
    expect(await db.vocab.get(own.id)).toBeTruthy();
    expect((await db.states.get(stateId(a.id, 'fa-de')))?.total).toBe(4);
    expect(await db.reviews.count()).toBe(5);
  });

  it('a failed replace leaves the old data fully intact', async () => {
    await seed();
    const backup = await createBackup();
    backup.data.vocab = [backup.data.vocab[0], backup.data.vocab[0]]; // duplicate key → failure halfway through the write
    await expect(restoreBackup(backup, 'replace')).rejects.toBeTruthy();
    expect(await db.vocab.count()).toBe(2);
    expect(await db.reviews.count()).toBe(5);
  });
});

describe('Sample data', () => {
  it('is marked, loads only once and can be removed cleanly', async () => {
    const own = await word('دریا', 'Meer');
    await answers(own.id, '10');
    expect(await loadSampleData()).toBe(20);
    expect(await loadSampleData()).toBe(0);
    const sample = await db.vocab.where('sample').equals(1).toArray();
    expect(sample.every((v) => v.tags.includes('Beispiel'))).toBe(true);
    await answers(sample[0].id, '00');
    const day = '2026-01-10';
    expect((await db.days.get(day))?.reviews).toBe(2);
    expect(await removeSampleData()).toBe(20);
    expect(await db.vocab.count()).toBe(1);
    expect(await db.lessons.count()).toBe(0);
    expect((await db.days.get(day))?.reviews).toBe(1);
    expect((await db.states.get(stateId(own.id, 'fa-de')))?.total).toBe(2);
    expect(await db.reviews.count()).toBe(2);
  });
});
