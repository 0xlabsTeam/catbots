import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@cloudflare/kumo/styles/standalone';
import './app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
