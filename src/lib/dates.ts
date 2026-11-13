import { locale, t } from '../i18n';

/** All timestamps are epoch milliseconds; calendar days are computed in LOCAL time. */
export const DAY_MS = 86_400_000;

export function dayKey(ts: number | Date): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function startOfDay(ts: number | Date): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Adds calendar days (DST-safe) and returns the start of that day. */
export function addDays(ts: number | Date, n: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

export function endOfDay(ts: number | Date): number {
  return addDays(ts, 1) - 1;
}

/** Whole calendar days between two points in time (b − a). */
export function calendarDaysBetween(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

export function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function relativeDay(ts: number, now = Date.now()): string {
  if (!ts) return '–';
  const n = calendarDaysBetween(now, ts);
  if (n === 0) return t('Heute');
  if (n === 1) return t('Morgen');
  if (n === -1) return t('Gestern');
  if (n > 1) return t('in {n} Tagen', { n });
  return t('vor {n} Tagen', { n: -n });
}

export function formatDate(ts: number): string {
  if (!ts) return '–';
  return new Date(ts).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(ts: number): string {
  if (!ts) return '–';
  return new Date(ts).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function shortDay(key: string): string {
  const d = keyToDate(key);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return t('Gute Nacht!');
  if (h < 11) return t('Guten Morgen!');
  if (h < 18) return t('Guten Tag!');
  return t('Guten Abend!');
}
