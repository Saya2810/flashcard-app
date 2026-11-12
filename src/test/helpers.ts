import { db } from '../db/db';
import { addVocab, type VocabInput } from '../db/repo';
import { newId } from '../lib/persian';
import { recordAnswer } from '../srs/review';
import type { Direction } from '../types';

export async function resetDb() {
  await db.delete();
  await db.open();
}

export const word = (persian = 'آمدن', german = 'kommen', extra: Partial<VocabInput> = {}) => addVocab({ persian, german, ...extra });

/** Several scheduled answers in a row, one day apart (or a custom gap). */
export async function answers(vocabId: string, pattern: string, opts: { direction?: Direction; start?: number; gapDays?: number } = {}) {
  const start = opts.start ?? new Date(2026, 0, 10, 10, 0).getTime();
  let t = start;
  for (const c of pattern) {
    await recordAnswer({ vocabId, direction: opts.direction ?? 'fa-de', correct: c === '1', sessionId: newId(), now: t });
    t += (opts.gapDays ?? 1) * 86_400_000;
  }
  return t;
}
