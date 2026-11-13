import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RichText } from '../components/RichText';
import { Button, Card, Confirm, EmptyState, Field, Icon, IconButton, Page, Segmented, cx, inputCls, toast } from '../components/ui';
import { SCHEME_PRESETS } from '../conj/presets';
import { addScheme, deleteScheme, schemeFromPreset, updateScheme, type SchemeInput } from '../conj/repo';
import type { ConjPerson, ConjTense } from '../conj/types';
import { db } from '../db/db';
import { ValidationError } from '../db/repo';
import { t } from '../i18n';
import { newId } from '../lib/text';
import { FONT_LABEL, type FontKey } from '../types';
import { DIR_OPTIONS, LANGUAGES } from './DeckForm';

/** List of all conjugation schemes (grammar templates), with presets as quick starts. */
export function SchemeList() {
  const nav = useNavigate();
  const schemes = useLiveQuery(() => db.schemes.orderBy('name').toArray(), []);
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    for (const v of await db.verbs.toArray()) m.set(v.schemeId, (m.get(v.schemeId) ?? 0) + 1);
    return m;
  }, [], new Map<string, number>());
  const [error, setError] = useState('');

  const fromPreset = async (id: string) => {
    const p = SCHEME_PRESETS.find((x) => x.id === id)!;
    try {
      const s = await addScheme(schemeFromPreset(p));
      nav(`/verben/schemata/${s.id}`);
    } catch (e) { setError(e instanceof ValidationError ? e.message : t('Speichern fehlgeschlagen. Bitte noch einmal versuchen.')); }
  };

  return (
    <Page title={t('Schemata')} back="/verben" subtitle={t('Ein Schema legt Personen und Zeitformen einer Sprache fest.')}>
      {schemes && schemes.length === 0 && <EmptyState icon="table" title={t('Noch kein Schema')} text={t('Starte mit einer Vorlage – du kannst alles danach frei ändern – oder lege ein leeres Schema an.')} />}
      {schemes && schemes.length > 0 && (
        <ul className="mb-4 overflow-hidden rounded-card bg-surface shadow-card">
          {schemes.map((s, i) => (
            <li key={s.id}>
              <Link to={`/verben/schemata/${s.id}`} data-testid="scheme-row" className={cx('flex min-h-[3.75rem] items-center justify-between gap-3 px-4 py-2.5', i > 0 && 'border-t border-line')}>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{s.name}</span>
                  <span className="block truncate text-xs text-muted">{t('{p} Personen · {z} Zeitformen', { p: s.persons.length, z: s.tenses.length })}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">{t('{n} Verben', { n: counts.get(s.id) ?? 0 })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Card className="space-y-3">
        <h2 className="font-bold">{t('Neues Schema')}</h2>
        <div className="grid grid-cols-2 gap-2">
          {SCHEME_PRESETS.map((p) => (
            <Button key={p.id} variant="soft" onClick={() => void fromPreset(p.id)} data-testid={`preset-${p.id}`}><Icon name="plus" size={18} />{t(p.name)}</Button>
          ))}
        </div>
        {error && <p role="alert" className="rounded-2xl bg-bad-soft p-3 text-sm font-medium text-bad">{error}</p>}
      </Card>
    </Page>
  );
}

function ListEditor<T extends ConjPerson | ConjTense>({ title, hint, items, onChange, addLabel, testId }: { title: string; hint: string; items: T[]; onChange: (v: T[]) => void; addLabel: string; testId: string }) {
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const c = [...items]; [c[i], c[j]] = [c[j], c[i]]; onChange(c);
  };
  return (
    <Card className="space-y-3">
      <div><h2 className="font-bold">{title}</h2><p className="text-xs text-muted">{hint}</p></div>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={it.id} className="flex items-center gap-1">
            <input value={it.label} dir="auto" aria-label={`${title} ${i + 1}`} onChange={(e) => onChange(items.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)))} className={cx(inputCls, '!py-2')} data-testid={`${testId}-${i}`} />
            <IconButton icon="chevron-up" label={t('Nach oben')} disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton icon="chevron-down" label={t('Nach unten')} disabled={i === items.length - 1} onClick={() => move(i, 1)} />
            <IconButton icon="trash" label={t('Entfernen')} disabled={items.length <= 1} onClick={() => onChange(items.filter((x) => x.id !== it.id))} />
          </li>
        ))}
      </ul>
      <Button variant="soft" size="sm" onClick={() => onChange([...items, { id: newId(), label: '' } as T])} data-testid={`${testId}-add`}><Icon name="plus" size={18} />{addLabel}</Button>
    </Card>
  );
}

const SAMPLE: Record<string, string> = { de: 'gehen', en: 'to go', fa: 'رفتن', ar: 'ذهب', he: 'ללכת', ur: 'جانا', fr: 'aller', es: 'ir' };

/** Editor of one scheme (also used for creating a blank one via /verben/schemata/neu). */
export function SchemeEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const [s, setS] = useState<SchemeInput>({ name: '', lang: '', dir: 'auto', font: 'system', scale: 1, persons: [{ id: newId(), label: '' }], tenses: [{ id: newId(), label: '' }] });
  const [loaded, setLoaded] = useState(!id);
  const [used, setUsed] = useState(0);
  const [error, setError] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const sc = await db.schemes.get(id);
      if (!sc) { nav('/verben/schemata', { replace: true }); return; }
      setS({ name: sc.name, lang: sc.lang, dir: sc.dir, font: sc.font, scale: sc.scale, persons: sc.persons, tenses: sc.tenses });
      setUsed(await db.verbs.where('schemeId').equals(id).count());
      setLoaded(true);
    })();
  }, [id, nav]);

  const save = async () => {
    setError('');
    try {
      if (id) { await updateScheme(id, s); toast(t('Gespeichert')); }
      else { const n = await addScheme(s); toast(t('Schema gespeichert')); nav(`/verben/schemata/${n.id}`, { replace: true }); }
    } catch (e) { setError(e instanceof ValidationError ? e.message : t('Speichern fehlgeschlagen. Bitte noch einmal versuchen.')); }
  };
  const remove = async () => {
    try { await deleteScheme(id!); toast(t('Gelöscht')); nav('/verben/schemata', { replace: true }); }
    catch (e) { setConfirmDel(false); setError(e instanceof ValidationError ? e.message : t('Löschen fehlgeschlagen.')); }
  };

  if (!loaded) return <Page title={t('Schema')} back>{null}</Page>;
  const look = { lang: s.lang, dir: s.dir ?? 'auto', font: s.font ?? 'system', scale: s.scale ?? 1, weight: 500 as const };

  return (
    <Page title={id ? t('Schema bearbeiten') : t('Neues Schema')} back="/verben/schemata">
      <div className="space-y-4 pb-8">
        <Card className="space-y-4">
          <Field label={t('Name')}><input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} className={inputCls} data-testid="scheme-name" /></Field>
          <Field label={t('Sprache der Verbformen')}>
            <select value={s.lang} className={inputCls} data-testid="scheme-lang"
              onChange={(e) => { const l = LANGUAGES.find((x) => x.tag === e.target.value)!; setS({ ...s, lang: l.tag, dir: l.dir ?? 'auto', ...(l.font ? { font: l.font } : {}) }); }}>
              {LANGUAGES.map((l) => <option key={l.tag} value={l.tag}>{t(l.label)}</option>)}
            </select>
          </Field>
          <div>
            <span className="mb-1.5 block text-sm font-semibold">{t('Schreibrichtung')}</span>
            <Segmented label={t('Schreibrichtung')} value={s.dir ?? 'auto'} onChange={(dir) => setS({ ...s, dir })} options={DIR_OPTIONS} />
          </div>
          <Field label={t('Schrift')}>
            <select value={s.font} onChange={(e) => setS({ ...s, font: e.target.value as FontKey })} className={inputCls}>
              {(Object.keys(FONT_LABEL) as FontKey[]).map((f) => <option key={f} value={f}>{t(FONT_LABEL[f])}</option>)}
            </select>
          </Field>
          <label className="block">
            <span className="mb-1.5 flex justify-between text-sm font-semibold"><span>{t('Schriftgröße')}</span><span className="tabular-nums text-muted">{Math.round((s.scale ?? 1) * 100)} %</span></span>
            <input type="range" min={0.7} max={1.8} step={0.05} value={s.scale ?? 1} onChange={(e) => setS({ ...s, scale: Number(e.target.value) })} className="w-full accent-[rgb(var(--accent))]" aria-label={t('Schriftgröße')} />
          </label>
          <div className="rounded-2xl bg-sunken p-4 text-center" aria-label={t('Vorschau')}>
            <RichText text={SAMPLE[s.lang ?? ''] ?? (s.name || '…')} rich={false} look={look} baseRem={1.75} />
          </div>
        </Card>
        <ListEditor title={t('Personen')} hint={t('z. B. ich, du, er/sie/es … – frei wählbar. Mit „/“ oder „|“ kannst du Sammelformen schreiben.')} items={s.persons} onChange={(persons) => setS({ ...s, persons })} addLabel={t('Person hinzufügen')} testId="person" />
        <ListEditor title={t('Zeitformen')} hint={t('z. B. Präsens, Präteritum – oder beliebige eigene grammatische Strukturen.')} items={s.tenses} onChange={(tenses) => setS({ ...s, tenses })} addLabel={t('Zeitform hinzufügen')} testId="tense" />
        {used > 0 && <p className="text-xs text-muted">{t('Umbenennen, Umsortieren und Hinzufügen ist sicher: Formen und Lernverlauf der {n} Verben bleiben erhalten. Entfernte Personen oder Zeitformen blenden ihre Formen aus.', { n: used })}</p>}
        {error && <p role="alert" className="rounded-2xl bg-bad-soft p-3 text-sm font-medium text-bad">{error}</p>}
        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={() => void save()} data-testid="save-scheme">{t('Speichern')}</Button>
          {id && <Button variant="danger" onClick={() => setConfirmDel(true)} data-testid="delete-scheme">{t('Schema löschen')}</Button>}
        </div>
      </div>
      <Confirm open={confirmDel} danger title={t('„{name}“ löschen?', { name: s.name })} text={used > 0 ? t('Dieses Schema wird noch von {n} Verben verwendet.', { n: used }) : t('Das Schema wird gelöscht. Verben sind nicht betroffen.')} confirmLabel={t('Endgültig löschen')} onCancel={() => setConfirmDel(false)} onConfirm={() => void remove()} />
    </Page>
  );
}

