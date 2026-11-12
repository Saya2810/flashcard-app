import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Icon, Toaster, cx } from './components/ui';
import { useApplySettings, useSettings } from './hooks/useSettings';
import Home from './pages/Home';
import ImportPage from './pages/Import';
import Learn from './pages/Learn';
import Lessons from './pages/Lessons';
import Problems from './pages/Problems';
import Session from './pages/Session';
import SettingsPage from './pages/Settings';
import Stats from './pages/Stats';
import VocabDetail from './pages/VocabDetail';
import VocabForm from './pages/VocabForm';
import VocabList from './pages/VocabList';

const TABS = [
  { to: '/', label: 'Startseite', icon: 'home' },
  { to: '/lernen', label: 'Lernen', icon: 'cards' },
  { to: '/vokabeln', label: 'Vokabeln', icon: 'list' },
  { to: '/statistik', label: 'Statistik', icon: 'chart' },
  { to: '/einstellungen', label: 'Einstellungen', icon: 'gear' },
];

function BottomNav() {
  const { pathname } = useLocation();
  const active = (to: string) =>
    to === '/' ? pathname === '/' : to === '/vokabeln' ? /^\/(vokabeln|lektionen|problemvokabeln)/.test(pathname) : pathname.startsWith(to);
  return (
    <nav aria-label="Hauptnavigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-lg" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className="mx-auto flex max-w-xl">
        {TABS.map((t) => (
          <li key={t.to} className="flex-1">
            <NavLink to={t.to} aria-current={active(t.to) ? 'page' : undefined}
              className={cx('flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 text-[0.68rem] font-semibold', active(t.to) ? 'text-accent' : 'text-muted')}>
              <Icon name={t.icon} size={24} />
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
        <Route path="/vokabeln" element={<VocabList />} />
        <Route path="/vokabeln/neu" element={<VocabForm />} />
        <Route path="/vokabeln/import" element={<ImportPage />} />
        <Route path="/vokabeln/:id" element={<VocabDetail />} />
        <Route path="/vokabeln/:id/bearbeiten" element={<VocabForm />} />
        <Route path="/lektionen" element={<Lessons />} />
        <Route path="/problemvokabeln" element={<Problems />} />
        <Route path="/statistik" element={<Stats />} />
        <Route path="/einstellungen" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!inSession && <BottomNav />}
      <Toaster />
    </>
  );
}
