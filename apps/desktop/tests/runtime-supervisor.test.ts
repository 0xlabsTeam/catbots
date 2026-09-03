import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeStatusSchema } from '@catbots/contracts';
import { RuntimeSupervisor, type RuntimeWorkerPort } from '../src/main/runtime/runtime-supervisor';
import { createTray } from '../src/main/tray/create-tray';

const trayBridge = vi.hoisted(() => {
  const tray = {
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
    reset: () => {
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

  it('escalates to kill after the bounded shutdown period before reporting stopped', async () => {
    vi.useFakeTimers();
    const worker = createWorkerDouble();
    const supervisor = new RuntimeSupervisor(() => worker, { shutdownTimeoutMs: 25 });
    supervisor.start();

    const stopping = supervisor.stop();
    expect(worker.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(25);
    await stopping;

    expect(worker.kill).toHaveBeenCalledOnce();
    expect(supervisor.getStatus()).toEqual({ state: 'stopped', activeBots: 0 });
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
});
