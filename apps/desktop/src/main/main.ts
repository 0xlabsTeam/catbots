import { app, ipcMain } from 'electron';
import { join } from 'node:path';
import { createMainWindow } from './create-window';
import { assertTrustedAppSenderUrl } from './ipc-security';
import { registerAppProtocol } from './register-app-protocol';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const appOrigin = 'catbots://app';

app.enableSandbox();

void app.whenReady().then(async () => {
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
