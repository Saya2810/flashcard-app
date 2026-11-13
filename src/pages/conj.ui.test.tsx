import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { SCHEME_PRESETS } from '../conj/presets';
import { addScheme, addVerb, schemeFromPreset } from '../conj/repo';
import { recordFormAnswer } from '../conj/review';
import { formKey, formStateId, type ConjScheme, type ConjSessionConfig, type Verb } from '../conj/types';
import { db } from '../db/db';
import { getSettings, saveSettings } from '../db/repo';
import { getLang, setLang } from '../i18n';
import { deck, resetDb } from '../test/helpers';
import ConjSession from './ConjSession';
import SettingsPage from './Settings';
import VerbForm from './VerbForm';

/** Types text into a controlled input; "{Enter}" presses Enter like a keyboard would. */
function typeIn(el: HTMLElement, text: string) {
  const [value, enter] = text.split('{Enter}');
  fireEvent.change(el, { target: { value } });
  if (enter !== undefined) fireEvent.keyDown(el, { key: 'Enter' });
}

beforeEach(async () => { setLang('de'); localStorage.clear(); await resetDb(); });

const PRES = ['gehe', 'gehst', 'geht', 'gehen', 'geht', 'gehen'];
async function seed() {
  const d = await deck();
  const s: ConjScheme = await addScheme(schemeFromPreset(SCHEME_PRESETS.find((p) => p.id === 'de')!));
  const forms: Record<string, string[]> = {};
  s.persons.forEach((p, i) => { forms[formKey(s.tenses[0].id, p.id)] = [PRES[i]]; });
  const v: Verb = await addVerb({ deckId: d.id, schemeId: s.id, infinitive: 'gehen', translation: 'to go', forms });
  return { d, s, v };
}
const cfg = (p: Partial<ConjSessionConfig>): ConjSessionConfig => ({ mode: 'conj-full', deckIds: [], lessonIds: [], langs: [], tenseLabels: [], size: 5, ...p });
function renderSession(c: ConjSessionConfig) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/verben/sitzung', state: c }]}>
      <Routes><Route path="/verben/sitzung" element={<ConjSession />} /><Route path="*" element={<div>woanders</div>} /></Routes>
    </MemoryRouter>,
  );
}

describe('Mode 1 – complete conjugation', () => {
  it('shows one input per person, Enter moves to the next field, results mark every difference, grading stays manual', async () => {
    const { s, v } = await seed();
    renderSession(cfg({ verbIds: [v.id] }));
    const first = await screen.findByTestId('conj-input-0');
    expect(screen.getAllByTestId(/^conj-input-/)).toHaveLength(6);
    await waitFor(() => expect(first).toHaveFocus());

    typeIn(first, 'gehe{Enter}');
    expect(screen.getByTestId('conj-input-1')).toHaveFocus();
    typeIn(screen.getByTestId('conj-input-1'), 'gest{Enter}');      // missing h, extra letter handled by diff
    typeIn(screen.getByTestId('conj-input-2'), 'geht{Enter}');
    typeIn(screen.getByTestId('conj-input-3'), 'gehenn{Enter}');     // additional character
    expect(screen.getByTestId('conj-input-4')).toHaveFocus();
    // leave 4 empty, 5 filled correctly, Enter on the last field evaluates
    typeIn(screen.getByTestId('conj-input-5'), 'gehen{Enter}');

    await screen.findByTestId('conj-results');
    const r1 = screen.getByTestId('form-result-1');
    expect(within(r1).getByTestId('diff-typed').textContent).toBe('gest');
    expect(within(r1).getByTestId('diff-solution').textContent).toBe('gehst');
    expect(within(r1).getByTestId('diff-solution').querySelector('ins')).not.toBeNull();         // missing character underlined
    expect(within(screen.getByTestId('form-result-3')).getByTestId('diff-typed').querySelector('del')?.textContent).toBe('n');   // additional character struck through
    expect(within(screen.getByTestId('form-result-4')).getByTestId('diff-typed').textContent).toMatch(/Keine Antwort/);
    expect(within(screen.getByTestId('form-result-4')).getByTestId('diff-solution').textContent).toBe('geht');
    expect(screen.getByTestId('conj-progress').textContent).toContain('0 von 6');

    // nothing is graded automatically; saving needs a decision for every form
    expect(screen.getByTestId('conj-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('accept-matches'));
    expect(screen.getByTestId('conj-progress').textContent).toContain('3 von 6');   // 0, 2, 5 matched exactly
    expect(screen.getByTestId('conj-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('btn-right-1'));          // the user may accept a deviation…
    fireEvent.click(screen.getByTestId('btn-wrong-3'));
    fireEvent.click(screen.getByTestId('btn-wrong-4'));
    expect(screen.getByTestId('conj-score').textContent).toContain('4 von 6');
    expect(screen.getByTestId('conj-save')).toBeEnabled();
    fireEvent.click(screen.getByTestId('btn-wrong-0'));          // …and overrule an exact match
    fireEvent.click(screen.getByTestId('conj-save'));

    await screen.findByTestId('summary');
    expect(screen.getByTestId('sum-correct').textContent).toBe('3');
    expect(screen.getByTestId('sum-incorrect').textContent).toBe('3');
    const t = s.tenses[0].id;
    expect(await db.formStates.get(formStateId(v.id, t, s.persons[0].id))).toMatchObject({ total: 1, incorrect: 1 });
    expect(await db.formStates.get(formStateId(v.id, t, s.persons[1].id))).toMatchObject({ total: 1, correct: 1 });
    expect(await db.formReviews.count()).toBe(6);
    const rev = (await db.formReviews.toArray()).find((x) => x.personId === s.persons[1].id)!;
    expect(rev).toMatchObject({ source: 'full', typed: 'gest', correct: true });
    expect((await db.sessions.toArray())[0]).toMatchObject({ mode: 'conj-full', answered: 6, correct: 3, incorrect: 3 });
  });
});

describe('Mode 2 – difficult individual forms', () => {
  it('trains one form at a time, brings wrong forms back and records them independently', async () => {
    const { s, v } = await seed();
    const t = s.tenses[0].id;
    const [ich, du, er] = s.persons;
    for (let i = 0; i < 3; i++) await recordFormAnswer({ verbId: v.id, tenseId: t, personId: du.id, correct: false, sessionId: 'old', source: 'forms', now: Date.now() - (4 - i) * 1000 });
    await recordFormAnswer({ verbId: v.id, tenseId: t, personId: ich.id, correct: true, sessionId: 'old', source: 'forms', now: Date.now() - 5000 });
    renderSession(cfg({ mode: 'conj-forms', verbIds: [v.id] }));
    await screen.findByTestId('form-prompt');
    expect(screen.getByTestId('form-prompt').textContent).toContain('du');         // only the difficult form is in the queue
    typeIn(screen.getByTestId('typed-input'), 'gehts{Enter}');
    const diff = await screen.findByTestId('answer-diff');
    expect(within(diff).getByTestId('diff-solution').textContent).toBe('gehst');
    fireEvent.click(screen.getByTestId('btn-wrong'));
    await screen.findByText(/Noch einmal/);
    typeIn(screen.getByTestId('typed-input'), 'gehst{Enter}');
    fireEvent.click(await screen.findByTestId('btn-right'));
    await screen.findByTestId('summary');
    expect(screen.getByTestId('sum-incorrect').textContent).toBe('1');
    expect(await db.formStates.get(formStateId(v.id, t, du.id))).toMatchObject({ total: 4, incorrect: 4 });
    expect(await db.formStates.get(formStateId(v.id, t, er.id))).toBeUndefined();
    expect((await db.formStates.get(formStateId(v.id, t, ich.id)))!.total).toBe(1);
  });

  it('says so when there are no difficult forms', async () => {
    const { v } = await seed();
    renderSession(cfg({ mode: 'conj-forms', verbIds: [v.id] }));
    expect(await screen.findByText('Nichts zu üben')).toBeInTheDocument();
  });
});

describe('Verb editor', () => {
  it('creates a verb with a form per person, Enter moves to the next cell, and saves alternatives', async () => {
    const { d, s } = await seed();
    await db.verbs.clear();
    render(
      <MemoryRouter initialEntries={['/verben/neu']}>
        <Routes><Route path="/verben/neu" element={<VerbForm />} /><Route path="/verben/:id" element={<div>detail</div>} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByTestId('in-infinitive');
    await waitFor(() => expect(screen.getByTestId('in-verb-scheme')).toHaveValue(s.id));
    fireEvent.change(screen.getByTestId('in-verb-deck'), { target: { value: d.id } });
    typeIn(screen.getByTestId('in-infinitive'), 'machen');
    typeIn(screen.getByTestId('cell-0-0'), 'mache{Enter}');
    expect(screen.getByTestId('cell-0-1')).toHaveFocus();
    typeIn(screen.getByTestId('cell-0-1'), 'machst | machst du');
    fireEvent.click(screen.getByTestId('save-verb'));
    await screen.findByText('detail');
    const v = (await db.verbs.toArray())[0];
    expect(v.infinitive).toBe('machen');
    expect(v.forms[formKey(s.tenses[0].id, s.persons[0].id)]).toEqual(['mache']);
    expect(v.forms[formKey(s.tenses[0].id, s.persons[1].id)]).toEqual(['machst', 'machst du']);
    expect(Object.keys(v.forms)).toHaveLength(2);
  });
});

describe('Settings – app language', () => {
  it('lists the sections, switches the whole app between German and English and persists the choice', async () => {
    render(<MemoryRouter initialEntries={['/einstellungen']}><App /></MemoryRouter>);
    await screen.findByText('Allgemein');
    for (const id of ['allgemein', 'darstellung', 'lernen', 'sicherung', 'updates']) expect(screen.getByTestId(`section-${id}`)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Hauptnavigation' })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('radio', { name: 'English' }));
    await waitFor(() => expect(getLang()).toBe('en'));
    await screen.findByText('General');
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByText('Updates')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Deutsch' })).toBeInTheDocument();       // language names are never translated
    expect(await getSettings()).toMatchObject({ uiLanguage: 'en' });
    expect(localStorage.getItem('lernkarten.uiLanguage')).toBe('en');

    fireEvent.click(screen.getByRole('radio', { name: 'Deutsch' }));
    await screen.findByText('Allgemein');
    expect(await getSettings()).toMatchObject({ uiLanguage: 'de' });
  });

  it('the stored language is applied on start and learning content is untouched by it', async () => {
    const d = await deck({ name: 'Persisch – Deutsch' });
    await saveSettings({ uiLanguage: 'en' });
    render(<MemoryRouter initialEntries={['/stapel']}><App /></MemoryRouter>);
    await screen.findByText('Persisch – Deutsch');
    await waitFor(() => expect(getLang()).toBe('en'));
    expect(within(await screen.findByRole('navigation', { name: 'Main navigation' })).getByText('Decks')).toBeInTheDocument();
    expect((await db.decks.get(d.id))!.name).toBe('Persisch – Deutsch');
  });

  it('answer font size is a setting and is applied to the typing fields', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole('radio', { name: 'Groß' }))[1]);
    await waitFor(async () => expect((await getSettings()).answerFontScale).toBe(1.2));
    await waitFor(() => expect((screen.getByTestId('answer-font-preview') as HTMLElement).style.fontSize).toBe('1.2rem'));
  });
});
