import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { getSettings } from '../db/repo';
import { DEFAULT_SETTINGS, type AppSettings } from '../types';

export function useSettings(): AppSettings {
  return useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS);
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Applies appearance settings to the document (light/dark, font sizes). */
export function useApplySettings(s: AppSettings) {
  useEffect(() => {
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const apply = () => {
      const dark = s.theme === 'dark' || (s.theme === 'system' && !!mq?.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0C1218' : '#F2F5F8');
    };
    apply();
    mq?.addEventListener('change', apply);
    return () => mq?.removeEventListener('change', apply);
  }, [s.theme]);
  useEffect(() => {
    document.documentElement.style.setProperty('--card-scale', String(s.cardFontScale));
    document.documentElement.style.setProperty('--fa-scale', String(s.persianFontScale));
  }, [s.cardFontScale, s.persianFontScale]);
}
