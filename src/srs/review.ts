import { db, stateId, type AppDB } from '../db/db';
import { dayKey } from '../lib/dates';
import { newId } from '../lib/persian';
import { STATUS_ORDER, type DayStats, type Direction, type ReviewKind, type SchedState, type Status } from '../types';
import { isProblem, statusOf, vocabStatus } from './metrics';
import { retrievability, schedule } from './scheduler';

export const emptyDay = (day: string): DayStats => ({ day, reviews: 0, correct: 0, incorrect: 0, newCards: 0, relearn: 0, snapshot: null });

export async function statusCounts(database: AppDB = db): Promise<Record<Status, number>> {
  const counts = await Promise.all(STATUS_ORDER.map((s) => database.vocab.where('status').equals(s).count()));
  return Object.fromEntries(STATUS_ORDER.map((s, i) => [s, counts[i]])) as Record<Status, number>;
}

/** Advance the counters (pure function – also used when recomputing from history). */
export function applyCounters(prev: SchedState | undefined, correct: boolean, now: number) {
  const total = (prev?.total ?? 0) + 1;
  const curCorrect = correct ? (prev?.curCorrect ?? 0) + 1 : 0;
  const curIncorrect = correct ? 0 : (prev?.curIncorrect ?? 0) + 1;
  return {
    total,
    correct: (prev?.correct ?? 0) + (correct ? 1 : 0),
    incorrect: (prev?.incorrect ?? 0) + (correct ? 0 : 1),
    curCorrect,
    curIncorrect,
    maxIncorrect: Math.max(prev?.maxIncorrect ?? 0, curIncorrect),
    lastIncorrectAt: correct ? prev?.lastIncorrectAt ?? 0 : now,
    firstReviewAt: prev?.firstReviewAt || now,
    recent: ((prev?.recent ?? '') + (correct ? '1' : '0')).slice(-10),
  };
}

export interface AnswerInput {
  vocabId: string;
  direction: Direction;
  correct: boolean;
  sessionId: string;
  kind?: ReviewKind;
  now?: number;
}

/**
 * Stores one answer atomically: event, scheduling state, vocabulary cache, daily stats, session.
 * kind 'relearn' (a repeat within the same session) is logged but changes neither FSRS
 * nor the error rate – otherwise the same mistake would be penalised several times.
 */
export async function recordAnswer(input: AnswerInput, database: AppDB = db): Promise<SchedState | null> {
  const now = input.now ?? Date.now();
  const kind = input.kind ?? 'scheduled';
  const d = database;
  return d.transaction('rw', [d.vocab, d.states, d.reviews, d.days, d.sessions, d.lessons], async () => {
    const v = await d.vocab.get(input.vocabId);
    if (!v) return null;
    const id = stateId(input.vocabId, input.direction);
    const prev = await d.states.get(id);
    const day = dayKey(now);
    const dayRow = (await d.days.get(day)) ?? emptyDay(day);
    const base = { id: newId(), vocabId: v.id, direction: input.direction, ts: now, day, correct: input.correct, sessionId: input.sessionId };

    if (kind === 'relearn') {
      await d.reviews.add({ ...base, kind, meta: null });
      dayRow.relearn++;
      await d.days.put(dayRow);
      return prev ?? null;
    }

    const wasNew = !prev || prev.total === 0;
    const sched = schedule(prev, input.correct, v.priority, now);
    const next: SchedState = {
      id, vocabId: v.id, direction: input.direction,
      ...sched,
      ...applyCounters(prev, input.correct, now),
      status: 'neu', problem: 0,
    };
    next.problem = isProblem(next) ? 1 : 0;
    next.status = statusOf(next);
    await d.states.put(next);

    await d.reviews.add({
      ...base, kind,
      meta: {
        priority: v.priority,
        wasNew,
        retrievability: retrievability(prev, now),
        stabilityBefore: prev?.stability ?? 0,
        stabilityAfter: next.stability,
        difficultyAfter: next.difficulty,
        intervalDays: next.scheduledDays,
        dueAfter: next.due,
      },
    });

    const other = await d.states.get(stateId(v.id, input.direction === 'fa-de' ? 'de-fa' : 'fa-de'));
    await d.vocab.update(v.id, {
      lastReviewAt: now,
      status: vocabStatus([next, other]),
      problem: next.problem || other?.problem ? 1 : 0,
    });
    if (v.lessonId) await d.lessons.update(v.lessonId, { lastPracticedAt: now });

    dayRow.reviews++;
    if (input.correct) dayRow.correct++; else dayRow.incorrect++;
    if (wasNew) dayRow.newCards++;
    dayRow.snapshot = await statusCounts(d);
    await d.days.put(dayRow);

    const session = await d.sessions.get(input.sessionId);
    if (session) {
      await d.sessions.update(session.id, {
        answered: session.answered + 1,
        correct: session.correct + (input.correct ? 1 : 0),
        incorrect: session.incorrect + (input.correct ? 0 : 1),
        endedAt: now,
      });
    }
    return next;
  });
}

/** Recompute an item's cached fields from its scheduling states. */
export async function refreshVocabCache(vocabId: string, database: AppDB = db): Promise<void> {
  const states = await database.states.where('vocabId').equals(vocabId).toArray();
  await database.vocab.update(vocabId, {
    status: vocabStatus(states),
    problem: states.some((s) => s.problem) ? 1 : 0,
    lastReviewAt: Math.max(0, ...states.map((s) => s.lastReview)),
  });
}
