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
    to === '/' ? pathname === '/' : to === '/stapel' ? /^\/(stapel|karten|problemkarten|import)/.test(pathname) : pathname.startsWith(to);
  return (
    <nav aria-label="Hauptnavigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface/90 backdrop-blur-xl" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className="mx-auto flex max-w-xl">
        {TABS.map((t) => (
          <li key={t.to} className="flex-1">
            <NavLink to={t.to} aria-current={active(t.to) ? 'page' : undefined}
              className={cx('flex min-h-[3.6rem] flex-col items-center justify-center gap-0.5 text-[0.68rem] font-semibold transition', active(t.to) ? 'text-accent' : 'text-muted')}>
              <span className={cx('grid h-7 w-12 place-items-center rounded-full transition', active(t.to) && 'bg-accent-soft')}><Icon name={t.icon} size={22} /></span>
              {t.label}
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
  const inSession = useLocation().pathname.startsWith('/lernen/sitzung');
  return (
    <>
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
        <Route path="/import" element={<ImportPage />} />
        <Route path="/statistik" element={<Stats />} />
        <Route path="/einstellungen" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!inSession && <BottomNav />}
      <Toaster />
    </>
  );
}
