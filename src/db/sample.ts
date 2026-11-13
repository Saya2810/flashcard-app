import type { CardInput, DeckInput } from './repo';
import { buildCard, buildDeck, deleteCards, deleteVerbRows } from './repo';
import { db, type AppDB } from './db';
import { newId } from '../lib/text';

/** Sample data – clearly marked (sample: 1) and removable again in the settings. */
type SampleCard = Omit<CardInput, 'deckId'> & { lesson?: string };
interface SampleDeck { deck: DeckInput; cards: SampleCard[] }

const SAMPLES: SampleDeck[] = [
  {
    deck: {
      name: 'Beispiel: Persisch – Deutsch', subject: 'Sprachen', color: 'rose', reverse: true, rich: false,
      description: 'Vokabeln mit Umschrift und Beispielsatz',
      front: { label: 'Persisch', lang: 'fa', dir: 'rtl', font: 'vazirmatn', scale: 1.1 },
      back: { label: 'Deutsch', lang: 'de', dir: 'ltr', font: 'system', weight: 700 },
      fields: [
        { key: 'umschrift', label: 'Umschrift', dir: 'ltr', font: 'system' },
        { key: 'beispiel', label: 'Beispiel', dir: 'rtl', font: 'vazirmatn' },
      ],
    },
    cards: [
      { lesson: 'Verben', front: 'آمدن', back: 'kommen', altBack: ['ankommen'], fields: { umschrift: 'âmadan', beispiel: 'من به خانه می‌آیم.' }, priority: 5 },
      { lesson: 'Verben', front: 'رفتن', back: 'gehen', altBack: ['fahren'], fields: { umschrift: 'raftan', beispiel: 'او به دانشگاه می‌رود.' }, priority: 5 },
      { lesson: 'Verben', front: 'خواندن', back: 'lesen', altBack: ['singen'], fields: { umschrift: 'xândan' }, priority: 3 },
      { lesson: 'Verben', front: 'نوشتن', back: 'schreiben', fields: { umschrift: 'neveštan' }, priority: 3 },
      { lesson: 'Alltag', front: 'سلام', back: 'Hallo', fields: { umschrift: 'salâm' }, priority: 3 },
      { lesson: 'Alltag', front: 'کتاب', back: 'Buch', fields: { umschrift: 'ketâb', beispiel: 'این کتاب خوب است.' }, priority: 3 },
      { lesson: 'Alltag', front: 'دانشگاه', back: 'Universität', fields: { umschrift: 'dânešgâh' }, priority: 4 },
    ],
  },
  {
    deck: {
      name: 'Beispiel: Analysis', subject: 'Mathematik', color: 'lavender', rich: true,
      description: 'Definitionen und Sätze mit Formeln',
      front: { label: 'Begriff', font: 'rounded', scale: 1 },
      back: { label: 'Definition', font: 'serif', scale: 0.9, weight: 400 },
    },
    cards: [
      { lesson: 'Grenzwerte', front: 'Grenzwert einer Folge', back: '$\\lim_{n\\to\\infty} a_n = a$ genau dann, wenn\n$$\\forall \\varepsilon > 0\\ \\exists N\\ \\forall n \\ge N: |a_n - a| < \\varepsilon$$', priority: 5 },
      { lesson: 'Grenzwerte', front: 'Stetigkeit (ε-δ)', back: '$f$ ist stetig in $x_0$, wenn\n$$\\forall \\varepsilon>0\\ \\exists \\delta>0: |x-x_0|<\\delta \\Rightarrow |f(x)-f(x_0)|<\\varepsilon$$', priority: 4 },
      { lesson: 'Ableitungen', front: 'Ableitung von $\\sin x$', back: '$\\cos x$', priority: 3 },
      { lesson: 'Ableitungen', front: 'Kettenregel', back: '$$(f \\circ g)\'(x) = f\'(g(x)) \\cdot g\'(x)$$', priority: 4 },
      { lesson: 'Integrale', front: 'Hauptsatz der Differential- und Integralrechnung', back: 'Ist $F$ eine Stammfunktion von $f$, dann gilt\n$$\\int_a^b f(x)\\,dx = F(b) - F(a)$$', priority: 5 },
    ],
  },
  {
    deck: {
      name: 'Beispiel: Physik', subject: 'Physik', color: 'sky', rich: true, reverse: true,
      description: 'Formeln in beide Richtungen',
      front: { label: 'Größe', font: 'rounded' },
      back: { label: 'Formel', font: 'serif', scale: 1.15, weight: 400 },
    },
    cards: [
      { front: 'Kinetische Energie', back: '$E_\\text{kin} = \\tfrac{1}{2} m v^2$', priority: 4 },
      { front: 'Masse-Energie-Äquivalenz', back: '$E = mc^2$', priority: 3 },
      { front: 'Newtons zweites Gesetz', back: '$\\vec F = m \\vec a$', priority: 4 },
      { front: 'Ohmsches Gesetz', back: '$U = R \\cdot I$', priority: 3 },
    ],
  },
  {
    deck: {
      name: 'Beispiel: Python', subject: 'Programmierung', color: 'mint', rich: true,
      description: 'Code-Schnipsel auswendig können',
      front: { label: 'Aufgabe', font: 'system' },
      back: { label: 'Code', font: 'mono', scale: 0.9, weight: 400 },
    },
    cards: [
      { front: 'Liste umkehren (neue Liste)', back: '```python\nreversed_list = my_list[::-1]\n```', priority: 3 },
      { front: 'Wörterbuch nach Werten sortieren', back: '```python\nsorted(d.items(), key=lambda kv: kv[1])\n```', priority: 3 },
      { front: 'Datei zeilenweise lesen', back: '```python\nwith open("datei.txt", encoding="utf-8") as f:\n    for line in f:\n        print(line.rstrip())\n```', priority: 4 },
    ],
  },
];

export async function loadSampleData(database: AppDB = db): Promise<number> {
  const d = database;
  if (await d.decks.where('sample').equals(1).count()) return 0;
  return d.transaction('rw', d.decks, d.lessons, d.cards, async () => {
    let n = 0;
    let t = Date.now();
    for (const s of SAMPLES) {
      if (await d.decks.where('name').equals(s.deck.name).count()) continue;
      const deck = buildDeck({ ...s.deck, sample: 1 });
      await d.decks.add(deck);
      const lessons = new Map<string, string>();
      for (const name of new Set(s.cards.map((c) => c.lesson).filter((x): x is string => !!x))) {
        const id = newId();
        await d.lessons.add({ id, deckId: deck.id, name, description: '', createdAt: t, lastPracticedAt: 0 });
        lessons.set(name, id);
      }
      await d.cards.bulkAdd(s.cards.map(({ lesson, ...c }) => buildCard({ ...c, deckId: deck.id, lessonId: lesson ? lessons.get(lesson) : '', tags: ['Beispiel'], sample: 1 }, t++)));
      n += s.cards.length;
    }
    return n;
  });
}

/**
 * Removes all sample decks and sample cards with their history and subtracts their answers
 * from the daily statistics – real progress stays untouched.
 */
export async function removeSampleData(database: AppDB = db): Promise<number> {
  const d = database;
  return d.transaction('rw', [d.decks, d.lessons, d.cards, d.states, d.reviews, d.days, d.verbs, d.formStates, d.formReviews], async () => {
    const sampleDecks = await d.decks.where('sample').equals(1).toArray();
    const verbIds: string[] = [];
    for (const deck of sampleDecks) verbIds.push(...(await d.verbs.where('deckId').equals(deck.id).primaryKeys()));
    const ids = new Set(await d.cards.where('sample').equals(1).primaryKeys());
    for (const deck of sampleDecks) for (const id of await d.cards.where('deckId').equals(deck.id).primaryKeys()) ids.add(id);
    const sub = new Map<string, { reviews: number; correct: number; incorrect: number; newCards: number; relearn: number }>();
    const events = [...(await d.reviews.where('cardId').anyOf([...ids]).toArray()), ...(await d.formReviews.where('verbId').anyOf(verbIds).toArray())];
    events.forEach((e) => {
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
    await deleteCards([...ids], d);
    await deleteVerbRows(verbIds, d);
    for (const deck of sampleDecks) {
      await d.lessons.where('deckId').equals(deck.id).delete();
      await d.decks.delete(deck.id);
    }
    return ids.size;
  });
}
