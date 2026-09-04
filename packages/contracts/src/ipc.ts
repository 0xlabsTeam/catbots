import type { BotSummary } from './bots';
import type { LocalSettingsPatch, RedactedLocalConfig } from './config';
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
  runtime: {
    getStatus(): Promise<RuntimeStatus>;
    subscribeStatus(listener: (status: RuntimeStatus) => void): () => void;
  };
}
