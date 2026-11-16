import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { UpdatePrompt } from './components/UpdatePrompt';
import { requestPersistence } from './db/db';
import './index.css';

void requestPersistence();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
      <UpdatePrompt />
    </HashRouter>
  </React.StrictMode>,
);
