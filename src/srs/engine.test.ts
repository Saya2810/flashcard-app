import { beforeEach, describe, expect, it } from 'vitest';
import { db, stateId } from '../db/db';
import { addCard, addDeck, addLesson, deleteCards, deleteDeck, deleteLesson, findDuplicates, moveCards, setPriority, updateCard, updateDeck, ValidationError } from '../db/repo';
import { addDays, dayKey, endOfDay, startOfDay } from '../lib/dates';
import { computeStreaks, loadDeckStats, loadForecast, loadOverview, loadProblemRows, sortProblems } from '../stats/stats';
import { answers, card as word, deck, resetDb } from '../test/helpers';
import { errorRate, isProblem, statusOf, wilsonLower } from './metrics';
import { recordAnswer } from './review';
import { retrievability, schedule } from './scheduler';

beforeEach(resetDb);
const T0 = new Date(2026, 0, 10, 10, 0).getTime();

describe('Decks, lessons and cards', () => {
  it('creates cards with multiple answers, custom fields and defaults', async () => {
    const d = await deck({ fields: [{ key: 'umschrift', label: 'Umschrift', dir: 'ltr', font: 'system' }] });
    const c = await addCard({ deckId: d.id, front: ' آمدن ', back: 'kommen', altBack: ['ankommen', 'kommen', ''], tags: ['Verb', 'Verb'], fields: { umschrift: 'âmadan', leer: ' ' }, priority: 5 });
    const saved = await db.cards.get(c.id);
    expect(saved).toMatchObject({ front: 'آمدن', altBack: ['ankommen'], tags: ['Verb'], fields: { umschrift: 'âmadan' }, status: 'neu', priority: 5, deckId: d.id });
  });

  it('rejects empty required fields and missing deck', async () => {
    const d = await deck();
    await expect(addCard({ deckId: d.id, front: '', back: 'x' })).rejects.toBeInstanceOf(ValidationError);
    await expect(addCard({ deckId: d.id, front: 'a', back: '  ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(addCard({ deckId: '', front: 'a', back: 'b' })).rejects.toBeInstanceOf(ValidationError);
    await expect(addDeck({ name: ' ' })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.cards.count()).toBe(0);
  });

  it('prevents duplicate deck names and renames decks', async () => {
    const a = await addDeck({ name: 'Physik' });
    await expect(addDeck({ name: 'Physik' })).rejects.toBeInstanceOf(ValidationError);
    const b = await addDeck({ name: 'Chemie' });
    await expect(updateDeck(b.id, { name: 'Physik' })).rejects.toBeInstanceOf(ValidationError);
    await updateDeck(a.id, { name: 'Physik I', reverse: true });
    expect(await db.decks.get(a.id)).toMatchObject({ name: 'Physik I', reverse: true });
  });

  it('edits cards without losing progress, also when moving to another deck', async () => {
    const v = await word();
    await answers(v.id, '11');
    const other = await deck();
    await updateCard(v.id, { deckId: other.id, front: 'آمدن', back: 'kommen (her)', priority: 3 });
    expect(await db.cards.get(v.id)).toMatchObject({ back: 'kommen (her)', deckId: other.id });
    expect(await db.states.get(stateId(v.id, 'fwd'))).toMatchObject({ total: 2, deckId: other.id });
    expect((await db.reviews.where('cardId').equals(v.id).toArray()).every((r) => r.deckId === other.id)).toBe(true);
  });

  it('deletes cards with states and history', async () => {
    const v = await word();
    const keep = await word('رفتن', 'gehen', { deckId: v.deckId });
    await answers(v.id, '10');
    await answers(keep.id, '1');
    await deleteCards([v.id]);
    expect(await db.cards.count()).toBe(1);
    expect(await db.states.where('cardId').equals(v.id).count()).toBe(0);
    expect(await db.reviews.where('cardId').equals(v.id).count()).toBe(0);
    expect(await db.reviews.where('cardId').equals(keep.id).count()).toBe(1);
  });

  it('deleting a deck removes its lessons, cards and history only', async () => {
    const a = await word();
    const b = await word('x', 'y');
    await addLesson(a.deckId, 'L1');
    await answers(a.id, '1');
    await answers(b.id, '1');
    await deleteDeck(a.deckId);
    expect(await db.decks.get(a.deckId)).toBeUndefined();
    expect(await db.lessons.count()).toBe(0);
    expect(await db.cards.toCollection().primaryKeys()).toEqual([b.id]);
    expect(await db.reviews.count()).toBe(1);
  });

  it('lessons are unique per deck; cards can be assigned and moved', async () => {
    const d1 = await deck();
    const d2 = await deck();
    const a = await addLesson(d1.id, 'Kapitel 1');
    await expect(addLesson(d1.id, 'Kapitel 1')).rejects.toBeInstanceOf(ValidationError);
    const b = await addLesson(d2.id, 'Kapitel 1');
    const v = await word('a', 'b', { deckId: d1.id, lessonId: a.id });
    expect((await db.cards.get(v.id))?.lessonId).toBe(a.id);
    await moveCards([v.id], { deckId: d2.id, lessonId: b.id });
    expect(await db.cards.get(v.id)).toMatchObject({ deckId: d2.id, lessonId: b.id });
  });

  it('deletes a lesson WITHOUT its cards by default', async () => {
    const d = await deck();
    const a = await addLesson(d.id, 'Alltag');
    const v = await word('نان', 'Brot', { deckId: d.id, lessonId: a.id });
    await deleteLesson(a.id);
    expect(await db.lessons.count()).toBe(0);
    expect((await db.cards.get(v.id))?.lessonId).toBe('');
  });

  it('deletes a lesson\'s cards only when explicitly requested', async () => {
    const d = await deck();
    const a = await addLesson(d.id, 'Alltag');
    await word('نان', 'Brot', { deckId: d.id, lessonId: a.id });
    await deleteLesson(a.id, true);
    expect(await db.cards.count()).toBe(0);
  });

  it('empty decks and lessons produce stats without division by zero', async () => {
    const d = await deck();
    await addLesson(d.id, 'Leer');
    const [s] = await loadDeckStats();
    expect(s).toMatchObject({ total: 0, progress: 0 });
    expect(s.lessons[0]).toMatchObject({ total: 0, progress: 0 });
  });

  it('detects duplicates within a deck across Arabic letter variants', async () => {
    const v = await word('کتاب', 'Buch');
    expect((await findDuplicates(v.deckId, 'كتاب', 'buch')).exact).toHaveLength(1);
    const other = await findDuplicates(v.deckId, 'کتاب', 'Heft');
    expect(other.exact).toHaveLength(0);
    expect(other.sameFront).toHaveLength(1);
    const elsewhere = await deck();
    expect((await findDuplicates(elsewhere.id, 'کتاب', 'Buch')).exact).toHaveLength(0);
  });
});

describe('Answers and scheduling (FSRS)', () => {
  it('stores a correct answer with event, state and daily stats', async () => {
    const v = await word();
    const s = await recordAnswer({ cardId: v.id, direction: 'fwd', correct: true, sessionId: 's1', now: T0 });
    expect(s).toMatchObject({ total: 1, correct: 1, incorrect: 0, curCorrect: 1, recent: '1' });
    const [e] = await db.reviews.toArray();
    expect(e).toMatchObject({ cardId: v.id, direction: 'fwd', correct: true, sessionId: 's1', ts: T0, day: dayKey(T0), kind: 'scheduled' });
    expect(e.meta?.wasNew).toBe(true);
    expect(e.meta?.intervalDays).toBeGreaterThanOrEqual(1);
    expect(await db.days.get(dayKey(T0))).toMatchObject({ reviews: 1, correct: 1, incorrect: 0, newCards: 1 });
    expect((await db.cards.get(v.id))?.lastReviewAt).toBe(T0);
  });

  it('stores an incorrect answer and schedules it for the next day', async () => {
    const v = await word();
    const s = await recordAnswer({ cardId: v.id, direction: 'fwd', correct: false, sessionId: 's1', now: T0 });
    expect(s).toMatchObject({ total: 1, incorrect: 1, curIncorrect: 1, maxIncorrect: 1, lastIncorrectAt: T0, status: 'unsicher' });
    expect(s!.due).toBe(addDays(T0, 1));
  });

  it('grows the interval on correct answers and shrinks it after a mistake', async () => {
    const v = await word();
    const intervals: number[] = [];
    let t = T0;
    for (let i = 0; i < 4; i++) {
      const s = (await recordAnswer({ cardId: v.id, direction: 'fwd', correct: true, sessionId: 's', now: t }))!;
      intervals.push(s.scheduledDays);
      t = s.due + 10 * 3_600_000;
    }
    expect(intervals[1]).toBeGreaterThan(intervals[0]);
    expect(intervals[3]).toBeGreaterThan(intervals[2]);
    const before = (await db.states.get(stateId(v.id, 'fwd')))!;
    const after = (await recordAnswer({ cardId: v.id, direction: 'fwd', correct: false, sessionId: 's', now: t }))!;
    expect(after.scheduledDays).toBeLessThan(intervals[3]);
    expect(after.stability).toBeLessThan(before.stability);
    expect(after.difficulty).toBeGreaterThan(before.difficulty);
    expect(after.lapses).toBe(1);
  });

  it('a single correct answer does not make a word "mastered"', async () => {
    const v = await word();
    await answers(v.id, '1');
    expect((await db.cards.get(v.id))?.status).toBe('bearbeitung');
  });

  it('reaches "mastered" only after long stability and several correct answers', async () => {
    const v = await word();
    let t = T0;
    let s;
    for (let i = 0; i < 8; i++) {
      s = (await recordAnswer({ cardId: v.id, direction: 'fwd', correct: true, sessionId: 's', now: t }))!;
      t = s.due + 3_600_000;
    }
    expect(s!.stability).toBeGreaterThanOrEqual(30);
    expect(s!.status).toBe('sicher');
  });

  it('keeps both directions completely separate', async () => {
    const v = await word();
    await answers(v.id, '111', { direction: 'fwd' });
    await answers(v.id, '00', { direction: 'rev' });
    const a = (await db.states.get(stateId(v.id, 'fwd')))!;
    const b = (await db.states.get(stateId(v.id, 'rev')))!;
    expect(a).toMatchObject({ total: 3, correct: 3, incorrect: 0, problem: 0 });
    expect(b).toMatchObject({ total: 2, correct: 0, incorrect: 2, problem: 1 });
    expect(a.stability).toBeGreaterThan(b.stability);
    // The item counts with its weaker direction.
    expect(await db.cards.get(v.id)).toMatchObject({ status: 'unsicher', problem: 1 });
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
    const before = (await db.states.get(stateId(v.id, 'fwd')))!;
    await setPriority(v.id, 5);
    const after = (await db.states.get(stateId(v.id, 'fwd')))!;
    expect(after.due).toBeLessThan(before.due);
    expect(after.stability).toBe(before.stability);
    expect(after.total).toBe(before.total);
    expect((await db.cards.get(v.id))?.priority).toBe(5);
  });

  it('in-session repeats change neither FSRS nor the error rate', async () => {
    const v = await word();
    const first = (await recordAnswer({ cardId: v.id, direction: 'fwd', correct: false, sessionId: 's', now: T0 }))!;
    await recordAnswer({ cardId: v.id, direction: 'fwd', correct: true, sessionId: 's', kind: 'relearn', now: T0 + 60_000 });
    const s = (await db.states.get(first.id))!;
    expect(s).toMatchObject({ total: 1, incorrect: 1, stability: first.stability, due: first.due });
    expect(await db.reviews.count()).toBe(2);
    expect(await db.days.get(dayKey(T0))).toMatchObject({ reviews: 1, relearn: 1 });
  });

  it('estimated memory strength decays over time', async () => {
    const v = await word();
    const s = (await recordAnswer({ cardId: v.id, direction: 'fwd', correct: true, sessionId: 's', now: T0 }))!;
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
    const s = (await db.states.get(stateId(v.id, 'fwd')))!;
    expect(s).toMatchObject({ total: 7, correct: 3, incorrect: 4, curCorrect: 2, curIncorrect: 0, maxIncorrect: 2 });
    expect(errorRate(s)).toBeCloseTo(4 / 7);
  });

  it('a single mistake does not make a problem word', async () => {
    const v = await word();
    await answers(v.id, '0');
    expect((await db.cards.get(v.id))?.problem).toBe(0);
    const { problems, watch } = await loadProblemRows();
    expect(problems).toHaveLength(0);
    expect(watch).toHaveLength(1);
    expect(watch[0].enoughData).toBe(false);
  });

  it('repeated mistakes are detected and cleared after recovery', async () => {
    const v = await word();
    const t = await answers(v.id, '00');
    expect((await db.cards.get(v.id))?.problem).toBe(1);
    await answers(v.id, '1111111', { start: t });
    expect((await db.cards.get(v.id))?.problem).toBe(0);
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
    expect(sortProblems(problems, 'rate')[0].card.id).toBe(hard.id);
    expect(sortProblems(problems, 'errors')[0].card.id).toBe(hard.id);
    expect(sortProblems(problems, 'recent')[0].card.id).toBe(hard.id);
  });

  it('statusOf for items without history', () => {
    expect(statusOf(undefined)).toBe('neu');
  });
});

describe('Statistics and calendar days', () => {
  it('overview with no items is zero everywhere', async () => {
    const o = await loadOverview('fwd', T0);
    expect(o).toMatchObject({ cardCount: 0, dueToday: 0, newAvailable: 0, problemCount: 0, streaks: { current: 0, longest: 0 } });
  });

  it('updates the overview immediately after each answer', async () => {
    const a = await word();
    await word('رفتن', 'gehen');
    let o = await loadOverview('fwd', T0);
    expect(o).toMatchObject({ cardCount: 2, newAvailable: 2 });
    await recordAnswer({ cardId: a.id, direction: 'fwd', correct: false, sessionId: 's', now: T0 });
    o = await loadOverview('fwd', T0);
    expect(o.today).toMatchObject({ reviews: 1, incorrect: 1 });
    expect(o.newAvailable).toBe(1);
    expect(o.dueTomorrow).toBe(1);
    expect(o.status.unsicher).toBe(1);
    expect(o.status.neu).toBe(1);
    expect(o.streaks.current).toBe(1);
    const tomorrow = addDays(T0, 1) + 8 * 3_600_000;
    expect((await loadOverview('fwd', tomorrow)).dueToday).toBe(1);
    expect((await loadForecast(7, T0))[1].count).toBe(1);
  });

  it('assigns answers around midnight to the correct local day', async () => {
    const v = await word();
    const late = new Date(2026, 2, 14, 23, 59, 30).getTime();
    const early = new Date(2026, 2, 15, 0, 0, 30).getTime();
    await recordAnswer({ cardId: v.id, direction: 'fwd', correct: true, sessionId: 's', now: late });
    await recordAnswer({ cardId: v.id, direction: 'rev', correct: true, sessionId: 's', now: early });
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

  it('deck and lesson stats sum the answers of their cards', async () => {
    const d = await deck();
    const l = await addLesson(d.id, 'Verben');
    const v = await word('آمدن', 'kommen', { deckId: d.id, lessonId: l.id });
    await word('رفتن', 'gehen', { deckId: d.id, lessonId: l.id });
    await word('ماندن', 'bleiben', { deckId: d.id });
    await answers(v.id, '0011');
    const s = (await loadDeckStats()).find((x) => x.deck.id === d.id)!;
    expect(s).toMatchObject({ total: 3, reviews: 4, correct: 2, incorrect: 2, started: 1 });
    expect(s.lessons.find((x) => x.lesson?.id === l.id)).toMatchObject({ total: 2, reviews: 4, started: 1 });
    expect(s.lessons.find((x) => !x.lesson)).toMatchObject({ total: 1, reviews: 0 });
    expect((await db.lessons.get(l.id))?.lastPracticedAt).toBeGreaterThan(0);
    expect((await db.decks.get(d.id))?.lastPracticedAt).toBeGreaterThan(0);
  });
});
