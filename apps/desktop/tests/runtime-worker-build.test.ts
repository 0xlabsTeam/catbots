import { describe, expect, it } from 'vitest';
import workerConfig from '../vite.runtime-worker.config';

describe('runtime worker Vite target', () => {
  it('emits a dedicated runtime-worker bundle instead of the Electron main entry', () => {
    expect(workerConfig.build?.lib).toMatchObject({ fileName: 'runtime-worker' });
  });
});
