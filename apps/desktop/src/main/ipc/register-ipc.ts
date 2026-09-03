import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  CreateDraftBotInputSchema,
  LocalConfigSchema,
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

export function createIpcHandlers(dependencies: IpcHandlerDependencies) {
  const assertSender = (event: IpcMainInvokeEvent): void => {
    assertTrustedAppSenderUrl(event.senderFrame?.url);
  };

  return {
    getVersion: async (event: IpcMainInvokeEvent): Promise<string> => {
      assertSender(event);
      return dependencies.app.getVersion();
    },

    showMainWindow: async (event: IpcMainInvokeEvent): Promise<void> => {
      assertSender(event);
      await dependencies.app.showMainWindow();
    },

    quitApplication: async (event: IpcMainInvokeEvent): Promise<void> => {
      assertSender(event);
      await dependencies.app.quitApplication();
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
      return dependencies.runtime.getStatus();
    },
  };
}

export function registerIpcHandlers(dependencies: IpcHandlerDependencies): () => void {
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

  for (const [channel, handler] of channels) {
    ipcMain.handle(channel, handler);
  }

  return () => {
    for (const [channel] of channels) ipcMain.removeHandler(channel);
  };
}

function parseRequest<T>(schema: { safeParse(input: unknown): { success: boolean; data?: T } }, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new IpcRequestError('INVALID_REQUEST');
  return result.data as T;
}

function toSafeConfigIssue(issue: { path: string; message: string }): { path: string; message: string } {
  return { path: issue.path, message: issue.message };
}
