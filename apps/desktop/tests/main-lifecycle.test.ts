import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  let windowAllClosedListener: (() => void) | undefined;
  const app = {
    enableSandbox: vi.fn(),
    getVersion: vi.fn(),
    on: vi.fn((eventName: string, listener: () => void) => {
      if (eventName === 'window-all-closed') {
        windowAllClosedListener = listener;
      }

      return app;
    }),
    quit: vi.fn(),
    whenReady: vi.fn(() => new Promise<void>(() => undefined)),
  };

  return {
    app,
    getWindowAllClosedListener: () => windowAllClosedListener,
    reset: () => {
      windowAllClosedListener = undefined;
      app.enableSandbox.mockClear();
      app.on.mockClear();
      app.quit.mockClear();
      app.whenReady.mockClear();
    },
    ipcMain: { handle: vi.fn() },
  };
});

vi.mock('electron', () => electron);
vi.mock('../src/main/create-window', () => ({ createMainWindow: vi.fn() }));
vi.mock('../src/main/register-app-protocol', () => ({ registerAppProtocol: vi.fn() }));

describe('main window lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    electron.reset();
  });

  it('keeps the application process alive when the last window closes', async () => {
    await import('../src/main/main');

    const listener = electron.getWindowAllClosedListener();
    expect(listener).toBeTypeOf('function');

    listener?.();

    expect(electron.app.quit).not.toHaveBeenCalled();
  });
});
