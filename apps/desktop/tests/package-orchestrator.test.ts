import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createRunner, createSignalController, runForgeWithSignalHandling, runPackaging, type SpawnedChild } from '../../../scripts/package-desktop.mjs';

function fakeChild(): SpawnedChild {
  const child = new EventEmitter() as SpawnedChild;
  child.kill = () => undefined;
  return child;
}

describe('package orchestrator runner', () => {
  it('uses the desktop directory by default and propagates nonzero child exits', async () => {
    const calls: Array<{ cwd: string }> = [];
    const run = createRunner((_command: string, _args: string[], options: { cwd: string }) => {
      calls.push({ cwd: options.cwd });
      const child = fakeChild();
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    });

    await run('forge', []);
    expect(calls[0]?.cwd).toMatch(/apps\/desktop$/);
    expect(calls[0]?.cwd).not.toMatch(/catbots-m0$/);
  });
});

describe('package signal controller', () => {
  it('restores once, removes listeners, and exits conventionally on SIGINT', async () => {
    const listeners = new Map<string, () => Promise<void>>();
    const calls: string[] = [];
    createSignalController({
      on: (signal: string, handler: () => Promise<void>) => listeners.set(signal, handler),
      off: (signal: string) => listeners.delete(signal),
      terminate: () => calls.push('terminate'),
      waitForExit: async () => { calls.push('wait'); },
      restoreHost: async () => { calls.push('restore'); },
      exit: (code: number) => calls.push(`exit:${code}`),
    });

    await listeners.get('SIGINT')?.();
    expect(calls).toEqual(['wait', 'terminate', 'restore', 'exit:130']);
    expect(listeners.size).toBe(0);
  });

  it('uses SIGTERM exit code and does not restore twice for duplicate signals', async () => {
    const listeners = new Map<string, () => Promise<void>>();
    const calls: string[] = [];
    createSignalController({
      on: (s: string, h: () => Promise<void>) => listeners.set(s, h),
      off: (s: string) => listeners.delete(s),
      terminate: () => calls.push('terminate'),
      waitForExit: async () => { calls.push('wait'); },
      restoreHost: async () => { calls.push('restore'); },
      exit: (code: number) => calls.push(`exit:${code}`),
    });

    await listeners.get('SIGTERM')?.();
    await listeners.get('SIGTERM')?.();
    expect(calls).toEqual(['wait', 'terminate', 'restore', 'exit:143']);
  });

  it('reports a fixed diagnostic and exits nonzero when signal restoration fails', async () => {
    const listeners = new Map<string, () => Promise<void>>();
    const diagnostics: string[] = [];
    const exits: number[] = [];
    createSignalController({
      on: (s: string, h: () => Promise<void>) => listeners.set(s, h),
      off: (s: string) => listeners.delete(s),
      terminate: () => undefined,
      waitForExit: async () => undefined,
      restoreHost: async () => { throw new Error('restore'); },
      exit: (code: number) => exits.push(code),
      report: (message: string) => diagnostics.push(message),
    });

    await listeners.get('SIGINT')?.();
    expect(exits).toEqual([1]);
    expect(diagnostics).toEqual(['Catbots host ABI restoration failed after interruption.']);
    expect(listeners.size).toBe(0);
  });
});

describe('Forge child signal wiring', () => {
  it('forwards SIGINT to the spawned Forge child, waits for exit, restores once, and removes listeners', async () => {
    const listeners = new Map<string, () => Promise<void>>();
    const child = fakeChild();
    const calls: string[] = [];
    child.kill = (signal: string) => calls.push(`kill:${signal}`);
    const run = createRunner(() => child);
    const running = runForgeWithSignalHandling({
      runCommand: run,
      command: 'forge',
      args: ['package'],
      on: (signal: string, handler: () => Promise<void>) => listeners.set(signal, handler),
      off: (signal: string) => listeners.delete(signal),
      exit: (code: number) => calls.push(`exit:${code}`),
      restoreHost: async () => { calls.push('restore'); },
    });

    const interrupt = listeners.get('SIGINT');
    expect(interrupt).toBeDefined();
    const interrupted = interrupt?.();
    expect(calls).toEqual(['kill:SIGINT']);
    child.emit('exit', null, 'SIGINT');
    await interrupted;
    await expect(running).rejects.toThrow('forge failed (SIGINT)');
    expect(calls).toEqual(['kill:SIGINT', 'restore', 'exit:130']);
    expect(listeners.size).toBe(0);
  });
});

describe('package lifecycle', () => {
  it('restores after Forge failure', async () => {
    const calls: string[] = [];
    await expect(runPackaging({
      rebuildElectron: async () => { calls.push('rebuild'); },
      forge: async () => { calls.push('forge'); throw new Error('forge'); },
      restoreHost: async () => { calls.push('restore'); },
    })).rejects.toThrow('forge');
    expect(calls).toEqual(['rebuild', 'forge', 'restore']);
  });

  it('fails when host restoration fails after a successful package', async () => {
    await expect(runPackaging({
      rebuildElectron: async () => undefined,
      forge: async () => undefined,
      restoreHost: async () => { throw new Error('restore'); },
    })).rejects.toThrow('restore');
  });

  it('preserves a safe primary failure when packaging and restoration both fail', async () => {
    await expect(runPackaging({
      rebuildElectron: async () => undefined,
      forge: async () => { throw new Error('forge'); },
      restoreHost: async () => { throw new Error('restore'); },
    })).rejects.toThrow('Catbots packaging and host ABI restoration failed');
  });
});
