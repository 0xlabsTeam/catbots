import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron', 'node:fs/promises', 'node:path'],
    },
  },
});
