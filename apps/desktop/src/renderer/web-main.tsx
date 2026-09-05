import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@cloudflare/kumo';
import App from './App';
import { createWebApi } from './web-api';
import { syncSystemAppearance } from './design-system/appearance';
import '@cloudflare/kumo/styles/standalone';
import './app.css';

syncSystemAppearance();
const root = createRoot(document.getElementById('root')!);
root.render(<main className="app-loading" role="status">Connecting to local backend…</main>);
void createWebApi().then((api) => root.render(<StrictMode><App api={api} surface="web" /></StrictMode>)).catch(() => {
  root.render(<main className="app-loading"><h1>Local backend unavailable</h1><p>Start Catbots with pnpm dev:web or pnpm dev:all, then reconnect.</p><Button onClick={() => window.location.reload()}>Reconnect</Button></main>);
});
