import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createRunner } from '../../../scripts/package-desktop.mjs';

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
