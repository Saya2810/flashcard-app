import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RichText, sideLook } from '../components/RichText';
import { Button, Card, Confirm, Field, Icon, IconButton, Page, Segmented, cx, deckTint, inputCls, toast } from '../components/ui';
import { db } from '../db/db';
import { addDeck, buildDeck, deleteDeck, updateDeck, ValidationError } from '../db/repo';
import { fieldKey } from '../lib/text';
import { DECK_COLORS, FONT_LABEL, type CustomField, type Deck, type FontKey, type SideStyle, type TextDir } from '../types';
import { plural, t } from '../i18n';

export const LANGUAGES: { tag: string; label: string; dir?: TextDir; font?: FontKey }[] = [
  { tag: '', label: 'Keine Angabe' },
  { tag: 'de', label: 'Deutsch' },
  { tag: 'en', label: 'Englisch' },
  { tag: 'fa', label: 'Persisch', dir: 'rtl', font: 'vazirmatn' },
  { tag: 'ar', label: 'Arabisch', dir: 'rtl', font: 'vazirmatn' },
  { tag: 'he', label: 'Hebräisch', dir: 'rtl' },
  { tag: 'ur', label: 'Urdu', dir: 'rtl', font: 'vazirmatn' },
  { tag: 'fr', label: 'Französisch' },
  { tag: 'es', label: 'Spanisch' },
  { tag: 'it', label: 'Italienisch' },
  { tag: 'pt', label: 'Portugiesisch' },
  { tag: 'nl', label: 'Niederländisch' },
  { tag: 'pl', label: 'Polnisch' },
  { tag: 'ru', label: 'Russisch' },
  { tag: 'uk', label: 'Ukrainisch' },
  { tag: 'tr', label: 'Türkisch' },
  { tag: 'el', label: 'Griechisch' },
  { tag: 'la', label: 'Latein' },
  { tag: 'ja', label: 'Japanisch' },
  { tag: 'zh', label: 'Chinesisch' },
  { tag: 'ko', label: 'Koreanisch' },
  { tag: 'hi', label: 'Hindi' },
];

const COLOR_LABEL: Record<string, string> = { rose: 'Rosa', lavender: 'Lavendel', mint: 'Mint', peach: 'Pfirsich', sky: 'Himmelblau', lemon: 'Zitrone' };
export const DIR_OPTIONS: { value: TextDir; label: string }[] = [{ value: 'auto', label: 'Automatisch' }, { value: 'ltr', label: 'Links → rechts' }, { value: 'rtl', label: 'Rechts → links' }];

function SideEditor({ title, side, onChange, sample, rich }: { title: string; side: SideStyle; onChange: (s: SideStyle) => void; sample: string; rich: boolean }) {
  const set = (p: Partial<SideStyle>) => onChange({ ...side, ...p });
  return (
    <Card className="space-y-4">
      <h2 className="font-bold">{title}</h2>
      <Field label={t("Bezeichnung")} hint={t("Erscheint oben auf der Karte, z. B. „Englisch“, „Begriff“ oder „Formel“.")}>
        <input value={side.label} onChange={(e) => set({ label: e.target.value })} className={inputCls} />
      </Field>
      <Field label={t("Sprache")}>
        <select value={side.lang} className={inputCls}
          onChange={(e) => { const l = LANGUAGES.find((x) => x.tag === e.target.value)!; set({ lang: l.tag, ...(l.dir ? { dir: l.dir } : { dir: 'auto' }), ...(l.font ? { font: l.font } : {}) }); }}>
          {LANGUAGES.map((l) => <option key={l.tag} value={l.tag}>{t(l.label)}</option>)}
        </select>
      </Field>
      <div>
        <span className="mb-1.5 block text-sm font-semibold">{t('Schreibrichtung')}</span>
        <Segmented label={t('Schreibrichtung {title}', { title })} value={side.dir} onChange={(dir) => set({ dir })} options={DIR_OPTIONS} />
      </div>
      <Field label={t("Schrift")}>
        <select value={side.font} onChange={(e) => set({ font: e.target.value as FontKey })} className={inputCls}>
          {(Object.keys(FONT_LABEL) as FontKey[]).map((f) => <option key={f} value={f}>{t(FONT_LABEL[f])}</option>)}
        </select>
      </Field>
      <label className="block">
        <span className="mb-1.5 flex justify-between text-sm font-semibold"><span>{t('Schriftgröße')}</span><span className="tabular-nums text-muted">{Math.round(side.scale * 100)} %</span></span>
        <input type="range" min={0.7} max={1.8} step={0.05} value={side.scale} onChange={(e) => set({ scale: Number(e.target.value) })} className="w-full accent-[rgb(var(--accent))]" aria-label={t('Schriftgröße {title}', { title })} />
      </label>
      <div>
        <span className="mb-1.5 block text-sm font-semibold">{t('Schriftstärke')}</span>
        <Segmented label={t('Schriftstärke {title}', { title })} value={String(side.weight)} onChange={(w) => set({ weight: Number(w) as SideStyle['weight'] })}
          options={[{ value: '400', label: 'Normal' }, { value: '500', label: 'Mittel' }, { value: '600', label: 'Halbfett' }, { value: '700', label: 'Fett' }]} />
      </div>
      <div className="rounded-2xl bg-sunken p-4 text-center" aria-label={t("Vorschau")}>
        <RichText text={sample || side.label} rich={rich} look={sideLook(side)} baseRem={1.75} />
      </div>
    </Card>
  );
}

const SAMPLE_TEXT: Record<string, string> = { fa: 'دانشگاه', ar: 'مَدْرَسَة', he: 'שָׁלוֹם', ur: 'کتاب', ja: '勉強', zh: '学习', ko: '공부', ru: 'учиться', el: 'μάθηση', hi: 'सीखना' };

export default function DeckForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const subjects = useLiveQuery(async () => [...new Set((await db.decks.toArray()).map((d) => d.subject).filter(Boolean))].sort(), [], []);
  const [deck, setDeck] = useState<Deck>(() => buildDeck({ name: 'x' }));
  const [ready, setReady] = useState(!id);
  const [error, setError] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const cardCount = useLiveQuery(() => (id ? db.cards.where('deckId').equals(id).count() : 0), [id], 0);

  useEffect(() => {
    if (id) void db.decks.get(id).then((d) => { if (d) { setDeck(d); setReady(true); } });
    else setDeck((d) => ({ ...d, name: '' }));
  }, [id]);

  const set = (p: Partial<Deck>) => setDeck((d) => ({ ...d, ...p }));
  const setField = (i: number, p: Partial<CustomField>) => set({ fields: deck.fields.map((f, j) => (j === i ? { ...f, ...p } : f)) });

  const save = async () => {
    setError('');
    try {
      const fields = deck.fields.filter((f) => f.label.trim()).map((f) => ({ ...f, label: f.label.trim() }));
      if (id) {
        const { id: _omit, ...rest } = { ...deck, fields };
        void _omit;
        await updateDeck(id, rest);
        toast(t('Stapel gespeichert')); nav(-1);
      } else {
        const d = await addDeck({ ...deck, fields });
        toast(t('Stapel angelegt')); nav(`/stapel/${d.id}`, { replace: true });
      }
    } catch (e) { setError(e instanceof ValidationError ? e.message : t('Speichern fehlgeschlagen.')); }
  };

  if (!ready) return <Page title={t("Stapel")} back>{null}</Page>;
  return (
    <Page title={id ? t('Stapel bearbeiten') : t('Neuer Stapel')} back>
      <form className="space-y-4 pb-8" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Card className="space-y-4">
          <Field label={t("Name")}><input value={deck.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("z. B. Englisch B2, Lineare Algebra, Anatomie")} className={inputCls} data-testid="in-deck-name" /></Field>
          <Field label={t("Fach (optional)")} hint={t("Stapel mit gleichem Fach werden zusammen angezeigt.")}>
            <input value={deck.subject} onChange={(e) => set({ subject: e.target.value })} list="subjects" placeholder={t("Sprachen, Mathematik, Medizin …")} className={inputCls} data-testid="in-deck-subject" />
            <datalist id="subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label={t("Beschreibung (optional)")}><input value={deck.description} onChange={(e) => set({ description: e.target.value })} className={inputCls} /></Field>
          <div>
            <span className="mb-1.5 block text-sm font-semibold">{t('Farbe')}</span>
            <div role="radiogroup" aria-label={t("Farbe")} className="flex flex-wrap gap-2">
              {DECK_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={deck.color === c} aria-label={t(COLOR_LABEL[c])} onClick={() => set({ color: c })}
                  className={cx('grid h-11 w-11 place-items-center rounded-2xl border-2 transition', deck.color === c ? 'border-ink' : 'border-transparent')} style={deckTint(c)}>
                  {deck.color === c && <Icon name="check" size={18} />}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <Card className="space-y-1 !py-2">
          {[
            { k: 'reverse' as const, title: t('Auch rückwärts lernen'), hint: t('Rückseite → Vorderseite wird zusätzlich abgefragt und getrennt ausgewertet. Sinnvoll für Vokabeln.') },
            { k: 'rich' as const, title: t('Formatierung, Formeln und Bilder'), hint: t('Markdown (**fett**, Listen), LaTeX ($x^2$, $$…$$), Code-Blöcke (```) und Bilder.') },
          ].map((o) => (
            <label key={o.k} className="flex items-center justify-between gap-4 py-2.5">
              <span><span className="block font-medium">{o.title}</span><span className="block text-xs text-muted">{o.hint}</span></span>
              <input type="checkbox" role="switch" className="h-6 w-6 shrink-0 accent-[rgb(var(--accent))]" checked={deck[o.k]} onChange={(e) => set({ [o.k]: e.target.checked })} data-testid={`in-deck-${o.k}`} />
            </label>
          ))}
        </Card>

        <SideEditor title={t("Vorderseite")} side={deck.front} onChange={(front) => set({ front })} rich={deck.rich} sample={SAMPLE_TEXT[deck.front.lang] ?? (deck.rich ? t('Begriff $x^2$') : t('Begriff'))} />
        <SideEditor title={t("Rückseite")} side={deck.back} onChange={(back) => set({ back })} rich={deck.rich} sample={SAMPLE_TEXT[deck.back.lang] ?? t('Antwort')} />

        <Card className="space-y-3">
          <div>
            <h2 className="font-bold">{t('Eigene Felder')}</h2>
            <p className="text-xs text-muted">{t('Zusätzliche Angaben, die nach dem Umdrehen erscheinen – z. B. Umschrift, Beispielsatz, Einheit, Quelle.')}</p>
          </div>
          {deck.fields.map((f, i) => (
            <div key={f.key} className="flex items-center gap-2">
              <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} aria-label={t("Feldname")} placeholder={t("Feldname")} className={cx(inputCls, 'flex-1')} />
              <select aria-label={t('Richtung {name}', { name: f.label })} value={f.dir} onChange={(e) => setField(i, { dir: e.target.value as TextDir })} className="min-h-[3rem] rounded-2xl border border-line bg-surface px-2 text-sm">
                <option value="auto">{t('Auto')}</option><option value="ltr">{t('LTR')}</option><option value="rtl">{t('RTL')}</option>
              </select>
              <IconButton icon="trash" label={`Feld ${f.label} entfernen`} className="text-muted" onClick={() => set({ fields: deck.fields.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <Button variant="soft" size="sm" onClick={() => set({ fields: [...deck.fields, { key: fieldKey(`feld ${deck.fields.length + 1}`, deck.fields.map((x) => x.key)), label: '', dir: 'auto', font: 'system' }] })} data-testid="add-field">
            <Icon name="plus" size={18} />{t('Feld hinzufügen')}
          </Button>
        </Card>

        {error && <p role="alert" className="rounded-2xl bg-bad-soft p-3 text-sm font-medium text-bad">{error}</p>}
        <Button type="submit" size="lg" className="w-full" data-testid="save-deck">{t('Speichern')}</Button>
        {id && <Button variant="danger" className="w-full" onClick={() => setConfirmDel(true)}>{t('Stapel löschen')}</Button>}
      </form>
      <Confirm open={confirmDel} danger title={t('„{name}“ löschen?', { name: deck.name })} confirmLabel={t("Endgültig löschen")}
        text={t('Der Stapel mit {n} {cards}, allen Lektionen und dem gesamten Lernverlauf wird gelöscht. Tipp: Erstelle vorher eine Sicherung.', { n: cardCount, cards: plural(cardCount, 'Karte', 'Karten') })}
        onCancel={() => setConfirmDel(false)} onConfirm={async () => { await deleteDeck(id!); toast(t('Stapel gelöscht')); nav('/stapel', { replace: true }); }} />
    </Page>
  );
}
