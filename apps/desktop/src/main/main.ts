import { app, ipcMain } from 'electron';
import { join } from 'node:path';
import { createMainWindow } from './create-window';
import { assertTrustedAppSenderUrl } from './ipc-security';
import { registerAppProtocol } from './register-app-protocol';
import { ApplicationDatabase } from './storage/database';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const appOrigin = 'catbots://app';
const database = new ApplicationDatabase();

app.enableSandbox();

void app.whenReady().then(async () => {
  database.start(app.getPath('userData'));

  registerAppProtocol({
    rendererDirectory: join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`),
    developmentServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
  });

  ipcMain.handle('app:get-version', (event) => {
    assertTrustedAppSenderUrl(event.senderFrame?.url);
    return app.getVersion();
  });

  const mainWindow = createMainWindow();
  await mainWindow.loadURL(`${appOrigin}/index.html`);
});

app.once('before-quit', () => {
  database.close();
});

// Subscribing preserves the process after the final window closes; Task 8 adds tray controls.
app.on('window-all-closed', () => undefined);
