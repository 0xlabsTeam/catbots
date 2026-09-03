import { app } from 'electron';
import { join } from 'node:path';
import { BotRepository } from './bots/bot-repository';
import { ConfigRepository } from './config/config-repository';
import { createMainWindow } from './create-window';
import { registerIpcHandlers } from './ipc/register-ipc';
import { registerAppProtocol } from './register-app-protocol';
import { ApplicationDatabase } from './storage/database';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const appOrigin = 'catbots://app';
const database = new ApplicationDatabase();
let disposeIpcHandlers: (() => void) | undefined;
const stoppedRuntime = {
  getStatus: () => ({ state: 'stopped' as const, activeBots: 0 }),
  subscribeStatus: () => () => undefined,
};

app.enableSandbox();

void app.whenReady()
  .then(async () => {
    const dataDirectory = app.getPath('userData');
    const connection = database.start(dataDirectory);

    registerAppProtocol({
      rendererDirectory: join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`),
      developmentServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
    });

    const mainWindow = createMainWindow();
    const configRepository = new ConfigRepository(dataDirectory);
    const botRepository = new BotRepository(connection);
    disposeIpcHandlers = registerIpcHandlers({
      app: {
        getVersion: () => app.getVersion(),
        showMainWindow: () => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
        quitApplication: () => app.quit(),
      },
      configRepository,
      botRepository,
      runtime: stoppedRuntime,
    });
    await mainWindow.loadURL(`${appOrigin}/index.html`);
  })
  .catch(() => {
    disposeRegisteredIpcHandlers();
    database.close();
    console.error('Catbots fatal startup error');
    app.quit();
  });

app.once('before-quit', () => {
  disposeRegisteredIpcHandlers();
  database.close();
});

// Subscribing preserves the process after the final window closes; Task 8 adds tray controls.
app.on('window-all-closed', () => undefined);

function disposeRegisteredIpcHandlers(): void {
  const dispose = disposeIpcHandlers;
  disposeIpcHandlers = undefined;
  try {
    dispose?.();
  } catch {
    // Shutdown must continue even if Electron has already removed an IPC handler.
  }
}
