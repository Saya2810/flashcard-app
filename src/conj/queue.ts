import { endOfDay } from '../lib/dates';
import { errorRate, wilsonLower } from '../srs/metrics';
import { priorityWeight } from '../srs/queue';
import { retrievability } from '../srs/scheduler';
import { definedCells } from './repo';
import { formStateId, type ConjScheme, type ConjSessionConfig, type FormState, type Verb } from './types';

/** One single form in a training queue. */
export interface FormItem {
  verbId: string;
  tenseId: string;
  personId: string;
  isNew: boolean;
  relearn: boolean;
  attempts: number;
}
/** One complete conjugation (verb × tense) in a training queue. */
export interface ConjugationItem { verbId: string; tenseId: string }

/**
 * Review priority of ONE form: the verb's priority weight (0.8–1.2), raised by this form's OWN error history.
 * wilsonLower is the conservative error-rate estimate, so "1 of 1 wrong" does not outrank "8 of 12 wrong".
 * A form that is frequently wrong therefore gets a clearly higher priority than its siblings.
 */
export function formReviewPriority(state: FormState | undefined, verbPriority: number): number {
  const base = priorityWeight(verbPriority);
  if (!state || state.total === 0) return base;
  return base * (1 + 2 * wilsonLower(state.incorrect, state.total) + (state.problem ? 0.3 : 0) + 0.1 * Math.min(state.curIncorrect, 3));
}

/** How urgently a form should be shown now. Never studied = 1 (as forgotten as it gets). */
export function formUrgency(state: FormState | undefined, verbPriority: number, now: number): number {
  const isNew = !state || state.total === 0;
  const r = isNew ? 0 : retrievability(state, now) ?? 0;
  return ((1 - r) + (state?.problem ? 0.15 : 0)) * formReviewPriority(state, verbPriority);
}

export interface QueueData {
  verbs: Verb[];
  schemes: ConjScheme[];
  states: FormState[];
  now: number;
}

/** Verbs matching the scope of a session config. */
export function scopedVerbs(cfg: ConjSessionConfig, verbs: Verb[], schemes: ConjScheme[]): { verb: Verb; scheme: ConjScheme; tenseIds: string[] }[] {
  const byScheme = new Map(schemes.map((s) => [s.id, s]));
  const out: { verb: Verb; scheme: ConjScheme; tenseIds: string[] }[] = [];
  for (const verb of verbs) {
    const scheme = byScheme.get(verb.schemeId);
    if (!scheme) continue;
    if (cfg.verbIds?.length) { if (!cfg.verbIds.includes(verb.id)) continue; }
    else {
      if (cfg.deckIds.length && !cfg.deckIds.includes(verb.deckId)) continue;
      if (cfg.lessonIds.length && !cfg.lessonIds.includes(verb.lessonId)) continue;
      if (cfg.langs.length && !cfg.langs.includes(scheme.lang)) continue;
    }
    const tenseIds = scheme.tenses.filter((t) => !cfg.tenseLabels.length || cfg.tenseLabels.includes(t.label)).map((t) => t.id);
    if (tenseIds.length) out.push({ verb, scheme, tenseIds });
  }
  return out;
}

/**
 * Mode 1 – complete conjugations. Each (verb, tense) is scored by the mean urgency of its forms;
 * forms that are not due yet count with a quarter of their urgency, so due and difficult conjugations come first
 * but the user can still practise any tense they selected.
 */
export function buildConjugationQueue(cfg: ConjSessionConfig, data: QueueData): ConjugationItem[] {
  const states = new Map(data.states.map((s) => [s.id, s]));
  const eod = endOfDay(data.now);
  const scored: { item: ConjugationItem; score: number; created: number }[] = [];
  for (const { verb, scheme, tenseIds } of scopedVerbs(cfg, data.verbs, data.schemes)) {
    for (const tenseId of tenseIds) {
      const cells = definedCells(verb, scheme, [tenseId]);
      if (!cells.length) continue;
      let sum = 0;
      for (const c of cells) {
        const st = states.get(formStateId(verb.id, c.tenseId, c.personId));
        const u = formUrgency(st, verb.priority, data.now);
        const due = !st || st.total === 0 || st.due <= eod || st.problem;
        sum += due ? u : u * 0.25;
      }
      scored.push({ item: { verbId: verb.id, tenseId }, score: sum / cells.length, created: verb.createdAt });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.created - b.created);
  return scored.slice(0, Math.max(1, cfg.size)).map((s) => s.item);
}


/**
 * Mode 2 – difficult individual forms. The pool is every form that is a problem form, or has mistakes and is due,
 * is currently wrong, or has an error rate of 25 % or more. Order: formUrgency (which includes the form's own error history).
 * Fully deterministic. Mistakes inside the session come back via requeueWrong (see srs/queue.ts).
 */
export function buildFormQueue(cfg: ConjSessionConfig, data: QueueData): FormItem[] {
  const states = new Map(data.states.map((s) => [s.id, s]));
  const eod = endOfDay(data.now);
  const pool: { item: FormItem; urgency: number; created: number }[] = [];
  for (const { verb, scheme, tenseIds } of scopedVerbs(cfg, data.verbs, data.schemes)) {
    for (const c of definedCells(verb, scheme, tenseIds)) {
      const st = states.get(formStateId(verb.id, c.tenseId, c.personId));
      if (!st || st.total === 0) continue;
      const difficult = st.problem === 1 || (st.incorrect > 0 && (st.due <= eod || st.curIncorrect > 0 || errorRate(st) >= 0.25));
      if (!difficult) continue;
      pool.push({ item: { verbId: verb.id, tenseId: c.tenseId, personId: c.personId, isNew: false, relearn: false, attempts: 0 }, urgency: formUrgency(st, verb.priority, data.now), created: verb.createdAt });
    }
  }
  pool.sort((a, b) => b.urgency - a.urgency || a.created - b.created);
  const items = pool.slice(0, Math.max(1, cfg.size)).map((p) => p.item);
  return items;
}
