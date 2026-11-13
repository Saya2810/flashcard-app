import { db, type AppDB } from '../db/db';
import { dayKey } from '../lib/dates';
import { newId } from '../lib/text';
import { applyCounters, emptyDay, statusCounts } from '../srs/review';
import { isProblem, statusOf } from '../srs/metrics';
import { retrievability, schedule } from '../srs/scheduler';
import { formStateId, type ConjSource, type FormState } from './types';

export interface FormAnswerInput {
  verbId: string;
  tenseId: string;
  personId: string;
  correct: boolean;
  sessionId: string;
  source: ConjSource;
  /** 'relearn' = repeat within the same session: logged, but changes neither FSRS nor the error statistics. */
  kind?: 'scheduled' | 'relearn';
  /** What the user typed – kept for reference only; the user's own Richtig/Falsch decides `correct`. */
  typed?: string;
  now?: number;
}

/**
 * Stores one answer for ONE combination (verb × tense × person) atomically:
 * its own FSRS state and counters, the review event, the daily statistics (so the home screen goal,
 * streak and the statistics charts include verb forms) and the session.
 * Reuses the card engine (scheduler, counters, problem and status rules) unchanged.
 */
export async function recordFormAnswer(input: FormAnswerInput, database: AppDB = db): Promise<FormState | null> {
  const now = input.now ?? Date.now();
  const kind = input.kind ?? 'scheduled';
  const d = database;
  return d.transaction('rw', [d.verbs, d.formStates, d.formReviews, d.days, d.sessions, d.lessons, d.decks, d.cards], async () => {
    const verb = await d.verbs.get(input.verbId);
    if (!verb) return null;
    const id = formStateId(verb.id, input.tenseId, input.personId);
    const prev = await d.formStates.get(id);
    const day = dayKey(now);
    const dayRow = (await d.days.get(day)) ?? emptyDay(day);
    const base = { id: newId(), verbId: verb.id, deckId: verb.deckId, tenseId: input.tenseId, personId: input.personId, ts: now, day, correct: input.correct, sessionId: input.sessionId, source: input.source, ...(input.typed ? { typed: input.typed } : {}) };

    if (kind === 'relearn') {
      await d.formReviews.add({ ...base, kind, meta: null });
      dayRow.relearn++;
      await d.days.put(dayRow);
      return prev ?? null;
    }

    const wasNew = !prev || prev.total === 0;
    const sched = schedule(prev, input.correct, verb.priority, now);
    const next: FormState = {
      id, verbId: verb.id, deckId: verb.deckId, tenseId: input.tenseId, personId: input.personId,
      ...sched, ...applyCounters(prev, input.correct, now), status: 'neu', problem: 0,
    };
    next.problem = isProblem(next) ? 1 : 0;
    next.status = statusOf(next);
    await d.formStates.put(next);
    await d.formReviews.add({ ...base, kind, meta: { wasNew, retrievability: retrievability(prev, now), stabilityAfter: next.stability, intervalDays: next.scheduledDays, dueAfter: next.due } });

    await d.verbs.update(verb.id, { lastReviewAt: now });
    if (verb.lessonId) await d.lessons.update(verb.lessonId, { lastPracticedAt: now });
    await d.decks.update(verb.deckId, { lastPracticedAt: now });

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
