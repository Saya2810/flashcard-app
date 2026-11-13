import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type FSRS, type State } from 'ts-fsrs';
import { addDays, DAY_MS } from '../lib/dates';
import type { SchedLike } from '../types';

/**
 * Long-term scheduling with FSRS (ts-fsrs library, default parameters).
 *
 * Mapping of the two-button rating:
 *   Richtig (correct) → FSRS "Good"      Falsch (incorrect) → FSRS "Again"
 * "Hard" and "Easy" are never given. As a result, difficulty D falls only slowly towards
 * the mean on correct answers and rises noticeably on every mistake.
 *
 * FSRS's own minute-level learning steps are disabled (enable_short_term: false):
 * short-term relearning is handled by the session queue (src/srs/queue.ts).
 * FSRS sees exactly ONE rating per card and session – the first, unprepared answer.
 *
 * Priority does not change the memory state but the target retrievability:
 * important words are reviewed before they have faded as far as unimportant ones.
 */
export const RETENTION_BY_PRIORITY: Record<number, number> = { 1: 0.8, 2: 0.85, 3: 0.9, 4: 0.93, 5: 0.95 };
export const MAX_INTERVAL_DAYS = 365;

const engines = new Map<number, FSRS>();
function engine(priority: number): FSRS {
  const p = RETENTION_BY_PRIORITY[priority] ? priority : 3;
  let e = engines.get(p);
  if (!e) {
    e = fsrs(generatorParameters({
      request_retention: RETENTION_BY_PRIORITY[p],
      maximum_interval: MAX_INTERVAL_DAYS,
      enable_fuzz: false,
      enable_short_term: false,
    }));
    engines.set(p, e);
  }
  return e;
}

function toCard(s: SchedLike | undefined, now: number): Card {
  if (!s || s.reps === 0) return createEmptyCard(new Date(now));
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: 0,
    scheduled_days: s.scheduledDays,
    learning_steps: 0,
    reps: s.reps,
    lapses: s.lapses,
    state: s.fsrsState as State,
    last_review: new Date(s.lastReview),
  };
}

export interface ScheduleResult {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  fsrsState: number;
  scheduledDays: number;
  due: number;
  lastReview: number;
}

export function schedule(s: SchedLike | undefined, correct: boolean, priority: number, now: number): ScheduleResult {
  const { card } = engine(priority).next(toCard(s, now), new Date(now), correct ? Rating.Good : Rating.Again);
  const days = Math.max(1, Math.round(card.scheduled_days));
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    fsrsState: card.state,
    scheduledDays: days,
    // Snap the due date to the start of a local calendar day: "due on day X" applies from the morning.
    due: addDays(now, days),
    lastReview: now,
  };
}

/** Estimated retrievability (0–1) right now; null if never studied. */
export function retrievability(s: SchedLike | undefined, now: number): number | null {
  if (!s || s.reps === 0 || !s.stability) return null;
  const elapsed = Math.max(0, (now - s.lastReview) / DAY_MS);
  return engine(3).forgetting_curve(elapsed, s.stability);
}

/** New due date after a priority change (memory state stays unchanged). */
export function dueForPriority(s: SchedLike, priority: number): { due: number; scheduledDays: number } {
  if (s.reps === 0 || s.curIncorrect > 0) return { due: s.due, scheduledDays: s.scheduledDays };
  const days = Math.max(1, engine(priority).next_interval(s.stability, 0));
  return { due: addDays(s.lastReview, days), scheduledDays: days };
}
