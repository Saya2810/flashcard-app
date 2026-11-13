import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Icon, Toaster, cx } from './components/ui';
import { useApplySettings, useSettings } from './hooks/useSettings';
import CardDetail from './pages/CardDetail';
import CardForm from './pages/CardForm';
import CardList from './pages/CardList';
import DeckDetail from './pages/DeckDetail';
import DeckForm from './pages/DeckForm';
import Decks from './pages/Decks';
import Home from './pages/Home';
import ImportPage from './pages/Import';
import Learn from './pages/Learn';
import Problems from './pages/Problems';
import Session from './pages/Session';
import SettingsPage from './pages/Settings';
import Stats from './pages/Stats';
import ConjLearn from './pages/ConjLearn';
import ConjSession from './pages/ConjSession';
import { SchemeEditor, SchemeList } from './pages/Schemes';
import VerbDetail from './pages/VerbDetail';
import VerbForm from './pages/VerbForm';
import Verbs from './pages/Verbs';
import { t, useLang } from './i18n';

const TABS = [
  { to: '/', label: 'Start', icon: 'home' },
  { to: '/lernen', label: 'Lernen', icon: 'cards' },
  { to: '/stapel', label: 'Stapel', icon: 'layers' },
  { to: '/statistik', label: 'Statistik', icon: 'chart' },
  { to: '/einstellungen', label: 'Einstellungen', icon: 'gear' },
];

function BottomNav() {
  const { pathname } = useLocation();
  const active = (to: string) =>
    to === '/' ? pathname === '/' : to === '/stapel' ? /^\/(stapel|karten|problemkarten|import|verben)/.test(pathname) : pathname.startsWith(to);
  return (
    <nav aria-label={t("Hauptnavigation")} className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface/90 backdrop-blur-xl" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className="mx-auto flex max-w-xl">
        {TABS.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink to={tab.to} aria-current={active(tab.to) ? 'page' : undefined}
              className={cx('flex min-h-[3.6rem] flex-col items-center justify-center gap-0.5 text-[0.68rem] font-semibold transition', active(tab.to) ? 'text-accent' : 'text-muted')}>
              <span className={cx('grid h-7 w-12 place-items-center rounded-full transition', active(tab.to) && 'bg-accent-soft')}><Icon name={tab.icon} size={22} /></span>
              {t(tab.label)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function App() {
  const settings = useSettings();
  useApplySettings(settings);
  const lang = useLang();
  const pathname = useLocation().pathname;
  const inSession = pathname.startsWith('/lernen/sitzung') || pathname.startsWith('/verben/sitzung');
  return (
    <div key={lang} className="contents">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/lernen" element={<Learn />} />
        <Route path="/lernen/sitzung" element={<Session />} />
        <Route path="/stapel" element={<Decks />} />
        <Route path="/stapel/neu" element={<DeckForm />} />
        <Route path="/stapel/:id" element={<DeckDetail />} />
        <Route path="/stapel/:id/bearbeiten" element={<DeckForm />} />
        <Route path="/karten" element={<CardList />} />
        <Route path="/karten/neu" element={<CardForm />} />
        <Route path="/karten/:id" element={<CardDetail />} />
        <Route path="/karten/:id/bearbeiten" element={<CardForm />} />
        <Route path="/problemkarten" element={<Problems />} />
        <Route path="/verben" element={<Verbs />} />
        <Route path="/verben/neu" element={<VerbForm />} />
        <Route path="/verben/schemata" element={<SchemeList />} />
        <Route path="/verben/schemata/neu" element={<SchemeEditor />} />
        <Route path="/verben/schemata/:id" element={<SchemeEditor />} />
        <Route path="/verben/lernen" element={<ConjLearn />} />
        <Route path="/verben/sitzung" element={<ConjSession />} />
        <Route path="/verben/:id" element={<VerbDetail />} />
        <Route path="/verben/:id/bearbeiten" element={<VerbForm />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/statistik" element={<Stats />} />
        <Route path="/einstellungen" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!inSession && <BottomNav />}
      <Toaster />
    </div>
  );
}
