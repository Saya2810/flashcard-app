import { useMemo } from 'react';
import { closest, isIdentical, type DiffOptions, type DiffPart } from '../lib/diff';
import { plainText } from '../lib/text';
import { lookStyle, type TextLook } from './RichText';

function Line({ parts, show, look, testId }: { parts: DiffPart[]; show: 'typed' | 'solution'; look: TextLook; testId: string }) {
  return (
    <div data-testid={testId} dir={look.dir ?? 'auto'} lang={look.lang || undefined} style={lookStyle({ ...look, weight: 500 }, 1.05)} className="whitespace-pre-wrap [overflow-wrap:anywhere] [unicode-bidi:plaintext]">
      {parts.map((p, i) => {
        if (p.op === 'same') return <span key={i}>{p.text}</span>;
        if (show === 'typed' && p.op === 'extra') return <del key={i} className="diff-extra" title="zu viel oder falsch">{p.text}</del>;
        if (show === 'solution' && p.op === 'missing') return <ins key={i} className="diff-missing no-underline" title="fehlt">{p.text}</ins>;
        return null;
      })}
    </div>
  );
}

/**
 * Shows the typed answer next to the solution and marks differences character by character.
 * Informational only: the user still decides with Richtig/Falsch.
 */
export function AnswerDiff({ typed, answers, rich, look, options }: { typed: string; answers: string[]; rich: boolean; look: TextLook; options: DiffOptions }) {
  const { parts } = useMemo(() => closest(typed, answers.map((a) => (rich ? plainText(a) : a)), options), [typed, answers, rich, options]);
  if (!typed.trim()) return <p className="rounded-2xl bg-sunken px-3 py-2 text-sm text-muted">Keine Antwort eingegeben.</p>;
  const same = isIdentical(parts);
  return (
    <div className="w-full space-y-2 rounded-2xl bg-sunken p-3 text-start" data-testid="answer-diff">
      <div>
        <div className="mb-0.5 text-xs font-semibold text-muted">Deine Antwort</div>
        <Line parts={parts} show="typed" look={look} testId="diff-typed" />
      </div>
      {!same && (
        <div>
          <div className="mb-0.5 text-xs font-semibold text-muted">Lösung</div>
          <Line parts={parts} show="solution" look={look} testId="diff-solution" />
        </div>
      )}
      <p className="text-xs text-muted">
        {same ? 'Keine Unterschiede zur Lösung gefunden.' : <>Rot durchgestrichen: zu viel oder anders; rot unterstrichen: fehlt.</>} Du entscheidest selbst, ob es richtig war.
      </p>
    </div>
  );
}
