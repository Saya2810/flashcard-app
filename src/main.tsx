import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { UpdatePrompt } from './components/UpdatePrompt';
import { toast } from './components/ui';
import { requestPersistence } from './db/db';
import { autoImportLegacy } from './db/legacy';
import './index.css';

void requestPersistence();
// Copy the Persian–German data of the original app once (read-only on the old database).
void autoImportLegacy().then((n) => { if (n > 0) toast(`${n} Vokabeln aus der Persisch-Version übernommen`); }).catch(() => {});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
      <UpdatePrompt />
    </HashRouter>
  </React.StrictMode>,
);
