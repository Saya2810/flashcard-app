import { useMemo } from 'react';
import { t } from '../i18n';
import { closest, isIdentical, type DiffOptions, type DiffPart } from '../lib/diff';
import { plainText } from '../lib/text';
import { lookStyle, type TextLook } from './RichText';

function Line({ parts, show, look, testId }: { parts: DiffPart[]; show: 'typed' | 'solution'; look: TextLook; testId: string }) {
  return (
    <div data-testid={testId} dir={look.dir ?? 'auto'} lang={look.lang || undefined} style={lookStyle({ ...look, weight: 500 }, 1.05)} className="whitespace-pre-wrap [overflow-wrap:anywhere] [unicode-bidi:plaintext]">
      {parts.map((p, i) => {
        if (p.op === 'same') return <span key={i}>{p.text}</span>;
        if (show === 'typed' && p.op === 'extra') return <del key={i} className="diff-extra" title={t('zu viel oder falsch')}>{p.text}</del>;
        if (show === 'solution' && p.op === 'missing') return <ins key={i} className="diff-missing no-underline" title={t('fehlt')}>{p.text}</ins>;
        return null;
      })}
    </div>
  );
}

export interface AnswerDiffProps {
  typed: string;
  answers: string[];
  rich: boolean;
  look: TextLook;
  options: DiffOptions;
  /** Show the correct form even when it matches, and also when nothing was typed (used by the conjugation results). */
  alwaysShowSolution?: boolean;
  /** Omit the explanatory footer (lists of many comparisons show it once). */
  hideNote?: boolean;
}

/**
 * Shows the typed answer next to the solution and marks differences character by character:
 * extra or wrong characters are struck through in red, missing ones are underlined in red.
 * Informational only: the user still decides with Richtig/Falsch.
 */
export function AnswerDiff({ typed, answers, rich, look, options, alwaysShowSolution = false, hideNote = false }: AnswerDiffProps) {
  const { parts } = useMemo(() => closest(typed, answers.map((a) => (rich ? plainText(a) : a)), options), [typed, answers, rich, options]);
  const empty = !typed.trim();
  if (empty && !alwaysShowSolution) return <p className="rounded-2xl bg-sunken px-3 py-2 text-sm text-muted">{t('Keine Antwort eingegeben.')}</p>;
  const same = !empty && isIdentical(parts);
  return (
    <div className="w-full space-y-2 rounded-2xl bg-sunken p-3 text-start" data-testid="answer-diff">
      <div>
        <div className="mb-0.5 text-xs font-semibold text-muted">{t('Deine Antwort')}</div>
        {empty ? <div data-testid="diff-typed" className="text-sm text-muted">{t('Keine Antwort eingegeben.')}</div> : <Line parts={parts} show="typed" look={look} testId="diff-typed" />}
      </div>
      {(!same || alwaysShowSolution) && (
        <div>
          <div className="mb-0.5 text-xs font-semibold text-muted">{t('Lösung')}</div>
          <Line parts={parts} show="solution" look={look} testId="diff-solution" />
        </div>
      )}
      {!hideNote && (
        <p className="text-xs text-muted">
          {same ? t('Keine Unterschiede zur Lösung gefunden.') : t('Rot durchgestrichen: zu viel oder anders; rot unterstrichen: fehlt.')} {t('Du entscheidest selbst, ob es richtig war.')}
        </p>
      )}
    </div>
  );
}
