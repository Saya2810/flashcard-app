import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { lookStyle, RichText, sideLook } from '../components/RichText';
import { Button, Card, Field, Icon, Page, Stars, cx, inputCls, toast } from '../components/ui';
import { db } from '../db/db';
import { storeImage } from '../db/media';
import { addCard, addLesson, findDuplicates, updateCard, ValidationError, type DuplicateInfo } from '../db/repo';
import type { SideStyle } from '../types';

const split = (s: string) => s.split(/\s*[|,;]\s*/).map((x) => x.trim()).filter(Boolean);
const EMPTY = { deckId: '', lessonId: '', front: '', back: '', alt: '', notes: '', priority: 3, tags: '', fields: {} as Record<string, string> };

function SideInput({ label, side, value, onChange, rich, testId }: { label: string; side: SideStyle; value: string; onChange: (v: string) => void; rich: boolean; testId: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);
  const insert = (text: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + text + value.slice(end));
  };
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{label} <span className="font-normal text-muted">({side.label})</span></span>
        {rich && (
          <span className="flex gap-1">
            <button type="button" className="rounded-full px-2.5 py-1 text-xs font-semibold text-accent" onClick={() => fileRef.current?.click()} aria-label={`Bild zu ${label} hinzufügen`}><Icon name="image" size={16} /></button>
            <button type="button" className="rounded-full px-2.5 py-1 text-xs font-semibold text-accent" onClick={() => insert('$  $')} aria-label="Formel einfügen">ƒx</button>
            <button type="button" aria-pressed={preview} className={cx('rounded-full px-2.5 py-1 text-xs font-semibold', preview ? 'bg-accent text-on-accent' : 'text-accent')} onClick={() => setPreview(!preview)}>Vorschau</button>
          </span>
        )}
      </div>
      {preview && rich ? (
        <div className="min-h-[5rem] rounded-2xl border border-line bg-surface p-4 text-center"><RichText text={value || ' '} rich look={sideLook(side)} baseRem={1.3} /></div>
      ) : (
        <textarea ref={ref} rows={value.split('\n').length > 2 || value.length > 60 ? 5 : 2} value={value} onChange={(e) => onChange(e.target.value)} dir={side.dir} lang={side.lang || undefined}
          autoCapitalize="off" className={cx(inputCls, 'resize-y')} style={lookStyle({ ...sideLook(side), scale: Math.min(1.3, side.scale), weight: 400 }, 1.05)} data-testid={testId} />
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try { const { markdown } = await storeImage(f); insert(`\n${markdown}\n`); } catch { toast('Bild konnte nicht gelesen werden.'); }
      }} />
    </div>
  );
}

export default function CardForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), [], []);
  const [f, setF] = useState({ ...EMPTY, deckId: params.get('stapel') ?? '', lessonId: params.get('lektion') ?? '' });
  const lessons = useLiveQuery(() => (f.deckId ? db.lessons.where('deckId').equals(f.deckId).sortBy('name') : []), [f.deckId], []);
  const [error, setError] = useState('');
  const [dup, setDup] = useState<DuplicateInfo>({ exact: [], sameFront: [] });
  const [newLesson, setNewLesson] = useState('');
  const sourceId = id ?? params.get('kopie');
  const deck = decks.find((d) => d.id === f.deckId);

  useEffect(() => { if (!f.deckId && decks.length === 1) setF((s) => ({ ...s, deckId: decks[0].id })); }, [decks, f.deckId]);
  useEffect(() => {
    if (!sourceId) return;
    void db.cards.get(sourceId).then((c) => {
      if (!c) return;
      setF({ deckId: c.deckId, lessonId: c.lessonId, front: c.front, back: c.back, alt: c.altBack.join(' | '), notes: c.notes, priority: c.priority, tags: c.tags.filter((t) => t !== 'Beispiel' || !!id).join(', '), fields: { ...c.fields } });
    });
  }, [sourceId, id]);
  useEffect(() => {
    const t = setTimeout(() => void findDuplicates(f.deckId, f.front, f.back, id).then(setDup), 250);
    return () => clearTimeout(t);
  }, [f.deckId, f.front, f.back, id]);

  const save = async (another: boolean) => {
    setError('');
    try {
      let lessonId = f.lessonId;
      if (lessonId === '__new') lessonId = (await addLesson(f.deckId, newLesson)).id;
      const input = { deckId: f.deckId, lessonId, front: f.front, back: f.back, altBack: f.alt.split(/\s*\|\s*/).filter(Boolean), fields: f.fields, notes: f.notes, priority: f.priority, tags: split(f.tags) };
      if (id) { await updateCard(id, input); toast('Gespeichert'); nav(-1); return; }
      const c = await addCard(input);
      toast('Karte gespeichert');
      if (another) { setF({ ...EMPTY, deckId: f.deckId, lessonId, priority: f.priority, tags: f.tags }); setNewLesson(''); window.scrollTo({ top: 0 }); }
      else nav(`/karten/${c.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ValidationError ? e.message : 'Speichern fehlgeschlagen. Bitte noch einmal versuchen.');
    }
  };

  if (decks.length === 0) {
    return <Page title="Neue Karte" back><Card className="text-center"><p className="mb-4 text-sm text-muted">Lege zuerst einen Stapel an – er bestimmt Sprache, Schrift und Felder der Karten.</p><Button onClick={() => nav('/stapel/neu')}>Stapel anlegen</Button></Card></Page>;
  }

  return (
    <Page title={id ? 'Karte bearbeiten' : 'Neue Karte'} back>
      <form className="space-y-4 pb-8" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
        <Card className="grid grid-cols-2 gap-3">
          <Field label="Stapel">
            <select value={f.deckId} onChange={(e) => setF({ ...f, deckId: e.target.value, lessonId: '' })} className={inputCls} data-testid="in-deck">
              <option value="" disabled>Bitte wählen</option>
              {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Lektion">
            <select value={f.lessonId} onChange={(e) => setF({ ...f, lessonId: e.target.value })} className={inputCls} disabled={!deck} data-testid="in-lesson">
              <option value="">Ohne Lektion</option>
              {lessons.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              <option value="__new">Neue Lektion …</option>
            </select>
          </Field>
          {f.lessonId === '__new' && <div className="col-span-2"><Field label="Name der neuen Lektion"><input value={newLesson} onChange={(e) => setNewLesson(e.target.value)} className={inputCls} /></Field></div>}
        </Card>

        {deck && (
          <Card className="space-y-4">
            <SideInput label="Vorderseite" side={deck.front} value={f.front} onChange={(front) => setF({ ...f, front })} rich={deck.rich} testId="in-front" />
            <SideInput label="Rückseite" side={deck.back} value={f.back} onChange={(back) => setF({ ...f, back })} rich={deck.rich} testId="in-back" />
            {dup.exact.length > 0 && <p role="alert" className="rounded-2xl bg-bad-soft p-3 text-sm text-bad">Diese Karte gibt es in diesem Stapel schon. Du kannst sie trotzdem speichern.</p>}
            {dup.exact.length === 0 && dup.sameFront.length > 0 && <p className="rounded-2xl bg-sunken p-3 text-sm">Die Vorderseite gibt es schon mit einer anderen Antwort. Du kannst dort auch eine weitere Antwort ergänzen.</p>}
            <Field label="Weitere richtige Antworten" hint="Mehrere mit „|“ trennen. Sie werden beim Vergleich der getippten Antwort berücksichtigt.">
              <input value={f.alt} onChange={(e) => setF({ ...f, alt: e.target.value })} dir={deck.back.dir} lang={deck.back.lang || undefined} className={inputCls} data-testid="in-alt" />
            </Field>
            {deck.rich && <p className="text-xs text-muted">Formatierung: **fett**, *kursiv*, Listen mit „- “, Formeln mit $…$ oder $$…$$, Code mit ```.</p>}
          </Card>
        )}

        {deck && deck.fields.length > 0 && (
          <Card className="space-y-4">
            {deck.fields.map((fd) => (
              <Field key={fd.key} label={fd.label}>
                <textarea rows={1} dir={fd.dir} value={f.fields[fd.key] ?? ''} onChange={(e) => setF({ ...f, fields: { ...f.fields, [fd.key]: e.target.value } })} className={cx(inputCls, 'resize-y')} style={lookStyle({ font: fd.font }, 1)} />
              </Field>
            ))}
          </Card>
        )}

        <Card className="space-y-4">
          <div><span className="mb-1 block text-sm font-semibold">Priorität</span><Stars value={f.priority} onChange={(p) => setF({ ...f, priority: p })} /></div>
          <Field label="Tags" hint="Mehrere mit Komma trennen."><input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} className={inputCls} /></Field>
          <Field label="Notizen"><textarea dir="auto" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inputCls} /></Field>
        </Card>

        {error && <p role="alert" className="rounded-2xl bg-bad-soft p-3 text-sm font-medium text-bad">{error}</p>}
        <div className="flex flex-col gap-2">
          <Button type="submit" size="lg" data-testid="save-card">Speichern</Button>
          {!id && <Button variant="soft" onClick={() => void save(true)} data-testid="save-next">Speichern und nächste</Button>}
        </div>
      </form>
    </Page>
  );
}
