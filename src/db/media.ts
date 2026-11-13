import { newId } from '../lib/text';
import type { Media } from '../types';
import { db, type AppDB } from './db';

export const MAX_SIDE = 1400;

/** Scales an image down (max 1400 px), stores it and returns the Markdown reference. */
export async function storeImage(file: Blob, database: AppDB = db): Promise<{ media: Media; markdown: string }> {
  const { dataUrl, width, height, mime } = await shrink(file);
  const media: Media = { id: newId(), mime, dataUrl, width, height, createdAt: Date.now() };
  await database.media.add(media);
  return { media, markdown: `![](media:${media.id})` };
}

async function shrink(file: Blob): Promise<{ dataUrl: string; width: number; height: number; mime: string }> {
  const original = await readAsDataUrl(file);
  if (file.type === 'image/gif' || file.type === 'image/svg+xml' || typeof document === 'undefined') {
    return { dataUrl: original, width: 0, height: 0, mime: file.type };
  }
  const img = await loadImage(original);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  if (scale === 1 && file.size < 400_000) return { dataUrl: original, width: w, height: h, mime: file.type };
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return { dataUrl: canvas.toDataURL(mime, 0.86), width: w, height: h, mime };
}

const readAsDataUrl = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(b);
});
const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => rej(new Error('Bild konnte nicht gelesen werden.'));
  i.src = src;
});

/** Removes images no card references any more. */
export async function pruneMedia(database: AppDB = db): Promise<number> {
  const used = new Set<string>();
  await database.cards.each((c) => {
    for (const t of [c.front, c.back, c.notes, ...Object.values(c.fields)]) for (const m of t.matchAll(/media:([\w-]+)/g)) used.add(m[1]);
  });
  const all = await database.media.toCollection().primaryKeys();
  const unused = all.filter((id) => !used.has(id));
  await database.media.bulkDelete(unused);
  return unused.length;
}
