export type Direction = 'fa-de' | 'de-fa';
export type DirectionChoice = Direction | 'mixed';
export const DIRECTIONS: Direction[] = ['fa-de', 'de-fa'];

/** Learning status – see src/srs/metrics.ts and the README for the criteria. */
export type Status = 'neu' | 'bearbeitung' | 'unsicher' | 'gut' | 'sicher';
export const STATUS_ORDER: Status[] = ['neu', 'unsicher', 'bearbeitung', 'gut', 'sicher'];
export const STATUS_LABEL: Record<Status, string> = {
  neu: 'Neu',
  unsicher: 'Unsicher',
  bearbeitung: 'In Bearbeitung',
  gut: 'Gut gelernt',
  sicher: 'Sicher beherrscht',
};

export type Priority = 1 | 2 | 3 | 4 | 5;
export const PRIORITY_LABEL: Record<number, string> = {
  1: 'Sehr niedrig', 2: 'Niedrig', 3: 'Normal', 4: 'Hoch', 5: 'Sehr hoch',
};

export interface Vocab {
  id: string;
  persian: string;
  /** Normalised form, used only for search and duplicate detection; the original is never changed. */
  persianNorm: string;
  german: string;
  /** Additional accepted translations. */
  altGerman: string[];
  translit: string;
  grammar: string;
  exampleFa: string;
  exampleDe: string;
  notes: string;
  /** '' = no lesson (IndexedDB cannot index null). */
  lessonId: string;
  priority: Priority;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  lastReviewAt: number;
  /** Cached from the scheduling states (can be recomputed at any time). */
  status: Status;
  problem: 0 | 1;
  sample: 0 | 1;
}

export interface Lesson {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  lastPracticedAt: number;
  sample: 0 | 1;
}

/** One scheduling state per vocabulary item AND direction. */
export interface SchedState {
  id: string; // `${vocabId}|${direction}`
  vocabId: string;
  direction: Direction;
  // FSRS memory model
  due: number;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  fsrsState: number;
  lastReview: number;
  scheduledDays: number;
  // Counters (cache – the review events are the source of truth)
  total: number;
  correct: number;
  incorrect: number;
  curCorrect: number;
  curIncorrect: number;
  maxIncorrect: number;
  lastIncorrectAt: number;
  firstReviewAt: number;
  /** Last 10 results, '1' = correct, '0' = incorrect, oldest first. */
  recent: string;
  status: Status;
  problem: 0 | 1;
}

export type ReviewKind = 'scheduled' | 'relearn';

export interface ReviewEvent {
  id: string;
  vocabId: string;
  direction: Direction;
  ts: number;
  /** Local calendar day (YYYY-MM-DD) at the time of the answer. */
  day: string;
  correct: boolean;
  sessionId: string;
  /** scheduled = counts for FSRS and statistics; relearn = repeat within the same session. */
  kind: ReviewKind;
  meta: {
    priority: number;
    wasNew: boolean;
    retrievability: number | null;
    stabilityBefore: number;
    stabilityAfter: number;
    difficultyAfter: number;
    intervalDays: number;
    dueAfter: number;
  } | null;
}

export type Mode = 'smart' | 'problem' | 'new' | 'lesson' | 'exam' | 'free';
export const MODE_LABEL: Record<Mode, string> = {
  smart: 'Intelligentes Lernen',
  problem: 'Problemvokabeln',
  new: 'Neue Vokabeln',
  lesson: 'Lektion lernen',
  exam: 'Prüfungsvorbereitung',
  free: 'Freies Lernen',
};

export interface LearningSession {
  id: string;
  mode: Mode;
  direction: DirectionChoice;
  lessonIds: string[];
  startedAt: number;
  endedAt: number;
  planned: number;
  answered: number;
  correct: number;
  incorrect: number;
}

export interface DayStats {
  day: string;
  reviews: number;
  correct: number;
  incorrect: number;
  newCards: number;
  relearn: number;
  /** Snapshot of the status distribution after the day's last answer. */
  snapshot: Record<Status, number> | null;
}

export interface AppSettings {
  key: 'app';
  theme: 'system' | 'light' | 'dark';
  defaultDirection: DirectionChoice;
  dailyGoal: number;
  newPerDay: number;
  maxReviewsPerDay: number;
  cardFontScale: number;
  persianFontScale: number;
  animations: boolean;
  autoIncludeProblems: boolean;
  sessionSize: number;
  lastBackupAt: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  key: 'app',
  theme: 'system',
  defaultDirection: 'fa-de',
  dailyGoal: 20,
  newPerDay: 10,
  maxReviewsPerDay: 150,
  cardFontScale: 1,
  persianFontScale: 1,
  animations: true,
  autoIncludeProblems: true,
  sessionSize: 20,
  lastBackupAt: 0,
};

export interface SessionConfig {
  mode: Mode;
  direction: DirectionChoice;
  lessonIds: string[];
  priorities: number[];
  size: number;
  vocabIds?: string[];
}
