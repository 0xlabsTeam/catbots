import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      environment: 'node',
      include: ['apps/desktop/tests/**/*.test.ts'],
    },
  },
]);
