import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';

export function buildWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };
}

export function createMainWindow(preload: string): BrowserWindow {
  const { BrowserWindow } = require('electron') as typeof import('electron');
  const window = new BrowserWindow(buildWindowOptions(preload));

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    const target = new URL(targetUrl);
    if (target.protocol !== 'catbots:' || target.host !== 'app') {
      event.preventDefault();
    }
  });
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  return window;
}
