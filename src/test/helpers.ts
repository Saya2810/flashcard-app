import { db } from '../db/db';
import { addCard, addDeck, type CardInput, type DeckInput } from '../db/repo';
import { newId } from '../lib/text';
import { recordAnswer } from '../srs/review';
import type { Deck, Direction } from '../types';

export async function resetDb() {
  db.close();
  await db.delete();
  await db.open();
}

let n = 0;
export const deck = (p: Partial<DeckInput> = {}): Promise<Deck> => addDeck({ name: `Stapel ${++n}`, ...p });

/** A card in the given deck (created on the fly if omitted). Each call gets a distinct creation time. */
export async function card(front = 'آمدن', back = 'kommen', extra: Partial<CardInput> = {}) {
  const deckId = extra.deckId ?? (await deck({ reverse: true })).id;
  const c = await addCard({ deckId, front, back, ...extra });
  await db.cards.update(c.id, { createdAt: c.createdAt + n++ });
  return (await db.cards.get(c.id))!;
}

/** Several scheduled answers in a row, one day apart (or a custom gap). */
export async function answers(cardId: string, pattern: string, opts: { direction?: Direction; start?: number; gapDays?: number } = {}) {
  let t = opts.start ?? new Date(2026, 0, 10, 10, 0).getTime();
  for (const c of pattern) {
    await recordAnswer({ cardId, direction: opts.direction ?? 'fwd', correct: c === '1', sessionId: newId(), now: t });
    t += (opts.gapDays ?? 1) * 86_400_000;
  }
  return t;
}
