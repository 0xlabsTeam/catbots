import { describe, expect, it } from 'vitest';
import { cleanupApplication, type CleanupProcess } from '../../../e2e/cleanup';

function processDouble(calls: string[]): CleanupProcess {
  return { kill: (signal: NodeJS.Signals | number) => { calls.push(`kill:${signal}`); return true; } };
}

describe('Electron E2E cleanup', () => {
  it('removes test data even when Playwright close fails', async () => {
    const calls: string[] = [];
    await expect(cleanupApplication({
      app: { close: async () => { throw new Error('close'); } },
      dataDirectory: '/tmp/catbots-e2e-random',
      removeDirectory: async (directory: string) => { calls.push(`rm:${directory}`); },
      waitForExit: async () => undefined,
      waitForExitWithin: async () => true,
    })).rejects.toThrow('close');
    expect(calls).toEqual(['rm:/tmp/catbots-e2e-random']);
  });

  it('force-kills a stuck process, waits for it, removes data, and reports the close failure', async () => {
    const calls: string[] = [];
    const process = processDouble(calls);
    await expect(cleanupApplication({
      app: { close: async () => undefined },
      dataDirectory: '/tmp/catbots-e2e-random',
      process,
      removeDirectory: async () => { calls.push('rm'); },
      waitForExit: async () => { calls.push('wait'); },
      waitForExitWithin: async () => false,
    })).rejects.toThrow('forced termination was required');
    expect(calls).toEqual(['kill:SIGKILL', 'wait', 'rm']);
  });
});
