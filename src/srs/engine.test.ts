import { beforeEach, describe, expect, it } from 'vitest';
import { db, stateId } from '../db/db';
import { addLesson, addVocab, deleteLesson, deleteVocab, findDuplicates, moveVocab, setPriority, updateVocab, ValidationError } from '../db/repo';
import { addDays, dayKey, endOfDay, startOfDay } from '../lib/dates';
import { computeStreaks, loadForecast, loadLessonStats, loadOverview, loadProblemRows, sortProblems } from '../stats/stats';
import { answers, resetDb, word } from '../test/helpers';
import { errorRate, isProblem, statusOf, wilsonLower } from './metrics';
import { recordAnswer } from './review';
import { retrievability, schedule } from './scheduler';

beforeEach(resetDb);
const T0 = new Date(2026, 0, 10, 10, 0).getTime();

describe('Vocabulary and lessons', () => {
  it('creates items with multiple translations and defaults', async () => {
    const v = await addVocab({ persian: ' آمدن ', german: 'kommen', altGerman: ['ankommen', 'kommen', ''], tags: ['Verb', 'Verb'], priority: 5 });
    const saved = await db.vocab.get(v.id);
    expect(saved?.persian).toBe('آمدن');
    expect(saved?.altGerman).toEqual(['ankommen']);
    expect(saved?.tags).toEqual(['Verb']);
    expect(saved?.status).toBe('neu');
    expect(saved?.priority).toBe(5);
  });

  it('rejects empty required fields', async () => {
    await expect(addVocab({ persian: '', german: 'x' })).rejects.toBeInstanceOf(ValidationError);
    await expect(addVocab({ persian: 'آب', german: '  ' })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.vocab.count()).toBe(0);
  });

  it('edits items without losing progress', async () => {
    const v = await word();
    await answers(v.id, '11');
    await updateVocab(v.id, { persian: 'آمدن', german: 'kommen (her)', priority: 3 });
    expect((await db.vocab.get(v.id))?.german).toBe('kommen (her)');
    expect((await db.states.get(stateId(v.id, 'fa-de')))?.total).toBe(2);
  });

  it('deletes items together with states and history', async () => {
    const v = await word();
    const keep = await word('رفتن', 'gehen');
    await answers(v.id, '10');
    await answers(keep.id, '1');
    await deleteVocab([v.id]);
    expect(await db.vocab.count()).toBe(1);
    expect(await db.states.where('vocabId').equals(v.id).count()).toBe(0);
    expect(await db.reviews.where('vocabId').equals(v.id).count()).toBe(0);
    expect(await db.reviews.where('vocabId').equals(keep.id).count()).toBe(1);
  });

  it('creates lessons, assigns and moves items, prevents duplicate names', async () => {
    const a = await addLesson('Persisch III – Lektion 1');
    const b = await addLesson('Verben');
    await expect(addLesson('Verben')).rejects.toBeInstanceOf(ValidationError);
    const v = await word('آمدن', 'kommen', { lessonId: a.id });
    expect((await db.vocab.get(v.id))?.lessonId).toBe(a.id);
    await moveVocab([v.id], b.id);
    expect((await db.vocab.get(v.id))?.lessonId).toBe(b.id);
  });

  it('deletes a lesson WITHOUT its items by default', async () => {
    const a = await addLesson('Alltag');
    const v = await word('نان', 'Brot', { lessonId: a.id });
    await deleteLesson(a.id);
    expect(await db.lessons.count()).toBe(0);
    expect((await db.vocab.get(v.id))?.lessonId).toBe('');
  });

  it('deletes a lesson\'s items only when explicitly requested', async () => {
    const a = await addLesson('Alltag');
    await word('نان', 'Brot', { lessonId: a.id });
    await deleteLesson(a.id, true);
    expect(await db.vocab.count()).toBe(0);
  });

  it('empty lessons produce stats without division by zero', async () => {
    await addLesson('Leer');
    const [s] = await loadLessonStats();
    expect(s.total).toBe(0);
    expect(s.progress).toBe(0);
  });

  it('detects duplicates across Arabic letter variants', async () => {
    await word('کتاب', 'Buch');
    const d = await findDuplicates('كتاب', 'buch');
    expect(d.exact).toHaveLength(1);
    const other = await findDuplicates('کتاب', 'Heft');
    expect(other.exact).toHaveLength(0);
    expect(other.samePersian).toHaveLength(1);
  });
});

describe('Answers and scheduling (FSRS)', () => {
  it('stores a correct answer with event, state and daily stats', async () => {
    const v = await word();
    const s = await recordAnswer({ vocabId: v.id, direction: 'fa-de', correct: true, sessionId: 's1', now: T0 });
    expect(s).toMatchObject({ total: 1, correct: 1, incorrect: 0, curCorrect: 1, recent: '1' });
    const [e] = await db.reviews.toArray();
    expect(e).toMatchObject({ vocabId: v.id, direction: 'fa-de', correct: true, sessionId: 's1', ts: T0, day: dayKey(T0), kind: 'scheduled' });
    expect(e.meta?.wasNew).toBe(true);
    expect(e.meta?.intervalDays).toBeGreaterThanOrEqual(1);
    expect(await db.days.get(dayKey(T0))).toMatchObject({ reviews: 1, correct: 1, incorrect: 0, newCards: 1 });
    expect((await db.vocab.get(v.id))?.lastReviewAt).toBe(T0);
  });

  it('stores an incorrect answer and schedules it for the next day', async () => {
    const v = await word();
    const s = await recordAnswer({ vocabId: v.id, direction: 'fa-de', correct: false, sessionId: 's1', now: T0 });
    expect(s).toMatchObject({ total: 1, incorrect: 1, curIncorrect: 1, maxIncorrect: 1, lastIncorrectAt: T0, status: 'unsicher' });
    expect(s!.due).toBe(addDays(T0, 1));
  });

  it('grows the interval on correct answers and shrinks it after a mistake', async () => {
    const v = await word();
    const intervals: number[] = [];
    let t = T0;
    for (let i = 0; i < 4; i++) {
      const s = (await recordAnswer({ vocabId: v.id, direction: 'fa-de', correct: true, sessionId: 's', now: t }))!;
      intervals.push(s.scheduledDays);
      t = s.due + 10 * 3_600_000;
    }
    expect(intervals[1]).toBeGreaterThan(intervals[0]);
    expect(intervals[3]).toBeGreaterThan(intervals[2]);
    const before = (await db.states.get(stateId(v.id, 'fa-de')))!;
    const after = (await recordAnswer({ vocabId: v.id, direction: 'fa-de', correct: false, sessionId: 's', now: t }))!;
    expect(after.scheduledDays).toBeLessThan(intervals[3]);
    expect(after.stability).toBeLessThan(before.stability);
    expect(after.difficulty).toBeGreaterThan(before.difficulty);
    expect(after.lapses).toBe(1);
  });

  it('a single correct answer does not make a word "mastered"', async () => {
    const v = await word();
    await answers(v.id, '1');
    expect((await db.vocab.get(v.id))?.status).toBe('bearbeitung');
  });

  it('reaches "mastered" only after long stability and several correct answers', async () => {
    const v = await word();
    let t = T0;
    let s;
    for (let i = 0; i < 8; i++) {
      s = (await recordAnswer({ vocabId: v.id, direction: 'fa-de', correct: true, sessionId: 's', now: t }))!;
      t = s.due + 3_600_000;
    }
    expect(s!.stability).toBeGreaterThanOrEqual(30);
    expect(s!.status).toBe('sicher');
  });

  it('keeps both directions completely separate', async () => {
    const v = await word();
    await answers(v.id, '111', { direction: 'fa-de' });
    await answers(v.id, '00', { direction: 'de-fa' });
    const a = (await db.states.get(stateId(v.id, 'fa-de')))!;
    const b = (await db.states.get(stateId(v.id, 'de-fa')))!;
    expect(a).toMatchObject({ total: 3, correct: 3, incorrect: 0, problem: 0 });
    expect(b).toMatchObject({ total: 2, correct: 0, incorrect: 2, problem: 1 });
    expect(a.stability).toBeGreaterThan(b.stability);
    // The item counts with its weaker direction.
    expect(await db.vocab.get(v.id)).toMatchObject({ status: 'unsicher', problem: 1 });
  });

  it('higher priority gives shorter intervals for the same memory state', () => {
    const run = (p: number) => {
      let s: any; let t = T0;
      for (let i = 0; i < 4; i++) { const r = schedule(s, true, p, t); s = { ...r, total: i + 1, curIncorrect: 0 }; t = r.due + 3_600_000; }
      return s.scheduledDays as number;
    };
    expect(run(5)).toBeLessThan(run(3));
    expect(run(3)).toBeLessThan(run(1));
  });

  it('changing priority adjusts the due date, not the memory state', async () => {
    const v = await word('آب', 'Wasser', { priority: 1 });
    await answers(v.id, '111', { gapDays: 6 });
    const before = (await db.states.get(stateId(v.id, 'fa-de')))!;
    await setPriority(v.id, 5);
    const after = (await db.states.get(stateId(v.id, 'fa-de')))!;
    expect(after.due).toBeLessThan(before.due);
    expect(after.stability).toBe(before.stability);
    expect(after.total).toBe(before.total);
    expect((await db.vocab.get(v.id))?.priority).toBe(5);
  });

  it('in-session repeats change neither FSRS nor the error rate', async () => {
    const v = await word();
    const first = (await recordAnswer({ vocabId: v.id, direction: 'fa-de', correct: false, sessionId: 's', now: T0 }))!;
    await recordAnswer({ vocabId: v.id, direction: 'fa-de', correct: true, sessionId: 's', kind: 'relearn', now: T0 + 60_000 });
    const s = (await db.states.get(first.id))!;
    expect(s).toMatchObject({ total: 1, incorrect: 1, stability: first.stability, due: first.due });
    expect(await db.reviews.count()).toBe(2);
    expect(await db.days.get(dayKey(T0))).toMatchObject({ reviews: 1, relearn: 1 });
  });

  it('estimated memory strength decays over time', async () => {
    const v = await word();
    const s = (await recordAnswer({ vocabId: v.id, direction: 'fa-de', correct: true, sessionId: 's', now: T0 }))!;
    const r1 = retrievability(s, T0 + 86_400_000)!;
    const r30 = retrievability(s, T0 + 30 * 86_400_000)!;
    expect(r1).toBeGreaterThan(r30);
    expect(r1).toBeLessThanOrEqual(1);
    expect(retrievability(undefined, T0)).toBeNull();
  });
});

describe('Error rates and problem words', () => {
  it('computes error rate and streaks', async () => {
    const v = await word();
    await answers(v.id, '0010011');
    const s = (await db.states.get(stateId(v.id, 'fa-de')))!;
    expect(s).toMatchObject({ total: 7, correct: 3, incorrect: 4, curCorrect: 2, curIncorrect: 0, maxIncorrect: 2 });
    expect(errorRate(s)).toBeCloseTo(4 / 7);
  });

  it('a single mistake does not make a problem word', async () => {
    const v = await word();
    await answers(v.id, '0');
    expect((await db.vocab.get(v.id))?.problem).toBe(0);
    const { problems, watch } = await loadProblemRows();
    expect(problems).toHaveLength(0);
    expect(watch).toHaveLength(1);
    expect(watch[0].enoughData).toBe(false);
  });

  it('repeated mistakes are detected and cleared after recovery', async () => {
    const v = await word();
    const t = await answers(v.id, '00');
    expect((await db.vocab.get(v.id))?.problem).toBe(1);
    await answers(v.id, '1111111', { start: t });
    expect((await db.vocab.get(v.id))?.problem).toBe(0);
  });

  it('isProblem: individual rules', () => {
    const c = (recent: string) => {
      const total = recent.length; const incorrect = [...recent].filter((x) => x === '0').length;
      const cur = (ch: string) => recent.length - recent.replace(new RegExp(`${ch}+$`), '').length;
      return { total, incorrect, recent, curCorrect: cur('1'), curIncorrect: cur('0') };
    };
    expect(isProblem(c('1'))).toBe(false);
    expect(isProblem(c('10'))).toBe(false);
    expect(isProblem(c('100'))).toBe(true); // two mistakes in a row
    expect(isProblem(c('010101'))).toBe(true); // 3 of 6
    expect(isProblem(c('00111'))).toBe(false); // recovered: 3 correct in a row, only 2 mistakes in the window
    expect(isProblem(c('1111111111'))).toBe(false);
  });

  it('ranking prefers solid data over tiny samples', async () => {
    const lucky = await word('رفتن', 'gehen');
    const hard = await word('آمدن', 'kommen');
    await answers(lucky.id, '00'); // 2 of 2 = 100 %
    await answers(hard.id, '001001001000'); // 8 of 12 = 67 %
    expect(wilsonLower(8, 12)).toBeGreaterThan(wilsonLower(2, 2));
    const { problems } = await loadProblemRows();
    expect(sortProblems(problems, 'rate')[0].vocab.id).toBe(hard.id);
    expect(sortProblems(problems, 'errors')[0].vocab.id).toBe(hard.id);
    expect(sortProblems(problems, 'recent')[0].vocab.id).toBe(hard.id);
  });

  it('statusOf for items without history', () => {
    expect(statusOf(undefined)).toBe('neu');
  });
});

describe('Statistics and calendar days', () => {
  it('overview with no items is zero everywhere', async () => {
    const o = await loadOverview('fa-de', T0);
    expect(o).toMatchObject({ vocabCount: 0, dueToday: 0, newAvailable: 0, problemCount: 0, streaks: { current: 0, longest: 0 } });
  });

  it('updates the overview immediately after each answer', async () => {
    const a = await word();
    await word('رفتن', 'gehen');
    let o = await loadOverview('fa-de', T0);
    expect(o).toMatchObject({ vocabCount: 2, newAvailable: 2 });
    await recordAnswer({ vocabId: a.id, direction: 'fa-de', correct: false, sessionId: 's', now: T0 });
    o = await loadOverview('fa-de', T0);
    expect(o.today).toMatchObject({ reviews: 1, incorrect: 1 });
    expect(o.newAvailable).toBe(1);
    expect(o.dueTomorrow).toBe(1);
    expect(o.status.unsicher).toBe(1);
    expect(o.status.neu).toBe(1);
    expect(o.streaks.current).toBe(1);
    const tomorrow = addDays(T0, 1) + 8 * 3_600_000;
    expect((await loadOverview('fa-de', tomorrow)).dueToday).toBe(1);
    expect((await loadForecast(7, T0))[1].count).toBe(1);
  });

  it('assigns answers around midnight to the correct local day', async () => {
    const v = await word();
    const late = new Date(2026, 2, 14, 23, 59, 30).getTime();
    const early = new Date(2026, 2, 15, 0, 0, 30).getTime();
    await recordAnswer({ vocabId: v.id, direction: 'fa-de', correct: true, sessionId: 's', now: late });
    await recordAnswer({ vocabId: v.id, direction: 'de-fa', correct: true, sessionId: 's', now: early });
    expect((await db.days.get('2026-03-14'))?.reviews).toBe(1);
    expect((await db.days.get('2026-03-15'))?.reviews).toBe(1);
  });

  it('day boundaries: DST and month change', () => {
    const d = new Date(2026, 2, 28, 12).getTime(); // European DST change on 29 March 2026
    expect(dayKey(addDays(d, 1))).toBe('2026-03-29');
    expect(dayKey(addDays(d, 2))).toBe('2026-03-30');
    expect(dayKey(addDays(new Date(2026, 0, 31).getTime(), 1))).toBe('2026-02-01');
    expect(endOfDay(d) + 1).toBe(addDays(d, 1));
    expect(startOfDay(d)).toBeLessThanOrEqual(d);
  });

  it('computes streaks across gaps and month boundaries', () => {
    const now = new Date(2026, 1, 2, 9).getTime();
    expect(computeStreaks(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'], now)).toEqual({ current: 4, longest: 4 });
    expect(computeStreaks(['2026-01-20', '2026-01-21', '2026-01-22', '2026-02-01'], now)).toEqual({ current: 1, longest: 3 });
    expect(computeStreaks(['2026-01-20'], now)).toEqual({ current: 0, longest: 1 });
    expect(computeStreaks([], now)).toEqual({ current: 0, longest: 0 });
  });

  it('lesson stats sum the answers of their items', async () => {
    const l = await addLesson('Verben');
    const v = await word('آمدن', 'kommen', { lessonId: l.id });
    await word('رفتن', 'gehen', { lessonId: l.id });
    await answers(v.id, '0011');
    const s = (await loadLessonStats()).find((x) => x.lesson?.id === l.id)!;
    expect(s).toMatchObject({ total: 2, reviews: 4, correct: 2, incorrect: 2, started: 1 });
    expect((await db.lessons.get(l.id))?.lastPracticedAt).toBeGreaterThan(0);
  });
});
