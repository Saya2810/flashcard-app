import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { mediaRefs } from '../lib/markdown';

/** Replaces media:ID references in a text with the stored data URLs. */
export function useResolvedMedia(text: string): string {
  const ids = mediaRefs(text);
  const key = ids.join(',');
  const map = useLiveQuery(async () => {
    if (!ids.length) return new Map<string, string>();
    const rows = await db.media.bulkGet(ids);
    return new Map(rows.filter((m): m is NonNullable<typeof m> => !!m).map((m) => [m.id, m.dataUrl]));
  }, [key]);
  if (!ids.length) return text;
  return text.replace(/media:([\w-]+)/g, (m, id) => map?.get(id) ?? m);
}
