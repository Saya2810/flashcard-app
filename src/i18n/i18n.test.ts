import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DIRECTION_OPTIONS } from '../pages/shared';
import { MODE_LABEL, PRIORITY_LABEL, STATUS_LABEL, FONT_LABEL } from '../types';
import { TARGET_LABEL } from '../db/import';
import { SCHEME_PRESETS } from '../conj/presets';
import { DEFAULT_LANG, LANGUAGES, getLang, locale, plural, setLang, t, tIn } from './index';

afterEach(() => { setLang(DEFAULT_LANG); localStorage.clear(); });

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'test' && name !== 'i18n') sourceFiles(p, out); }
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const unescape = (s: string) => s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n');
const PATTERN = /\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const f of sourceFiles('src')) {
    for (const m of readFileSync(f, 'utf8').matchAll(PATTERN)) keys.set(unescape(m[1] ?? m[2]), f);
  }
  return keys;
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('Localization architecture', () => {
  it('German is the source language and the default; English is registered', () => {
    expect(DEFAULT_LANG).toBe('de');
    expect(LANGUAGES.map((l) => l.code)).toEqual(['de', 'en']);
    expect(t('Heute')).toBe('Heute');
  });

  it('switches language at runtime, persists the choice and falls back to German for unknown texts', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    expect(t('Einstellungen')).toBe('Settings');
    expect(t('{n} Karten importiert', { n: 3 })).toBe('3 cards imported');
    expect(t('Dieser Text steht in keinem Wörterbuch')).toBe('Dieser Text steht in keinem Wörterbuch');
    expect(localStorage.getItem('lernkarten.uiLanguage')).toBe('en');
    expect(locale()).toBe('en-GB');
    expect(plural(1, 'Karte', 'Karten')).toBe('Card');
    expect(plural(2, 'Karte', 'Karten')).toBe('Cards');
    expect(tIn('de', 'Einstellungen')).toBe('Einstellungen');
    setLang('de');
    expect(t('Einstellungen')).toBe('Einstellungen');
    setLang('xx');
    expect(getLang()).toBe('de');
  });

  it('every UI text used with t(\'…\') exists in the English dictionary with the same placeholders', () => {
    const missing: string[] = [];
    const mismatched: string[] = [];
    for (const [key, file] of usedKeys()) {
      const en = tIn('en', key);
      if (en === key && !(key in LANGUAGES[1].dict)) missing.push(`${file}: ${key}`);
      else if (placeholders(key).join() !== placeholders(en).join()) mismatched.push(`${file}: ${key}`);
    }
    expect(missing).toEqual([]);
    expect(mismatched).toEqual([]);
  });

  it('label tables that are translated at render time are complete', () => {
    const en = LANGUAGES[1].dict;
    const labels = [
      ...Object.values(STATUS_LABEL), ...Object.values(PRIORITY_LABEL), ...Object.values(MODE_LABEL), ...Object.values(FONT_LABEL),
      ...Object.values(TARGET_LABEL), ...DIRECTION_OPTIONS.map((o) => o.label), ...SCHEME_PRESETS.map((p) => p.name),
      'Start', 'Lernen', 'Stapel', 'Statistik', 'Einstellungen', 'Rosa', 'Lavendel', 'Mint', 'Pfirsich', 'Himmelblau', 'Zitrone',
      'Automatisch', 'Hell', 'Dunkel', 'Klein', 'Normal', 'Groß', 'Sehr groß', 'Abgerundet', 'System', 'Serif',
      'Keine Angabe', 'Deutsch', 'Englisch', 'Persisch', 'Arabisch', 'Hebräisch', 'Urdu', 'Französisch', 'Spanisch', 'Italienisch', 'Portugiesisch', 'Niederländisch', 'Polnisch', 'Russisch', 'Ukrainisch', 'Türkisch', 'Griechisch', 'Latein', 'Japanisch', 'Chinesisch', 'Koreanisch', 'Hindi',
      'Karte', 'Karten', 'Stapel', 'Stapeln', 'Verb', 'Verben', 'Lektion', 'Lektionen', 'Form', 'Formen', 'Tag', 'Tage', 'Duplikat', 'Duplikate',
    ];
    expect(labels.filter((l) => !(l in en))).toEqual([]);
  });

  it('keeps all dictionary entries well-formed', () => {
    for (const [k, v] of Object.entries(LANGUAGES[1].dict)) {
      expect(v.trim(), k).not.toBe('');
      expect(placeholders(v), k).toEqual(placeholders(k));
    }
  });
});
