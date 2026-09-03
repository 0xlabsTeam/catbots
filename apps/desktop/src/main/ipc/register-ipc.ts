import { ipcMain, webContents, type IpcMainInvokeEvent } from 'electron';
import {
  CreateDraftBotInputSchema,
  LocalConfigSchema,
  RuntimeStatusSchema,
  type BootstrapState,
  type ConnectionTestResult,
  type LocalConfig,
  type RuntimeStatus,
} from '@catbots/contracts';
import { BotRepository } from '../bots/bot-repository';
import { ConfigParseError, ConfigRepository } from '../config/config-repository';
import { assertTrustedAppSenderUrl } from '../ipc-security';

export class IpcRequestError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'IpcRequestError';
    this.code = code;
  }
}

type RuntimePort = {
  getStatus(): RuntimeStatus;
  subscribeStatus(listener: (status: RuntimeStatus) => void): () => void;
};

type ApplicationPort = {
  getVersion(): string;
  showMainWindow(): void | Promise<void>;
  quitApplication(): void | Promise<void>;
};

export type IpcHandlerDependencies = {
  app: ApplicationPort;
  configRepository: Pick<ConfigRepository, 'getRedacted' | 'save'>;
  botRepository: Pick<BotRepository, 'list' | 'createDraft'>;
  runtime: RuntimePort;
  // M0 deliberately provides no network implementation. A later milestone can inject one.
  testLlmConnection?: (input: LocalConfig) => Promise<ConnectionTestResult>;
};

export type IpcHandlers = ReturnType<typeof createIpcHandlers>;

type RegisteredIpcHandlers = {
  dependencies: IpcHandlerDependencies;
  dispose(): void;
};

let activeRegistration: RegisteredIpcHandlers | undefined;

export function createIpcHandlers(dependencies: IpcHandlerDependencies) {
  const assertSender = (event: IpcMainInvokeEvent): void => {
    assertTrustedAppSenderUrl(event.senderFrame?.url);
  };

  return {
    getVersion: async (event: IpcMainInvokeEvent): Promise<string> => {
      assertSender(event);
      try {
        const version = dependencies.app.getVersion();
        if (typeof version !== 'string') throw new Error('Invalid version response');
        return version;
      } catch {
        throw new IpcRequestError('APP_VERSION_FAILED');
      }
    },

    showMainWindow: async (event: IpcMainInvokeEvent): Promise<void> => {
      assertSender(event);
      try {
        await dependencies.app.showMainWindow();
      } catch {
        throw new IpcRequestError('APP_SHOW_MAIN_WINDOW_FAILED');
      }
    },

    quitApplication: async (event: IpcMainInvokeEvent): Promise<void> => {
      assertSender(event);
      try {
        await dependencies.app.quitApplication();
      } catch {
        throw new IpcRequestError('APP_QUIT_APPLICATION_FAILED');
      }
    },

    getBootstrapState: async (event: IpcMainInvokeEvent): Promise<BootstrapState> => {
      assertSender(event);
      try {
        const config = await dependencies.configRepository.getRedacted();
        return config === null ? { state: 'first-launch' } : { state: 'ready', config };
      } catch (error) {
        if (error instanceof ConfigParseError) {
          return { state: 'repair', issues: error.issues.map(toSafeConfigIssue) };
        }
        return { state: 'repair', issues: [{ path: 'config', message: 'Configuration requires repair' }] };
      }
    },

    saveLocalConfig: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const config = parseRequest(LocalConfigSchema, input);
      try {
        return await dependencies.configRepository.save(config);
      } catch (error) {
        if (error instanceof ConfigParseError) throw new IpcRequestError('INVALID_REQUEST');
        throw new IpcRequestError('CONFIG_SAVE_FAILED');
      }
    },

    testLlmConnection: async (event: IpcMainInvokeEvent, input: unknown): Promise<ConnectionTestResult> => {
      assertSender(event);
      const config = parseRequest(LocalConfigSchema, input);
      if (dependencies.testLlmConnection === undefined) {
        return {
          ok: false,
          code: 'LLM_CONNECTION_TEST_UNAVAILABLE',
          message: 'LLM connection testing is unavailable in M0.',
        };
      }
      try {
        return await dependencies.testLlmConnection(config);
      } catch {
        return {
          ok: false,
          code: 'LLM_CONNECTION_TEST_FAILED',
          message: 'LLM connection test failed.',
        };
      }
    },

    listBots: async (event: IpcMainInvokeEvent) => {
      assertSender(event);
      try {
        return dependencies.botRepository.list();
      } catch {
        throw new IpcRequestError('BOT_LIST_FAILED');
      }
    },

    createDraftBot: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const draft = parseRequest(CreateDraftBotInputSchema, input);
      try {
        return dependencies.botRepository.createDraft(draft);
      } catch {
        throw new IpcRequestError('BOT_CREATE_FAILED');
      }
    },

    getRuntimeStatus: async (event: IpcMainInvokeEvent): Promise<RuntimeStatus> => {
      assertSender(event);
      try {
        return RuntimeStatusSchema.parse(dependencies.runtime.getStatus());
      } catch {
        throw new IpcRequestError('RUNTIME_STATUS_FAILED');
      }
    },
  };
}

export function registerIpcHandlers(dependencies: IpcHandlerDependencies): () => void {
  const previousRegistration = activeRegistration;
  if (previousRegistration !== undefined) {
    activeRegistration = undefined;
    try {
      previousRegistration.dispose();
    } catch {
      // Its handlers were removed in dispose's finally block; replacement remains safe.
    }
  }

  let registration: RegisteredIpcHandlers;
  try {
    registration = installIpcHandlers(dependencies);
  } catch (error) {
    if (previousRegistration !== undefined) {
      try {
        activeRegistration = installIpcHandlers(previousRegistration.dependencies);
      } catch {
        activeRegistration = undefined;
      }
    }
    throw error;
  }
  activeRegistration = registration;

  return () => {
    if (activeRegistration !== registration) return;
    activeRegistration = undefined;
    registration.dispose();
  };
}

function installIpcHandlers(dependencies: IpcHandlerDependencies): RegisteredIpcHandlers {
  const handlers = createIpcHandlers(dependencies);
  const channels: ReadonlyArray<readonly [string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown]> = [
    ['app:get-version', handlers.getVersion],
    ['app:show-main-window', handlers.showMainWindow],
    ['app:quit-application', handlers.quitApplication],
    ['config:get-bootstrap-state', handlers.getBootstrapState],
    ['config:save', handlers.saveLocalConfig],
    ['config:test-llm', handlers.testLlmConnection],
    ['bots:list', handlers.listBots],
    ['bots:create-draft', handlers.createDraftBot],
    ['runtime:get-status', handlers.getRuntimeStatus],
  ];
  const registeredChannels: string[] = [];
  let unsubscribeRuntime: (() => void) | undefined;

  try {
    for (const [channel, handler] of channels) {
      ipcMain.handle(channel, handler);
      registeredChannels.push(channel);
    }
    const unsubscribe = dependencies.runtime.subscribeStatus((candidate: RuntimeStatus) => {
      forwardRuntimeStatus(candidate);
    });
    if (typeof unsubscribe !== 'function') throw new Error('Invalid runtime subscription');
    unsubscribeRuntime = unsubscribe;
  } catch (error) {
    try {
      unsubscribeRuntime?.();
    } finally {
      removeOwnedHandlers(registeredChannels);
    }
    throw error;
  }

  let disposed = false;
  return {
    dependencies,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const unsubscribe = unsubscribeRuntime;
      unsubscribeRuntime = undefined;
      try {
        unsubscribe?.();
      } finally {
        removeOwnedHandlers(registeredChannels);
      }
    },
  };
}

function removeOwnedHandlers(channels: readonly string[]): void {
  for (const channel of [...channels].reverse()) ipcMain.removeHandler(channel);
}

function forwardRuntimeStatus(candidate: unknown): void {
  const parsed = RuntimeStatusSchema.safeParse(candidate);
  if (!parsed.success) return;

  for (const target of webContents.getAllWebContents()) {
    try {
      if (target.isDestroyed()) continue;
      assertTrustedAppSenderUrl(target.getURL());
      target.send('runtime:status', parsed.data);
    } catch {
      // A destroyed, untrusted, or failed renderer target must not affect other targets.
    }
  }
}

function parseRequest<T>(schema: { safeParse(input: unknown): { success: boolean; data?: T } }, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new IpcRequestError('INVALID_REQUEST');
  return result.data as T;
}

function toSafeConfigIssue(issue: { path: string; message: string }): { path: string; message: string } {
  return { path: issue.path, message: issue.message };
}
