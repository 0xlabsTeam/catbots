import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@cloudflare/kumo/styles/standalone';
import './app.css';
import { syncSystemAppearance } from './design-system/appearance';

syncSystemAppearance();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App api={window.catbots} />
  </StrictMode>,
);
