import { describe, expect, it } from 'vitest';
import { isRuntimeShutdownEvent } from '../src/main/runtime/runtime-worker';

describe('runtime worker utility-process contract', () => {
  it('unwraps Electron utility-process MessageEvent.data before checking shutdown', () => {
    expect(isRuntimeShutdownEvent({ data: { type: 'shutdown' } })).toBe(true);
    expect(isRuntimeShutdownEvent({ data: { type: 'ready' } })).toBe(false);
    expect(isRuntimeShutdownEvent({ type: 'shutdown' })).toBe(false);
  });
});
