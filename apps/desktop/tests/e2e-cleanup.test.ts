import { describe, expect, it, vi } from 'vitest';
import { cleanupApplication, type CleanupProcess } from '../../../e2e/cleanup';

function processDouble(calls: string[]): CleanupProcess {
  return { kill: (signal: NodeJS.Signals | number) => { calls.push(`kill:${signal}`); return true; } };
}

describe('Electron E2E cleanup', () => {
  it('bounds a never-resolving Playwright close before forcing the process down', async () => {
    const calls: string[] = [];
    const process = processDouble(calls);
    vi.useFakeTimers();
    try {
      const cleanup = cleanupApplication({
        app: { close: () => new Promise<void>(() => undefined) },
        dataDirectory: '/tmp/catbots-e2e-random',
        process,
        removeDirectory: async () => { calls.push('rm'); },
        waitForExitWithin: async (_process, milliseconds) => {
          calls.push(`exit-within:${milliseconds}`);
          return milliseconds === 5_000;
        },
      });
      const cleanupResult = cleanup.then(() => 'resolved', (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(cleanupResult).resolves.toBe('resolved');
    } finally {
      vi.useRealTimers();
    }

    expect(calls).toEqual([
      'exit-within:0',
      'exit-within:0',
      'kill:SIGKILL',
      'exit-within:5000',
      'rm',
    ]);
  });

  it('does not close or kill an application process that already exited', async () => {
    const calls: string[] = [];
    const process = processDouble(calls);

    await expect(cleanupApplication({
      app: { close: async () => { calls.push('close'); } },
      dataDirectory: '/tmp/catbots-e2e-random',
      process,
      removeDirectory: async () => { calls.push('rm'); },
      waitForExitWithin: async (_process, milliseconds) => {
        calls.push(`exit-within:${milliseconds}`);
        return true;
      },
    })).resolves.toBeUndefined();

    expect(calls).toEqual(['exit-within:0', 'rm']);
  });

  it('does not kill or remove twice when Playwright close resolves after its deadline', async () => {
    const calls: string[] = [];
    const process = processDouble(calls);
    let resolveClose: (() => void) | undefined;

    await expect(cleanupApplication({
      app: { close: () => new Promise<void>((resolve) => { resolveClose = resolve; }) },
      dataDirectory: '/tmp/catbots-e2e-random',
      process,
      removeDirectory: async () => { calls.push('rm'); },
      waitForCloseWithin: async () => false,
      waitForExitWithin: async (_process, milliseconds) => {
        calls.push(`exit-within:${milliseconds}`);
        return milliseconds === 5_000;
      },
    })).resolves.toBeUndefined();

    const callsAfterCleanup = [...calls];
    resolveClose?.();
    await Promise.resolve();
    expect(calls).toEqual(callsAfterCleanup);
    expect(calls.filter((call) => call === 'kill:SIGKILL')).toHaveLength(1);
    expect(calls.filter((call) => call === 'rm')).toHaveLength(1);
  });

  it('force-kills an alive process after Playwright close rejects', async () => {
    const calls: string[] = [];
    const process = processDouble(calls);

    await expect(cleanupApplication({
      app: { close: async () => { throw new Error('close failed'); } },
      dataDirectory: '/tmp/catbots-e2e-random',
      process,
      removeDirectory: async () => { calls.push('rm'); },
      waitForCloseWithin: async (close) => { await close; return true; },
      waitForExitWithin: async (_process, milliseconds) => {
        calls.push(`exit-within:${milliseconds}`);
        return milliseconds === 5_000;
      },
    })).resolves.toBeUndefined();

    expect(calls).toEqual([
      'exit-within:0',
      'exit-within:0',
      'kill:SIGKILL',
      'exit-within:5000',
      'rm',
    ]);
  });

  it('accepts a process that exits within the bound after Playwright close', async () => {
    const calls: string[] = [];
    const process = processDouble(calls);

    await expect(cleanupApplication({
      app: { close: async () => { calls.push('close'); } },
      dataDirectory: '/tmp/catbots-e2e-random',
      process,
      removeDirectory: async () => { calls.push('rm'); },
      waitForCloseWithin: async (close) => { await close; return true; },
      waitForExitWithin: async (_process, milliseconds) => {
        calls.push(`exit-within:${milliseconds}`);
        return milliseconds === 5_000;
      },
    })).resolves.toBeUndefined();

    expect(calls).toEqual(['exit-within:0', 'close', 'exit-within:5000', 'rm']);
  });

  it('reports when the process remains alive after the bounded forced-exit wait', async () => {
    const calls: string[] = [];
    const process = processDouble(calls);

    await expect(cleanupApplication({
      app: { close: async () => undefined },
      dataDirectory: '/tmp/catbots-e2e-random',
      process,
      removeDirectory: async () => { calls.push('rm'); },
      waitForCloseWithin: async (close) => { await close; return true; },
      waitForExitWithin: async (_process, milliseconds) => {
        calls.push(`exit-within:${milliseconds}`);
        return false;
      },
    })).rejects.toThrow('Electron remained alive 5000ms after forced termination');

    expect(calls).toEqual([
      'exit-within:0',
      'exit-within:5000',
      'kill:SIGKILL',
      'exit-within:5000',
      'rm',
    ]);
  });

  it('preserves close, forced-exit, and directory-removal failures', async () => {
    const process = processDouble([]);

    const error = await cleanupApplication({
      app: { close: () => new Promise<void>(() => undefined) },
      dataDirectory: '/tmp/catbots-e2e-random',
      process,
      removeDirectory: async () => { throw new Error('remove failed'); },
      waitForCloseWithin: async () => false,
      waitForExitWithin: async () => false,
    }).catch((cleanupError: unknown) => cleanupError);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((failure: unknown) => String(failure))).toEqual([
      'Error: Playwright close did not settle within 5000ms',
      'Error: Electron remained alive 5000ms after forced termination',
      'Error: remove failed',
    ]);
  });

  it('removes test data even when Playwright close fails', async () => {
    const calls: string[] = [];
    await expect(cleanupApplication({
      app: { close: async () => { throw new Error('close'); } },
      dataDirectory: '/tmp/catbots-e2e-random',
      removeDirectory: async (directory: string) => { calls.push(`rm:${directory}`); },
      waitForExitWithin: async () => true,
    })).rejects.toThrow('close');
    expect(calls).toEqual(['rm:/tmp/catbots-e2e-random']);
  });

  it('accepts a successful bounded forced cleanup for a stuck process', async () => {
    const calls: string[] = [];
    const process = processDouble(calls);
    await expect(cleanupApplication({
      app: { close: async () => undefined },
      dataDirectory: '/tmp/catbots-e2e-random',
      process,
      removeDirectory: async () => { calls.push('rm'); },
      waitForExitWithin: async (_process, milliseconds) => {
        calls.push(`exit-within:${milliseconds}`);
        return calls.filter((call) => call.startsWith('exit-within')).length === 3;
      },
    })).resolves.toBeUndefined();
    expect(calls).toEqual(['exit-within:0', 'exit-within:5000', 'kill:SIGKILL', 'exit-within:5000', 'rm']);
  });
});
