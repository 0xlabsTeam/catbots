import { app, dialog, utilityProcess, type BrowserWindow, type Tray } from 'electron';
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
        showMainWindow: openMainWindow,
        quitApplication: requestQuit,
      },
      configRepository,
      botRepository,
      runtime,
    });
    tray = createTray({
      iconPath: join(app.getAppPath(), 'assets', 'trayTemplate.png'),
      showWindow: openMainWindow,
      quit: requestQuit,
      getRuntimeStatus: () => runtime.getStatus(),
    });
    await openMainWindow();
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
  void requestQuit();
});

// Subscribing preserves the process after the final window closes. Tray controls own explicit exit.
app.on('window-all-closed', () => undefined);

async function showMainWindow(): Promise<void> {
  if (mainWindow === undefined || mainWindow.isDestroyed()) {
    const candidate = createMainWindow();
    mainWindow = candidate;
    try {
      await candidate.loadURL(`${appOrigin}/index.html`);
    } catch {
      try {
        if (!candidate.isDestroyed()) candidate.destroy();
      } catch {
        // The tray remains the recovery path even if a failed window is already unavailable.
      }
      if (mainWindow === candidate) mainWindow = undefined;
      throw new Error('RENDERER_UNAVAILABLE');
    }
  }
  mainWindow.show();
  mainWindow.focus();
}

async function openMainWindow(): Promise<void> {
  try {
    await showMainWindow();
  } catch {
    // A renderer can be recreated from the native tray; it is not a native startup failure.
    console.error('Catbots renderer unavailable');
  }
}

async function requestQuit(): Promise<void> {
  if (quitting) return;

  try {
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'Quit Catbots?',
      message: 'Quit Catbots?',
      detail: 'Catbots will stop its local runtime before quitting.',
      buttons: ['Quit Catbots', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (result.response !== 0) return;
  } catch {
    console.error('Catbots quit confirmation unavailable');
    return;
  }

  await quitApplication();
}

async function quitApplication(): Promise<void> {
  if (quitting) return;
  quitting = true;
  try {
    await shutdown();
  } finally {
    app.quit();
  }
}

function shutdown(): Promise<void> {
  if (shutdownPromise !== undefined) return shutdownPromise;

  shutdownPromise = (async () => {
    try {
      await runtime.stop();
    } catch {
      console.error('Catbots runtime shutdown failed');
    }
    disposeRegisteredIpcHandlers();
    try {
      database.close();
    } catch {
      console.error('Catbots database shutdown failed');
    }
  })();
  return shutdownPromise;
}

function disposeRegisteredIpcHandlers(): void {
  const dispose = disposeIpcHandlers;
  disposeIpcHandlers = undefined;
  try {
    dispose?.();
  } catch {
    console.error('Catbots IPC shutdown failed');
  }
}
