import type { SchedState, Status } from '../types';

/** Below this number of scheduled answers the error rate is not considered meaningful. */
export const MIN_REVIEWS = 4;
export const STABLE_GOOD_DAYS = 7;
export const STABLE_MASTERED_DAYS = 30;

type Counters = Pick<SchedState, 'total' | 'incorrect' | 'curCorrect' | 'curIncorrect' | 'recent'>;

/**
 * Problem word (per direction) if ANY of these holds:
 *  1. two or more mistakes in a row (currently),
 *  2. at least 4 answers and 3+ mistakes among the last 6,
 *  3. at least 5 answers, error rate ≥ 40 % and not yet 3 correct in a row.
 * A single mistake with few answers is deliberately not enough.
 */
export function isProblem(s: Counters): boolean {
  if (s.curIncorrect >= 2) return true;
  const recentWrong = [...s.recent.slice(-6)].filter((c) => c === '0').length;
  if (s.total >= MIN_REVIEWS && recentWrong >= 3) return true;
  if (s.total >= MIN_REVIEWS + 1 && s.incorrect / s.total >= 0.4 && s.curCorrect < 3) return true;
  return false;
}

export const hasEnoughData = (s: Pick<SchedState, 'total'>) => s.total >= MIN_REVIEWS;

export const errorRate = (s: Pick<SchedState, 'total' | 'incorrect'>) => (s.total ? s.incorrect / s.total : 0);

/**
 * Lower Wilson bound (90 %) of the error rate – used for sorting so that "1 of 1 wrong"
 * does not rank above "8 of 12 wrong".
 */
export function wilsonLower(incorrect: number, total: number, z = 1.645): number {
  if (!total) return 0;
  const p = incorrect / total;
  const z2 = z * z;
  const centre = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return Math.max(0, (centre - margin) / (1 + z2 / total));
}

/**
 * Learning status of one direction:
 *  neu (new)                 – never answered in a scheduled review
 *  unsicher (shaky)          – problem word OR last answer incorrect
 *  bearbeitung (in progress) – stability < 7 days
 *  gut (well learned)       – stability ≥ 7 days
 *  sicher (mastered)         – stability ≥ 30 days AND at least 3 correct answers in a row
 * (stability = FSRS estimate of how many days until retrievability drops to 90 %.)
 */
export function statusOf(s: Pick<SchedState, 'total' | 'stability' | 'curCorrect' | 'curIncorrect' | 'problem'> | undefined): Status {
  if (!s || s.total === 0) return 'neu';
  if (s.problem || s.curIncorrect >= 1) return 'unsicher';
  if (s.stability >= STABLE_MASTERED_DAYS && s.curCorrect >= 3) return 'sicher';
  if (s.stability >= STABLE_GOOD_DAYS) return 'gut';
  return 'bearbeitung';
}

const RANK: Record<Status, number> = { neu: -1, unsicher: 0, bearbeitung: 1, gut: 2, sicher: 3 };

/** Card status = weakest of the directions already practised; "neu" if none has been practised. */
export function cardStatus(states: (SchedState | undefined)[]): Status {
  const practiced = states.filter((s): s is SchedState => !!s && s.total > 0);
  if (!practiced.length) return 'neu';
  return practiced.map((s) => s.status).sort((a, b) => RANK[a] - RANK[b])[0];
}
