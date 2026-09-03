import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createRunner, createSignalController, runPackaging, waitForChildThenRestore } from '../../../scripts/package-desktop.mjs';

describe('package orchestrator runner', () => {
  it('uses the desktop directory by default and propagates nonzero child exits', async () => {
    const calls: Array<{ cwd: string }> = [];
    const run = createRunner((_command: string, _args: string[], options: { cwd: string }) => {
      calls.push({ cwd: options.cwd });
      const child = new EventEmitter() as EventEmitter & { once: EventEmitter['once'] };
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    });
    await run('forge', []);
    expect(calls[0]?.cwd).toMatch(/apps\/desktop$/);
  });
});

it('forwards a signal to the active child before restoring', async () => {
  const child = new EventEmitter() as EventEmitter & { kill(signal: string): void };
  const calls: string[] = []; child.kill = (signal) => calls.push(signal);
  const pending = waitForChildThenRestore(child, 'SIGTERM', async () => calls.push('restore'));
  expect(calls).toEqual(['SIGTERM']); child.emit('exit'); await pending;
  expect(calls).toEqual(['SIGTERM', 'restore']);
});

describe('package signal controller', () => {
  it('restores once, removes listeners, and exits conventionally on SIGINT', async () => {
    const listeners = new Map<string, () => Promise<void>>();
    const calls: string[] = [];
    createSignalController({
      on: (signal: string, handler: () => Promise<void>) => listeners.set(signal, handler),
      off: (signal: string) => listeners.delete(signal),
      terminate: () => calls.push('terminate'),
      restoreHost: async () => calls.push('restore'),
      exit: (code: number) => calls.push(`exit:${code}`),
    });
    await listeners.get('SIGINT')?.();
    expect(calls).toEqual(['terminate', 'restore', 'exit:130']);
    expect(listeners.size).toBe(0);
  });

  it('uses SIGTERM exit code and does not restore twice for duplicate signals', async () => {
    const listeners = new Map<string, () => Promise<void>>();
    const calls: string[] = [];
    createSignalController({ on: (s, h) => listeners.set(s, h), off: (s) => listeners.delete(s), terminate: () => calls.push('terminate'), restoreHost: async () => calls.push('restore'), exit: (code) => calls.push(`exit:${code}`) });
    await listeners.get('SIGTERM')?.();
    await listeners.get('SIGTERM')?.();
    expect(calls).toEqual(['terminate', 'restore', 'exit:143']);
  });

  it('exits nonzero and removes listeners when signal restoration fails', async () => {
    const listeners = new Map<string, () => Promise<void>>(); const exits: number[] = [];
    createSignalController({ on: (s, h) => listeners.set(s, h), off: (s) => listeners.delete(s), terminate: () => undefined, restoreHost: async () => { throw new Error('restore'); }, exit: (code) => exits.push(code) });
    await listeners.get('SIGINT')?.();
    expect(exits).toEqual([1]); expect(listeners.size).toBe(0);
  });
});

describe('package lifecycle', () => {
  it('restores after Forge failure', async () => {
    const calls: string[] = [];
    await expect(runPackaging({
      rebuildElectron: async () => calls.push('rebuild'),
      forge: async () => { calls.push('forge'); throw new Error('forge'); },
      restoreHost: async () => calls.push('restore'),
    })).rejects.toThrow('forge');
    expect(calls).toEqual(['rebuild', 'forge', 'restore']);
  });

  it('fails when host restoration fails after a successful package', async () => {
    await expect(runPackaging({ rebuildElectron: async () => undefined, forge: async () => undefined, restoreHost: async () => { throw new Error('restore'); } })).rejects.toThrow('restore');
  });
});
