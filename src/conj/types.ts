import type { FontKey, SchedState, TextDir } from '../types';

/**
 * Conjugation module – data model.
 *
 * Nothing about a language's grammar is hard-coded: a *scheme* lists the grammatical persons and
 * tenses the user wants to practise (German: ich … sie/Sie × Präsens …; Persian, English or anything
 * else works the same). Verbs reference a scheme and store one or more accepted answers per
 * tense × person cell.
 */
export interface ConjPerson { id: string; label: string }
export interface ConjTense { id: string; label: string }

export interface ConjScheme {
  id: string;
  name: string;
  /** BCP-47 language tag of the verb forms ('' = unspecified). Also the "language" filter of the verb list. */
  lang: string;
  dir: TextDir;
  font: FontKey;
  scale: number;
  persons: ConjPerson[];
  tenses: ConjTense[];
  createdAt: number;
  updatedAt: number;
}

/** Cell key inside Verb.forms. Ids never contain '|'. */
export const formKey = (tenseId: string, personId: string) => `${tenseId}|${personId}`;
/** Id of the scheduling state of one verb × tense × person combination. */
export const formStateId = (verbId: string, tenseId: string, personId: string) => `${verbId}|${tenseId}|${personId}`;

export interface Verb {
  id: string;
  deckId: string;
  /** '' = no lesson. */
  lessonId: string;
  schemeId: string;
  infinitive: string;
  translation: string;
  notes: string;
  priority: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  /** formKey(tenseId, personId) → accepted answers; the first one is the canonical form. */
  forms: Record<string, string[]>;
  /** Normalised infinitive for duplicate detection. */
  infinitiveKey: string;
  createdAt: number;
  updatedAt: number;
  lastReviewAt: number;
}

/**
 * Scheduling state of ONE combination (verb × tense × person): own FSRS memory state, own counters
 * and error statistics. Same fields as the card states, minus the card/direction columns.
 */
export type FormState = Omit<SchedState, 'id' | 'cardId' | 'direction'> & {
  id: string; // formStateId
  verbId: string;
  deckId: string;
  tenseId: string;
  personId: string;
};

export type ConjSource = 'full' | 'forms';

export interface FormReview {
  id: string;
  verbId: string;
  deckId: string;
  tenseId: string;
  personId: string;
  ts: number;
  day: string;
  correct: boolean;
  sessionId: string;
  kind: 'scheduled' | 'relearn';
  /** full = complete-conjugation training, forms = single-form training. */
  source: ConjSource;
  typed?: string;
  meta: { wasNew: boolean; retrievability: number | null; stabilityAfter: number; intervalDays: number; dueAfter: number } | null;
}

/** Session modes of the conjugation trainer (stored in the shared `sessions` table). */
export type ConjMode = 'conj-full' | 'conj-forms';

export interface ConjSessionConfig {
  mode: ConjMode;
  deckIds: string[];
  lessonIds: string[];
  /** Language tags of the schemes (empty = all). */
  langs: string[];
  /** Tense labels (empty = all). Labels, not ids, so the same tense of different schemes is selected together. */
  tenseLabels: string[];
  /** Explicit verbs (e.g. started from a verb page); overrides deck/lesson/lang. */
  verbIds?: string[];
  /** full: number of conjugations; forms: number of single forms. */
  size: number;
}
