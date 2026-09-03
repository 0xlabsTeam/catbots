import { contextBridge, ipcRenderer } from 'electron';

const catbots = Object.freeze({
  app: Object.freeze({
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  }),
});

contextBridge.exposeInMainWorld('catbots', catbots);
