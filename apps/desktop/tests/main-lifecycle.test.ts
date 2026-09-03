import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  let beforeQuitListener: (() => void) | undefined;
  let windowAllClosedListener: (() => void) | undefined;
  const app = {
    enableSandbox: vi.fn(),
    getPath: vi.fn(() => '/test-user-data'),
    getVersion: vi.fn(),
    on: vi.fn((eventName: string, listener: () => void) => {
      if (eventName === 'window-all-closed') {
        windowAllClosedListener = listener;
      }

      return app;
    }),
    once: vi.fn((eventName: string, listener: () => void) => {
      if (eventName === 'before-quit') {
        beforeQuitListener = listener;
      }

      return app;
    }),
    quit: vi.fn(),
    whenReady: vi.fn(() => new Promise<void>(() => undefined)),
  };

  return {
    app,
    getBeforeQuitListener: () => beforeQuitListener,
    getWindowAllClosedListener: () => windowAllClosedListener,
    reset: () => {
      beforeQuitListener = undefined;
      windowAllClosedListener = undefined;
      app.enableSandbox.mockClear();
      app.getPath.mockClear();
      app.on.mockClear();
      app.once.mockClear();
      app.quit.mockClear();
      app.whenReady.mockClear();
    },
    ipcMain: { handle: vi.fn() },
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

vi.mock('electron', () => electron);
vi.mock('../src/main/create-window', () => ({ createMainWindow: vi.fn(() => ({ loadURL: vi.fn() })) }));
vi.mock('../src/main/register-app-protocol', () => ({ registerAppProtocol: vi.fn() }));
vi.mock('../src/main/storage/database', () => applicationDatabase);

describe('main window lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);
    vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window');
    electron.reset();
    applicationDatabase.reset();
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
    listener?.();

    expect(applicationDatabase.close).toHaveBeenCalledOnce();
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

    expect(applicationDatabase.close).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith('Catbots fatal startup error');
    expect(JSON.stringify(report.mock.calls)).not.toContain(secret);
  });
});
