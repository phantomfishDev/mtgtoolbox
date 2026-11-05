import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';
import { APP_TITLE } from './showcase.js';

// index.html carries a neutral title for the moment before this runs.
document.title = APP_TITLE;

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
