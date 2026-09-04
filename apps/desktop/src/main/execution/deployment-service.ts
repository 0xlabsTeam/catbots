import { randomUUID } from 'node:crypto';
import {
  DeploymentSchema,
  PrepareLiveInputSchema,
  StartLiveInputSchema,
  PaperDeploymentViewSchema,
  type LivePreflightView,
  type LocalConfig,
  type PrepareLiveInput,
  type StartLiveInput,
  StartPaperInputSchema,
  type Deployment,
  type PaperDeploymentView,
  type StartPaperInput,
} from '@catbots/contracts';
import {
  createBuiltinRegistry,
  createEvaluationContext,
  evaluateTrigger,
  validateStrategy,
  type AuditEvent,
  type CompiledStrategy,
  type EvaluationContext,
  type TriggerInput,
} from '@catbots/strategy-runtime';

import type { WorkbenchRepository } from '../workbench/workbench-repository';
import type { ExecutionRepository } from './execution-repository';
import { createHyperliquidClient, resolveHyperliquidSignerAddress, type HyperliquidClientPort } from './hyperliquid/hyperliquid-client';
import { runHyperliquidPreflight } from './hyperliquid/hyperliquid-preflight';
import { PaperAdapter, type PaperState } from './paper-adapter';

type ActivePaperDeployment = Readonly<{
  deployment: Deployment;
  compiled: CompiledStrategy;
  adapter: PaperAdapter;
  evaluations: Map<string, readonly AuditEvent[]>;
}>;

export type PaperIngestInput = Readonly<{
  deploymentId: string;
  triggerNodeId: string;
  triggerInput: TriggerInput;
  context: EvaluationContext;
}>;

export type PaperEvaluationResult = Readonly<{
  traceId: string;
  duplicate: boolean;
  events: readonly AuditEvent[];
  state: PaperState;
}>;

export class DeploymentService {
  private readonly active = new Map<string, ActivePaperDeployment>();
  private readonly livePreflights = new Map<string, Readonly<{
    input: PrepareLiveInput;
    view: LivePreflightView;
    botName: string;
    accountAddress: string;
    signerAddress: string | null;
  }>>();

  constructor(private readonly dependencies: Readonly<{
    executionRepository: ExecutionRepository;
    workbenchRepository: Pick<WorkbenchRepository, 'getState' | 'getStrategyDocument'>;
    configRepository?: Readonly<{ load(): Promise<LocalConfig | null> }>;
    runtimeReady?: () => boolean;
    createHyperliquidClient?: (options: Readonly<{ agentPrivateKey: string }>) => HyperliquidClientPort;
    resolveSignerAddress?: (privateKey: string) => Promise<string>;
    clock?: () => Date;
    idFactory?: () => string;
  }>) {}

  async prepareLive(source: PrepareLiveInput, signal: AbortSignal): Promise<LivePreflightView> {
    const input = PrepareLiveInputSchema.parse(source);
    const state = this.dependencies.workbenchRepository.getState(input.botId, input.strategyVersion);
    const config = await this.dependencies.configRepository?.load();
    const exchange = config?.exchanges.hyperliquid;
    let client: HyperliquidClientPort = unavailableHyperliquidClient();
    if (exchange !== undefined) {
      try {
        client = (this.dependencies.createHyperliquidClient ?? createHyperliquidClient)({ agentPrivateKey: exchange.agentPrivateKey });
      } catch {
        client = unavailableHyperliquidClient();
      }
    }
    let dataFresh = false;
    if (exchange !== undefined) {
      try {
        const mids = await client.getAllMids(signal);
        dataFresh = input.riskLimits.allowedMarkets.every((market) => Number(mids[market.replace(/-PERP$/, '')]) > 0);
      } catch {
        dataFresh = false;
      }
    }
    const view = await runHyperliquidPreflight({
      botId: input.botId,
      strategyVersion: input.strategyVersion,
      network: input.network,
      accountAddress: exchange?.accountAddress ?? 'unconfigured',
      agentPrivateKey: exchange?.agentPrivateKey ?? 'unconfigured',
      riskLimits: input.riskLimits,
      strategyApproved: state.currentRevision?.status === 'approved' && state.currentRevision.version === input.strategyVersion,
      backtestPassed: state.backtests.some((backtest) => backtest.revisionVersion === input.strategyVersion && backtest.status === 'completed'),
      dataFresh,
      auditWritable: this.dependencies.executionRepository.isWritable(),
      runtimeReady: this.dependencies.runtimeReady?.() ?? false,
      reconciliationHealthy: true,
      client,
      resolveSignerAddress: this.dependencies.resolveSignerAddress ?? resolveHyperliquidSignerAddress,
      clock: this.dependencies.clock,
      idFactory: this.dependencies.idFactory,
    }, signal);
    let signerAddress: string | null = null;
    if (exchange !== undefined) {
      try {
        signerAddress = await (this.dependencies.resolveSignerAddress ?? resolveHyperliquidSignerAddress)(exchange.agentPrivateKey);
      } catch {
        signerAddress = null;
      }
    }
    this.livePreflights.set(view.id, {
      input,
      view,
      botName: state.bot.name,
      accountAddress: exchange?.accountAddress ?? 'unconfigured',
      signerAddress: signerAddress?.toLowerCase() ?? null,
    });
    return view;
  }

  async startLive(source: StartLiveInput): Promise<Deployment> {
    const input = StartLiveInputSchema.parse(source);
    const prepared = this.livePreflights.get(input.preflightId);
    if (prepared === undefined || !prepared.view.ready) throw new Error('A successful Live preflight is required');
    if (input.confirmationBotName !== prepared.botName) throw new Error('Live confirmation does not match the bot name');
    if (JSON.stringify(prepared.input) !== JSON.stringify({
      botId: input.botId, strategyVersion: input.strategyVersion, riskLimits: input.riskLimits, network: input.network,
    })) throw new Error('Live inputs changed after preflight');
    const currentTime = (this.dependencies.clock ?? (() => new Date()))().getTime();
    const preflightAge = currentTime - Date.parse(prepared.view.checkedAt);
    if (preflightAge < 0 || preflightAge > 5 * 60_000) throw new Error('Live preflight expired');
    const currentConfig = await this.dependencies.configRepository?.load();
    const currentExchange = currentConfig?.exchanges.hyperliquid;
    if (currentExchange === undefined || currentExchange.accountAddress.toLowerCase() !== prepared.accountAddress.toLowerCase()) {
      throw new Error('Hyperliquid settings changed after preflight');
    }
    const currentSigner = await (this.dependencies.resolveSignerAddress ?? resolveHyperliquidSignerAddress)(currentExchange.agentPrivateKey);
    if (prepared.signerAddress === null || currentSigner.toLowerCase() !== prepared.signerAddress) {
      throw new Error('Hyperliquid Agent wallet changed after preflight');
    }
    const state = this.dependencies.workbenchRepository.getState(input.botId, input.strategyVersion);
    if (state.currentRevision?.status !== 'approved') throw new Error('Live deployment requires an approved strategy revision');
    const document = this.dependencies.workbenchRepository.getStrategyDocument(input.botId, input.strategyVersion);
    const validation = validateStrategy(document, createBuiltinRegistry());
    if (!validation.valid) throw new Error('Approved strategy is no longer valid');
    const timestamp = (this.dependencies.clock ?? (() => new Date()))().toISOString();
    const deployment = DeploymentSchema.parse({
      id: (this.dependencies.idFactory ?? randomUUID)(),
      botId: input.botId,
      strategyId: document.strategy.id,
      strategyVersion: input.strategyVersion,
      mode: 'live', venue: 'hyperliquid', network: 'testnet',
      maskedAccount: prepared.view.maskedAccount,
      marketBindings: [state.bot.market], riskLimits: input.riskLimits,
      status: 'running', createdAt: timestamp, updatedAt: timestamp,
    });
    const persisted = this.dependencies.executionRepository.createDeployment(deployment);
    this.livePreflights.delete(input.preflightId);
    return persisted;
  }

  getLiveDeployment(deploymentId: string): Deployment {
    const deployment = this.dependencies.executionRepository.getDeployment(deploymentId);
    if (deployment.mode !== 'live') throw new Error('Live deployment required');
    return deployment;
  }

  getActiveDeployment(botId: string): Deployment | null {
    return this.dependencies.executionRepository.getActiveDeploymentForBot(botId);
  }

  startPaper(source: StartPaperInput): Deployment {
    const input = StartPaperInputSchema.parse(source);
    const state = this.dependencies.workbenchRepository.getState(input.botId, input.strategyVersion);
    if (state.currentRevision?.status !== 'approved') throw new Error('Paper deployment requires an approved strategy revision');
    const document = this.dependencies.workbenchRepository.getStrategyDocument(input.botId, input.strategyVersion);
    const validation = validateStrategy(document, createBuiltinRegistry());
    if (!validation.valid) throw new Error('Approved strategy is no longer valid');
    const timestamp = (this.dependencies.clock ?? (() => new Date()))().toISOString();
    const deployment = DeploymentSchema.parse({
      id: (this.dependencies.idFactory ?? randomUUID)(),
      botId: input.botId,
      strategyId: document.strategy.id,
      strategyVersion: input.strategyVersion,
      mode: 'paper',
      venue: 'paper',
      network: 'paper',
      marketBindings: [state.bot.market],
      riskLimits: input.riskLimits,
      status: 'running',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const persisted = this.dependencies.executionRepository.createDeployment(deployment);
    this.active.set(persisted.id, {
      deployment: persisted,
      compiled: validation.compiled,
      adapter: new PaperAdapter({
        deploymentId: persisted.id,
        strategyId: persisted.strategyId,
        strategyVersion: persisted.strategyVersion,
        market: persisted.marketBindings[0]!,
        riskLimits: persisted.riskLimits,
      }),
      evaluations: new Map(),
    });
    return persisted;
  }

  ingest(input: PaperIngestInput): PaperEvaluationResult {
    const runtime = this.active.get(input.deploymentId);
    if (runtime === undefined || this.dependencies.executionRepository.getDeployment(input.deploymentId).status !== 'running') {
      throw new Error('Paper deployment is not running');
    }
    runtime.adapter.beginEvaluation();
    try {
      const paperState = runtime.adapter.snapshot();
      const context = createEvaluationContext({
        ...input.context,
        values: {
          ...input.context.values,
          'account.positions': {
            value: paperState.positions,
            provider: 'catbots.paper',
            observedAt: input.context.evaluatedAt,
            freshnessSeconds: 0,
            quality: { status: 'verified' },
            integrityHash: `paper:${runtime.deployment.id}:positions:${paperState.orders.length}`,
          },
        },
      });
      const evaluation = evaluateTrigger({
        compiled: runtime.compiled,
        triggerNodeId: input.triggerNodeId,
        triggerInput: input.triggerInput,
        context,
        deployment: { id: runtime.deployment.id, mode: 'paper' },
        execution: runtime.adapter,
      });
      const previous = runtime.evaluations.get(evaluation.traceId);
      if (previous !== undefined || this.dependencies.executionRepository.hasTrace(evaluation.traceId)) {
        runtime.adapter.rollbackEvaluation();
        return {
          traceId: evaluation.traceId,
          duplicate: true,
          events: previous ?? evaluation.trace,
          state: runtime.adapter.snapshot(),
        };
      }
      this.dependencies.executionRepository.recordPaperTrace(runtime.deployment.id, evaluation.trace);
      runtime.adapter.commitEvaluation();
      runtime.evaluations.set(evaluation.traceId, evaluation.trace);
      return { traceId: evaluation.traceId, duplicate: false, events: evaluation.trace, state: runtime.adapter.snapshot() };
    } catch (error) {
      runtime.adapter.rollbackEvaluation();
      throw error;
    }
  }

  getPaperState(deploymentId: string): PaperState {
    const runtime = this.active.get(deploymentId);
    if (runtime === undefined) throw new Error('Paper deployment is not active');
    return runtime.adapter.snapshot();
  }

  getPaperDeployment(deploymentId: string): PaperDeploymentView {
    const deployment = this.dependencies.executionRepository.getDeployment(deploymentId);
    if (deployment.mode !== 'paper') throw new Error('Paper deployment required');
    return PaperDeploymentViewSchema.parse({
      deployment,
      state: this.getPaperState(deploymentId),
      auditEvents: this.dependencies.executionRepository.listDeploymentAuditEvents(deploymentId),
    });
  }

  pause(deploymentId: string): Deployment {
    const timestamp = (this.dependencies.clock ?? (() => new Date()))().toISOString();
    return this.dependencies.executionRepository.pause(deploymentId, timestamp);
  }

  stop(deploymentId: string): Deployment {
    const timestamp = (this.dependencies.clock ?? (() => new Date()))().toISOString();
    this.dependencies.executionRepository.requestStop(deploymentId, timestamp);
    return this.dependencies.executionRepository.completeStop(deploymentId, timestamp);
  }
}

function unavailableHyperliquidClient(): HyperliquidClientPort {
  const unavailable = async (): Promise<never> => { throw new Error('HYPERLIQUID_NOT_CONFIGURED'); };
  return {
    getMeta: unavailable,
    getClearinghouseState: unavailable,
    getAllMids: unavailable,
    getUserRole: unavailable,
    placeOrder: unavailable,
    cancelByCloid: unavailable,
    updateLeverage: unavailable,
    getUserFills: unavailable,
  };
}
