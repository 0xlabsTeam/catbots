import { ipcMain, webContents, type IpcMainInvokeEvent } from 'electron';
import {
  CreateDraftBotInputSchema,
  AgentToolActivitySchema,
  ApproveStrategyRevisionInputSchema,
  GetTraceInputSchema,
  GetActiveDeploymentInputSchema,
  GetDeploymentInputSchema,
  GetWorkbenchInputSchema,
  LocalSettingsPatchSchema,
  RunWorkbenchBacktestInputSchema,
  PaperDeploymentViewSchema,
  PauseDeploymentInputSchema,
  PrepareLiveInputSchema,
  StartLiveInputSchema,
  DeploymentSchema,
  RuntimeStatusSchema,
  SendWorkbenchMessageInputSchema,
  StartPaperInputSchema,
  StopDeploymentInputSchema,
  type AgentToolActivity,
  type BootstrapState,
  type ConnectionTestResult,
  type LocalConfig,
  type LocalSettingsPatch,
  type RuntimeStatus,
} from '@catbots/contracts';
import { BotRepository } from '../bots/bot-repository';
import {
  ConfigParseError,
  ConfigRepository,
  HyperliquidCredentialReplacementRequiredError,
  LlmCredentialReplacementRequiredError,
} from '../config/config-repository';
import { assertTrustedAppSenderUrl } from '../ipc-security';
import type { WorkbenchService } from '../workbench/workbench-service';
import type { DeploymentService } from '../execution/deployment-service';

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
  startDeployment(deploymentId: string): void;
  pauseDeployment(deploymentId: string): void;
  stopDeployment(deploymentId: string): void;
};

type ApplicationPort = {
  getVersion(): string;
  showMainWindow(): void | Promise<void>;
  quitApplication(): void | Promise<void>;
};

export type IpcHandlerDependencies = {
  app: ApplicationPort;
  configRepository: Pick<ConfigRepository, 'getRedacted' | 'patchSettings' | 'resolveSettingsPatch'>;
  botRepository: Pick<BotRepository, 'list' | 'createDraft'>;
  workbenchService: Pick<WorkbenchService, 'get' | 'sendMessage' | 'runBacktest' | 'approveRevision' | 'getTrace' | 'subscribeActivity'>;
  deploymentService: Pick<DeploymentService, 'startPaper' | 'getPaperDeployment' | 'pause' | 'stop' | 'prepareLive' | 'startLive' | 'getLiveDeployment' | 'getActiveDeployment'>;
  runtime: RuntimePort;
  testLlmConnection?: (provider: LocalConfig['llm']) => Promise<ConnectionTestResult>;
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

    patchLocalSettings: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const patch = parseRequest(LocalSettingsPatchSchema, input);
      try {
        return await dependencies.configRepository.patchSettings(patch);
      } catch (error) {
        if (error instanceof LlmCredentialReplacementRequiredError) {
          throw new IpcRequestError('LLM_CREDENTIAL_REPLACEMENT_REQUIRED');
        }
        if (error instanceof HyperliquidCredentialReplacementRequiredError) {
          throw new IpcRequestError('HYPERLIQUID_CREDENTIAL_REPLACEMENT_REQUIRED');
        }
        if (error instanceof ConfigParseError) throw new IpcRequestError('INVALID_REQUEST');
        throw new IpcRequestError('CONFIG_SAVE_FAILED');
      }
    },

    testLlmConnection: async (event: IpcMainInvokeEvent, input: unknown): Promise<ConnectionTestResult> => {
      assertSender(event);
      const patch = parseRequest<LocalSettingsPatch>(LocalSettingsPatchSchema, input);
      if (dependencies.testLlmConnection === undefined) {
        return {
          ok: false,
          code: 'LLM_CONNECTION_TEST_UNAVAILABLE',
          message: 'LLM connection testing is unavailable in M0.',
        };
      }
      try {
        const config = await dependencies.configRepository.resolveSettingsPatch(patch);
        return await dependencies.testLlmConnection(config.llm);
      } catch (error) {
        if (error instanceof LlmCredentialReplacementRequiredError) {
          return {
            ok: false,
            code: 'LLM_CREDENTIAL_REPLACEMENT_REQUIRED',
            message: 'Enter a new API key for this provider location.',
          };
        }
        if (error instanceof ConfigParseError) {
          return {
            ok: false,
            code: 'LLM_CONNECTION_CONFIGURATION_REQUIRED',
            message: 'Enter an API key before testing this provider.',
          };
        }
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

    getWorkbench: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const request = parseRequest(GetWorkbenchInputSchema, input);
      try {
        return await dependencies.workbenchService.get(request);
      } catch {
        throw new IpcRequestError('WORKBENCH_GET_FAILED');
      }
    },

    sendWorkbenchMessage: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const request = parseRequest(SendWorkbenchMessageInputSchema, input);
      try {
        return await dependencies.workbenchService.sendMessage(request);
      } catch {
        throw new IpcRequestError('WORKBENCH_MESSAGE_FAILED');
      }
    },

    runWorkbenchBacktest: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const request = parseRequest(RunWorkbenchBacktestInputSchema, input);
      try {
        return await dependencies.workbenchService.runBacktest(request);
      } catch {
        throw new IpcRequestError('WORKBENCH_BACKTEST_FAILED');
      }
    },

    approveStrategyRevision: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const request = parseRequest(ApproveStrategyRevisionInputSchema, input);
      try {
        return await dependencies.workbenchService.approveRevision(request);
      } catch {
        throw new IpcRequestError('WORKBENCH_APPROVAL_FAILED');
      }
    },

    getWorkbenchTrace: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const request = parseRequest(GetTraceInputSchema, input);
      try {
        return await dependencies.workbenchService.getTrace(request);
      } catch {
        throw new IpcRequestError('WORKBENCH_TRACE_FAILED');
      }
    },

    startPaperDeployment: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const request = parseRequest(StartPaperInputSchema, input);
      let deploymentId: string | undefined;
      try {
        const deployment = dependencies.deploymentService.startPaper(request);
        deploymentId = deployment.id;
        dependencies.runtime.startDeployment(deployment.id);
        return PaperDeploymentViewSchema.parse(dependencies.deploymentService.getPaperDeployment(deployment.id));
      } catch {
        if (deploymentId !== undefined) {
          try {
            dependencies.deploymentService.stop(deploymentId);
          } catch {
            // The fixed IPC failure remains authoritative; startup never proceeds to the renderer.
          }
        }
        throw new IpcRequestError('PAPER_DEPLOYMENT_START_FAILED');
      }
    },

    getPaperDeployment: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const request = parseRequest(GetDeploymentInputSchema, input);
      try {
        return PaperDeploymentViewSchema.parse(dependencies.deploymentService.getPaperDeployment(request.deploymentId));
      } catch {
        throw new IpcRequestError('PAPER_DEPLOYMENT_GET_FAILED');
      }
    },

    pausePaperDeployment: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const request = parseRequest(PauseDeploymentInputSchema, input);
      try {
        dependencies.deploymentService.pause(request.deploymentId);
        dependencies.runtime.pauseDeployment(request.deploymentId);
        return PaperDeploymentViewSchema.parse(dependencies.deploymentService.getPaperDeployment(request.deploymentId));
      } catch {
        throw new IpcRequestError('PAPER_DEPLOYMENT_PAUSE_FAILED');
      }
    },

    stopPaperDeployment: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const request = parseRequest(StopDeploymentInputSchema, input);
      try {
        dependencies.deploymentService.stop(request.deploymentId);
        dependencies.runtime.stopDeployment(request.deploymentId);
        return PaperDeploymentViewSchema.parse(dependencies.deploymentService.getPaperDeployment(request.deploymentId));
      } catch {
        throw new IpcRequestError('PAPER_DEPLOYMENT_STOP_FAILED');
      }
    },

    prepareLiveDeployment: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const request = parseRequest(PrepareLiveInputSchema, input);
      try {
        return await dependencies.deploymentService.prepareLive(request, new AbortController().signal);
      } catch {
        throw new IpcRequestError('LIVE_PREFLIGHT_FAILED');
      }
    },

    startLiveDeployment: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const request = parseRequest(StartLiveInputSchema, input);
      let deploymentId: string | undefined;
      try {
        const deployment = await dependencies.deploymentService.startLive(request);
        deploymentId = deployment.id;
        dependencies.runtime.startDeployment(deployment.id);
        return DeploymentSchema.parse(deployment);
      } catch {
        if (deploymentId !== undefined) {
          try { dependencies.deploymentService.stop(deploymentId); } catch { /* Startup failure remains authoritative. */ }
        }
        throw new IpcRequestError('LIVE_DEPLOYMENT_START_FAILED');
      }
    },

    getLiveDeployment: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const request = parseRequest(GetDeploymentInputSchema, input);
      try {
        return DeploymentSchema.parse(dependencies.deploymentService.getLiveDeployment(request.deploymentId));
      } catch {
        throw new IpcRequestError('LIVE_DEPLOYMENT_GET_FAILED');
      }
    },

    stopLiveDeployment: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const request = parseRequest(StopDeploymentInputSchema, input);
      try {
        dependencies.deploymentService.stop(request.deploymentId);
        dependencies.runtime.stopDeployment(request.deploymentId);
        return DeploymentSchema.parse(dependencies.deploymentService.getLiveDeployment(request.deploymentId));
      } catch {
        throw new IpcRequestError('LIVE_DEPLOYMENT_STOP_FAILED');
      }
    },

    getActiveDeployment: async (event: IpcMainInvokeEvent, input: unknown) => {
      assertSender(event);
      const request = parseRequest(GetActiveDeploymentInputSchema, input);
      try {
        const deployment = dependencies.deploymentService.getActiveDeployment(request.botId);
        return deployment === null ? null : DeploymentSchema.parse(deployment);
      } catch {
        throw new IpcRequestError('ACTIVE_DEPLOYMENT_GET_FAILED');
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
    ['config:patch-settings', handlers.patchLocalSettings],
    ['config:test-llm', handlers.testLlmConnection],
    ['bots:list', handlers.listBots],
    ['bots:create-draft', handlers.createDraftBot],
    ['workbench:get', handlers.getWorkbench],
    ['workbench:send-message', handlers.sendWorkbenchMessage],
    ['workbench:run-backtest', handlers.runWorkbenchBacktest],
    ['workbench:approve-revision', handlers.approveStrategyRevision],
    ['workbench:get-trace', handlers.getWorkbenchTrace],
    ['deployments:start-paper', handlers.startPaperDeployment],
    ['deployments:get-paper', handlers.getPaperDeployment],
    ['deployments:pause-paper', handlers.pausePaperDeployment],
    ['deployments:stop-paper', handlers.stopPaperDeployment],
    ['deployments:prepare-live', handlers.prepareLiveDeployment],
    ['deployments:start-live', handlers.startLiveDeployment],
    ['deployments:get-live', handlers.getLiveDeployment],
    ['deployments:stop-live', handlers.stopLiveDeployment],
    ['deployments:get-active', handlers.getActiveDeployment],
    ['runtime:get-status', handlers.getRuntimeStatus],
  ];
  const registeredChannels: string[] = [];
  let unsubscribeRuntime: (() => void) | undefined;
  let unsubscribeActivity: (() => void) | undefined;

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
    const unsubscribeWorkbench = dependencies.workbenchService.subscribeActivity((activity) => {
      forwardWorkbenchActivity(activity);
    });
    if (typeof unsubscribeWorkbench !== 'function') throw new Error('Invalid workbench subscription');
    unsubscribeActivity = unsubscribeWorkbench;
  } catch (error) {
    try {
      unsubscribeAll(unsubscribeActivity, unsubscribeRuntime);
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
      const unsubscribeWorkbench = unsubscribeActivity;
      unsubscribeRuntime = undefined;
      unsubscribeActivity = undefined;
      try {
        unsubscribeAll(unsubscribeWorkbench, unsubscribe);
      } finally {
        removeOwnedHandlers(registeredChannels);
      }
    },
  };
}

function unsubscribeAll(...subscriptions: Array<(() => void) | undefined>): void {
  let firstFailure: unknown;
  for (const unsubscribe of subscriptions) {
    try {
      unsubscribe?.();
    } catch (error) {
      firstFailure ??= error;
    }
  }
  if (firstFailure !== undefined) throw firstFailure;
}

function forwardWorkbenchActivity(candidate: unknown): void {
  const parsed = AgentToolActivitySchema.safeParse(candidate);
  if (!parsed.success) return;
  forwardToTrustedRenderers('workbench:activity', parsed.data);
}

function removeOwnedHandlers(channels: readonly string[]): void {
  let firstFailure: unknown;
  let hasFailure = false;
  for (const channel of [...channels].reverse()) {
    try {
      ipcMain.removeHandler(channel);
    } catch (error) {
      if (!hasFailure) {
        firstFailure = error;
        hasFailure = true;
      }
    }
  }
  if (hasFailure) throw firstFailure;
}

function forwardRuntimeStatus(candidate: unknown): void {
  const parsed = RuntimeStatusSchema.safeParse(candidate);
  if (!parsed.success) return;

  forwardToTrustedRenderers('runtime:status', parsed.data);
}

function forwardToTrustedRenderers(channel: string, payload: RuntimeStatus | AgentToolActivity): void {
  for (const target of webContents.getAllWebContents()) {
    try {
      if (target.isDestroyed()) continue;
      assertTrustedAppSenderUrl(target.getURL());
      target.send(channel, payload);
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
