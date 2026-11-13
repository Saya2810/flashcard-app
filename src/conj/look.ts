import type { TextLook } from '../components/RichText';
import type { ConjScheme } from './types';

/** Language, direction and font of a scheme – applied to every verb form of that scheme. */
export const schemeLook = (s: ConjScheme | undefined, weight = 500): TextLook => ({ lang: s?.lang, dir: s?.dir ?? 'auto', font: s?.font ?? 'system', scale: s?.scale ?? 1, weight });
