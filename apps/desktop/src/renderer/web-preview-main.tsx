import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { createWebPreviewApi } from './web-preview-api';
import '@cloudflare/kumo/styles/standalone';
import './app.css';
import { syncSystemAppearance } from './design-system/appearance';

syncSystemAppearance();

const api = createWebPreviewApi();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App api={api} preview />
  </StrictMode>,
);
