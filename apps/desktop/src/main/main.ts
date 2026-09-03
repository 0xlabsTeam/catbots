import { app, ipcMain } from 'electron';
import { join } from 'node:path';
import { createMainWindow } from './create-window';
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
    if (event.senderFrame?.url !== `${appOrigin}/index.html`) {
      throw new Error('Untrusted IPC sender');
    }

    return app.getVersion();
  });

  const mainWindow = createMainWindow(join(__dirname, 'index.js'));
  await mainWindow.loadURL(`${appOrigin}/index.html`);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
