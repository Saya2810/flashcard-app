import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Fa, Field, Page, Stars, cx, inputCls, toast } from '../components/ui';
import { db } from '../db/db';
import { addLesson, addVocab, findDuplicates, updateVocab, ValidationError, type DuplicateInfo } from '../db/repo';

const split = (s: string) => s.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
const EMPTY = { persian: '', german: '', alt: '', translit: '', grammar: '', exampleFa: '', exampleDe: '', notes: '', lessonId: '', priority: 3, tags: '' };

export default function VocabForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const lessons = useLiveQuery(() => db.lessons.orderBy('name').toArray(), [], []);
  const [f, setF] = useState({ ...EMPTY, lessonId: params.get('lektion') ?? '' });
  const [error, setError] = useState('');
  const [dup, setDup] = useState<DuplicateInfo>({ exact: [], samePersian: [] });
  const [newLesson, setNewLesson] = useState('');
  const sourceId = id ?? params.get('kopie');

  useEffect(() => {
    if (!sourceId) return;
    void db.vocab.get(sourceId).then((v) => {
      if (!v) return;
      setF({ persian: v.persian, german: v.german, alt: v.altGerman.join(', '), translit: v.translit, grammar: v.grammar, exampleFa: v.exampleFa, exampleDe: v.exampleDe, notes: v.notes, lessonId: v.lessonId, priority: v.priority, tags: v.tags.filter((t) => t !== 'Beispiel' || !!id).join(', ') });
    });
  }, [sourceId, id]);

  useEffect(() => {
    const t = setTimeout(() => void findDuplicates(f.persian, f.german, id).then(setDup), 250);
    return () => clearTimeout(t);
  }, [f.persian, f.german, id]);

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = async (another: boolean) => {
    setError('');
    try {
      let lessonId = f.lessonId;
      if (lessonId === '__new') lessonId = (await addLesson(newLesson)).id;
      const input = { persian: f.persian, german: f.german, altGerman: split(f.alt), translit: f.translit, grammar: f.grammar, exampleFa: f.exampleFa, exampleDe: f.exampleDe, notes: f.notes, lessonId, priority: f.priority, tags: split(f.tags) };
      if (id) { await updateVocab(id, input); toast('Gespeichert'); nav(-1); return; }
      const v = await addVocab(input);
      toast('Vokabel gespeichert');
      if (another) { setF({ ...EMPTY, lessonId, priority: f.priority, tags: f.tags }); setNewLesson(''); window.scrollTo({ top: 0 }); }
      else nav(`/vokabeln/${v.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ValidationError ? e.message : 'Speichern fehlgeschlagen. Bitte noch einmal versuchen.');
    }
  };

  return (
    <Page title={id ? 'Vokabel bearbeiten' : 'Neue Vokabel'} back>
      <form className="space-y-4 pb-6" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
        <Field label="Persisch">
          <input lang="fa" dir="rtl" value={f.persian} onChange={set('persian')} placeholder="آمدن" autoCapitalize="off" autoCorrect="off" className={cx(inputCls, 'fa !py-2 text-xl')} data-testid="in-persian" />
        </Field>
        <Field label="Deutsch">
          <input lang="de" value={f.german} onChange={set('german')} placeholder="kommen" className={inputCls} data-testid="in-german" />
        </Field>
        {dup.exact.length > 0 && <p role="alert" className="rounded-2xl bg-bad/10 p-3 text-sm text-bad">Diese Vokabel gibt es schon. Du kannst sie trotzdem speichern.</p>}
        {dup.exact.length === 0 && dup.samePersian.length > 0 && (
          <p className="rounded-2xl bg-sunken p-3 text-sm"><Fa>{dup.samePersian[0].persian}</Fa> ist bereits mit „{dup.samePersian[0].german}“ gespeichert. Für eine weitere Bedeutung kannst du dort eine zusätzliche Übersetzung ergänzen.</p>
        )}
        <Field label="Weitere Übersetzungen" hint="Mehrere mit Komma trennen. Sie gelten ebenfalls als richtig.">
          <input lang="de" value={f.alt} onChange={set('alt')} placeholder="ankommen, herkommen" className={inputCls} data-testid="in-alt" />
        </Field>
        <Field label="Umschrift">
          <input value={f.translit} onChange={set('translit')} placeholder="âmadan" autoCapitalize="off" className={inputCls} />
        </Field>
        <div>
          <span className="mb-1 block text-sm font-semibold">Priorität</span>
          <Stars value={f.priority} onChange={(p) => setF((s) => ({ ...s, priority: p }))} />
        </div>
        <Field label="Lektion">
          <select value={f.lessonId} onChange={set('lessonId')} className={inputCls} data-testid="in-lesson">
            <option value="">Ohne Lektion</option>
            {lessons.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            <option value="__new">Neue Lektion anlegen …</option>
          </select>
        </Field>
        {f.lessonId === '__new' && (
          <Field label="Name der neuen Lektion"><input value={newLesson} onChange={(e) => setNewLesson(e.target.value)} placeholder="Persisch III – Lektion 1" className={inputCls} /></Field>
        )}
        <Field label="Grammatik"><input dir="auto" value={f.grammar} onChange={set('grammar')} placeholder="Verb" className={inputCls} /></Field>
        <Field label="Tags" hint="Mehrere mit Komma trennen."><input value={f.tags} onChange={set('tags')} placeholder="Verben, Alltag" className={inputCls} /></Field>
        <Field label="Beispielsatz (Persisch)">
          <textarea lang="fa" dir="rtl" rows={2} value={f.exampleFa} onChange={set('exampleFa')} className={cx(inputCls, 'fa')} />
        </Field>
        <Field label="Beispielsatz (Deutsch)"><textarea lang="de" rows={2} value={f.exampleDe} onChange={set('exampleDe')} className={inputCls} /></Field>
        <Field label="Notizen"><textarea dir="auto" rows={3} value={f.notes} onChange={set('notes')} className={inputCls} /></Field>
        {error && <p role="alert" className="rounded-2xl bg-bad/10 p-3 text-sm font-medium text-bad">{error}</p>}
        <div className="flex flex-col gap-2 pt-2">
          <Button type="submit" size="lg" data-testid="save-vocab">Speichern</Button>
          {!id && <Button variant="soft" onClick={() => void save(true)} data-testid="save-next">Speichern und nächste</Button>}
        </div>
      </form>
    </Page>
  );
}
