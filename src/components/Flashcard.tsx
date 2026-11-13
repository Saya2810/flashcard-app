import type { ReactNode } from 'react';
import { prefersReducedMotion } from '../hooks/useSettings';
import type { DiffOptions } from '../lib/diff';
import type { Card, Deck, Direction } from '../types';
import { AnswerDiff } from './AnswerDiff';
import { baseSize, RichText, sideLook } from './RichText';
import { cx } from './ui';

export interface FlashcardProps {
  card: Card;
  deck: Deck;
  direction: Direction;
  flipped: boolean;
  onFlip: () => void;
  animations?: boolean;
  /** Typed answer (typed-answer mode). null = mode off. */
  typed?: string | null;
  diffOptions?: DiffOptions;
}

function Face({ side, children, hidden, label }: { side: 'front' | 'back'; children: ReactNode; hidden: boolean; label: string }) {
  return (
    <div data-testid={`card-${side}`} aria-hidden={hidden}
      className={cx('fc-face flex min-h-[20rem] flex-col items-center rounded-[2rem] bg-surface px-6 pb-7 pt-5 text-center shadow-lift', side === 'front' ? 'fc-front' : 'fc-back')}>
      <div className="mb-3 self-center rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">{label}</div>
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-4">{children}</div>
    </div>
  );
}

/**
 * Flashcard with a flip animation. The back face is pre-rotated by 180° in CSS, so right-to-left
 * scripts are never mirrored and text is never reversed manually anywhere.
 */
export function Flashcard({ card, deck, direction, flipped, onFlip, animations = true, typed = null, diffOptions = {} }: FlashcardProps) {
  const still = !animations || prefersReducedMotion();
  const fwd = direction === 'fwd';
  const qSide = fwd ? deck.front : deck.back;
  const aSide = fwd ? deck.back : deck.front;
  const question = fwd ? card.front : card.back;
  const answer = fwd ? card.back : card.front;
  const answers = fwd ? [card.back, ...card.altBack] : [card.front];
  const extras = deck.fields.filter((f) => card.fields[f.key]);

  return (
    <div
      role="button" tabIndex={0} data-flipped={flipped} data-testid="flashcard"
      aria-label={flipped ? 'Karte zurückdrehen' : 'Karte umdrehen und Lösung zeigen'}
      className={cx('fc w-full cursor-pointer select-none outline-offset-4', still && 'no-anim')}
      onClick={(e) => { if ((e.target as HTMLElement).closest('a')) return; onFlip(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFlip(); } }}
    >
      <div className="fc-inner">
        <Face side="front" hidden={flipped} label={qSide.label}>
          <RichText text={question} rich={deck.rich} look={sideLook(qSide)} baseRem={baseSize(question, deck.rich)} className="w-full" testId="question" />
          {typed === null && <div className="mt-2 text-sm text-muted">Tippen zum Umdrehen</div>}
        </Face>
        <Face side="back" hidden={!flipped} label={aSide.label}>
          <RichText text={answer} rich={deck.rich} look={sideLook(aSide)} baseRem={baseSize(answer, deck.rich)} className="w-full" testId="answer" />
          {fwd && card.altBack.length > 0 && (
            <div className="text-sm text-muted">auch: <span dir="auto" lang={aSide.lang || undefined}>{card.altBack.join(', ')}</span></div>
          )}
          {!fwd && <div className="text-sm text-muted" dir="auto">{qSide.label}: <span lang={qSide.lang || undefined}>{card.back}</span></div>}
          {typed !== null && flipped && (
            <AnswerDiff typed={typed} answers={answers} rich={deck.rich} look={sideLook(aSide)} options={diffOptions} />
          )}
          {(extras.length > 0 || card.notes) && (
            <dl className="w-full space-y-2 border-t border-line pt-3 text-start text-sm">
              {extras.map((f) => (
                <div key={f.key}>
                  <dt className="text-xs font-semibold text-muted">{f.label}</dt>
                  <dd><RichText text={card.fields[f.key]} rich={deck.rich} look={{ dir: f.dir, font: f.font, scale: 1 }} baseRem={0.95} /></dd>
                </div>
              ))}
              {card.notes && (
                <div>
                  <dt className="text-xs font-semibold text-muted">Notiz</dt>
                  <dd><RichText text={card.notes} rich={deck.rich} look={{ dir: 'auto' }} baseRem={0.9} className="text-muted" /></dd>
                </div>
              )}
            </dl>
          )}
        </Face>
      </div>
      <span className="sr-only" aria-live="polite">{flipped ? answer : ''}</span>
    </div>
  );
}
