import type { FontKey, TextDir } from '../types';

/**
 * Starting points for schemes. They are plain data: choosing one just creates an ordinary,
 * fully editable scheme. The trainer itself knows nothing about any of these languages.
 */
export interface SchemePreset {
  id: string;
  /** Shown in the picker (German source text, translated with t()). */
  name: string;
  lang: string;
  dir: TextDir;
  font: FontKey;
  persons: string[];
  tenses: string[];
}

export const SCHEME_PRESETS: SchemePreset[] = [
  {
    id: 'de', name: 'Deutsch', lang: 'de', dir: 'ltr', font: 'system',
    persons: ['ich', 'du', 'er/sie/es', 'wir', 'ihr', 'sie/Sie'],
    tenses: ['Präsens', 'Präteritum', 'Perfekt', 'Plusquamperfekt', 'Futur I'],
  },
  {
    id: 'fa', name: 'Persisch', lang: 'fa', dir: 'rtl', font: 'vazirmatn',
    persons: ['من', 'تو', 'او', 'ما', 'شما', 'آن‌ها'],
    tenses: ['حال اخباری', 'گذشته ساده', 'گذشته استمراری', 'آینده'],
  },
  {
    id: 'en', name: 'Englisch', lang: 'en', dir: 'ltr', font: 'system',
    persons: ['I', 'you', 'he/she/it', 'we', 'you (pl.)', 'they'],
    tenses: ['Present', 'Past', 'Present perfect', 'Future'],
  },
  {
    id: 'blank', name: 'Leeres Schema', lang: '', dir: 'auto', font: 'system',
    persons: ['1'], tenses: ['1'],
  },
];
