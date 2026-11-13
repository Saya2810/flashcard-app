import { db, type AppDB } from '../db/db';
import { endOfDay } from '../lib/dates';
import { errorRate, hasEnoughData, wilsonLower } from '../srs/metrics';
import { retrievability } from '../srs/scheduler';
import type { ConjPerson, ConjScheme, ConjTense, FormState, Verb } from './types';

export interface FormRow {
  state: FormState;
  verb: Verb;
  scheme: ConjScheme;
  tense: ConjTense;
  person: ConjPerson;
  errorRate: number;
  score: number;
  strength: number | null;
}

export interface FormOverview {
  verbCount: number;
  /** Forms that have been answered at least once. */
  practiced: number;
  reviews: number;
  correct: number;
  incorrect: number;
  problemCount: number;
  dueToday: number;
  /** Most mistakes first. */
  hardest: FormRow[];
}

/** Statistics of the verb forms – shown next to the card statistics. */
export async function loadFormOverview(now = Date.now(), database: AppDB = db): Promise<FormOverview> {
  const d = database;
  const [verbs, schemes, states] = await Promise.all([d.verbs.toArray(), d.schemes.toArray(), d.formStates.toArray()]);
  const verbById = new Map(verbs.map((v) => [v.id, v]));
  const schemeById = new Map(schemes.map((s) => [s.id, s]));
  const eod = endOfDay(now);
  const o: FormOverview = { verbCount: verbs.length, practiced: 0, reviews: 0, correct: 0, incorrect: 0, problemCount: 0, dueToday: 0, hardest: [] };
  const rows: FormRow[] = [];
  for (const st of states) {
    const verb = verbById.get(st.verbId);
    const scheme = verb && schemeById.get(verb.schemeId);
    const tense = scheme?.tenses.find((x) => x.id === st.tenseId);
    const person = scheme?.persons.find((x) => x.id === st.personId);
    if (!verb || !scheme || !tense || !person || st.total === 0) continue;
    o.practiced++; o.reviews += st.total; o.correct += st.correct; o.incorrect += st.incorrect;
    if (st.problem) o.problemCount++;
    if (st.due <= eod) o.dueToday++;
    if (st.incorrect > 0) rows.push({ state: st, verb, scheme, tense, person, errorRate: errorRate(st), score: wilsonLower(st.incorrect, st.total), strength: retrievability(st, now) });
  }
  o.hardest = rows.sort((a, b) => b.state.incorrect - a.state.incorrect || b.score - a.score).slice(0, 8);
  return o;
}

export { hasEnoughData };
