import { db, type AppDB } from '../db/db';
import { addDays, dayKey, endOfDay, keyToDate } from '../lib/dates';
import { emptyDay, statusCounts } from '../srs/review';
import { errorRate, hasEnoughData, wilsonLower } from '../srs/metrics';
import { retrievability } from '../srs/scheduler';
import type { DayStats, DirectionChoice, Lesson, SchedState, Status, Vocab } from '../types';

export interface Streaks { current: number; longest: number }

/** Streak = consecutive calendar days with at least one scheduled answer. */
export function computeStreaks(activeDays: string[], now: number): Streaks {
  const set = new Set(activeDays);
  let longest = 0;
  let run = 0;
  let prev = '';
  for (const k of [...set].sort()) {
    run = prev && dayKey(addDays(keyToDate(prev), 1)) === k ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = k;
  }
  // The current streak survives as long as the user studied today OR yesterday.
  let current = 0;
  let cursor = set.has(dayKey(now)) ? now : addDays(now, -1);
  while (set.has(dayKey(cursor))) { current++; cursor = addDays(cursor, -1); }
  return { current, longest };
}

export interface Overview {
  vocabCount: number;
  today: DayStats;
  dueToday: number;
  dueTomorrow: number;
  newAvailable: number;
  problemCount: number;
  streaks: Streaks;
  totals: { reviews: number; correct: number; incorrect: number };
  status: Record<Status, number>;
}

async function dueCount(d: AppDB, dir: DirectionChoice, from: number, to: number): Promise<number> {
  if (dir === 'mixed') return d.states.where('due').between(from, to, true, true).count();
  return d.states.where('[direction+due]').between([dir, from], [dir, to], true, true).count();
}

export async function loadOverview(direction: DirectionChoice, now = Date.now(), database: AppDB = db): Promise<Overview> {
  const d = database;
  const eod = endOfDay(now);
  const days = await d.days.toArray();
  const today = days.find((x) => x.day === dayKey(now)) ?? emptyDay(dayKey(now));
  const vocabCount = await d.vocab.count();
  const firstDir = direction === 'mixed' ? 'fa-de' : direction;
  const started = await d.states.where('direction').equals(firstDir).count();
  const totals = days.reduce((a, x) => ({ reviews: a.reviews + x.reviews, correct: a.correct + x.correct, incorrect: a.incorrect + x.incorrect }), { reviews: 0, correct: 0, incorrect: 0 });
  return {
    vocabCount,
    today,
    dueToday: await dueCount(d, direction, 0, eod),
    dueTomorrow: await dueCount(d, direction, eod + 1, endOfDay(addDays(now, 1))),
    newAvailable: Math.max(0, vocabCount - started),
    problemCount: await d.vocab.where('problem').equals(1).count(),
    streaks: computeStreaks(days.filter((x) => x.reviews > 0).map((x) => x.day), now),
    totals,
    status: await statusCounts(d),
  };
}

/** Gap-free series for the last n days (missing days = 0). */
export async function loadDaySeries(n: number, now = Date.now(), database: AppDB = db): Promise<DayStats[]> {
  const from = dayKey(addDays(now, -(n - 1)));
  const rows = new Map((await database.days.where('day').aboveOrEqual(from).toArray()).map((r) => [r.day, r]));
  return Array.from({ length: n }, (_, i) => {
    const k = dayKey(addDays(now, i - (n - 1)));
    return rows.get(k) ?? emptyDay(k);
  });
}

/** How many cards become due over the next n days (today includes overdue cards). */
export async function loadForecast(n: number, now = Date.now(), database: AppDB = db): Promise<{ day: string; count: number }[]> {
  const end = endOfDay(addDays(now, n - 1));
  const dues = (await database.states.where('due').belowOrEqual(end).keys()) as number[];
  const out = Array.from({ length: n }, (_, i) => ({ day: dayKey(addDays(now, i)), count: 0 }));
  const idx = new Map(out.map((o, i) => [o.day, i]));
  const eodToday = endOfDay(now);
  for (const due of dues) out[due <= eodToday ? 0 : idx.get(dayKey(due))!].count++;
  return out;
}

export interface ProblemRow {
  state: SchedState;
  vocab: Vocab;
  errorRate: number;
  score: number;
  strength: number | null;
  enoughData: boolean;
}

export type ProblemSort = 'errors' | 'rate' | 'recent' | 'strength';

export function sortProblems(rows: ProblemRow[], sort: ProblemSort): ProblemRow[] {
  const by: Record<ProblemSort, (a: ProblemRow, b: ProblemRow) => number> = {
    errors: (a, b) => b.state.incorrect - a.state.incorrect || b.score - a.score,
    // Sort by the conservative (Wilson) estimate instead of the raw rate.
    rate: (a, b) => b.score - a.score || b.state.incorrect - a.state.incorrect,
    recent: (a, b) => b.state.lastIncorrectAt - a.state.lastIncorrectAt,
    strength: (a, b) => (a.strength ?? 1) - (b.strength ?? 1),
  };
  return [...rows].sort(by[sort]);
}

/** All directions with at least one mistake, split into detected problem words and "not enough data". */
export async function loadProblemRows(now = Date.now(), database: AppDB = db): Promise<{ problems: ProblemRow[]; watch: ProblemRow[] }> {
  const states = await database.states.filter((s) => s.incorrect > 0).toArray();
  const vocab = new Map((await database.vocab.bulkGet([...new Set(states.map((s) => s.vocabId))])).filter((v): v is Vocab => !!v).map((v) => [v.id, v]));
  const rows: ProblemRow[] = states.filter((s) => vocab.has(s.vocabId)).map((s) => ({
    state: s,
    vocab: vocab.get(s.vocabId)!,
    errorRate: errorRate(s),
    score: wilsonLower(s.incorrect, s.total),
    strength: retrievability(s, now),
    enoughData: hasEnoughData(s),
  }));
  return {
    problems: rows.filter((r) => r.state.problem),
    watch: rows.filter((r) => !r.state.problem && !r.enoughData),
  };
}

export interface LessonStats {
  lesson: Lesson | null;
  total: number;
  reviews: number;
  correct: number;
  incorrect: number;
  mastered: number;
  difficult: number;
  started: number;
  /** Progress 0–1: mastered = 1, good = 0.75, in progress = 0.4, shaky = 0.15, new = 0. */
  progress: number;
}

const PROGRESS_WEIGHT: Record<Status, number> = { neu: 0, unsicher: 0.15, bearbeitung: 0.4, gut: 0.75, sicher: 1 };

export async function loadLessonStats(database: AppDB = db): Promise<LessonStats[]> {
  const lessons = await database.lessons.orderBy('name').toArray();
  const vocab = await database.vocab.toArray();
  const states = await database.states.toArray();
  const per = new Map<string, LessonStats>();
  const make = (lesson: Lesson | null): LessonStats => ({ lesson, total: 0, reviews: 0, correct: 0, incorrect: 0, mastered: 0, difficult: 0, started: 0, progress: 0 });
  for (const l of lessons) per.set(l.id, make(l));
  const lessonOf = new Map<string, string>();
  for (const v of vocab) {
    const key = per.has(v.lessonId) ? v.lessonId : '';
    if (!per.has(key)) per.set('', make(null));
    const s = per.get(key)!;
    lessonOf.set(v.id, key);
    s.total++;
    if (v.status === 'sicher') s.mastered++;
    if (v.problem) s.difficult++;
    if (v.status !== 'neu') s.started++;
    s.progress += PROGRESS_WEIGHT[v.status];
  }
  for (const st of states) {
    const s = per.get(lessonOf.get(st.vocabId) ?? '\u0000');
    if (!s) continue;
    s.reviews += st.total; s.correct += st.correct; s.incorrect += st.incorrect;
  }
  return [...per.values()].map((s) => ({ ...s, progress: s.total ? s.progress / s.total : 0 }));
}
