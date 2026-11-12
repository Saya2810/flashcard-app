/**
 * Normalisation ONLY for search and duplicate detection.
 * The stored original text is never changed and never reversed manually.
 */
const MAP: Record<string, string> = {
  'ي': 'ی', 'ى': 'ی', 'ئ': 'ی',
  'ك': 'ک',
  'ة': 'ه', 'ۀ': 'ه',
  'أ': 'ا', 'إ': 'ا', 'ٱ': 'ا',
  'ؤ': 'و',
};
const DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeFa(input: string): string {
  let s = input.normalize('NFC');
  // Vowel marks (harakat), superscript alef, tatweel
  s = s.replace(/[ً-ٰٟـ]/g, '');
  // Half-space (ZWNJ) → space; other invisible direction marks are removed
  s = s.replace(/‌/g, ' ').replace(/[​‍‎‏‪-‮⁦-⁩]/g, '');
  let out = '';
  for (const ch of s) {
    if (MAP[ch]) out += MAP[ch];
    else if (DIGITS.includes(ch)) out += String(DIGITS.indexOf(ch));
    else if (AR_DIGITS.includes(ch)) out += String(AR_DIGITS.indexOf(ch));
    else out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** German/transliteration: lower-case, transliteration diacritics (â, š …) ignored, umlauts kept. */
export function normalizeLatin(input: string): string {
  return input
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ 'ä': '\u0001', 'ö': '\u0002', 'ü': '\u0003', 'ß': '\u0004' }[c] as string))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\u0001-\u0004]/g, (c) => ['ä', 'ö', 'ü', 'ß'][c.charCodeAt(0) - 1])
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasPersian(s: string): boolean {
  return /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(s);
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}
