import { endOfDay } from '../lib/dates';
import type { AppSettings, Direction, SchedState, SessionConfig, Vocab } from '../types';
import { retrievability } from './scheduler';

export interface QueueItem {
  vocabId: string;
  direction: Direction;
  isNew: boolean;
  /** true = repeat after a mistake in this session (no longer affects FSRS). */
  relearn: boolean;
  attempts: number;
}

export interface QueueContext {
  now: number;
  settings: Pick<AppSettings, 'newPerDay' | 'maxReviewsPerDay' | 'autoIncludeProblems'>;
  newDoneToday: number;
  reviewsDoneToday: number;
}

interface Candidate {
  v: Vocab;
  direction: Direction;
  s: SchedState | undefined;
  isNew: boolean;
  due: boolean;
  problem: boolean;
  r: number;
  urgency: number;
}

/** Priority as a weight: 1 → 0.8 … 5 → 1.2. Shifts the order but never replaces the memory state. */
export const priorityWeight = (p: number) => 0.7 + 0.1 * p;

/** Share of extra (not yet due) problem words and of new cards per session. */
export const EXTRA_PROBLEM_SHARE = 0.2;
export const NEW_SHARE_WHEN_BUSY = 0.25;

function candidates(cfg: SessionConfig, vocab: Vocab[], states: SchedState[], now: number): Candidate[] {
  const byId = new Map(states.map((s) => [s.id, s]));
  const dirs: Direction[] = cfg.direction === 'mixed' ? ['fa-de', 'de-fa'] : [cfg.direction];
  const lessons = new Set(cfg.lessonIds);
  const prios = new Set(cfg.priorities);
  const ids = cfg.vocabIds ? new Set(cfg.vocabIds) : null;
  const eod = endOfDay(now);
  const out: Candidate[] = [];
  for (const v of vocab) {
    if (ids && !ids.has(v.id)) continue;
    if (!ids && lessons.size && !lessons.has(v.lessonId)) continue;
    if (!ids && prios.size && !prios.has(v.priority)) continue;
    for (const direction of dirs) {
      const s = byId.get(`${v.id}|${direction}`);
      const isNew = !s || s.total === 0;
      const r = isNew ? 0 : retrievability(s, now) ?? 0;
      const problem = !!s?.problem;
      out.push({
        v, direction, s, isNew, problem, r,
        due: !isNew && s!.due <= eod,
        urgency: ((1 - r) + (problem ? 0.15 : 0)) * priorityWeight(v.priority),
      });
    }
  }
  return out;
}

const byUrgency = (a: Candidate, b: Candidate) => b.urgency - a.urgency || a.v.createdAt - b.v.createdAt;
/** New cards: high priority first, then recognition (fa→de) before production, then entry order. */
const byNewOrder = (a: Candidate, b: Candidate) =>
  b.v.priority - a.v.priority || (a.direction === b.direction ? 0 : a.direction === 'fa-de' ? -1 : 1) || a.v.createdAt - b.v.createdAt;

/** At most one card per item and session (in mixed mode, the more urgent direction). */
function uniqueByVocab(list: Candidate[], seen = new Set<string>()): Candidate[] {
  return list.filter((c) => (seen.has(c.v.id) ? false : (seen.add(c.v.id), true)));
}

/** Spreads b evenly through a instead of appending everything new at the end. */
export function interleave<T>(a: T[], b: T[]): T[] {
  if (!b.length) return [...a];
  if (!a.length) return [...b];
  const out: T[] = [];
  const step = (a.length + b.length) / b.length;
  let bi = 0;
  let ai = 0;
  for (let i = 0; i < a.length + b.length; i++) {
    if (bi < b.length && i >= Math.floor(step * bi + step - 1)) out.push(b[bi++]);
    else if (ai < a.length) out.push(a[ai++]);
    else out.push(b[bi++]);
  }
  return out;
}

const toItem = (c: Candidate): QueueItem => ({ vocabId: c.v.id, direction: c.direction, isNew: c.isNew, relearn: false, attempts: 0 });

/**
 * Builds the card order for a session. Deterministic – no randomness.
 */
export function buildQueue(cfg: SessionConfig, vocab: Vocab[], states: SchedState[], ctx: QueueContext): QueueItem[] {
  const size = Math.max(1, cfg.size);
  const all = candidates(cfg, vocab, states, ctx.now);
  const seen = new Set<string>();

  switch (cfg.mode) {
    case 'smart': {
      const reviewBudget = Math.max(0, ctx.settings.maxReviewsPerDay - ctx.reviewsDoneToday);
      const newBudget = Math.max(0, ctx.settings.newPerDay - ctx.newDoneToday);
      const dueAll = uniqueByVocab(all.filter((c) => c.due).sort(byUrgency), seen);
      const newAll = all.filter((c) => c.isNew).sort(byNewOrder);
      // New cards get a fixed share even when a lot is due – and vice versa.
      const reservedNew = Math.min(newBudget, newAll.length, Math.floor(size * NEW_SHARE_WHEN_BUSY));
      // Difficult words that are not yet due also get a fixed (small) share –
      // due cards that no longer fit move to the front of the next session.
      const extraPool = ctx.settings.autoIncludeProblems
        ? uniqueByVocab(all.filter((c) => c.problem && !c.due && !c.isNew).sort(byUrgency), new Set(dueAll.map((c) => c.v.id)))
        : [];
      const reservedExtra = Math.min(extraPool.length, Math.ceil(size * EXTRA_PROBLEM_SHARE), reviewBudget);
      const due = dueAll.slice(0, Math.max(0, Math.min(reviewBudget - reservedExtra, size - reservedNew - reservedExtra)));
      const extra = extraPool.slice(0, reservedExtra);
      const seenNow = new Set([...due, ...extra].map((c) => c.v.id));
      const reviews = [...due, ...extra];
      const fresh = uniqueByVocab(newAll, seenNow).slice(0, Math.min(newBudget, size - reviews.length));
      return interleave(reviews, fresh).map(toItem);
    }
    case 'problem': {
      const pool = cfg.vocabIds ? all.filter((c) => !c.isNew) : all.filter((c) => c.problem);
      return uniqueByVocab(pool.sort(byUrgency), seen).slice(0, size).map(toItem);
    }
    case 'new':
      return uniqueByVocab(all.filter((c) => c.isNew).sort(byNewOrder), seen).slice(0, size).map(toItem);
    case 'lesson': {
      const due = uniqueByVocab(all.filter((c) => c.due).sort(byUrgency), seen);
      const fresh = uniqueByVocab(all.filter((c) => c.isNew).sort(byNewOrder), seen);
      const rest = uniqueByVocab(all.filter((c) => !c.due && !c.isNew).sort(byUrgency), seen);
      return [...interleave(due, fresh), ...rest].slice(0, size).map(toItem);
    }
    case 'exam': {
      // Weakest first: new cards count as "forgotten".
      const ranked = all.map((c) => ({ ...c, urgency: c.isNew ? priorityWeight(c.v.priority) : c.urgency })).sort(byUrgency);
      return uniqueByVocab(ranked, seen).slice(0, size).map(toItem);
    }
    case 'free': {
      const order = (a: Candidate, b: Candidate) => a.v.createdAt - b.v.createdAt;
      return uniqueByVocab(all.sort(order), seen).slice(0, size).map(toItem);
    }
  }
}

/** After how many OTHER cards an incorrectly answered card comes back in the session. */
export const RELEARN_GAP = 4;
/** Maximum number of times the same card returns within one session. */
export const MAX_RELEARN = 3;

/**
 * Short-term relearning: re-inserts an incorrectly answered card further back.
 * `rest` is the queue WITHOUT the card that was just answered.
 * If no other card is left, it comes back directly at most once.
 */
export function requeueWrong(rest: QueueItem[], item: QueueItem): QueueItem[] {
  const attempts = item.attempts + 1;
  if (attempts > MAX_RELEARN) return rest;
  if (rest.length === 0 && attempts > 1) return rest;
  const again: QueueItem = { ...item, relearn: true, attempts };
  const pos = Math.min(RELEARN_GAP, rest.length);
  return [...rest.slice(0, pos), again, ...rest.slice(pos)];
}
