import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeStatusSchema } from '@catbots/contracts';
import { RuntimeSupervisor, type RuntimeWorkerPort } from '../src/main/runtime/runtime-supervisor';
import { createTray } from '../src/main/tray/create-tray';

const trayBridge = vi.hoisted(() => {
  const tray = {
    destroy: vi.fn(),
    setContextMenu: vi.fn(),
    setToolTip: vi.fn(),
  };
  const buildFromTemplate = vi.fn((template) => template);
  const Tray = vi.fn(function TrayDouble() {
    return tray;
  });
  const createFromPath = vi.fn(() => ({ setTemplateImage: vi.fn() }));

  return {
    Menu: { buildFromTemplate },
    Tray,
    nativeImage: { createFromPath },
    tray,
    reset: () => {
      tray.destroy.mockClear();
      tray.setContextMenu.mockClear();
      tray.setToolTip.mockClear();
      buildFromTemplate.mockClear();
      Tray.mockClear();
      createFromPath.mockClear();
    },
  };
});

vi.mock('electron', () => trayBridge);

function createWorkerDouble(): RuntimeWorkerPort & EventEmitter {
  const worker = new EventEmitter() as RuntimeWorkerPort & EventEmitter;
  worker.postMessage = vi.fn();
  worker.kill = vi.fn().mockReturnValue(true);
  return worker;
}

describe('RuntimeSupervisor', () => {
  afterEach(() => {
    vi.useRealTimers();
    trayBridge.reset();
  });

  it('starts exactly one worker and publishes ready once it reports readiness', () => {
    const worker = createWorkerDouble();
    const createWorker = vi.fn(() => worker);
    const supervisor = new RuntimeSupervisor(createWorker);
    const observed: string[] = [];
    supervisor.subscribeStatus((status) => observed.push(status.state));

    supervisor.start();
    supervisor.start();
    worker.emit('message', { type: 'ready' });

    expect(createWorker).toHaveBeenCalledOnce();
    expect(supervisor.getStatus()).toEqual({ state: 'ready', activeBots: 0 });
    expect(observed).toEqual(['starting', 'ready']);
  });

  it('routes deployment lifecycle commands through the worker and publishes its active count', () => {
    const worker = createWorkerDouble();
    const supervisor = new RuntimeSupervisor(() => worker);
    supervisor.start();
    worker.emit('message', { type: 'ready' });

    supervisor.startDeployment('028f3f75-89ab-7def-8123-456789abcdef');
    worker.emit('message', { type: 'runtime-status', activeBots: 1 });
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: 'deployment:start', deploymentId: '028f3f75-89ab-7def-8123-456789abcdef',
    });
    expect(supervisor.getStatus()).toEqual({ state: 'ready', activeBots: 1 });

    supervisor.pauseDeployment('028f3f75-89ab-7def-8123-456789abcdef');
    supervisor.stopDeployment('028f3f75-89ab-7def-8123-456789abcdef');
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'deployment:pause' }));
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'deployment:stop' }));
  });

  it('fails closed when a deployment command is sent before the worker is ready', () => {
    const supervisor = new RuntimeSupervisor(() => createWorkerDouble());
    supervisor.start();

    expect(() => supervisor.startDeployment('028f3f75-89ab-7def-8123-456789abcdef')).toThrow('RUNTIME_NOT_READY');
  });

  it('ignores a ready event from a stopped worker after a replacement starts', async () => {
    const first = createWorkerDouble();
    const second = createWorkerDouble();
    const supervisor = new RuntimeSupervisor(
      vi.fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
      { shutdownTimeoutMs: 25 },
    );

    supervisor.start();
    const stopping = supervisor.stop();
    first.emit('exit', 0, null);
    await stopping;
    supervisor.start();
    first.emit('message', { type: 'ready' });

    expect(supervisor.getStatus()).toEqual({ state: 'starting', activeBots: 0 });
    second.emit('message', { type: 'ready' });
    expect(supervisor.getStatus()).toEqual({ state: 'ready', activeBots: 0 });
  });

  it('stops gracefully when the worker exits after shutdown', async () => {
    const worker = createWorkerDouble();
    const supervisor = new RuntimeSupervisor(() => worker, { shutdownTimeoutMs: 25 });
    supervisor.start();

    const stopping = supervisor.stop();
    expect(supervisor.getStatus()).toEqual({ state: 'stopping', activeBots: 0 });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
    worker.emit('exit', 0, null);
    await stopping;

    expect(worker.kill).not.toHaveBeenCalled();
    expect(supervisor.getStatus()).toEqual({ state: 'stopped', activeBots: 0 });
  });

  it('keeps stop pending after a successful kill until the worker actually exits', async () => {
    vi.useFakeTimers();
    const worker = createWorkerDouble();
    const supervisor = new RuntimeSupervisor(() => worker, { shutdownTimeoutMs: 25, forceExitTimeoutMs: 25 });
    supervisor.start();

    const stopping = supervisor.stop();
    let settled = false;
    void stopping.finally(() => { settled = true; });
    expect(worker.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(25);

    expect(worker.kill).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    expect(supervisor.getStatus()).toEqual({ state: 'stopping', activeBots: 0 });
    worker.emit('exit', 0, null);
    await stopping;
    expect(supervisor.getStatus()).toEqual({ state: 'stopped', activeBots: 0 });
  });

  it('rejects stop within a terminal bound when kill succeeds but no exit arrives', async () => {
    vi.useFakeTimers();
    const worker = createWorkerDouble();
    const supervisor = new RuntimeSupervisor(() => worker, { shutdownTimeoutMs: 25, forceExitTimeoutMs: 40 });
    supervisor.start();

    const stopping = supervisor.stop();
    const rejected = expect(stopping).rejects.toMatchObject({ code: 'RUNTIME_STOP_FAILED' });
    await vi.advanceTimersByTimeAsync(25);
    expect(supervisor.getStatus()).toEqual({ state: 'stopping', activeBots: 0 });
    await vi.advanceTimersByTimeAsync(39);
    expect(supervisor.getStatus()).toEqual({ state: 'stopping', activeBots: 0 });
    await vi.advanceTimersByTimeAsync(1);

    await rejected;
    expect(supervisor.getStatus()).toEqual({ state: 'error', activeBots: 0 });
  });

  it('rejects shutdown when the bounded kill reports failure until a delayed exit establishes termination', async () => {
    vi.useFakeTimers();
    const worker = createWorkerDouble();
    worker.kill = vi.fn().mockReturnValue(false);
    const supervisor = new RuntimeSupervisor(() => worker, { shutdownTimeoutMs: 25 });
    supervisor.start();

    const stopping = supervisor.stop();
    const rejected = expect(stopping).rejects.toMatchObject({ code: 'RUNTIME_STOP_FAILED' });
    await vi.advanceTimersByTimeAsync(25);

    await rejected;
    expect(supervisor.getStatus()).toEqual({ state: 'error', activeBots: 0 });
    worker.emit('exit', 0, null);
    expect(supervisor.getStatus()).toEqual({ state: 'stopped', activeBots: 0 });
  });

  it('rejects shutdown when kill throws without treating late ready as a recovery', async () => {
    vi.useFakeTimers();
    const worker = createWorkerDouble();
    worker.kill = vi.fn(() => { throw new Error('platform kill failure'); });
    const supervisor = new RuntimeSupervisor(() => worker, { shutdownTimeoutMs: 25 });
    supervisor.start();

    const stopping = supervisor.stop();
    const rejected = expect(stopping).rejects.toMatchObject({ code: 'RUNTIME_STOP_FAILED' });
    await vi.advanceTimersByTimeAsync(25);

    await rejected;
    worker.emit('message', { type: 'ready' });
    expect(supervisor.getStatus()).toEqual({ state: 'error', activeBots: 0 });
  });

  it('reports an unexpected worker exit as an error without permitting an illegal ready transition', () => {
    const worker = createWorkerDouble();
    const supervisor = new RuntimeSupervisor(() => worker);
    supervisor.start();
    worker.emit('exit', 1, null);
    worker.emit('message', { type: 'ready' });

    expect(supervisor.getStatus()).toEqual({ state: 'error', activeBots: 0 });
  });
});

describe('M0 runtime contract', () => {
  it('validates the zero-active-bot skeleton status at the shared IPC boundary', () => {
    expect(RuntimeStatusSchema.parse({ state: 'ready', activeBots: 0 })).toEqual({ state: 'ready', activeBots: 0 });
    expect(RuntimeStatusSchema.safeParse({ state: 'ready', activeBots: -1 }).success).toBe(false);
  });
});

describe('createTray', () => {
  it('keeps native Open and Quit controls available independently of a renderer', async () => {
    const showWindow = vi.fn();
    const quit = vi.fn().mockResolvedValue(undefined);
    createTray({
      iconPath: '/app/trayTemplate.png',
      showWindow,
      quit,
      getRuntimeStatus: () => ({ state: 'ready', activeBots: 0 }),
      subscribeRuntimeStatus: () => () => undefined,
    });

    const template = trayBridge.Menu.buildFromTemplate.mock.calls[0]?.[0] as Array<{
      label?: string;
      click?: () => void | Promise<void>;
    }>;
    const open = template.find((item) => item.label === 'Open Catbots');
    const quitItem = template.find((item) => item.label === 'Quit Catbots');

    open?.click?.();
    await quitItem?.click?.();

    expect(showWindow).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
    expect(trayBridge.Tray).toHaveBeenCalledOnce();
    expect(trayBridge.nativeImage.createFromPath).toHaveBeenCalledWith('/app/trayTemplate.png');
  });

  it('validates live runtime updates, rebuilds status UI, and disposes its subscription', () => {
    trayBridge.reset();
    let publish: ((status: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const controller = createTray({
      iconPath: '/app/trayTemplate.png',
      showWindow: vi.fn(),
      quit: vi.fn(),
      getRuntimeStatus: () => ({ state: 'starting', activeBots: 0 }),
      subscribeRuntimeStatus: (listener) => {
        publish = listener as (status: unknown) => void;
        return unsubscribe;
      },
    });

    publish?.({ state: 'ready', activeBots: 0 });
    publish?.({ state: 'ready', activeBots: -1 });
    publish?.({ state: 'stopped', activeBots: 0 });

    expect(trayBridge.tray.setToolTip.mock.calls.map(([label]) => label)).toEqual([
      'Runtime: Starting · 0 active bots',
      'Runtime: Ready · 0 active bots',
      'Runtime: Error · 0 active bots',
      'Runtime: Stopped · 0 active bots',
    ]);
    expect(trayBridge.tray.setContextMenu).toHaveBeenCalledTimes(4);

    controller.dispose();
    controller.dispose();
    publish?.({ state: 'ready', activeBots: 0 });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(trayBridge.tray.destroy).toHaveBeenCalledOnce();
    expect(trayBridge.tray.setToolTip).toHaveBeenCalledTimes(4);
  });
});
