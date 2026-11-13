import { useSyncExternalStore } from 'react';

/**
 * Localization of the app interface (NOT of the learning content).
 *
 * Design: German is the source language. `t('Stapel anlegen')` returns the German text unchanged
 * and looks the same string up in the dictionary of the active language. A missing entry falls back
 * to German, so a half-finished translation never shows blank labels.
 *
 * Adding a language:
 *   1. create src/i18n/<code>.ts exporting a `Record<string, string>` (German source → translation),
 *   2. register it in LANGUAGES below.
 * src/i18n/i18n.test.ts checks that every t('…') literal in src/ exists in every registered dictionary.
 *
 * Placeholders: t('{n} Karten', { n: 3 }). Dynamic keys (t(STATUS_LABEL[s])) are covered by the same test
 * through the label tables they come from.
 */
import { en } from './en';

export interface UiLanguage {
  code: string;
  /** Name in its own language – shown in the language picker. */
  name: string;
  /** Locale for dates and number formatting. */
  locale: string;
  dict: Record<string, string>;
}

export const LANGUAGES: UiLanguage[] = [
  { code: 'de', name: 'Deutsch', locale: 'de-DE', dict: {} },
  { code: 'en', name: 'English', locale: 'en-GB', dict: en },
];
export type LangCode = string;
export const DEFAULT_LANG: LangCode = 'de';
const STORAGE_KEY = 'lernkarten.uiLanguage';

const byCode = (code: string) => LANGUAGES.find((l) => l.code === code);
const isKnown = (code: unknown): code is string => typeof code === 'string' && !!byCode(code);

function readStored(): LangCode {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return isKnown(v) ? v : DEFAULT_LANG;
  } catch { return DEFAULT_LANG; }
}

let current: LangCode = readStored();
const listeners = new Set<() => void>();

export const getLang = () => current;
export const locale = () => byCode(current)?.locale ?? 'de-DE';

/** Switches the interface language. The choice is also mirrored to localStorage so the first paint is right. */
export function setLang(code: LangCode): void {
  const next = isKnown(code) ? code : DEFAULT_LANG;
  if (next === current) return;
  current = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode – the IndexedDB setting still applies */ }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

export type Params = Record<string, string | number>;

export function t(de: string, params?: Params): string {
  const text = byCode(current)?.dict[de] ?? de;
  return params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text;
}

/** Translation in a specific language (used by tests and by the coverage check). */
export function tIn(code: LangCode, de: string): string {
  return byCode(code)?.dict[de] ?? de;
}

/** Re-renders the component when the language changes. */
export function useLang(): LangCode {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getLang);
}

/** Pluralisation helper for simple one/other languages: plural(n, 'Karte', 'Karten'). */
export const plural = (n: number, one: string, other: string) => t(n === 1 ? one : other);
