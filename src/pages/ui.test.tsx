import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { Flashcard } from '../components/Flashcard';
import { db, stateId } from '../db/db';
import { buildVocab } from '../db/repo';
import { answers, resetDb, word } from '../test/helpers';
import type { SessionConfig } from '../types';
import Problems from './Problems';
import Session from './Session';
import Stats from './Stats';
import VocabList from './VocabList';

beforeEach(resetDb);

const sample = buildVocab({ persian: 'آمدن', german: 'kommen', altGerman: ['ankommen'], translit: 'âmadan', grammar: 'Verb', exampleFa: 'من می‌آیم.', exampleDe: 'Ich komme.' });

describe('Flashcard', () => {
  it('shows the front first and flips on tap', () => {
    let flipped = false;
    const view = (f: boolean) => <Flashcard vocab={sample} direction="fa-de" flipped={f} onFlip={() => { flipped = !flipped; }} />;
    const { rerender } = render(view(false));
    const card = screen.getByTestId('flashcard');
    expect(card).toHaveAttribute('data-flipped', 'false');
    expect(screen.getByTestId('card-front')).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByTestId('card-back')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(card);
    expect(flipped).toBe(true);
    rerender(view(true));
    expect(card).toHaveAttribute('data-flipped', 'true');
    expect(screen.getByTestId('card-back')).toHaveAttribute('aria-hidden', 'false');
    const back = within(screen.getByTestId('card-back'));
    expect(back.getByText('kommen')).toBeInTheDocument();
    expect(back.getByText('âmadan')).toBeInTheDocument();
    expect(back.getByText('auch: ankommen')).toBeInTheDocument();
    expect(back.getByText('Ich komme.')).toBeInTheDocument();
  });

  it('can be flipped with the keyboard', () => {
    let n = 0;
    render(<Flashcard vocab={sample} direction="fa-de" flipped={false} onFlip={() => n++} />);
    fireEvent.keyDown(screen.getByTestId('flashcard'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByTestId('flashcard'), { key: ' ' });
    expect(n).toBe(2);
  });

  it('renders Persian text with dir="rtl" and lang="fa", unchanged', () => {
    render(<Flashcard vocab={sample} direction="fa-de" flipped={false} onFlip={() => {}} />);
    const fa = within(screen.getByTestId('card-front')).getByText('آمدن');
    expect(fa).toHaveAttribute('dir', 'rtl');
    expect(fa).toHaveAttribute('lang', 'fa');
    expect(fa.textContent).toBe('آمدن');
  });

  it('German → Persian direction shows German on the front', () => {
    render(<Flashcard vocab={sample} direction="de-fa" flipped={false} onFlip={() => {}} />);
    expect(within(screen.getByTestId('card-front')).getByText('kommen')).toBeInTheDocument();
    expect(within(screen.getByTestId('card-back')).getByText('آمدن')).toBeInTheDocument();
  });

  it('shrinks very long Persian expressions and can disable animation', () => {
    const long = buildVocab({ persian: 'من هر روز صبح زود از خواب بیدار می‌شوم و به دانشگاه می‌روم', german: 'lang' });
    render(<Flashcard vocab={long} direction="fa-de" flipped={false} onFlip={() => {}} animations={false} />);
    expect(screen.getByText(long.persian).closest('.text-2xl')).not.toBeNull();
    expect(screen.getByTestId('flashcard').className).toContain('no-anim');
  });
});

function renderSession(cfg: SessionConfig) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/lernen/sitzung', state: cfg }]}>
      <Routes><Route path="/lernen/sitzung" element={<Session />} /><Route path="*" element={<div>woanders</div>} /></Routes>
    </MemoryRouter>,
  );
}
const cfg = (p: Partial<SessionConfig> = {}): SessionConfig => ({ mode: 'lesson', direction: 'fa-de', lessonIds: [], priorities: [], size: 20, ...p });

describe('Study session', () => {
  it('shows exactly two answer buttons after flipping: Falsch and Richtig', async () => {
    await word();
    renderSession(cfg());
    const card = await screen.findByTestId('flashcard');
    expect(screen.queryByTestId('btn-right')).toBeNull();
    fireEvent.click(card);
    const footer = screen.getByTestId('btn-right').parentElement!;
    const buttons = within(footer).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Falsch', 'Richtig']);
  });

  it('brings a wrong card back in the same session and persists everything', async () => {
    const a = await word('آمدن', 'kommen');
    const b = await word('رفتن', 'gehen');
    // Both may be created in the same millisecond; pin the order so the test is deterministic.
    await db.vocab.update(b.id, { createdAt: a.createdAt + 1 });
    renderSession(cfg());
    const front = async () => (await screen.findByTestId('card-front')).textContent ?? '';
    expect(await front()).toContain('آمدن');
    fireEvent.click(screen.getByTestId('flashcard'));
    fireEvent.click(screen.getByTestId('btn-wrong'));
    await waitFor(async () => expect(await front()).toContain('رفتن'));
    fireEvent.click(screen.getByTestId('flashcard'));
    fireEvent.click(screen.getByTestId('btn-right'));
    // The wrong card comes back, marked as a repeat.
    await screen.findByText(/Noch einmal/);
    expect(await front()).toContain('آمدن');
    expect(screen.getByTestId('progress').textContent).toBe('2 / 3');
    fireEvent.click(screen.getByTestId('flashcard'));
    fireEvent.click(screen.getByTestId('btn-right'));
    await screen.findByTestId('summary');
    expect(screen.getByTestId('sum-correct').textContent).toBe('1');
    expect(screen.getByTestId('sum-incorrect').textContent).toBe('1');

    const sa = (await db.states.get(stateId(a.id, 'fa-de')))!;
    expect(sa).toMatchObject({ total: 1, incorrect: 1 }); // the repeat is not counted twice
    expect((await db.states.get(stateId(b.id, 'fa-de')))!.correct).toBe(1);
    expect(await db.reviews.count()).toBe(3);
    const [session] = await db.sessions.toArray();
    expect(session).toMatchObject({ mode: 'lesson', planned: 2, answered: 2, correct: 1, incorrect: 1 });
    const kinds = (await db.reviews.orderBy('ts').toArray()).map((r) => r.kind);
    expect(kinds.filter((k) => k === 'relearn')).toHaveLength(1);
  });

  it('free practice changes neither schedule nor statistics', async () => {
    await word('آمدن', 'kommen');
    await word('رفتن', 'gehen');
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

  it('explains an empty session instead of showing a blank card', async () => {
    renderSession(cfg({ mode: 'problem' }));
    expect(await screen.findByText('Nichts zu lernen')).toBeInTheDocument();
  });
});

describe('Pages', () => {
  it('statistics page shows an empty state without items', async () => {
    render(<MemoryRouter><Stats /></MemoryRouter>);
    expect(await screen.findByText('Noch nichts auszuwerten')).toBeInTheDocument();
  });

  it('statistics page shows daily values and lessons after answers', async () => {
    const v = await word();
    await answers(v.id, '01', { start: Date.now() - 1000, gapDays: 0 });
    render(<MemoryRouter><Stats /></MemoryRouter>);
    expect(await screen.findByText('Lernaktivität pro Tag')).toBeInTheDocument();
    expect(screen.getByText('Anstehende Wiederholungen')).toBeInTheDocument();
    expect(await screen.findByTestId('lesson-stat')).toHaveTextContent('Ohne Lektion');
    expect(screen.getAllByText('50 %').length).toBeGreaterThan(0);
  });

  it('search finds Persian words typed with Arabic letters', async () => {
    await word('کتاب', 'Buch');
    await word('یک', 'eins');
    await word('آب', 'Wasser');
    render(<MemoryRouter><VocabList /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('vocab-count').textContent).toBe('3 Vokabeln'));
    const search = screen.getByLabelText('Vokabeln durchsuchen');
    fireEvent.change(search, { target: { value: 'كتاب' } }); // Arabic kaf
    await waitFor(() => expect(screen.getByTestId('vocab-count').textContent).toBe('1 Vokabel'));
    expect(screen.getByText('Buch')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'يك' } }); // Arabic ya and kaf
    await waitFor(() => expect(screen.getByText('eins')).toBeInTheDocument());
    fireEvent.change(search, { target: { value: 'wass' } });
    await waitFor(() => expect(screen.getByText('Wasser')).toBeInTheDocument());
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(await screen.findByText('Nichts gefunden')).toBeInTheDocument();
  });

  it('problem page separates detected words from those with too little data', async () => {
    const hard = await word('آمدن', 'kommen');
    const once = await word('رفتن', 'gehen');
    await answers(hard.id, '001000');
    await answers(once.id, '0');
    render(<MemoryRouter><Problems /></MemoryRouter>);
    const table = await screen.findByTestId('problem-table');
    expect(within(table).getByText('آمدن')).toBeInTheDocument();
    expect(within(table).getByText('83 %')).toBeInTheDocument();
    expect(within(table).queryByText('رفتن')).toBeNull();
    expect(screen.getByText('Noch zu wenig Daten')).toBeInTheDocument();
    expect(screen.getByTestId('practice-problems')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'kommen auswählen' }));
    expect(screen.getByTestId('practice-selected')).toHaveTextContent('Auswahl üben (1)');
  });
});
