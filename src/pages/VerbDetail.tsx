import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { RichText } from '../components/RichText';
import { Button, Card, DeckDot, Icon, Page, StatusBadge } from '../components/ui';
import { schemeLook } from '../conj/look';
import { formStateId, formKey } from '../conj/types';
import { db } from '../db/db';
import { t } from '../i18n';
import { relativeDay } from '../lib/dates';
import { errorRate } from '../srs/metrics';

/** Complete conjugation tables of one verb with the learning state of every single form. */
export default function VerbDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const data = useLiveQuery(async () => {
    const verb = await db.verbs.get(id!);
    if (!verb) return null;
    const [scheme, deck, lesson, states] = await Promise.all([
      db.schemes.get(verb.schemeId), db.decks.get(verb.deckId), verb.lessonId ? db.lessons.get(verb.lessonId) : undefined,
      db.formStates.where('verbId').equals(verb.id).toArray(),
    ]);
    return { verb, scheme, deck, lesson, states: new Map(states.map((s) => [s.id, s])) };
  }, [id]);

  if (data === undefined) return <Page title={t('Verb')} back="/verben">{null}</Page>;
  if (data === null || !data.scheme) return <Page title={t('Verb')} back="/verben"><Card className="text-center text-sm text-muted">{t('Dieses Verb gibt es nicht (mehr).')}</Card></Page>;
  const { verb, scheme, deck, lesson, states } = data;
  const look = schemeLook(scheme, 500);
  const train = (mode: 'conj-full' | 'conj-forms') => nav(`/verben/lernen?modus=${mode}&verb=${verb.id}`);
  const problems = [...states.values()].filter((s) => s.problem).length;

  return (
    <Page title={t('Verb')} back="/verben" actions={<Button variant="ghost" size="sm" onClick={() => nav(`/verben/${verb.id}/bearbeiten`)} data-testid="edit-verb"><Icon name="edit" size={18} />{t('Bearbeiten')}</Button>}>
      <div className="space-y-4 pb-6">
        <Card>
          <RichText text={verb.infinitive} rich={false} look={{ ...look, weight: 700 }} baseRem={2} />
          {verb.translation && <p className="mt-1 text-muted" dir="auto">{verb.translation}</p>}
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            {deck && <span className="flex items-center gap-1"><DeckDot color={deck.color} size={8} />{deck.name}</span>}
            {lesson && <span>· {lesson.name}</span>}
            <span>· {scheme.name}</span>
            {problems > 0 && <span className="font-semibold text-bad">· {t('{n} schwierig', { n: problems })}</span>}
          </p>
          {verb.notes && <p className="mt-3 whitespace-pre-wrap text-sm" dir="auto">{verb.notes}</p>}
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Button onClick={() => train('conj-full')} data-testid="train-verb-full"><Icon name="keyboard" size={20} />{t('Konjugation üben')}</Button>
          <Button variant="soft" onClick={() => train('conj-forms')} data-testid="train-verb-forms"><Icon name="alert" size={20} />{t('Schwierige Formen')}</Button>
        </div>

        {scheme.tenses.map((ten) => {
          const rows = scheme.persons.filter((p) => (verb.forms[formKey(ten.id, p.id)] ?? []).length);
          if (!rows.length) return null;
          return (
            <Card key={ten.id} className="!p-0 overflow-hidden" data-testid="tense-table">
              <h2 className="bg-sunken px-4 py-2 text-sm font-bold" dir="auto">{ten.label}</h2>
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((p) => {
                    const answers = verb.forms[formKey(ten.id, p.id)];
                    const st = states.get(formStateId(verb.id, ten.id, p.id));
                    return (
                      <tr key={p.id} className="border-t border-line align-top" data-testid="form-row">
                        <th scope="row" className="w-28 px-4 py-2.5 text-start font-medium text-muted" dir="auto" lang={scheme.lang || undefined}>{p.label}</th>
                        <td className="py-2.5 pe-2">
                          <RichText text={answers[0]} rich={false} look={look} />
                          {answers.length > 1 && <div className="text-xs text-muted" dir={look.dir} lang={look.lang}>{answers.slice(1).join(' · ')}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-end text-xs text-muted">
                          {st && st.total > 0 ? (
                            <>
                              <div className="flex justify-end"><StatusBadge status={st.status} /></div>
                              <div className="tabular-nums" title={t('Fehlerquote')}>{st.incorrect}/{st.total} {t('falsch')} · {Math.round(errorRate(st) * 100)} %</div>
                              <div>{t('Fällig')}: {relativeDay(st.due)}</div>
                            </>
                          ) : <span>{t('Noch nicht geübt')}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          );
        })}
        {Object.keys(verb.forms).length === 0 && <Card className="text-center text-sm text-muted">{t('Noch keine Formen eingetragen.')}</Card>}
      </div>
    </Page>
  );
}
