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
  if (n === 0) return 'Heute';
  if (n === 1) return 'Morgen';
  if (n === -1) return 'Gestern';
  if (n > 1) return `in ${n} Tagen`;
  return `vor ${-n} Tagen`;
}

export function formatDate(ts: number): string {
  if (!ts) return '–';
  return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(ts: number): string {
  if (!ts) return '–';
  return new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function shortDay(key: string): string {
  const d = keyToDate(key);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Gute Nacht!';
  if (h < 11) return 'Guten Morgen!';
  if (h < 18) return 'Guten Tag!';
  return 'Guten Abend!';
}
