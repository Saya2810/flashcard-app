/**
 * Text helpers for any script. Normalisation is ONLY used for search and duplicate keys;
 * stored text is never changed and never reversed manually.
 */
const ARABIC_VARIANTS: Record<string, string> = {
  'ي': 'ی', 'ى': 'ی', 'ئ': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه',
  'أ': 'ا', 'إ': 'ا', 'ٱ': 'ا', 'آ': 'ا', 'ؤ': 'و',
};
const DIGIT_SETS = ['۰۱۲۳۴۵۶۷۸۹', '٠١٢٣٤٥٦٧٨٩'];

function base(input: string): string {
  let s = input.normalize('NFC');
  s = s.replace(/[ً-ٰٟـ]/g, ''); // Arabic harakat, superscript alef, tatweel
  s = s.replace(/‌/g, ' ').replace(/[​‍‎‏‪-‮⁦-⁩﻿]/g, '');
  let out = '';
  for (const ch of s) {
    const set = DIGIT_SETS.find((d) => d.includes(ch));
    out += set ? String(set.indexOf(ch)) : ARABIC_VARIANTS[ch] ?? ch;
  }
  return out.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Strict key for duplicate detection: keeps accents (Bär ≠ Bar), unifies Arabic/Persian variants. */
export const dupKey = (s: string) => base(s);

/** Loose key for search: additionally ignores Latin diacritics (é = e, â = a, ü = u). */
export const searchKey = (s: string) => base(s).normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const STRONG_LTR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;
export const hasRtl = (s: string) => RTL.test(s);

/** Direction of the first strong character (what dir="auto" does), for places where we need it in JS. */
export function detectDir(s: string): 'ltr' | 'rtl' {
  for (const ch of s) {
    if (RTL.test(ch)) return 'rtl';
    if (STRONG_LTR.test(ch)) return 'ltr';
  }
  return 'ltr';
}

/** Rough plain text of Markdown/LaTeX source, for previews and diffs ($…$ delimiters are dropped, TeX is kept). */
export function plainText(md: string): string {
  return md
    .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
    .replace(/\$((?:\\\$|[^$\n])+?)\$/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/```[^\n]*\n?/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_]/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .trim();
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

/** Field key from a free label, e.g. „Beispiel (Deutsch)“ → beispiel_deutsch. */
export function fieldKey(label: string, taken: string[] = []): string {
  const k = (searchKey(label).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || 'feld').slice(0, 32);
  let key = k;
  let i = 2;
  while (taken.includes(key)) key = `${k}_${i++}`;
  return key;
}
