import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron', 'node:crypto', 'node:fs', 'node:fs/promises', 'node:path'],
    },
  },
});
