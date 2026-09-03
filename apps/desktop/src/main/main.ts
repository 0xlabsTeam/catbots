import { app, utilityProcess, type BrowserWindow, type Tray } from 'electron';
import { join } from 'node:path';
import { BotRepository } from './bots/bot-repository';
import { ConfigRepository } from './config/config-repository';
import { createMainWindow } from './create-window';
import { registerIpcHandlers } from './ipc/register-ipc';
import { registerAppProtocol } from './register-app-protocol';
import { RuntimeSupervisor } from './runtime/runtime-supervisor';
import { ApplicationDatabase } from './storage/database';
import { createTray } from './tray/create-tray';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const appOrigin = 'catbots://app';
const database = new ApplicationDatabase();
const runtime = new RuntimeSupervisor(() => utilityProcess.fork(join(__dirname, 'runtime-worker.js')));
let disposeIpcHandlers: (() => void) | undefined;
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let shutdownPromise: Promise<void> | undefined;
let quitting = false;

app.enableSandbox();

void app.whenReady()
  .then(async () => {
    const dataDirectory = app.getPath('userData');
    const connection = database.start(dataDirectory);

    registerAppProtocol({
      rendererDirectory: join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`),
      developmentServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
    });

    const configRepository = new ConfigRepository(dataDirectory);
    const botRepository = new BotRepository(connection);
    runtime.start();
    disposeIpcHandlers = registerIpcHandlers({
      app: {
        getVersion: () => app.getVersion(),
        showMainWindow,
        quitApplication,
      },
      configRepository,
      botRepository,
      runtime,
    });
    tray = createTray({
      iconPath: join(app.getAppPath(), 'assets', 'trayTemplate.png'),
      showWindow: showMainWindow,
      quit: quitApplication,
      getRuntimeStatus: () => runtime.getStatus(),
    });
    await showMainWindow();
  })
  .catch(async () => {
    await shutdown();
    console.error('Catbots fatal startup error');
    quitting = true;
    app.quit();
  });

app.once('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  void quitApplication();
});

// Subscribing preserves the process after the final window closes. Tray controls own explicit exit.
app.on('window-all-closed', () => undefined);

async function showMainWindow(): Promise<void> {
  if (mainWindow === undefined || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    await mainWindow.loadURL(`${appOrigin}/index.html`);
  }
  mainWindow.show();
  mainWindow.focus();
}

async function quitApplication(): Promise<void> {
  if (quitting) return;
  quitting = true;
  await shutdown();
  app.quit();
}

function shutdown(): Promise<void> {
  if (shutdownPromise !== undefined) return shutdownPromise;

  shutdownPromise = (async () => {
    try {
      await runtime.stop();
    } catch {
      // The worker supervisor converges to stopped even if platform termination reports an error.
    }
    disposeRegisteredIpcHandlers();
    database.close();
  })();
  return shutdownPromise;
}

function disposeRegisteredIpcHandlers(): void {
  const dispose = disposeIpcHandlers;
  disposeIpcHandlers = undefined;
  try {
    dispose?.();
  } catch {
    // Shutdown must continue even if Electron has already removed an IPC handler.
  }
}
