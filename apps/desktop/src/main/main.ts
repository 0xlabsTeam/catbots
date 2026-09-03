import { app, dialog, session, utilityProcess, type BrowserWindow } from 'electron';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotRepository } from './bots/bot-repository';
import { ConfigRepository } from './config/config-repository';
import { createMainWindow } from './create-window';
import { isUnsignedDevelopmentBuild, isUnsignedE2ETestProcess, resolveApplicationDataDirectory } from './data-directory';
import { registerIpcHandlers } from './ipc/register-ipc';
import { installM0PermissionPolicy } from './install-permission-policy';
import { testLlmConnection } from './llm/test-llm-connection';
import { registerAppProtocol } from './register-app-protocol';
import { RuntimeSupervisor } from './runtime/runtime-supervisor';
import { ApplicationDatabase } from './storage/database';
import { createTray, type TrayController } from './tray/create-tray';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const appOrigin = 'catbots://app';
const database = new ApplicationDatabase();
const runtime = new RuntimeSupervisor(() => utilityProcess.fork(join(__dirname, 'runtime-worker.js')));
let disposeIpcHandlers: (() => void) | undefined;
let mainWindow: BrowserWindow | undefined;
let tray: TrayController | undefined;
let shutdownPromise: Promise<void> | undefined;
let quitting = false;
let e2eQuitResponse: number | undefined;

app.enableSandbox();

void app.whenReady()
  .then(async () => {
    installM0PermissionPolicy(session.defaultSession);
    const e2eRequested = process.env.NODE_ENV === 'test' && process.env.CATBOTS_E2E_DATA_DIR !== undefined;
    const unsignedBuild = e2eRequested && isUnsignedDevelopmentBuild({
      executablePath: process.execPath,
      isDefaultApp: process.defaultApp === true,
      isMacAppStore: process.mas === true,
      isPackaged: app.isPackaged,
      platform: process.platform,
    });
    const e2eAllowed = isUnsignedE2ETestProcess(process.env, unsignedBuild);
    const dataDirectory = await resolveApplicationDataDirectory({
      defaultDirectory: app.getPath('userData'),
      environment: process.env,
      allowE2EDataDirectory: e2eAllowed,
      protectedDirectories: [app.getAppPath(), app.getPath('userData')],
      temporaryRoot: tmpdir(),
    });
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
      testLlmConnection,
    });
    tray = createTray({
      iconPath: app.isPackaged
        ? join(process.resourcesPath, 'trayTemplate.png')
        : join(__dirname, '..', '..', 'assets', 'trayTemplate.png'),
      showWindow: openMainWindow,
      quit: requestQuit,
      getRuntimeStatus: () => runtime.getStatus(),
      subscribeRuntimeStatus: (listener) => runtime.subscribeStatus(listener),
    });
    if (e2eAllowed) {
      Object.assign(globalThis, {
        __catbotsE2E: {
          openMainWindow,
          requestQuit: async (response: number) => {
            e2eQuitResponse = response;
            await requestQuit();
          },
        },
      });
    }
    await openMainWindow();
  })
  .catch(async () => {
    await shutdown();
    console.error('Catbots fatal startup error');
    quitting = true;
    app.quit();
  });

app.on('before-quit', (event) => {
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
    candidate.webContents.on('render-process-gone', () => handleRendererGone(candidate));
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
    const result = e2eQuitResponse === undefined
      ? await dialog.showMessageBox({
        type: 'warning',
        title: 'Quit Catbots?',
        message: 'Quit Catbots?',
        detail: 'Catbots will stop its local runtime before quitting.',
        buttons: ['Quit Catbots', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      : { response: e2eQuitResponse };
    e2eQuitResponse = undefined;
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
    disposeTray();
    disposeRegisteredIpcHandlers();
    try {
      database.close();
    } catch {
      console.error('Catbots database shutdown failed');
    }
  })();
  return shutdownPromise;
}

function disposeTray(): void {
  const controller = tray;
  tray = undefined;
  try {
    controller?.dispose();
  } catch {
    console.error('Catbots tray shutdown failed');
  }
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

function handleRendererGone(affectedWindow: BrowserWindow): void {
  if (mainWindow === affectedWindow) mainWindow = undefined;
  try {
    if (!affectedWindow.isDestroyed()) affectedWindow.destroy();
  } catch {
    // Runtime and tray ownership remain in Main even if renderer cleanup races native teardown.
  }
}
