import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  let beforeQuitListener: ((event?: { preventDefault(): void }) => void) | undefined;
  let windowAllClosedListener: (() => void) | undefined;
  const app = {
    enableSandbox: vi.fn(),
    getPath: vi.fn(() => '/test-user-data'),
    getAppPath: vi.fn(() => '/test-app'),
    getVersion: vi.fn(),
    on: vi.fn((eventName: string, listener: () => void) => {
      if (eventName === 'window-all-closed') {
        windowAllClosedListener = listener;
      }

      return app;
    }),
    once: vi.fn((eventName: string, listener: (event?: { preventDefault(): void }) => void) => {
      if (eventName === 'before-quit') {
        beforeQuitListener = listener;
      }

      return app;
    }),
    quit: vi.fn(),
    whenReady: vi.fn(() => new Promise<void>(() => undefined)),
  };
  const removeHandler = vi.fn();

  return {
    app,
    getBeforeQuitListener: () => beforeQuitListener,
    getWindowAllClosedListener: () => windowAllClosedListener,
    removeHandler,
    reset: () => {
      beforeQuitListener = undefined;
      windowAllClosedListener = undefined;
      app.enableSandbox.mockClear();
      app.getPath.mockClear();
      app.getAppPath.mockClear();
      app.on.mockClear();
      app.once.mockClear();
      app.quit.mockClear();
      app.whenReady.mockClear();
      removeHandler.mockClear();
    },
    ipcMain: { handle: vi.fn(), removeHandler },
  };
});

const applicationDatabase = vi.hoisted(() => {
  const start = vi.fn();
  const close = vi.fn();

  return {
    ApplicationDatabase: vi.fn(function ApplicationDatabaseMock() {
      return { close, start };
    }),
    close,
    reset: () => {
      start.mockClear();
      close.mockClear();
    },
    start,
  };
});

const mainWindow = vi.hoisted(() => {
  const loadURL = vi.fn();
  const first = { focus: vi.fn(), isDestroyed: vi.fn(() => false), loadURL, show: vi.fn() };
  const replacement = { focus: vi.fn(), isDestroyed: vi.fn(() => false), loadURL: vi.fn(), show: vi.fn() };
  const create = vi.fn(() => first);

  return {
    create,
    first,
    loadURL,
    replacement,
    reset: () => {
      create.mockReset();
      create.mockReturnValue(first);
      loadURL.mockReset();
      first.focus.mockReset();
      first.isDestroyed.mockReset();
      first.isDestroyed.mockReturnValue(false);
      first.show.mockReset();
      replacement.focus.mockReset();
      replacement.isDestroyed.mockReset();
      replacement.isDestroyed.mockReturnValue(false);
      replacement.loadURL.mockReset();
      replacement.show.mockReset();
    },
  };
});

const runtime = vi.hoisted(() => {
  const start = vi.fn();
  const stop = vi.fn(async () => undefined);
  const getStatus = vi.fn(() => ({ state: 'stopped' as const, activeBots: 0 }));
  const subscribeStatus = vi.fn(() => () => undefined);
  const RuntimeSupervisor = vi.fn(function RuntimeSupervisorMock() {
    return { getStatus, start, stop, subscribeStatus };
  });

  return {
    RuntimeSupervisor,
    getStatus,
    start,
    stop,
    subscribeStatus,
    reset: () => {
      RuntimeSupervisor.mockClear();
      getStatus.mockClear();
      start.mockClear();
      stop.mockClear();
      subscribeStatus.mockClear();
    },
  };
});

const tray = vi.hoisted(() => {
  const create = vi.fn();
  return {
    create,
    reset: () => create.mockReset(),
  };
});

vi.mock('electron', () => electron);
vi.mock('../src/main/create-window', () => ({ createMainWindow: mainWindow.create }));
vi.mock('../src/main/register-app-protocol', () => ({ registerAppProtocol: vi.fn() }));
vi.mock('../src/main/storage/database', () => applicationDatabase);
vi.mock('../src/main/runtime/runtime-supervisor', () => ({ RuntimeSupervisor: runtime.RuntimeSupervisor }));
vi.mock('../src/main/tray/create-tray', () => ({ createTray: tray.create }));

describe('main window lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);
    vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window');
    electron.reset();
    applicationDatabase.reset();
    mainWindow.reset();
    runtime.reset();
    tray.reset();
  });

  it('keeps the application process alive when the last window closes', async () => {
    await import('../src/main/main');

    const listener = electron.getWindowAllClosedListener();
    expect(listener).toBeTypeOf('function');

    listener?.();

    expect(electron.app.quit).not.toHaveBeenCalled();
  });

  it('opens the application database at startup and closes it before quit', async () => {
    electron.app.whenReady.mockResolvedValueOnce(undefined);

    await import('../src/main/main');
    await vi.waitFor(() => {
      expect(applicationDatabase.start).toHaveBeenCalledWith('/test-user-data');
    });

    const listener = electron.getBeforeQuitListener();
    expect(listener).toBeTypeOf('function');
    listener?.({ preventDefault: vi.fn() });
    await vi.waitFor(() => {
      expect(electron.app.quit).toHaveBeenCalledOnce();
    });

    expect(applicationDatabase.close).toHaveBeenCalledOnce();
    expect(electron.removeHandler).toHaveBeenCalledTimes(9);
  });

  it('recreates a destroyed window from the tray Open action', async () => {
    electron.app.whenReady.mockResolvedValueOnce(undefined);

    await import('../src/main/main');
    await vi.waitFor(() => expect(tray.create).toHaveBeenCalledOnce());
    mainWindow.first.isDestroyed.mockReturnValue(true);
    mainWindow.create.mockReturnValueOnce(mainWindow.replacement);

    const options = tray.create.mock.calls[0]?.[0] as { showWindow(): Promise<void> };
    await options.showWindow();

    expect(mainWindow.create).toHaveBeenCalledTimes(2);
    expect(mainWindow.replacement.loadURL).toHaveBeenCalledWith('catbots://app/index.html');
    expect(mainWindow.replacement.show).toHaveBeenCalledOnce();
    expect(mainWindow.replacement.focus).toHaveBeenCalledOnce();
  });

  it('stops the runtime before quitting from the renderer-independent tray action', async () => {
    electron.app.whenReady.mockResolvedValueOnce(undefined);

    await import('../src/main/main');
    await vi.waitFor(() => expect(tray.create).toHaveBeenCalledOnce());
    const options = tray.create.mock.calls[0]?.[0] as { quit(): Promise<void> };
    await options.quit();

    expect(runtime.start).toHaveBeenCalledOnce();
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(applicationDatabase.close).toHaveBeenCalledOnce();
    expect(runtime.stop.mock.invocationCallOrder[0]).toBeLessThan(electron.app.quit.mock.invocationCallOrder[0]);
  });

  it('closes resources, reports safely, and quits when startup fails', async () => {
    const secret = 'database failure containing a secret';
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    applicationDatabase.start.mockImplementationOnce(() => {
      throw new Error(secret);
    });
    electron.app.whenReady.mockResolvedValueOnce(undefined);

    await import('../src/main/main');
    await vi.waitFor(() => {
      expect(electron.app.quit).toHaveBeenCalledOnce();
    });

    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(applicationDatabase.close).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith('Catbots fatal startup error');
    expect(JSON.stringify(report.mock.calls)).not.toContain(secret);
  });

  it('disposes owned IPC handlers when startup fails after registration', async () => {
    const secret = 'late startup failure containing a secret';
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mainWindow.loadURL.mockRejectedValueOnce(new Error(secret));
    electron.app.whenReady.mockResolvedValueOnce(undefined);

    await import('../src/main/main');
    await vi.waitFor(() => {
      expect(electron.app.quit).toHaveBeenCalledOnce();
    });

    expect(electron.removeHandler).toHaveBeenCalledTimes(9);
    expect(JSON.stringify(report.mock.calls)).not.toContain(secret);
  });
});
