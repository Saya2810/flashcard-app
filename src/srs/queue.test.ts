import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { buildVocab } from '../db/repo';
import { addDays } from '../lib/dates';
import { answers, resetDb, word } from '../test/helpers';
import type { SchedState, SessionConfig, Vocab } from '../types';
import { buildQueue, interleave, MAX_RELEARN, RELEARN_GAP, requeueWrong, type QueueContext, type QueueItem } from './queue';

beforeEach(resetDb);
const T0 = new Date(2026, 0, 10, 10, 0).getTime();
const cfg = (p: Partial<SessionConfig> = {}): SessionConfig => ({ mode: 'smart', direction: 'fa-de', lessonIds: [], priorities: [], size: 20, ...p });
const ctx = (now: number, p: Partial<QueueContext['settings']> = {}, done = { n: 0, r: 0 }): QueueContext => ({
  now, settings: { newPerDay: 10, maxReviewsPerDay: 100, autoIncludeProblems: true, ...p }, newDoneToday: done.n, reviewsDoneToday: done.r,
});
const load = async () => [await db.vocab.toArray(), await db.states.toArray()] as [Vocab[], SchedState[]];
const item = (id: string, attempts = 0): QueueItem => ({ vocabId: id, direction: 'fa-de', isNew: false, relearn: attempts > 0, attempts });

describe('Re-queueing wrong cards within a session', () => {
  it('re-inserts the card after several others, never immediately', () => {
    const rest = ['b', 'c', 'd', 'e', 'f', 'g'].map((x) => item(x));
    const q = requeueWrong(rest, item('a'));
    expect(q.map((x) => x.vocabId)).toEqual(['b', 'c', 'd', 'e', 'a', 'f', 'g']);
    expect(q[RELEARN_GAP]).toMatchObject({ vocabId: 'a', relearn: true, attempts: 1 });
  });
  it('appends it to the end when fewer cards are left', () => {
    expect(requeueWrong([item('b')], item('a')).map((x) => x.vocabId)).toEqual(['b', 'a']);
  });
  it('does not repeat a word endlessly: per-session cap', () => {
    const rest = [item('b')];
    expect(requeueWrong(rest, item('a', MAX_RELEARN))).toEqual(rest);
  });
  it('the last remaining card comes back directly at most once', () => {
    expect(requeueWrong([], item('a'))).toHaveLength(1);
    expect(requeueWrong([], item('a', 1))).toHaveLength(0);
  });
});

describe('Session building', () => {
  it('every mode yields an empty session without items', () => {
    for (const mode of ['smart', 'problem', 'new', 'lesson', 'exam', 'free'] as const) {
      expect(buildQueue(cfg({ mode }), [], [], ctx(T0))).toEqual([]);
    }
  });

  it('interleave spreads evenly and loses nothing', () => {
    expect(interleave([1, 2, 3, 4, 5, 6], [9, 8])).toEqual([1, 2, 3, 9, 4, 5, 6, 8]);
    expect(interleave([], [1])).toEqual([1]);
    expect(interleave([1], [])).toEqual([1]);
  });

  it('smart mode: due cards first by urgency, new cards capped', async () => {
    const weak = await word('آمدن', 'kommen');
    const strong = await word('رفتن', 'gehen');
    const notDue = await word('ماندن', 'bleiben');
    for (let i = 0; i < 15; i++) await word(`نو${i}`, `neu${i}`);
    await answers(weak.id, '0', { start: T0 });
    await answers(strong.id, '11', { start: T0, gapDays: 3 });
    const later = addDays(T0, 40) + 3_600_000;
    await answers(notDue.id, '1', { start: later - 3_600_000 });
    const q = buildQueue(cfg({ size: 10 }), ...(await load()), ctx(later, { newPerDay: 4 }));
    const reviews = q.filter((x) => !x.isNew).map((x) => x.vocabId);
    expect(reviews).toEqual([weak.id, strong.id]);
    expect(q.filter((x) => x.isNew)).toHaveLength(4);
    expect(q.some((x) => x.vocabId === notDue.id)).toBe(false);
  });

  it('respects new cards already studied today and the review limit', async () => {
    for (let i = 0; i < 10; i++) await word(`نو${i}`, `neu${i}`);
    expect(buildQueue(cfg(), ...(await load()), ctx(T0, { newPerDay: 5 }, { n: 5, r: 0 }))).toHaveLength(0);
    expect(buildQueue(cfg(), ...(await load()), ctx(T0, { newPerDay: 5 }, { n: 2, r: 0 }))).toHaveLength(3);
  });

  it('problem words get extra practice without starving due cards', async () => {
    const due: string[] = [];
    for (let i = 0; i < 12; i++) { const v = await word(`ف${i}`, `fällig${i}`); await answers(v.id, '1', { start: T0 }); due.push(v.id); }
    const problems: string[] = [];
    const now = addDays(T0, 20) + 2 * 3_600_000;
    for (let i = 0; i < 8; i++) { const v = await word(`م${i}`, `problem${i}`); await answers(v.id, '00', { start: now - 3_600_000, gapDays: 0.01 }); problems.push(v.id); }
    // The problem cards were already practised today and are due tomorrow → they count as extras.
    const q = buildQueue(cfg({ size: 10 }), ...(await load()), ctx(now));
    const nProblem = q.filter((x) => problems.includes(x.vocabId)).length;
    const nDue = q.filter((x) => due.includes(x.vocabId)).length;
    expect(nProblem).toBeGreaterThan(0);
    expect(nProblem).toBeLessThanOrEqual(2);
    expect(nDue).toBeGreaterThanOrEqual(8);
    const off = buildQueue(cfg({ size: 10 }), ...(await load()), ctx(now, { autoIncludeProblems: false }));
    expect(off.filter((x) => problems.includes(x.vocabId))).toHaveLength(0);
  });

  it('with equal forgetting, high priority comes first', async () => {
    const low = await word('آب', 'Wasser', { priority: 1 });
    const high = await word('نان', 'Brot', { priority: 5 });
    const [vocab] = await load();
    const mk = (v: Vocab): SchedState => ({ id: `${v.id}|fa-de`, vocabId: v.id, direction: 'fa-de', due: T0, stability: 5, difficulty: 5, reps: 2, lapses: 0, fsrsState: 2, lastReview: T0 - 5 * 86_400_000, scheduledDays: 5, total: 2, correct: 2, incorrect: 0, curCorrect: 2, curIncorrect: 0, maxIncorrect: 0, lastIncorrectAt: 0, firstReviewAt: 1, recent: '11', status: 'bearbeitung', problem: 0 });
    const q = buildQueue(cfg(), vocab, [mk(low), mk(high)], ctx(T0));
    expect(q.map((x) => x.vocabId)).toEqual([high.id, low.id]);
  });

  it('"new words" mode depends on the chosen direction', async () => {
    const v = await word();
    await answers(v.id, '1', { direction: 'fa-de' });
    expect(buildQueue(cfg({ mode: 'new', direction: 'fa-de' }), ...(await load()), ctx(T0))).toHaveLength(0);
    const q = buildQueue(cfg({ mode: 'new', direction: 'de-fa' }), ...(await load()), ctx(T0));
    expect(q).toEqual([{ vocabId: v.id, direction: 'de-fa', isNew: true, relearn: false, attempts: 0 }]);
  });

  it('mixed direction shows each item at most once per session', async () => {
    for (let i = 0; i < 6; i++) await word(`و${i}`, `wort${i}`);
    const q = buildQueue(cfg({ mode: 'lesson', direction: 'mixed', size: 50 }), ...(await load()), ctx(T0));
    expect(q).toHaveLength(6);
    expect(new Set(q.map((x) => x.vocabId)).size).toBe(6);
  });

  it('lesson and priority filter the selection (exam prep)', async () => {
    await word('آب', 'Wasser', { lessonId: 'L1', priority: 5 });
    await word('نان', 'Brot', { lessonId: 'L1', priority: 2 });
    await word('کتاب', 'Buch', { lessonId: 'L2', priority: 5 });
    const [vocab, states] = await load();
    expect(buildQueue(cfg({ mode: 'exam', lessonIds: ['L1'] }), vocab, states, ctx(T0))).toHaveLength(2);
    expect(buildQueue(cfg({ mode: 'exam', lessonIds: ['L1'], priorities: [5] }), vocab, states, ctx(T0))).toHaveLength(1);
    expect(buildQueue(cfg({ mode: 'exam', size: 2 }), vocab, states, ctx(T0))).toHaveLength(2);
  });

  it('problem mode contains only detected problem words or the explicit selection', async () => {
    const bad = await word('آمدن', 'kommen');
    const ok = await word('رفتن', 'gehen');
    await answers(bad.id, '00');
    await answers(ok.id, '01');
    const [vocab, states] = await load();
    expect(buildQueue(cfg({ mode: 'problem', direction: 'mixed' }), vocab, states, ctx(T0)).map((x) => x.vocabId)).toEqual([bad.id]);
    expect(buildQueue(cfg({ mode: 'problem', direction: 'mixed', vocabIds: [ok.id] }), vocab, states, ctx(T0)).map((x) => x.vocabId)).toEqual([ok.id]);
  });

  it('stays fast with 5000 items', async () => {
    const vocab = Array.from({ length: 5000 }, (_, i) => buildVocab({ persian: `واژه${i}`, german: `Wort ${i}`, priority: (i % 5) + 1 }, T0 + i));
    await db.vocab.bulkAdd(vocab);
    expect(await db.vocab.count()).toBe(5000);
    const t = performance.now();
    const q = buildQueue(cfg({ mode: 'lesson', direction: 'mixed', size: 50 }), vocab, [], ctx(T0));
    expect(performance.now() - t).toBeLessThan(2000);
    expect(q).toHaveLength(50);
    expect(q[0].isNew).toBe(true);
  });
});
