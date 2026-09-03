import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';

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

export function createMainWindow(): BrowserWindow {
  const { BrowserWindow } = require('electron') as typeof import('electron');
  const window = new BrowserWindow(buildWindowOptions(join(__dirname, 'index.js')));

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    denyUnexpectedNavigation(event, targetUrl);
  });
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  return window;
}

export function denyUnexpectedNavigation(event: Pick<Event, 'preventDefault'>, targetUrl: string): void {
  try {
    const target = new URL(targetUrl);
    if (target.protocol === 'catbots:' && target.host === 'app') {
      return;
    }
  } catch {
    // An unparsable target is never a trusted application URL.
  }

  event.preventDefault();
}
