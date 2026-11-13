import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { lookStyle } from '../components/RichText';
import { Button, Card, Confirm, Field, Page, Stars, cx, inputCls, toast } from '../components/ui';
import { schemeLook } from '../conj/look';
import { addVerb, deleteVerbs, formatAnswers, parseAnswers, updateVerb } from '../conj/repo';
import { formKey } from '../conj/types';
import { db } from '../db/db';
import { addLesson, ValidationError } from '../db/repo';
import { t } from '../i18n';
import { useSettings } from '../hooks/useSettings';

interface FormState {
  deckId: string; lessonId: string; schemeId: string; infinitive: string; translation: string; notes: string; priority: number; tags: string;
  cells: Record<string, string>;
}
const EMPTY: FormState = { deckId: '', lessonId: '', schemeId: '', infinitive: '', translation: '', notes: '', priority: 3, tags: '', cells: {} };

export default function VerbForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const settings = useSettings();
  const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), []);
  const schemes = useLiveQuery(() => db.schemes.orderBy('name').toArray(), []);
  const [f, setF] = useState<FormState>({ ...EMPTY, deckId: params.get('stapel') ?? '', lessonId: params.get('lektion') ?? '' });
  const lessons = useLiveQuery(() => (f.deckId ? db.lessons.where('deckId').equals(f.deckId).sortBy('name') : []), [f.deckId], []);
  const [newLesson, setNewLesson] = useState('');
  const [error, setError] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const scheme = schemes?.find((s) => s.id === f.schemeId);
  const look = useMemo(() => schemeLook(scheme, 400), [scheme]);

  useEffect(() => {
    if (!id) return;
    void db.verbs.get(id).then((v) => {
      if (!v) return;
      const cells: Record<string, string> = {};
      for (const [k, a] of Object.entries(v.forms)) cells[k] = formatAnswers(a);
      setF({ deckId: v.deckId, lessonId: v.lessonId, schemeId: v.schemeId, infinitive: v.infinitive, translation: v.translation, notes: v.notes, priority: v.priority, tags: v.tags.join(', '), cells });
    });
  }, [id]);
  useEffect(() => { if (!id && !f.deckId && decks?.length === 1) setF((s) => ({ ...s, deckId: decks[0].id })); }, [id, decks, f.deckId]);
  useEffect(() => { if (!id && !f.schemeId && schemes?.length === 1) setF((s) => ({ ...s, schemeId: schemes[0].id })); }, [id, schemes, f.schemeId]);

  const save = async (another: boolean) => {
    setError('');
    try {
      if (!scheme) throw new ValidationError(t('Bitte ein Schema wählen.'));
      let lessonId = f.lessonId;
      if (lessonId === '__new') lessonId = (await addLesson(f.deckId, newLesson)).id;
      const forms: Record<string, string[]> = {};
      for (const ten of scheme.tenses) for (const per of scheme.persons) {
        const k = formKey(ten.id, per.id);
        const a = parseAnswers(f.cells[k] ?? '');
        if (a.length) forms[k] = a;
      }
      const input = { deckId: f.deckId, lessonId, schemeId: f.schemeId, infinitive: f.infinitive, translation: f.translation, notes: f.notes, priority: f.priority, tags: f.tags.split(/\s*,\s*/), forms };
      if (id) { await updateVerb(id, input); toast(t('Gespeichert')); nav(-1); return; }
      const v = await addVerb(input);
      toast(t('Verb gespeichert'));
      if (another) { setF({ ...EMPTY, deckId: f.deckId, lessonId, schemeId: f.schemeId, priority: f.priority, tags: f.tags }); setNewLesson(''); window.scrollTo({ top: 0 }); }
      else nav(`/verben/${v.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ValidationError ? e.message : t('Speichern fehlgeschlagen. Bitte noch einmal versuchen.'));
    }
  };

  // Enter inside the grid moves to the next cell instead of saving the whole form.
  const nextCell = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const cells = Array.from(formRef.current?.querySelectorAll<HTMLInputElement>('[data-cell]') ?? []);
    const i = cells.indexOf(e.currentTarget);
    const el = cells[i + 1];
    if (el) { el.closest('details')?.setAttribute('open', ''); el.focus(); } else e.currentTarget.blur();
  };

  if (!decks || !schemes) return <Page title={t('Verb')} back>{null}</Page>;
  if (decks.length === 0) return <Page title={t('Neues Verb')} back><Card className="text-center"><p className="mb-4 text-sm text-muted">{t('Lege zuerst einen Stapel an – er ordnet das Verb nach Fach und Lektion ein.')}</p><Button onClick={() => nav('/stapel/neu')}>{t('Stapel anlegen')}</Button></Card></Page>;
  if (schemes.length === 0) return <Page title={t('Neues Verb')} back><Card className="text-center"><p className="mb-4 text-sm text-muted">{t('Lege zuerst ein Schema an: Es legt fest, welche Personen und Zeitformen du übst – für jede Sprache.')}</p><Button onClick={() => nav('/verben/schemata')}>{t('Schema anlegen')}</Button></Card></Page>;

  return (
    <Page title={id ? t('Verb bearbeiten') : t('Neues Verb')} back>
      <form ref={formRef} className="space-y-4 pb-8" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
        <Card className="grid grid-cols-2 gap-3">
          <Field label={t('Zugehöriger Stapel')}>
            <select value={f.deckId} onChange={(e) => setF({ ...f, deckId: e.target.value, lessonId: '' })} className={inputCls} data-testid="in-verb-deck">
              <option value="" disabled>{t('Bitte wählen')}</option>
              {decks.map((d) => <option key={d.id} value={d.id}>{d.name}{d.subject ? ` (${d.subject})` : ''}</option>)}
            </select>
          </Field>
          <Field label={t('Lektion')}>
            <select value={f.lessonId} onChange={(e) => setF({ ...f, lessonId: e.target.value })} className={inputCls} disabled={!f.deckId} data-testid="in-verb-lesson">
              <option value="">{t('Ohne Lektion')}</option>
              {lessons.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              <option value="__new">{t('Neue Lektion …')}</option>
            </select>
          </Field>
          {f.lessonId === '__new' && <div className="col-span-2"><Field label={t('Name der neuen Lektion')}><input value={newLesson} onChange={(e) => setNewLesson(e.target.value)} className={inputCls} /></Field></div>}
          <div className="col-span-2">
            <Field label={t('Schema')} hint={id ? t('Das Schema lässt sich nach dem Anlegen nicht mehr wechseln.') : t('Legt Personen, Zeitformen, Sprache und Schrift fest.')}>
              <select value={f.schemeId} onChange={(e) => setF({ ...f, schemeId: e.target.value, cells: {} })} disabled={!!id} className={inputCls} data-testid="in-verb-scheme">
                <option value="" disabled>{t('Bitte wählen')}</option>
                {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>
        </Card>

        <Card className="space-y-4">
          <Field label={t('Infinitiv')}>
            <input value={f.infinitive} onChange={(e) => setF({ ...f, infinitive: e.target.value })} dir={look.dir} lang={look.lang || undefined} autoCapitalize="off" autoCorrect="off" spellCheck={false}
              className={inputCls} style={lookStyle({ ...look, scale: Math.min(1.3, look.scale ?? 1) }, 1.1)} data-testid="in-infinitive" />
          </Field>
          <Field label={t('Übersetzung (optional)')}><input value={f.translation} onChange={(e) => setF({ ...f, translation: e.target.value })} dir="auto" className={inputCls} data-testid="in-translation" /></Field>
        </Card>

        {scheme && (
          <Card className="space-y-2">
            <div>
              <h2 className="font-bold">{t('Konjugationsformen')}</h2>
              <p className="text-xs text-muted">{t('Mehrere richtige Formen mit „|“ trennen; die erste gilt als Hauptform. Leere Felder werden nicht abgefragt.')}</p>
            </div>
            {scheme.tenses.map((ten, ti) => {
              const filled = scheme.persons.filter((p) => (f.cells[formKey(ten.id, p.id)] ?? '').trim()).length;
              return (
                <details key={ten.id} open={ti === 0} className="rounded-2xl bg-sunken px-3 py-2" data-testid="tense-block">
                  <summary className="flex cursor-pointer items-center justify-between gap-2 font-semibold">
                    <span dir="auto">{ten.label}</span><span className="text-xs font-normal text-muted">{filled}/{scheme.persons.length}</span>
                  </summary>
                  <div className="mt-2 space-y-2 pb-1">
                    {scheme.persons.map((p, pi) => (
                      <label key={p.id} className="flex items-center gap-3">
                        <span className="w-24 shrink-0 text-sm font-medium" dir="auto" lang={scheme.lang || undefined}>{p.label}</span>
                        <input data-cell value={f.cells[formKey(ten.id, p.id)] ?? ''} onChange={(e) => setF({ ...f, cells: { ...f.cells, [formKey(ten.id, p.id)]: e.target.value } })} onKeyDown={nextCell}
                          dir={look.dir} lang={look.lang || undefined} autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label={`${ten.label} – ${p.label}`}
                          className={cx(inputCls, '!py-2')} style={lookStyle({ ...look, scale: Math.min(1.3, look.scale ?? 1) * settings.answerFontScale }, 1)} data-testid={`cell-${ti}-${pi}`} />
                      </label>
                    ))}
                  </div>
                </details>
              );
            })}
          </Card>
        )}

        <Card className="space-y-4">
          <div><span className="mb-1 block text-sm font-semibold">{t('Priorität')}</span><Stars value={f.priority} onChange={(p) => setF({ ...f, priority: p })} /></div>
          <Field label={t('Tags')} hint={t('Mehrere mit Komma trennen.')}><input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} className={inputCls} /></Field>
          <Field label={t('Notizen')}><textarea dir="auto" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inputCls} /></Field>
        </Card>

        {error && <p role="alert" className="rounded-2xl bg-bad-soft p-3 text-sm font-medium text-bad">{error}</p>}
        <div className="flex flex-col gap-2">
          <Button type="submit" size="lg" data-testid="save-verb">{t('Speichern')}</Button>
          {!id && <Button variant="soft" onClick={() => void save(true)} data-testid="save-verb-next">{t('Speichern und nächstes')}</Button>}
          {id && <Button variant="danger" onClick={() => setConfirmDel(true)}>{t('Verb löschen')}</Button>}
        </div>
      </form>
      <Confirm open={confirmDel} danger title={t('„{name}“ löschen?', { name: f.infinitive })} text={t('Das Verb und der Lernverlauf aller seiner Formen werden endgültig gelöscht.')} confirmLabel={t('Endgültig löschen')}
        onCancel={() => setConfirmDel(false)} onConfirm={async () => { await deleteVerbs([id!]); toast(t('Gelöscht')); nav('/verben', { replace: true }); }} />
    </Page>
  );
}
