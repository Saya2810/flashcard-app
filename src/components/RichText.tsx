import { useMemo, type CSSProperties } from 'react';
import { useResolvedMedia } from '../hooks/useMedia';
import { renderMarkdown } from '../lib/markdown';
import { FONT_STACK, type FontKey, type SideStyle, type TextDir } from '../types';
import { cx } from './ui';

export interface TextLook { lang?: string; dir?: TextDir; font?: FontKey; scale?: number; weight?: number }

export function lookStyle(look: TextLook, baseRem: number): CSSProperties {
  return {
    fontFamily: FONT_STACK[look.font ?? 'system'],
    fontSize: `calc(${baseRem}rem * ${look.scale ?? 1} * var(--card-scale))`,
    fontWeight: look.weight ?? 400,
    lineHeight: look.font === 'vazirmatn' ? 1.85 : undefined,
  };
}

/**
 * Renders card text. rich = Markdown + LaTeX + code + images; otherwise plain text with line breaks.
 * Direction comes from dir (auto = per paragraph from its first strong character); text is never reversed.
 */
export function RichText({ text, rich, look, baseRem = 1, className, testId }: { text: string; rich: boolean; look: TextLook; baseRem?: number; className?: string; testId?: string }) {
  const resolved = useResolvedMedia(text);
  const html = useMemo(() => (rich ? renderMarkdown(resolved) : null), [resolved, rich]);
  const props = { lang: look.lang || undefined, dir: look.dir ?? 'auto', style: lookStyle(look, baseRem), 'data-testid': testId };
  if (html !== null) return <div {...props} className={cx('rich', className)} dangerouslySetInnerHTML={{ __html: html }} />;
  return <div {...props} className={cx('whitespace-pre-wrap [overflow-wrap:anywhere] [unicode-bidi:plaintext]', className)}>{text}</div>;
}

/** Size class for the question/answer by length (long text gets smaller). */
export function baseSize(text: string, rich: boolean): number {
  const n = text.replace(/\$[^$]*\$/g, 'xxxx').length;
  if (rich && /```|\$\$|\n/.test(text)) return 1.15;
  if (n > 120) return 1.1;
  if (n > 50) return 1.35;
  if (n > 18) return 1.75;
  return 2.35;
}

export const sideLook = (s: SideStyle): TextLook => ({ lang: s.lang, dir: s.dir, font: s.font, scale: s.scale, weight: s.weight });
