import type { ReactNode } from 'react';
import { prefersReducedMotion } from '../hooks/useSettings';
import type { Direction, Vocab } from '../types';
import { Fa, cx } from './ui';

export interface FlashcardProps {
  vocab: Vocab;
  direction: Direction;
  flipped: boolean;
  onFlip: () => void;
  animations?: boolean;
}

function Face({ side, children, hidden }: { side: 'front' | 'back'; children: ReactNode; hidden: boolean }) {
  return (
    <div data-testid={`card-${side}`} aria-hidden={hidden} className={cx('fc-face flex min-h-[19rem] flex-col items-center justify-center rounded-[1.75rem] bg-surface px-6 py-8 text-center shadow-card', side === 'front' ? 'fc-front' : 'fc-back')}>
      {children}
    </div>
  );
}

const Persian = ({ v }: { v: Vocab }) => (
  <div className={cx('font-semibold', v.persian.length > 28 ? 'text-2xl' : v.persian.length > 14 ? 'text-4xl' : 'text-5xl')}>
    <div className="fc-text"><Fa>{v.persian}</Fa></div>
  </div>
);
const German = ({ v }: { v: Vocab }) => (
  <div>
    <div className={cx('font-bold tracking-tight [overflow-wrap:anywhere]', v.german.length > 28 ? 'text-2xl' : 'text-4xl')}><div lang="de" className="fc-text">{v.german}</div></div>
    {v.altGerman.length > 0 && <div lang="de" className="mt-2 text-base text-muted">auch: {v.altGerman.join(', ')}</div>}
  </div>
);

function Extras({ v }: { v: Vocab }) {
  if (!v.translit && !v.grammar && !v.exampleFa && !v.exampleDe && !v.notes) return null;
  return (
    <div className="mt-5 w-full space-y-2 border-t border-line pt-4 text-sm">
      {v.translit && <div className="text-base italic text-muted">{v.translit}</div>}
      {v.grammar && <div className="text-muted" dir="auto">{v.grammar}</div>}
      {(v.exampleFa || v.exampleDe) && (
        <div className="rounded-2xl bg-sunken px-3 py-2">
          {v.exampleFa && <div><Fa className="block">{v.exampleFa}</Fa></div>}
          {v.exampleDe && <div lang="de" className="text-muted">{v.exampleDe}</div>}
        </div>
      )}
      {v.notes && <div className="text-muted" dir="auto">{v.notes}</div>}
    </div>
  );
}

/**
 * Flashcard with a flip animation. The back face is pre-rotated by 180° in CSS, so
 * Persian script is never mirrored and is never reversed manually anywhere.
 */
export function Flashcard({ vocab, direction, flipped, onFlip, animations = true }: FlashcardProps) {
  const still = !animations || prefersReducedMotion();
  const faFront = direction === 'fa-de';
  return (
    <div
      role="button" tabIndex={0} data-flipped={flipped} data-testid="flashcard"
      aria-label={flipped ? 'Karte zurückdrehen' : 'Karte umdrehen und Antwort zeigen'}
      className={cx('fc w-full cursor-pointer select-none outline-offset-4', still && 'no-anim')}
      onClick={onFlip}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFlip(); } }}
    >
      <div className="fc-inner">
        <Face side="front" hidden={flipped}>
          <div className="mb-4 text-xs font-semibold text-muted">{faFront ? 'Persisch' : 'Deutsch'}</div>
          {faFront ? <Persian v={vocab} /> : <German v={vocab} />}
          <div className="mt-8 text-sm text-muted">Tippen zum Umdrehen</div>
        </Face>
        <Face side="back" hidden={!flipped}>
          <div className="mb-4 text-xs font-semibold text-muted">{faFront ? 'Deutsch' : 'Persisch'}</div>
          {faFront ? <German v={vocab} /> : <Persian v={vocab} />}
          <Extras v={vocab} />
        </Face>
      </div>
      <span className="sr-only" aria-live="polite">{flipped ? (faFront ? vocab.german : vocab.persian) : ''}</span>
    </div>
  );
}
