import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { getSettings } from '../db/repo';
import { setLang } from '../i18n';
import { DEFAULT_SETTINGS, FONT_STACK, type AppSettings } from '../types';

const UI_FONTS: Record<string, string> = { system: FONT_STACK.system, rounded: FONT_STACK.rounded, serif: FONT_STACK.serif };

export function useSettings(): AppSettings {
  return useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS);
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Applies appearance and language settings to the document (light/dark, font sizes, interface language). */
export function useApplySettings(s: AppSettings) {
  useEffect(() => {
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const apply = () => {
      const dark = s.theme === 'dark' || (s.theme === 'system' && !!mq?.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1A1117' : '#FCF1F5');
    };
    apply();
    mq?.addEventListener('change', apply);
    return () => mq?.removeEventListener('change', apply);
  }, [s.theme]);
  useEffect(() => {
    document.documentElement.style.setProperty('--card-scale', String(s.cardFontScale));
  }, [s.cardFontScale]);
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-font', UI_FONTS[s.uiFont] ?? UI_FONTS.rounded);
  }, [s.uiFont]);
  useEffect(() => {
    // DEFAULT_SETTINGS is only the placeholder before IndexedDB answered – do not let it override the stored language.
    if (s !== DEFAULT_SETTINGS) setLang(s.uiLanguage);
  }, [s]);
}
