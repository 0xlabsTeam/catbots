import type { BotSummary } from './bots';
import type { LocalSettingsPatch, RedactedLocalConfig } from './config';
import type {
  Deployment,
  GetActiveDeploymentInput,
  GetDeploymentInput,
  LivePreflightView,
  PaperDeploymentView,
  PauseDeploymentInput,
  PrepareLiveInput,
  StartLiveInput,
  StartPaperInput,
  StopDeploymentInput,
} from './execution';
import type {
  AgentToolActivity,
  ApproveStrategyRevisionInput,
  BacktestSummary,
  GetTraceInput,
  GetWorkbenchInput,
  RunWorkbenchBacktestInput,
  SendWorkbenchMessageInput,
  StrategyRevision,
  TraceDetail,
  WorkbenchState,
} from './workbench';
import { z } from 'zod';

export const RuntimeStatusSchema = z.object({
  state: z.enum(['starting', 'ready', 'stopping', 'stopped', 'error']),
  activeBots: z.number().int().nonnegative(),
}).strict();

export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

export const DatabaseStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready') }).strict(),
  z.object({ status: z.literal('repair'), code: z.literal('DATABASE_MIGRATION_FAILED') }).strict(),
]);

export type DatabaseState = z.infer<typeof DatabaseStateSchema>;

export type BootstrapState =
  | { state: 'first-launch' }
  | { state: 'ready'; config: RedactedLocalConfig }
  | { state: 'repair'; issues: Array<{ path: string; message: string }> };

export type ConnectionTestResult =
  | { ok: true; model: string }
  | { ok: false; code: string; message: string };

export interface CatbotsDesktopApi {
  app: {
    getVersion(): Promise<string>;
    showMainWindow(): Promise<void>;
    quitApplication(): Promise<void>;
  };
  config: {
    getBootstrapState(): Promise<BootstrapState>;
    patchSettings(input: LocalSettingsPatch): Promise<RedactedLocalConfig>;
    testLlmConnection(input: LocalSettingsPatch): Promise<ConnectionTestResult>;
  };
  bots: {
    list(): Promise<BotSummary[]>;
    createDraft(input: unknown): Promise<BotSummary>;
  };
  workbench: {
    get(input: GetWorkbenchInput): Promise<WorkbenchState>;
    sendMessage(input: SendWorkbenchMessageInput): Promise<WorkbenchState>;
    runBacktest(input: RunWorkbenchBacktestInput): Promise<BacktestSummary>;
    approveRevision(input: ApproveStrategyRevisionInput): Promise<StrategyRevision>;
    getTrace(input: GetTraceInput): Promise<TraceDetail>;
    subscribeActivity(listener: (activity: AgentToolActivity) => void): () => void;
  };
  deployments: {
    startPaper(input: StartPaperInput): Promise<PaperDeploymentView>;
    getPaper(input: GetDeploymentInput): Promise<PaperDeploymentView>;
    pausePaper(input: PauseDeploymentInput): Promise<PaperDeploymentView>;
    stopPaper(input: StopDeploymentInput): Promise<PaperDeploymentView>;
    prepareLive(input: PrepareLiveInput): Promise<LivePreflightView>;
    startLive(input: StartLiveInput): Promise<Deployment>;
    getLive(input: GetDeploymentInput): Promise<Deployment>;
    stopLive(input: StopDeploymentInput): Promise<Deployment>;
    getActive(input: GetActiveDeploymentInput): Promise<Deployment | null>;
  };
  runtime: {
    getStatus(): Promise<RuntimeStatus>;
    getDatabaseState?(): Promise<DatabaseState>;
    subscribeStatus(listener: (status: RuntimeStatus) => void): () => void;
  };
}
