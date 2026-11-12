import { addLesson, buildVocab, deleteVocab, type VocabInput } from './repo';
import { db, type AppDB } from './db';

/** Sample data – clearly marked (sample: 1) and removable again in the settings. */
const VERBS: VocabInput[] = [
  { persian: 'آمدن', german: 'kommen', translit: 'âmadan', grammar: 'Verb · Präsensstamm آ', exampleFa: 'من به خانه می‌آیم.', exampleDe: 'Ich komme nach Hause.', priority: 5 },
  { persian: 'رفتن', german: 'gehen', altGerman: ['fahren'], translit: 'raftan', grammar: 'Verb · Präsensstamm رو', exampleFa: 'او به دانشگاه می‌رود.', exampleDe: 'Er/Sie geht zur Universität.', priority: 5 },
  { persian: 'ماندن', german: 'bleiben', translit: 'mândan', grammar: 'Verb · Präsensstamm مان', priority: 4 },
  { persian: 'دیدن', german: 'sehen', translit: 'didan', grammar: 'Verb · Präsensstamm بین', priority: 4 },
  { persian: 'خوردن', german: 'essen', altGerman: ['trinken'], translit: 'xordan', grammar: 'Verb · Präsensstamm خور', priority: 3 },
  { persian: 'نوشتن', german: 'schreiben', translit: 'neveštan', grammar: 'Verb · Präsensstamm نویس', priority: 3 },
  { persian: 'خواندن', german: 'lesen', altGerman: ['singen'], translit: 'xândan', grammar: 'Verb · Präsensstamm خوان', priority: 3 },
  { persian: 'گفتن', german: 'sagen', translit: 'goftan', grammar: 'Verb · Präsensstamm گو', priority: 4 },
  { persian: 'داشتن', german: 'haben', translit: 'dâštan', grammar: 'Verb · Präsensstamm دار', priority: 5 },
  { persian: 'بودن', german: 'sein', translit: 'budan', grammar: 'Verb', priority: 5 },
];
const DAILY: VocabInput[] = [
  { persian: 'سلام', german: 'Hallo', translit: 'salâm', priority: 3 },
  { persian: 'خداحافظ', german: 'Auf Wiedersehen', altGerman: ['Tschüss'], translit: 'xodâhâfez', priority: 3 },
  { persian: 'خانه', german: 'Haus', altGerman: ['Zuhause'], translit: 'xâne', grammar: 'Nomen', priority: 3 },
  { persian: 'کتاب', german: 'Buch', translit: 'ketâb', grammar: 'Nomen', exampleFa: 'این کتاب خوب است.', exampleDe: 'Dieses Buch ist gut.', priority: 3 },
  { persian: 'آب', german: 'Wasser', translit: 'âb', grammar: 'Nomen', priority: 2 },
  { persian: 'نان', german: 'Brot', translit: 'nân', grammar: 'Nomen', priority: 2 },
  { persian: 'دانشگاه', german: 'Universität', translit: 'dânešgâh', grammar: 'Nomen', priority: 4 },
  { persian: 'دوست', german: 'Freund', altGerman: ['Freundin'], translit: 'dust', grammar: 'Nomen', priority: 3 },
  { persian: 'امروز', german: 'heute', translit: 'emruz', grammar: 'Adverb', priority: 3 },
  { persian: 'فردا', german: 'morgen', translit: 'fardâ', grammar: 'Adverb', priority: 3 },
];

export async function loadSampleData(database: AppDB = db): Promise<number> {
  if (await database.vocab.where('sample').equals(1).count()) return 0;
  const sets: [string, string, VocabInput[]][] = [
    ['Beispiel – Grundverben', 'Beispieldaten zum Ausprobieren', VERBS],
    ['Beispiel – Alltag', 'Beispieldaten zum Ausprobieren', DAILY],
  ];
  let n = 0;
  let t = Date.now();
  for (const [name, desc, items] of sets) {
    const existing = await database.lessons.where('name').equals(name).first();
    const lesson = existing ?? (await addLesson(name, desc, 1, database));
    await database.vocab.bulkAdd(items.map((i) => buildVocab({ ...i, lessonId: lesson.id, tags: ['Beispiel'], sample: 1 }, t++)));
    n += items.length;
  }
  return n;
}

/**
 * Removes all sample items with their history and subtracts their answers
 * from the daily statistics – real progress stays untouched.
 */
export async function removeSampleData(database: AppDB = db): Promise<number> {
  const d = database;
  return d.transaction('rw', [d.vocab, d.lessons, d.states, d.reviews, d.days], async () => {
    const ids = await d.vocab.where('sample').equals(1).primaryKeys();
    const sub = new Map<string, { reviews: number; correct: number; incorrect: number; newCards: number; relearn: number }>();
    await d.reviews.where('vocabId').anyOf(ids).each((e) => {
      const r = sub.get(e.day) ?? { reviews: 0, correct: 0, incorrect: 0, newCards: 0, relearn: 0 };
      if (e.kind === 'relearn') r.relearn++;
      else {
        r.reviews++;
        if (e.correct) r.correct++; else r.incorrect++;
        if (e.meta?.wasNew) r.newCards++;
      }
      sub.set(e.day, r);
    });
    for (const [day, r] of sub) {
      const row = await d.days.get(day);
      if (!row) continue;
      const next = {
        ...row,
        reviews: Math.max(0, row.reviews - r.reviews),
        correct: Math.max(0, row.correct - r.correct),
        incorrect: Math.max(0, row.incorrect - r.incorrect),
        newCards: Math.max(0, row.newCards - r.newCards),
        relearn: Math.max(0, row.relearn - r.relearn),
      };
      if (next.reviews === 0 && next.relearn === 0) await d.days.delete(day);
      else await d.days.put(next);
    }
    await deleteVocab(ids, d);
    const sampleLessons = await d.lessons.where('sample').equals(1).toArray();
    for (const l of sampleLessons) {
      // Only delete the lesson if the user has not put their own items into it.
      if ((await d.vocab.where('lessonId').equals(l.id).count()) === 0) await d.lessons.delete(l.id);
      else await d.lessons.update(l.id, { sample: 0 });
    }
    return ids.length;
  });
}
