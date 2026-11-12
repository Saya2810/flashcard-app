import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { toast } from './ui';

/** Tells the user when the app is ready offline or when a new version has been downloaded. */
export function UpdatePrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW();
  useEffect(() => {
    if (!offlineReady) return;
    toast('Die App ist jetzt offline nutzbar.');
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady]);
  if (!needRefresh) return null;
  return (
    <div role="status" className="fixed inset-x-3 top-0 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-bg shadow-card" style={{ marginTop: 'max(env(safe-area-inset-top), 0.75rem)' }}>
      <span className="flex-1">Eine neue Version ist verfügbar.</span>
      <button className="min-h-[2.5rem] rounded-full bg-bg px-3 font-semibold text-ink" onClick={() => void updateServiceWorker(true)}>Aktualisieren</button>
      <button className="min-h-[2.5rem] px-2 font-medium opacity-80" onClick={() => setNeedRefresh(false)}>Später</button>
    </div>
  );
}
