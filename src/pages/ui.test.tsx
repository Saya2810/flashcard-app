import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { Flashcard } from '../components/Flashcard';
import { db, stateId } from '../db/db';
import { buildCard, buildDeck, saveSettings } from '../db/repo';
import { answers, card, deck, resetDb } from '../test/helpers';
import type { SessionConfig } from '../types';
import CardList from './CardList';
import DeckForm from './DeckForm';
import Problems from './Problems';
import Session from './Session';
import Stats from './Stats';

beforeEach(resetDb);

const faDeck = buildDeck({
  name: 'Persisch', reverse: true, rich: false,
  front: { label: 'Persisch', lang: 'fa', dir: 'rtl', font: 'vazirmatn' }, back: { label: 'Deutsch', lang: 'de', dir: 'ltr' },
  fields: [{ key: 'um', label: 'Umschrift', dir: 'ltr', font: 'system' }],
});
const faCard = buildCard({ deckId: faDeck.id, front: 'آمدن', back: 'kommen', altBack: ['ankommen'], fields: { um: 'âmadan' }, notes: 'Präsensstamm آ' });
const mathDeck = buildDeck({ name: 'Mathe', rich: true, front: { label: 'Begriff' }, back: { label: 'Formel' } });
const mathCard = buildCard({ deckId: mathDeck.id, front: 'Kettenregel', back: "$$(f\\circ g)'(x) = f'(g(x))\\,g'(x)$$\n\n```python\nprint('x')\n```" });

describe('Flashcard', () => {
  it('shows the front first and flips on tap', () => {
    let flipped = false;
    const view = (f: boolean) => <Flashcard card={faCard} deck={faDeck} direction="fwd" flipped={f} onFlip={() => { flipped = !flipped; }} />;
    const { rerender } = render(view(false));
    const c = screen.getByTestId('flashcard');
    expect(c).toHaveAttribute('data-flipped', 'false');
    expect(screen.getByTestId('card-back')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(c);
    expect(flipped).toBe(true);
    rerender(view(true));
    const back = within(screen.getByTestId('card-back'));
    expect(back.getByText('kommen')).toBeInTheDocument();
    expect(back.getByText('âmadan')).toBeInTheDocument();
    expect(back.getByText('Umschrift')).toBeInTheDocument();
    expect(back.getByText('ankommen')).toBeInTheDocument();
    expect(back.getByText('Präsensstamm آ')).toBeInTheDocument();
  });

  it('can be flipped with the keyboard', () => {
    let n = 0;
    render(<Flashcard card={faCard} deck={faDeck} direction="fwd" flipped={false} onFlip={() => n++} />);
    fireEvent.keyDown(screen.getByTestId('flashcard'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByTestId('flashcard'), { key: ' ' });
    expect(n).toBe(2);
  });

  it('applies the deck\'s language, direction and font; text stays unchanged', () => {
    render(<Flashcard card={faCard} deck={faDeck} direction="fwd" flipped={false} onFlip={() => {}} />);
    const q = screen.getByTestId('question');
    expect(q).toHaveAttribute('dir', 'rtl');
    expect(q).toHaveAttribute('lang', 'fa');
    expect(q.style.fontFamily).toContain('Vazirmatn');
    expect(q.textContent).toBe('آمدن');
  });

  it('back → front direction puts the back side first', () => {
    render(<Flashcard card={faCard} deck={faDeck} direction="rev" flipped={false} onFlip={() => {}} />);
    expect(within(screen.getByTestId('card-front')).getByText('kommen')).toBeInTheDocument();
    expect(within(screen.getByTestId('card-back')).getByText('آمدن')).toBeInTheDocument();
  });

  it('renders LaTeX and code blocks in rich decks', () => {
    render(<Flashcard card={mathCard} deck={mathDeck} direction="fwd" flipped onFlip={() => {}} />);
    const a = screen.getByTestId('answer');
    expect(a.querySelector('.katex-display')).not.toBeNull();
    expect(a.querySelector('pre code')?.textContent).toContain("print('x')");
  });

  it('typed-answer mode shows the diff after flipping, without any verdict', () => {
    const { rerender } = render(<Flashcard card={faCard} deck={faDeck} direction="fwd" flipped={false} onFlip={() => {}} typed="komen" />);
    expect(screen.queryByTestId('answer-diff')).toBeNull();
    rerender(<Flashcard card={faCard} deck={faDeck} direction="fwd" flipped onFlip={() => {}} typed="komen" />);
    const diff = screen.getByTestId('answer-diff');
    expect(within(diff).getByTestId('diff-typed').textContent).toBe('komen');
    const missing = within(diff).getByTestId('diff-solution').querySelector('ins');
    expect(missing?.textContent).toBe('m');
    expect(diff.textContent).toContain('Du entscheidest selbst');
    expect(diff.textContent).not.toMatch(/\b(korrekt|falsch)\b/i);
  });

  it('compares against the closest accepted answer', () => {
    render(<Flashcard card={faCard} deck={faDeck} direction="fwd" flipped onFlip={() => {}} typed="ankommen" />);
    expect(screen.getByTestId('answer-diff').textContent).toContain('Keine Unterschiede');
  });
});

function renderSession(cfg: SessionConfig) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/lernen/sitzung', state: cfg }]}>
      <Routes><Route path="/lernen/sitzung" element={<Session />} /><Route path="*" element={<div>woanders</div>} /></Routes>
    </MemoryRouter>,
  );
}
const cfg = (p: Partial<SessionConfig> = {}): SessionConfig => ({ mode: 'lesson', direction: 'fwd', deckIds: [], lessonIds: [], priorities: [], size: 20, ...p });
const front = async () => ((await screen.findByTestId('question')).textContent ?? '').trim();

describe('Study session', () => {
  it('shows exactly two answer buttons after flipping: Falsch and Richtig', async () => {
    await card();
    renderSession(cfg());
    const c = await screen.findByTestId('flashcard');
    expect(screen.queryByTestId('btn-right')).toBeNull();
    fireEvent.click(c);
    const buttons = within(screen.getByTestId('btn-right').parentElement!).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Falsch', 'Richtig']);
  });

  it('brings a wrong card back in the same session and persists everything', async () => {
    const d = await deck();
    const a = await card('آمدن', 'kommen', { deckId: d.id });
    const b = await card('رفتن', 'gehen', { deckId: d.id });
    renderSession(cfg());
    expect(await front()).toBe('آمدن');
    fireEvent.click(screen.getByTestId('flashcard'));
    fireEvent.click(screen.getByTestId('btn-wrong'));
    await waitFor(async () => expect(await front()).toBe('رفتن'));
    fireEvent.click(screen.getByTestId('flashcard'));
    fireEvent.click(screen.getByTestId('btn-right'));
    await screen.findByText(/Noch einmal/);
    expect(await front()).toBe('آمدن');
    expect(screen.getByTestId('progress').textContent).toBe('2 / 3');
    fireEvent.click(screen.getByTestId('flashcard'));
    fireEvent.click(screen.getByTestId('btn-right'));
    await screen.findByTestId('summary');
    expect(screen.getByTestId('sum-correct').textContent).toBe('1');
    expect(screen.getByTestId('sum-incorrect').textContent).toBe('1');
    expect(await db.states.get(stateId(a.id, 'fwd'))).toMatchObject({ total: 1, incorrect: 1 });
    expect((await db.states.get(stateId(b.id, 'fwd')))?.correct).toBe(1);
    expect(await db.reviews.count()).toBe(3);
    expect((await db.sessions.toArray())[0]).toMatchObject({ planned: 2, answered: 2, correct: 1, incorrect: 1 });
  });

  it('typed answers are stored for reference, but only the button decides', async () => {
    await saveSettings({ typedAnswer: true });
    const c = await card('cat', 'Katze');
    renderSession(cfg());
    const input = await screen.findByTestId('typed-input');
    fireEvent.change(input, { target: { value: 'Katze' } });
    fireEvent.click(screen.getByTestId('reveal'));
    expect(await screen.findByTestId('answer-diff')).toHaveTextContent('Keine Unterschiede');
    // identical answer – user still marks it wrong, and that is what counts
    fireEvent.click(screen.getByTestId('btn-wrong'));
    await waitFor(async () => expect((await db.states.get(stateId(c.id, 'fwd')))?.incorrect).toBe(1));
    const [ev] = await db.reviews.toArray();
    expect(ev).toMatchObject({ correct: false, typed: 'Katze' });
  });

  it('Enter in the answer field reveals the solution', async () => {
    await saveSettings({ typedAnswer: true });
    await card('cat', 'Katze');
    renderSession(cfg());
    const input = await screen.findByTestId('typed-input');
    fireEvent.change(input, { target: { value: 'Kaze' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByTestId('btn-right')).toBeInTheDocument();
    expect(screen.getByTestId('diff-solution').querySelector('ins')?.textContent).toBe('t');
  });

  it('free practice changes neither schedule nor statistics', async () => {
    const d = await deck();
    await card('a', 'b', { deckId: d.id });
    await card('c', 'd', { deckId: d.id });
    renderSession(cfg({ mode: 'free' }));
    fireEvent.click(await screen.findByTestId('flashcard'));
    expect(screen.getByText(/zählt nicht für den Lernplan/)).toBeInTheDocument();
    expect(screen.queryByTestId('btn-right')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(screen.getByTestId('progress').textContent).toBe('2 / 2');
    expect(await db.reviews.count()).toBe(0);
    expect(await db.states.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
  });

  it('only studies the chosen deck', async () => {
    const a = await card('nur hier', 'x');
    await card('anderer Stapel', 'y');
    renderSession(cfg({ deckIds: [a.deckId] }));
    expect(await front()).toBe('nur hier');
    expect(screen.getByTestId('progress').textContent).toBe('0 / 1');
  });

  it('explains an empty session instead of showing a blank card', async () => {
    renderSession(cfg({ mode: 'problem' }));
    expect(await screen.findByText('Nichts zu lernen')).toBeInTheDocument();
  });
});

describe('Pages', () => {
  it('statistics shows an empty state without cards', async () => {
    render(<MemoryRouter><Stats /></MemoryRouter>);
    expect(await screen.findByText('Noch nichts auszuwerten')).toBeInTheDocument();
  });

  it('statistics shows daily values and per-deck stats after answers', async () => {
    const v = await card();
    await answers(v.id, '01', { start: Date.now() - 1000, gapDays: 0 });
    render(<MemoryRouter><Stats /></MemoryRouter>);
    expect(await screen.findByText('Lernaktivität pro Tag')).toBeInTheDocument();
    expect(await screen.findByTestId('deck-stat')).toBeInTheDocument();
    expect(screen.getAllByText('50 %').length).toBeGreaterThan(0);
  });

  it('search finds Persian words typed with Arabic letters, and text in custom fields', async () => {
    const d = await deck({ fields: [{ key: 'um', label: 'Umschrift', dir: 'ltr', font: 'system' }] });
    await card('کتاب', 'Buch', { deckId: d.id, fields: { um: 'ketâb' } });
    await card('یک', 'eins', { deckId: d.id });
    await card('Integral', '$\\int f$', { deckId: d.id });
    render(<MemoryRouter><CardList /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('card-count').textContent).toBe('3 Karten'));
    const search = screen.getByLabelText('Karten durchsuchen');
    fireEvent.change(search, { target: { value: 'كتاب' } });
    await waitFor(() => expect(screen.getByTestId('card-count').textContent).toBe('1 Karte'));
    fireEvent.change(search, { target: { value: 'ketab' } });
    await waitFor(() => expect(screen.getByText('Buch')).toBeInTheDocument());
    fireEvent.change(search, { target: { value: 'يك' } });
    await waitFor(() => expect(screen.getByText('eins')).toBeInTheDocument());
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(await screen.findByText('Nichts gefunden')).toBeInTheDocument();
  });

  it('problem page separates detected cards from those with too little data', async () => {
    const hard = await card('آمدن', 'kommen');
    const once = await card('رفتن', 'gehen');
    await answers(hard.id, '001000');
    await answers(once.id, '0');
    render(<MemoryRouter><Problems /></MemoryRouter>);
    const table = await screen.findByTestId('problem-table');
    expect(within(table).getByText('آمدن')).toBeInTheDocument();
    expect(within(table).getByText('83 %')).toBeInTheDocument();
    expect(within(table).queryByText('رفتن')).toBeNull();
    expect(screen.getByText('Noch zu wenig Daten')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'آمدن auswählen' }));
    expect(screen.getByTestId('practice-selected')).toHaveTextContent('Auswahl üben (1)');
  });

  it('deck form creates a deck with language, direction, font and custom fields', async () => {
    render(<MemoryRouter initialEntries={['/stapel/neu']}><Routes><Route path="/stapel/neu" element={<DeckForm />} /><Route path="/stapel/:id" element={<div>Detail</div>} /></Routes></MemoryRouter>);
    fireEvent.change(screen.getByTestId('in-deck-name'), { target: { value: 'Arabisch' } });
    fireEvent.change(screen.getByTestId('in-deck-subject'), { target: { value: 'Sprachen' } });
    const langs = screen.getAllByLabelText('Sprache') as HTMLSelectElement[];
    fireEvent.change(langs[0], { target: { value: 'ar' } });
    fireEvent.click(screen.getByTestId('in-deck-reverse'));
    fireEvent.click(screen.getByTestId('add-field'));
    fireEvent.change(screen.getByLabelText('Feldname'), { target: { value: 'Wurzel' } });
    fireEvent.click(screen.getByTestId('save-deck'));
    await screen.findByText('Detail');
    const d = (await db.decks.where('name').equals('Arabisch').first())!;
    expect(d).toMatchObject({ subject: 'Sprachen', reverse: true, front: { lang: 'ar', dir: 'rtl', font: 'vazirmatn' } });
    expect(d.fields.map((f) => f.label)).toEqual(['Wurzel']);
  });
});
