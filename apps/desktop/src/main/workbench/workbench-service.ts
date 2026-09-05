import { randomUUID } from 'node:crypto';
import {
  AgentToolActivitySchema,
  ApproveStrategyRevisionInputSchema,
  GetTraceInputSchema,
  GetWorkbenchInputSchema,
  RunWorkbenchBacktestInputSchema,
  SendWorkbenchMessageInputSchema,
  TraceDetailSchema,
  type AgentToolActivity,
  type ApproveStrategyRevisionInput,
  type BacktestSummary,
  type GetTraceInput,
  type GetWorkbenchInput,
  type LocalConfig,
  type RunWorkbenchBacktestInput,
  type SendWorkbenchMessageInput,
  type StrategyRevision,
  type TraceDetail,
  type WorkbenchState,
} from '@catbots/contracts';

import { legacyMarketHint } from '../../legacy-contract-compat';
import { sanitizeAuditValue } from '@catbots/strategy-runtime';

import { createAgentToolCatalog } from '../agent/agent-tools';
import { runAgentTurn } from '../agent/agent-loop';
import { AnthropicCompatibleChatProvider } from '../llm/anthropic-compatible-chat';
import type { CompatibleChatProvider } from '../llm/compatible-chat-provider';
import { OpenAiCompatibleChatProvider } from '../llm/openai-compatible-chat';
import { runBundledSampleBacktest } from './sample-backtest-data';
import type { WorkbenchRepository } from './workbench-repository';

type ProviderFactory = (config: LocalConfig['llm']) => CompatibleChatProvider;

export type WorkbenchServiceDependencies = Readonly<{
  repository: WorkbenchRepository;
  configRepository: { load(): Promise<LocalConfig | null> };
  providerFactory?: ProviderFactory;
  clock?: () => Date;
  idFactory?: () => string;
}>;

export class WorkbenchService {
  readonly #listeners = new Set<(activity: AgentToolActivity) => void>();

  constructor(private readonly dependencies: WorkbenchServiceDependencies) {}

  async get(input: GetWorkbenchInput): Promise<WorkbenchState> {
    const request = GetWorkbenchInputSchema.parse(input);
    return this.dependencies.repository.getState(request.botId, request.version);
  }

  async sendMessage(input: SendWorkbenchMessageInput): Promise<WorkbenchState> {
    const request = SendWorkbenchMessageInputSchema.parse(input);
    const config = await this.dependencies.configRepository.load();
    if (config === null) throw new Error('LLM_CONFIGURATION_REQUIRED');
    const requestId = (this.dependencies.idFactory ?? randomUUID)();
    const controller = new AbortController();
    const state = this.dependencies.repository.getState(request.botId);
    const onActivity = (activity: AgentToolActivity) => this.publish(activity);
    const tools = createAgentToolCatalog({
      botId: request.botId,
      market: legacyMarketHint(state.bot),
      repository: this.dependencies.repository,
      clock: this.dependencies.clock,
      idFactory: this.dependencies.idFactory,
      shouldCancel: () => controller.signal.aborted,
      onBacktestProgress: (completed, total) => this.publish(AgentToolActivitySchema.parse({
        botId: request.botId,
        requestId,
        phase: 'backtest_progress',
        tool: 'backtest_strategy',
        message: 'Backtest is running.',
        progress: total === 0 ? 1 : completed / total,
      })),
    });
    return runAgentTurn({ botId: request.botId, message: request.message, signal: controller.signal }, {
      provider: (this.dependencies.providerFactory ?? createProvider)(config.llm),
      repository: this.dependencies.repository,
      tools,
      requestId,
      onActivity,
    });
  }

  async runBacktest(input: RunWorkbenchBacktestInput): Promise<BacktestSummary> {
    const request = RunWorkbenchBacktestInputSchema.parse(input);
    const state = this.dependencies.repository.getState(request.botId);
    const document = this.dependencies.repository.getStrategyDocument(request.botId, request.revisionVersion);
    const requestId = (this.dependencies.idFactory ?? randomUUID)();
    const result = runBundledSampleBacktest(
      request.botId,
      request.revisionVersion,
      document,
      legacyMarketHint(state.bot),
      request.assumptions,
      {
        clock: this.dependencies.clock,
        idFactory: this.dependencies.idFactory,
        onProgress: (completed, total) => this.publish(AgentToolActivitySchema.parse({
          botId: request.botId,
          requestId,
          phase: 'backtest_progress',
          tool: 'backtest_strategy',
          message: 'Backtest is running.',
          progress: total === 0 ? 1 : completed / total,
        })),
      },
    );
    this.dependencies.repository.createBacktestRun(result.summary, result.artifact);
    return result.summary;
  }

  async approveRevision(input: ApproveStrategyRevisionInput): Promise<StrategyRevision> {
    const request = ApproveStrategyRevisionInputSchema.parse(input);
    return this.dependencies.repository.approveRevision(request.botId, request.version);
  }

  async getTrace(input: GetTraceInput): Promise<TraceDetail> {
    const request = GetTraceInputSchema.parse(input);
    const state = this.dependencies.repository.getState(request.botId);
    const backtest = state.backtests.find((candidate) => candidate.traces.some(({ traceId }) => traceId === request.traceId));
    const summary = backtest?.traces.find(({ traceId }) => traceId === request.traceId);
    if (backtest === undefined || summary === undefined) throw new Error('TRACE_NOT_FOUND');
    const artifact = this.dependencies.repository.getTraceArtifact(request.botId, backtest.artifactHash);
    const trace = findTrace(JSON.parse(artifact) as unknown, request.traceId);
    return TraceDetailSchema.parse({
      traceId: request.traceId,
      outcome: summary.outcome,
      events: trace.map((event, index) => ({
        sequence: typeof event.sequence === 'number' ? event.sequence : index + 1,
        type: requiredString(event.type),
        occurredAt: requiredString(event.createdAt ?? event.evaluationTime),
        ...(typeof event.nodeId === 'string' ? { nodeId: event.nodeId } : {}),
        summary: requiredString(event.type).replaceAll('.', ' '),
        details: sanitizeAuditValue(event.details ?? {}) as Record<string, unknown>,
      })),
    });
  }

  subscribeActivity(listener: (activity: AgentToolActivity) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  private publish(activity: AgentToolActivity): void {
    for (const listener of this.#listeners) listener(activity);
  }
}

function createProvider(config: LocalConfig['llm']): CompatibleChatProvider {
  return config.provider === 'openai-compatible'
    ? new OpenAiCompatibleChatProvider(config)
    : new AnthropicCompatibleChatProvider(config);
}

function findTrace(value: unknown, traceId: string): Record<string, unknown>[] {
  if (typeof value !== 'object' || value === null) throw new Error('TRACE_ARTIFACT_INVALID');
  const traces = (value as { traces?: unknown }).traces;
  if (!Array.isArray(traces)) throw new Error('TRACE_ARTIFACT_INVALID');
  for (const candidate of traces) {
    if (!Array.isArray(candidate)) continue;
    const events = candidate.filter((event): event is Record<string, unknown> => typeof event === 'object' && event !== null);
    if (events.some((event) => event.traceId === traceId)) return events;
  }
  throw new Error('TRACE_NOT_FOUND');
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('TRACE_ARTIFACT_INVALID');
  return value;
}
