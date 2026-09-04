import { describe, expect, it } from 'vitest';
import { applyRuntimeWorkerCommand, isRuntimeShutdownEvent } from '../src/main/runtime/runtime-worker';

describe('runtime worker utility-process contract', () => {
  it('unwraps Electron utility-process MessageEvent.data before checking shutdown', () => {
    expect(isRuntimeShutdownEvent({ data: { type: 'shutdown' } })).toBe(true);
    expect(isRuntimeShutdownEvent({ data: { type: 'ready' } })).toBe(false);
    expect(isRuntimeShutdownEvent({ type: 'shutdown' })).toBe(false);
  });
});

describe('runtime worker deployment registry', () => {
  it('tracks only running deployment IDs and ignores malformed commands', () => {
    const active = new Set<string>();
    expect(applyRuntimeWorkerCommand(active, { type: 'deployment:start', deploymentId: 'deployment-1' })).toBe(1);
    expect(applyRuntimeWorkerCommand(active, { type: 'deployment:start', deploymentId: 'deployment-1' })).toBe(1);
    expect(applyRuntimeWorkerCommand(active, { type: 'deployment:pause', deploymentId: 'deployment-1' })).toBe(0);
    expect(applyRuntimeWorkerCommand(active, { type: 'deployment:start', deploymentId: '' })).toBeUndefined();
    expect(applyRuntimeWorkerCommand(active, { type: 'deployment:stop', deploymentId: 'deployment-1' })).toBe(0);
  });
});
