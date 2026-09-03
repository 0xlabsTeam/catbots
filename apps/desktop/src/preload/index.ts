import { contextBridge, ipcRenderer } from 'electron';
import type { CatbotsDesktopApi, RuntimeStatus } from '@catbots/contracts';

const runtimeListeners = new Set<(status: RuntimeStatus) => void>();

ipcRenderer.on('runtime:status', (_event, status: RuntimeStatus) => {
  for (const listener of runtimeListeners) listener(status);
});

const catbots: CatbotsDesktopApi = deepFreeze({
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
    showMainWindow: (): Promise<void> => ipcRenderer.invoke('app:show-main-window'),
    quitApplication: (): Promise<void> => ipcRenderer.invoke('app:quit-application'),
  },
  config: {
    getBootstrapState: () => ipcRenderer.invoke('config:get-bootstrap-state'),
    patchSettings: (input) => ipcRenderer.invoke('config:patch-settings', input),
    testLlmConnection: (input: unknown) => ipcRenderer.invoke('config:test-llm', input),
  },
  bots: {
    list: () => ipcRenderer.invoke('bots:list'),
    createDraft: (input: unknown) => ipcRenderer.invoke('bots:create-draft', input),
  },
  runtime: {
    getStatus: () => ipcRenderer.invoke('runtime:get-status'),
    subscribeStatus: (listener: (status: RuntimeStatus) => void): (() => void) => {
      runtimeListeners.add(listener);
      void ipcRenderer.invoke('runtime:get-status').then((status: RuntimeStatus) => {
        if (runtimeListeners.has(listener)) listener(status);
      }).catch(() => undefined);
      return () => runtimeListeners.delete(listener);
    },
  },
});

contextBridge.exposeInMainWorld('catbots', catbots);

function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
