import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export function rendererContentSecurityPolicy(development: boolean): string {
  const connectSource = development
    ? "connect-src 'self' http://localhost:* ws://localhost:*"
    : "connect-src 'self'";
  return `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; ${connectSource}`;
}

function contentSecurityPolicyPlugin(development: boolean): Plugin {
  return {
    name: 'catbots-renderer-content-security-policy',
    transformIndexHtml: (html) => html.replace('__CATBOTS_CSP__', rendererContentSecurityPolicy(development)),
  };
}

export default defineConfig(({ command }) => ({
  plugins: [contentSecurityPolicyPlugin(command === 'serve'), react()],
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  optimizeDeps: { exclude: ['@catbots/contracts', '@catbots/strategy-runtime'] },
  build: {
    outDir: resolve(__dirname, '.vite/renderer/main_window'),
  },
}));
