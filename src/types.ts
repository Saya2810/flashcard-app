/** fwd = front → back, rev = back → front. Each direction has its own memory state. */
export type Direction = 'fwd' | 'rev';
export type DirectionChoice = Direction | 'mixed';
export const DIRECTIONS: Direction[] = ['fwd', 'rev'];

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

/** Font families offered per card side. System fonts cost nothing offline; Vazirmatn is bundled. */
export type FontKey = 'system' | 'rounded' | 'serif' | 'mono' | 'vazirmatn';
export const FONT_LABEL: Record<FontKey, string> = {
  system: 'System',
  rounded: 'Abgerundet',
  serif: 'Serif',
  mono: 'Monospace',
  vazirmatn: 'Vazirmatn (Persisch/Arabisch)',
};
export const FONT_STACK: Record<FontKey, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Noto Sans', sans-serif",
  rounded: "ui-rounded, 'SF Pro Rounded', -apple-system, 'Nunito', 'Segoe UI', sans-serif",
  serif: "ui-serif, 'New York', Georgia, 'Noto Serif', 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  vazirmatn: "Vazirmatn, 'Geeza Pro', Tahoma, sans-serif",
};

export type TextDir = 'auto' | 'ltr' | 'rtl';

/** Appearance of one card side. */
export interface SideStyle {
  label: string;
  /** BCP-47 language tag ('' = unspecified). Used for lang=, hyphenation and font fallback. */
  lang: string;
  dir: TextDir;
  font: FontKey;
  /** Relative size, 0.7–1.8. */
  scale: number;
  weight: 400 | 500 | 600 | 700;
}

export interface CustomField {
  key: string;
  label: string;
  /** Which side of the card shows the field after flipping. */
  dir: TextDir;
  font: FontKey;
}

export const DECK_COLORS = ['rose', 'lavender', 'mint', 'peach', 'sky', 'lemon'] as const;
export type DeckColor = (typeof DECK_COLORS)[number];

export interface Deck {
  id: string;
  name: string;
  /** Free grouping such as „Sprachen“, „Mathematik“, „Physik“. */
  subject: string;
  description: string;
  color: DeckColor;
  front: SideStyle;
  back: SideStyle;
  /** Also study back → front. */
  reverse: boolean;
  /** Render Markdown, LaTeX ($…$, $$…$$) and code blocks. */
  rich: boolean;
  fields: CustomField[];
  createdAt: number;
  lastPracticedAt: number;
  sample: 0 | 1;
}

export interface Lesson {
  id: string;
  deckId: string;
  name: string;
  description: string;
  createdAt: number;
  lastPracticedAt: number;
}

export interface Card {
  id: string;
  deckId: string;
  /** '' = no lesson (IndexedDB cannot index null). */
  lessonId: string;
  front: string;
  back: string;
  /** Additional accepted answers for the back side. */
  altBack: string[];
  /** Values of the deck's custom fields, keyed by CustomField.key. */
  fields: Record<string, string>;
  notes: string;
  priority: Priority;
  tags: string[];
  /** Normalised front for duplicate detection; the original is never changed. */
  frontKey: string;
  createdAt: number;
  updatedAt: number;
  lastReviewAt: number;
  /** Cached from the scheduling states (can be recomputed at any time). */
  status: Status;
  problem: 0 | 1;
  sample: 0 | 1;
}

/** Image stored once and referenced from card text as ![](media:ID). */
export interface Media {
  id: string;
  mime: string;
  dataUrl: string;
  width: number;
  height: number;
  createdAt: number;
}

/** One scheduling state per card AND direction. */
export interface SchedState {
  id: string; // `${cardId}|${direction}`
  cardId: string;
  deckId: string;
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
  cardId: string;
  deckId: string;
  direction: Direction;
  ts: number;
  /** Local calendar day (YYYY-MM-DD) at the time of the answer. */
  day: string;
  correct: boolean;
  sessionId: string;
  /** scheduled = counts for FSRS and statistics; relearn = repeat within the same session. */
  kind: ReviewKind;
  /** What the user typed in typed-answer mode (for their own reference only; never graded). */
  typed?: string;
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
  problem: 'Problemkarten',
  new: 'Neue Karten',
  lesson: 'Stapel & Lektionen',
  exam: 'Prüfungsvorbereitung',
  free: 'Freies Lernen',
};

export interface LearningSession {
  id: string;
  /** Card modes plus the conjugation trainer modes ('conj-full', 'conj-forms'). */
  mode: Mode | 'conj-full' | 'conj-forms';
  direction: DirectionChoice;
  deckIds: string[];
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
  /** Language of the app interface (not of the learning content). */
  uiLanguage: string;
  /** App interface font. */
  uiFont: 'system' | 'rounded' | 'serif';
  defaultDirection: DirectionChoice;
  dailyGoal: number;
  newPerDay: number;
  maxReviewsPerDay: number;
  /** Global multiplier on top of each deck's side scale. */
  cardFontScale: number;
  /** Size of the typed-answer fields (multiplier on top of the deck side scale). */
  answerFontScale: number;
  animations: boolean;
  autoIncludeProblems: boolean;
  sessionSize: number;
  /** Type the answer before flipping; shows a diff but never grades. */
  typedAnswer: boolean;
  diffIgnoreCase: boolean;
  diffIgnorePunctuation: boolean;
  lastBackupAt: number;
  legacyImportedAt: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  key: 'app',
  theme: 'system',
  uiLanguage: 'de',
  uiFont: 'rounded',
  defaultDirection: 'fwd',
  dailyGoal: 20,
  newPerDay: 15,
  maxReviewsPerDay: 200,
  cardFontScale: 1,
  answerFontScale: 1,
  animations: true,
  autoIncludeProblems: true,
  sessionSize: 20,
  typedAnswer: false,
  diffIgnoreCase: false,
  diffIgnorePunctuation: false,
  lastBackupAt: 0,
  legacyImportedAt: 0,
};

export interface SessionConfig {
  mode: Mode;
  direction: DirectionChoice;
  deckIds: string[];
  lessonIds: string[];
  priorities: number[];
  size: number;
  cardIds?: string[];
}

export const defaultSide = (label: string, patch: Partial<SideStyle> = {}): SideStyle => ({
  label, lang: '', dir: 'auto', font: 'system', scale: 1, weight: 600, ...patch,
});

/** Scheduling fields shared by card states and verb-form states (what the FSRS wrapper needs). */
export type SchedLike = Omit<SchedState, 'id' | 'cardId' | 'direction'>;
