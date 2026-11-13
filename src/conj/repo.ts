import { db, type AppDB } from '../db/db';
import { clampPriority, deleteVerbRows, ValidationError } from '../db/repo';
import { t } from '../i18n';
import { dupKey, newId } from '../lib/text';
import type { FontKey, TextDir } from '../types';
import type { SchemePreset } from './presets';
import { formKey, type ConjPerson, type ConjScheme, type ConjTense, type Verb } from './types';

// ---------- Answers per cell ----------

/** "geht | gehet" → ['geht', 'gehet'] (first = canonical form). */
export const parseAnswers = (text: string): string[] => [...new Set(text.split('|').map((x) => x.trim()).filter(Boolean))];
export const formatAnswers = (answers: string[] | undefined): string => (answers ?? []).join(' | ');

/** Trimmed copy without empty cells. */
export function cleanForms(forms: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(forms)) {
    const list = [...new Set(v.map((x) => x.trim()).filter(Boolean))];
    if (list.length) out[k] = list;
  }
  return out;
}

/** Cells that actually have an answer, in scheme order (tense by tense, person by person). */
export function definedCells(verb: Verb, scheme: ConjScheme, tenseIds?: string[]): { tenseId: string; personId: string; answers: string[] }[] {
  const out: { tenseId: string; personId: string; answers: string[] }[] = [];
  for (const tense of scheme.tenses) {
    if (tenseIds && !tenseIds.includes(tense.id)) continue;
    for (const person of scheme.persons) {
      const answers = verb.forms[formKey(tense.id, person.id)];
      if (answers?.length) out.push({ tenseId: tense.id, personId: person.id, answers });
    }
  }
  return out;
}

// ---------- Schemes ----------

export interface SchemeInput {
  name: string;
  lang?: string;
  dir?: TextDir;
  font?: FontKey;
  scale?: number;
  persons: ConjPerson[];
  tenses: ConjTense[];
}

function validateScheme(input: SchemeInput) {
  const name = input.name.trim();
  if (!name) throw new ValidationError(t('Bitte einen Namen für das Schema eintragen.'));
  const clean = <T extends { id: string; label: string }>(list: T[]) => list.map((x) => ({ ...x, label: x.label.trim() })).filter((x) => x.label);
  const persons = clean(input.persons);
  const tenses = clean(input.tenses);
  if (!persons.length) throw new ValidationError(t('Mindestens eine Person ist nötig.'));
  if (!tenses.length) throw new ValidationError(t('Mindestens eine Zeitform ist nötig.'));
  return { name, persons, tenses };
}

export async function addScheme(input: SchemeInput, database: AppDB = db): Promise<ConjScheme> {
  const v = validateScheme(input);
  const now = Date.now();
  const scheme: ConjScheme = {
    id: newId(), name: v.name, lang: input.lang ?? '', dir: input.dir ?? 'auto', font: input.font ?? 'system', scale: input.scale ?? 1,
    persons: v.persons, tenses: v.tenses, createdAt: now, updatedAt: now,
  };
  await database.schemes.add(scheme);
  return scheme;
}

export function schemeFromPreset(preset: SchemePreset): SchemeInput {
  return {
    name: t(preset.name), lang: preset.lang, dir: preset.dir, font: preset.font,
    persons: preset.persons.map((label) => ({ id: newId(), label })),
    tenses: preset.tenses.map((label) => ({ id: newId(), label })),
  };
}

/** Ids of persons/tenses stay stable, so renaming or reordering never loses forms or learning history. */
export async function updateScheme(id: string, input: SchemeInput, database: AppDB = db): Promise<void> {
  const v = validateScheme(input);
  await database.schemes.update(id, { name: v.name, lang: input.lang ?? '', dir: input.dir ?? 'auto', font: input.font ?? 'system', scale: input.scale ?? 1, persons: v.persons, tenses: v.tenses, updatedAt: Date.now() });
}

export async function deleteScheme(id: string, database: AppDB = db): Promise<void> {
  const used = await database.verbs.where('schemeId').equals(id).count();
  if (used) throw new ValidationError(t('Dieses Schema wird noch von {n} Verben verwendet.', { n: used }));
  await database.schemes.delete(id);
}

// ---------- Verbs ----------

export interface VerbInput {
  deckId: string;
  lessonId?: string;
  schemeId: string;
  infinitive: string;
  translation?: string;
  notes?: string;
  priority?: number;
  tags?: string[];
  forms?: Record<string, string[]>;
}

export function buildVerb(input: VerbInput, now = Date.now()): Verb {
  const infinitive = input.infinitive.trim();
  if (!input.deckId) throw new ValidationError(t('Bitte einen Stapel wählen.'));
  if (!input.schemeId) throw new ValidationError(t('Bitte ein Schema wählen.'));
  if (!infinitive) throw new ValidationError(t('Bitte den Infinitiv eintragen.'));
  return {
    id: newId(), deckId: input.deckId, lessonId: input.lessonId ?? '', schemeId: input.schemeId,
    infinitive, translation: input.translation?.trim() ?? '', notes: input.notes?.trim() ?? '',
    priority: clampPriority(input.priority ?? 3), tags: [...new Set((input.tags ?? []).map((x) => x.trim()).filter(Boolean))],
    forms: cleanForms(input.forms ?? {}), infinitiveKey: dupKey(infinitive), createdAt: now, updatedAt: now, lastReviewAt: 0,
  };
}

async function assertNoDuplicate(v: Verb, database: AppDB, exceptId?: string) {
  const same = await database.verbs.where('infinitiveKey').equals(v.infinitiveKey).filter((x) => x.id !== exceptId && x.deckId === v.deckId && x.schemeId === v.schemeId).count();
  if (same) throw new ValidationError(t('Das Verb „{name}“ gibt es in diesem Stapel mit diesem Schema schon.', { name: v.infinitive }));
}

export async function addVerb(input: VerbInput, database: AppDB = db): Promise<Verb> {
  const v = buildVerb(input);
  await assertNoDuplicate(v, database);
  await database.verbs.add(v);
  return v;
}

export async function updateVerb(id: string, input: VerbInput, database: AppDB = db): Promise<void> {
  const b = buildVerb(input);
  const d = database;
  await d.transaction('rw', [d.verbs, d.formStates, d.formReviews], async () => {
    const old = await d.verbs.get(id);
    if (!old) throw new ValidationError(t('Dieses Verb gibt es nicht mehr.'));
    await assertNoDuplicate(b, d, id);
    await d.verbs.update(id, { deckId: b.deckId, lessonId: b.lessonId, schemeId: b.schemeId, infinitive: b.infinitive, infinitiveKey: b.infinitiveKey, translation: b.translation, notes: b.notes, priority: b.priority, tags: b.tags, forms: b.forms, updatedAt: Date.now() });
    if (old.deckId !== b.deckId) {
      await d.formStates.where('verbId').equals(id).modify({ deckId: b.deckId });
      await d.formReviews.where('verbId').equals(id).modify({ deckId: b.deckId });
    }
  });
}

/** Deletes verbs with the learning history of all their forms. */
export async function deleteVerbs(ids: string[], database: AppDB = db): Promise<void> {
  const d = database;
  await d.transaction('rw', d.verbs, d.formStates, d.formReviews, () => deleteVerbRows(ids, d));
}
