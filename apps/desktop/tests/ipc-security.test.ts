import { describe, expect, it, vi } from 'vitest';
import { LocalConfigSchema } from '@catbots/contracts';
import { buildWindowOptions } from '../src/main/create-window';
import { denyUnexpectedNavigation } from '../src/main/create-window';
import { assertTrustedAppSenderUrl } from '../src/main/ipc-security';
import { createIpcHandlers, registerIpcHandlers } from '../src/main/ipc/register-ipc';
import { getSafeRelativePath } from '../src/main/register-app-protocol';

const electronBridge = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  handle: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electronBridge.exposeInMainWorld },
  ipcMain: { handle: electronBridge.handle, removeHandler: electronBridge.removeHandler },
  ipcRenderer: { invoke: electronBridge.invoke, on: electronBridge.on },
  net: { fetch: vi.fn() },
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
}));

describe('buildWindowOptions', () => {
  it('isolates and sandboxes the renderer', () => {
    const options = buildWindowOptions('/app/preload.js');
    expect(options.webPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: '/app/preload.js',
    });
  });
});

describe('application origin boundaries', () => {
  it('rejects an application authority with a port', () => {
    expect(getSafeRelativePath('catbots://app:123/index.html')).toBeUndefined();
  });

  it('rejects encoded path traversal', () => {
    expect(getSafeRelativePath('catbots://app/%2e%2e%2fsecret.txt')).toBeUndefined();
  });

  it('denies navigation outside the application origin', () => {
    const event = { preventDefault: vi.fn() };

    denyUnexpectedNavigation(event, 'https://example.com');

    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('rejects an IPC sender outside the application entry document', () => {
    expect(() => assertTrustedAppSenderUrl('catbots://app/settings.html')).toThrow('Untrusted IPC sender');
  });
});

const localEvent = {
  senderFrame: { url: 'catbots://app/index.html' },
} as unknown as Electron.IpcMainInvokeEvent;
const fakeRemoteEvent = {
  senderFrame: { url: 'https://attacker.example/' },
} as unknown as Electron.IpcMainInvokeEvent;
const validConfig = LocalConfigSchema.parse({
  profile: { name: 'My Trading', telemetry: false },
  llm: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'secret',
    model: 'provider/model',
  },
  exchanges: {},
});

function createDependencies() {
  return {
    app: {
      getVersion: vi.fn(() => '0.1.0'),
      showMainWindow: vi.fn(),
      quitApplication: vi.fn(),
    },
    configRepository: {
      getRedacted: vi.fn(),
      save: vi.fn(),
    },
    botRepository: {
      list: vi.fn(() => []),
      createDraft: vi.fn(),
    },
    runtime: {
      getStatus: vi.fn(() => ({ state: 'stopped' as const, activeBots: 0 })),
      subscribeStatus: vi.fn(() => () => undefined),
    },
    testLlmConnection: vi.fn(async () => ({ ok: true as const, model: 'provider/model' })),
  };
}

describe('validated IPC handlers', () => {
  it('rejects config writes from an unknown sender', async () => {
    const handlers = createIpcHandlers(createDependencies());

    await expect(handlers.saveLocalConfig(fakeRemoteEvent, validConfig))
      .rejects.toThrow('IPC_SENDER_NOT_ALLOWED');
  });

  it('requires the exact packaged entry document', async () => {
    const dependencies = createDependencies();
    const handlers = createIpcHandlers(dependencies);
    const siblingDocument = {
      senderFrame: { url: 'catbots://app/settings.html' },
    } as unknown as Electron.IpcMainInvokeEvent;

    await expect(handlers.listBots(siblingDocument)).rejects.toThrow('IPC_SENDER_NOT_ALLOWED');
    expect(dependencies.botRepository.list).not.toHaveBeenCalled();
  });

  it('rejects malformed draft-bot input before repository access', async () => {
    const dependencies = createDependencies();
    const handlers = createIpcHandlers(dependencies);

    await expect(handlers.createDraftBot(localEvent, { name: '', market: '' }))
      .rejects.toThrow('INVALID_REQUEST');
    expect(dependencies.botRepository.createDraft).not.toHaveBeenCalled();
  });

  it('rejects malformed configuration before repository access without exposing its secret', async () => {
    const dependencies = createDependencies();
    const handlers = createIpcHandlers(dependencies);
    const secret = 'must-not-be-in-the-error';

    const error = await handlers.saveLocalConfig(localEvent, {
      ...validConfig,
      profile: { ...validConfig.profile, name: '' },
      llm: { ...validConfig.llm, apiKey: secret },
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('INVALID_REQUEST');
    expect(String(error)).not.toContain(secret);
    expect(dependencies.configRepository.save).not.toHaveBeenCalled();
  });

  it('uses the injected M0 connection-test seam only after request validation', async () => {
    const dependencies = createDependencies();
    const handlers = createIpcHandlers(dependencies);

    await expect(handlers.testLlmConnection(localEvent, validConfig)).resolves.toEqual({
      ok: true,
      model: 'provider/model',
    });
    expect(dependencies.testLlmConnection).toHaveBeenCalledWith(validConfig);

    await expect(handlers.testLlmConnection(localEvent, { llm: {} })).rejects.toThrow('INVALID_REQUEST');
    expect(dependencies.testLlmConnection).toHaveBeenCalledTimes(1);
  });

  it('exposes safe typed app and runtime handler behavior', async () => {
    const dependencies = createDependencies();
    const handlers = createIpcHandlers(dependencies);

    await expect(handlers.getVersion(localEvent)).resolves.toBe('0.1.0');
    await expect(handlers.showMainWindow(localEvent)).resolves.toBeUndefined();
    await expect(handlers.quitApplication(localEvent)).resolves.toBeUndefined();
    await expect(handlers.getRuntimeStatus(localEvent)).resolves.toEqual({ state: 'stopped', activeBots: 0 });

    expect(dependencies.app.showMainWindow).toHaveBeenCalledOnce();
    expect(dependencies.app.quitApplication).toHaveBeenCalledOnce();
    expect(dependencies.runtime.getStatus).toHaveBeenCalledOnce();
  });

  it('registers only the named typed IPC channels', () => {
    const remove = registerIpcHandlers(createDependencies());

    expect(electronBridge.handle.mock.calls.map(([channel]) => channel)).toEqual([
      'app:get-version',
      'app:show-main-window',
      'app:quit-application',
      'config:get-bootstrap-state',
      'config:save',
      'config:test-llm',
      'bots:list',
      'bots:create-draft',
      'runtime:get-status',
    ]);

    remove();
    expect(electronBridge.removeHandler).toHaveBeenCalledTimes(9);
  });
});

describe('preload bridge', () => {
  it('exposes a deeply frozen named API without generic Electron primitives', async () => {
    await import('../src/preload/index');

    const [, api] = electronBridge.exposeInMainWorld.mock.calls[0] as [string, Record<string, unknown>];
    expect(electronBridge.exposeInMainWorld).toHaveBeenCalledWith('catbots', expect.any(Object));
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.app)).toBe(true);
    expect(Object.isFrozen(api.config)).toBe(true);
    expect(Object.isFrozen(api.bots)).toBe(true);
    expect(Object.isFrozen(api.runtime)).toBe(true);
    expect(Object.isFrozen((api.app as { getVersion: unknown }).getVersion)).toBe(true);
    expect(Object.keys(api)).toEqual(['app', 'config', 'bots', 'runtime']);
    expect(JSON.stringify(api)).not.toContain('ipcRenderer');
    expect(JSON.stringify(api)).not.toContain('process');
  });
});
