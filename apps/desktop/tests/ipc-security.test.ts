import { describe, expect, it, vi } from 'vitest';
import { buildWindowOptions } from '../src/main/create-window';

describe('buildWindowOptions', () => {
  it('isolates and sandboxes the renderer', () => {
    const options = buildWindowOptions('/app/preload.js');
    expect(options.webPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: '/app/preload.js',
    });
  });
});
