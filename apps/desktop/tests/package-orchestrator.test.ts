import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createRunner, runPackaging } from '../../../scripts/package-desktop.mjs';

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
