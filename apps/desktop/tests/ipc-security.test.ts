import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalConfigSchema, REDACTED_SECRET, type RuntimeStatus } from '@catbots/contracts';
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
  getAllWebContents: vi.fn<() => unknown[]>(() => []),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electronBridge.exposeInMainWorld },
  ipcMain: { handle: electronBridge.handle, removeHandler: electronBridge.removeHandler },
  ipcRenderer: { invoke: electronBridge.invoke, on: electronBridge.on },
  webContents: { getAllWebContents: electronBridge.getAllWebContents },
  net: { fetch: vi.fn() },
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
}));

beforeEach(() => {
  electronBridge.handle.mockReset();
  electronBridge.removeHandler.mockReset();
  electronBridge.invoke.mockReset();
  electronBridge.getAllWebContents.mockReset();
  electronBridge.getAllWebContents.mockReturnValue([]);
});

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

  it.each([
    'catbots://app/%69ndex.html',
    'catbots://app/index.html?next=settings',
    'catbots://app/index.html#settings',
    'catbots://app:443/index.html',
    'catbots://user@app/index.html',
    'CATBOTS://app/index.html',
    undefined,
  ])('rejects non-canonical IPC sender spelling %s', (senderUrl) => {
    expect(() => assertTrustedAppSenderUrl(senderUrl)).toThrow('IPC_SENDER_NOT_ALLOWED');
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
const settingsPatch = {
  profile: { name: 'My Trading', telemetry: false },
  llm: {
    provider: 'openai-compatible' as const,
    baseUrl: 'https://api.example.com/v1',
    model: 'provider/model',
  },
};

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
      patchSettings: vi.fn(),
      resolveSettingsPatch: vi.fn().mockResolvedValue(validConfig),
    },
    botRepository: {
      list: vi.fn(() => []),
      createDraft: vi.fn(),
    },
    runtime: {
      getStatus: vi.fn(() => ({ state: 'stopped' as const, activeBots: 0 })),
      subscribeStatus: vi.fn((_listener: (status: RuntimeStatus) => void) => () => undefined),
    },
    testLlmConnection: vi.fn(async () => ({ ok: true as const, model: 'provider/model' })),
  };
}

describe('validated IPC handlers', () => {
  it('rejects config writes from an unknown sender', async () => {
    const handlers = createIpcHandlers(createDependencies());

    await expect(handlers.patchLocalSettings(fakeRemoteEvent, settingsPatch))
      .rejects.toThrow('IPC_SENDER_NOT_ALLOWED');
  });

  it('patches settings without accepting full exchange or redacted-secret payloads', async () => {
    const dependencies = createDependencies();
    const handlers = createIpcHandlers(dependencies);

    await handlers.patchLocalSettings(localEvent, settingsPatch);
    expect(dependencies.configRepository.patchSettings).toHaveBeenCalledWith(settingsPatch);

    await expect(handlers.patchLocalSettings(localEvent, {
      ...settingsPatch,
      exchanges: validConfig.exchanges,
    })).rejects.toThrow('INVALID_REQUEST');
    await expect(handlers.patchLocalSettings(localEvent, {
      ...settingsPatch,
      llm: { ...settingsPatch.llm, apiKey: REDACTED_SECRET },
    })).rejects.toThrow('INVALID_REQUEST');
    expect(dependencies.configRepository.patchSettings).toHaveBeenCalledTimes(1);
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

    const error = await handlers.patchLocalSettings(localEvent, {
      ...settingsPatch,
      profile: { ...validConfig.profile, name: '' },
      llm: { ...settingsPatch.llm, apiKey: secret },
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('INVALID_REQUEST');
    expect(String(error)).not.toContain(secret);
    expect(dependencies.configRepository.patchSettings).not.toHaveBeenCalled();
  });

  it('resolves an omitted key inside Main before invoking the connection tester', async () => {
    const dependencies = createDependencies();
    const handlers = createIpcHandlers(dependencies);

    await expect(handlers.testLlmConnection(localEvent, settingsPatch)).resolves.toEqual({
      ok: true,
      model: 'provider/model',
    });
    expect(dependencies.configRepository.resolveSettingsPatch).toHaveBeenCalledWith(settingsPatch);
    expect(dependencies.testLlmConnection).toHaveBeenCalledWith(validConfig.llm);

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

  it.each([
    ['getVersion', 'APP_VERSION_FAILED'],
    ['showMainWindow', 'APP_SHOW_MAIN_WINDOW_FAILED'],
    ['quitApplication', 'APP_QUIT_APPLICATION_FAILED'],
    ['getRuntimeStatus', 'RUNTIME_STATUS_FAILED'],
  ] as const)('redacts dependency failures from %s', async (handlerName, code) => {
    const secret = `sentinel-secret-${handlerName}`;
    const dependencies = createDependencies();
    const handlers = createIpcHandlers(dependencies);

    if (handlerName === 'getVersion') dependencies.app.getVersion.mockImplementationOnce(() => { throw new Error(secret); });
    if (handlerName === 'showMainWindow') dependencies.app.showMainWindow.mockImplementationOnce(() => { throw new Error(secret); });
    if (handlerName === 'quitApplication') dependencies.app.quitApplication.mockImplementationOnce(() => { throw new Error(secret); });
    if (handlerName === 'getRuntimeStatus') dependencies.runtime.getStatus.mockImplementationOnce(() => { throw new Error(secret); });

    const request = handlerName === 'getVersion'
      ? handlers.getVersion(localEvent)
      : handlerName === 'showMainWindow'
        ? handlers.showMainWindow(localEvent)
        : handlerName === 'quitApplication'
          ? handlers.quitApplication(localEvent)
          : handlers.getRuntimeStatus(localEvent);
    const error = await request.catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: unknown }).code).toBe(code);
    expect(String(error)).not.toContain(secret);
  });

  it('returns the fixed no-network M0 connection-test result without an injected tester', async () => {
    const dependencies = createDependencies();
    const { testLlmConnection: _testLlmConnection, ...withoutTester } = dependencies;
    const handlers = createIpcHandlers(withoutTester);

    await expect(handlers.testLlmConnection(localEvent, settingsPatch)).resolves.toEqual({
      ok: false,
      code: 'LLM_CONNECTION_TEST_UNAVAILABLE',
      message: 'LLM connection testing is unavailable in M0.',
    });
    expect(dependencies.configRepository.getRedacted).not.toHaveBeenCalled();
    expect(dependencies.configRepository.patchSettings).not.toHaveBeenCalled();
    expect(dependencies.botRepository.list).not.toHaveBeenCalled();
  });

  it('registers only the named typed IPC channels', () => {
    const remove = registerIpcHandlers(createDependencies());

    expect(electronBridge.handle.mock.calls.map(([channel]) => channel)).toEqual([
      'app:get-version',
      'app:show-main-window',
      'app:quit-application',
      'config:get-bootstrap-state',
      'config:patch-settings',
      'config:test-llm',
      'bots:list',
      'bots:create-draft',
      'runtime:get-status',
    ]);

    remove();
    expect(electronBridge.removeHandler).toHaveBeenCalledTimes(9);
  });

  it('forwards only validated runtime status to live trusted renderer targets and unsubscribes on cleanup', () => {
    let pushStatus: ((status: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const dependencies = createDependencies();
    dependencies.runtime.subscribeStatus.mockImplementation((listener: (status: RuntimeStatus) => void) => {
      pushStatus = listener as (status: unknown) => void;
      return unsubscribe;
    });
    const trustedTarget = {
      getURL: vi.fn(() => 'catbots://app/index.html'),
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    };
    const destroyedTarget = {
      getURL: vi.fn(() => 'catbots://app/index.html'),
      isDestroyed: vi.fn(() => true),
      send: vi.fn(),
    };
    const untrustedTarget = {
      getURL: vi.fn(() => 'https://attacker.example/'),
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    };
    electronBridge.getAllWebContents.mockReturnValue([trustedTarget, destroyedTarget, untrustedTarget]);

    const remove = registerIpcHandlers(dependencies);
    pushStatus?.({ state: 'ready', activeBots: 0 });
    pushStatus?.({ state: 'ready', activeBots: -1 });

    expect(trustedTarget.send).toHaveBeenCalledExactlyOnceWith('runtime:status', { state: 'ready', activeBots: 0 });
    expect(destroyedTarget.send).not.toHaveBeenCalled();
    expect(untrustedTarget.send).not.toHaveBeenCalled();

    remove();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('replaces only its owned registration and makes stale disposers harmless', () => {
    const firstDependencies = createDependencies();
    const secondDependencies = createDependencies();

    const removeFirst = registerIpcHandlers(firstDependencies);
    const removeSecond = registerIpcHandlers(secondDependencies);
    removeFirst();

    expect(firstDependencies.runtime.subscribeStatus).toHaveBeenCalledOnce();
    expect(electronBridge.removeHandler).toHaveBeenCalledTimes(9);
    removeSecond();
    expect(electronBridge.removeHandler).toHaveBeenCalledTimes(18);
  });

  it('restores the previous owned registration after a replacement failure', () => {
    const firstDependencies = createDependencies();
    const secondDependencies = createDependencies();
    const thirdDependencies = createDependencies();
    registerIpcHandlers(firstDependencies);
    let configSaveAttempts = 0;
    electronBridge.handle.mockImplementation((channel: string) => {
      if (channel === 'config:patch-settings' && configSaveAttempts++ === 0) {
        throw new Error('replacement registration failed');
      }
    });

    expect(() => registerIpcHandlers(secondDependencies)).toThrow('replacement registration failed');
    expect(firstDependencies.runtime.subscribeStatus).toHaveBeenCalledTimes(2);

    const removeThird = registerIpcHandlers(thirdDependencies);
    removeThird();
  });

  it('removes owned handlers even when the runtime unsubscriber throws, then permits replacement', () => {
    const firstDependencies = createDependencies();
    const secondDependencies = createDependencies();
    firstDependencies.runtime.subscribeStatus.mockReturnValueOnce(() => {
      throw new Error('runtime unsubscribe failed');
    });
    const removeFirst = registerIpcHandlers(firstDependencies);

    expect(() => removeFirst()).toThrow('runtime unsubscribe failed');
    expect(electronBridge.removeHandler).toHaveBeenCalledTimes(9);

    const removeSecond = registerIpcHandlers(secondDependencies);
    removeSecond();
    expect(electronBridge.removeHandler).toHaveBeenCalledTimes(18);
  });

  it('replaces a registration whose runtime unsubscriber throws without leaving stale handlers', () => {
    const firstDependencies = createDependencies();
    firstDependencies.runtime.subscribeStatus.mockReturnValueOnce(() => {
      throw new Error('runtime unsubscribe failed');
    });
    registerIpcHandlers(firstDependencies);

    const removeReplacement = registerIpcHandlers(createDependencies());
    expect(electronBridge.removeHandler).toHaveBeenCalledTimes(9);
    removeReplacement();
    expect(electronBridge.removeHandler).toHaveBeenCalledTimes(18);
  });

  it('rolls back handlers after an invalid runtime unsubscribe return and permits a later registration', () => {
    const invalidDependencies = createDependencies();
    invalidDependencies.runtime.subscribeStatus.mockReturnValueOnce({} as never);

    expect(() => registerIpcHandlers(invalidDependencies)).toThrow('Invalid runtime subscription');
    expect(electronBridge.removeHandler).toHaveBeenCalledTimes(9);

    const remove = registerIpcHandlers(createDependencies());
    remove();
    expect(electronBridge.removeHandler).toHaveBeenCalledTimes(18);
  });

  it('rolls back only partially registered owned channels when an external handler blocks registration', () => {
    electronBridge.handle.mockImplementation((channel: string) => {
      if (channel === 'config:patch-settings') throw new Error('external handler already registered');
    });

    expect(() => registerIpcHandlers(createDependencies())).toThrow('external handler already registered');
    expect(electronBridge.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
      'config:get-bootstrap-state',
      'app:quit-application',
      'app:show-main-window',
      'app:get-version',
    ]);
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

  it('does not call a listener after it unsubscribes before the initial status resolves', async () => {
    await import('../src/preload/index');
    const [, api] = electronBridge.exposeInMainWorld.mock.calls[0] as [string, {
      runtime: { subscribeStatus(listener: (status: { state: string; activeBots: number }) => void): () => void };
    }];
    let resolveStatus: ((status: { state: string; activeBots: number }) => void) | undefined;
    electronBridge.invoke.mockImplementationOnce(() => new Promise((resolve) => {
      resolveStatus = resolve;
    }));
    const listener = vi.fn();

    const unsubscribe = api.runtime.subscribeStatus(listener);
    unsubscribe();
    resolveStatus?.({ state: 'stopped', activeBots: 0 });
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
  });
});
