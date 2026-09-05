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
  coordinateEvaluation,
  validateStrategy,
  type AuditEvent,
  type CompiledStrategy,
  type CoordinatedEvaluation,
  type EvaluationContext,
  type EvaluationContextFactory,
  type MarketUniverseSnapshot,
  type TriggerInput,
} from '@catbots/strategy-runtime';

import type { WorkbenchRepository } from '../workbench/workbench-repository';
import type { ExecutionRepository } from './execution-repository';
import type { MarketUniverseCache } from './market-universe-cache';
import { createHyperliquidClient, resolveHyperliquidSignerAddress, type HyperliquidClientPort } from './hyperliquid/hyperliquid-client';
import { runHyperliquidPreflight } from './hyperliquid/hyperliquid-preflight';
import { PaperAdapter, type PaperState } from './paper-adapter';

type ActivePaperDeployment = {
  deployment: Deployment;
  compiled: CompiledStrategy;
  adapter: PaperAdapter;
  evaluations: Map<string, readonly AuditEvent[]>;
  universe: MarketUniverseSnapshot;
};

export type PaperIngestInput = Readonly<{
  deploymentId: string;
  triggerNodeId: string;
  triggerInput: TriggerInput;
  contextFactory?: EvaluationContextFactory;
}>;

export type PaperEvaluationResult = Readonly<{
  traceId: string;
  parentTraceId: string;
  duplicate: boolean;
  events: readonly AuditEvent[];
  children: CoordinatedEvaluation['children'];
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
    universe: MarketUniverseSnapshot;
  }>>();

  constructor(private readonly dependencies: Readonly<{
    executionRepository: ExecutionRepository;
    workbenchRepository: Pick<WorkbenchRepository, 'getState' | 'getStrategyDocument' | 'getStoredIdentity'>;
    configRepository?: Readonly<{ load(): Promise<LocalConfig | null> }>;
    marketUniverseCache?: Pick<MarketUniverseCache, 'refresh' | 'freshness'>;
    runtimeReady?: () => boolean;
    createHyperliquidClient?: (options: Readonly<{ agentPrivateKey: string }>) => HyperliquidClientPort;
    resolveSignerAddress?: (privateKey: string) => Promise<string>;
    clock?: () => Date;
    idFactory?: () => string;
  }>) {}

  async prepareLive(source: PrepareLiveInput, signal: AbortSignal): Promise<LivePreflightView> {
    const input = PrepareLiveInputSchema.parse(source);
    const state = this.dependencies.workbenchRepository.getState(input.botId, input.strategyVersion);
    const document = this.dependencies.workbenchRepository.getStrategyDocument(input.botId, input.strategyVersion);
    if (document.schemaVersion !== '2.0' || document.marketScope.type !== 'dex_universe') {
      throw new Error('Strategy 2.0 is required');
    }
    const bot = this.dependencies.workbenchRepository.getStoredIdentity(input.botId).summary;
    const marketUniverseCache = this.dependencies.marketUniverseCache;
    if (marketUniverseCache === undefined) throw new Error('DEX universe unavailable');
    let universe: MarketUniverseSnapshot;
    try {
      universe = await marketUniverseCache.refresh(signal);
    } catch {
      throw new Error('DEX universe unavailable');
    }
    if (!marketUniverseCache.freshness().fresh || universe.dex !== bot.dex) {
      throw new Error('DEX universe unavailable');
    }
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
        dataFresh = universe.markets.some(({ active }) => active)
          && Object.values(mids).some((mid) => Number(mid) > 0);
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
      universe,
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
    if (document.schemaVersion !== '2.0' || document.marketScope.type !== 'dex_universe') {
      throw new Error('Strategy 2.0 is required');
    }
    const validation = validateStrategy(document, createBuiltinRegistry());
    if (!validation.valid) throw new Error('Approved strategy is no longer valid');
    const bot = this.dependencies.workbenchRepository.getStoredIdentity(input.botId).summary;
    if (prepared.universe.dex !== bot.dex) throw new Error('DEX universe does not match Bot');
    const timestamp = (this.dependencies.clock ?? (() => new Date()))().toISOString();
    const deployment = DeploymentSchema.parse({
      id: (this.dependencies.idFactory ?? randomUUID)(),
      botId: input.botId,
      strategyId: document.strategy.id,
      strategyVersion: input.strategyVersion,
      recordVersion: 2, dex: bot.dex, mode: 'live', executionVenue: 'hyperliquid', network: 'testnet',
      maskedAccount: prepared.view.maskedAccount,
      marketAccess: { mode: 'all_active_perpetuals' }, riskLimits: input.riskLimits,
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

  async startPaper(
    source: StartPaperInput,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<Deployment> {
    const input = StartPaperInputSchema.parse(source);
    const state = this.dependencies.workbenchRepository.getState(input.botId, input.strategyVersion);
    if (state.currentRevision?.status !== 'approved') throw new Error('Paper deployment requires an approved strategy revision');
    const document = this.dependencies.workbenchRepository.getStrategyDocument(input.botId, input.strategyVersion);
    if (document.schemaVersion !== '2.0' || document.marketScope.type !== 'dex_universe') {
      throw new Error('Strategy 2.0 is required');
    }
    const validation = validateStrategy(document, createBuiltinRegistry());
    if (!validation.valid) throw new Error('Approved strategy is no longer valid');
    const marketUniverseCache = this.dependencies.marketUniverseCache;
    if (marketUniverseCache === undefined) throw new Error('DEX universe unavailable');
    let universe;
    try {
      universe = await marketUniverseCache.refresh(signal);
    } catch {
      throw new Error('DEX universe unavailable');
    }
    if (!marketUniverseCache.freshness().fresh) throw new Error('DEX universe unavailable');
    const bot = this.dependencies.workbenchRepository.getStoredIdentity(input.botId).summary;
    if (universe.dex !== bot.dex) throw new Error('DEX universe does not match Bot');
    const timestamp = (this.dependencies.clock ?? (() => new Date()))().toISOString();
    const deployment = DeploymentSchema.parse({
      id: (this.dependencies.idFactory ?? randomUUID)(),
      botId: input.botId,
      strategyId: document.strategy.id,
      strategyVersion: input.strategyVersion,
      recordVersion: 2,
      dex: bot.dex,
      mode: 'paper',
      executionVenue: 'paper',
      marketAccess: { mode: 'all_active_perpetuals' },
      riskLimits: input.riskLimits,
      status: 'running',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const persisted = this.dependencies.executionRepository.createDeployment(deployment);
    if (persisted.recordVersion !== 2) throw new Error('Dynamic Paper deployment required');
    this.active.set(persisted.id, {
      deployment: persisted,
      compiled: validation.compiled,
      adapter: new PaperAdapter({
        recordVersion: 2,
        deploymentId: persisted.id,
        strategyId: persisted.strategyId,
        strategyVersion: persisted.strategyVersion,
        botDex: bot.dex,
        deploymentDex: persisted.dex,
        riskLimits: persisted.riskLimits,
        universe,
        universeFresh: true,
      }),
      evaluations: new Map(),
      universe,
    });
    return persisted;
  }

  async ingest(
    input: PaperIngestInput,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<PaperEvaluationResult> {
    const runtime = this.active.get(input.deploymentId);
    if (runtime === undefined || this.dependencies.executionRepository.getDeployment(input.deploymentId).status !== 'running') {
      throw new Error('Paper deployment is not running');
    }
    const deployment = runtime.deployment;
    if (deployment.recordVersion !== 2 || input.contextFactory === undefined) {
      throw new Error('Dynamic market context factory is required');
    }
    let universe = runtime.universe;
    let universeFresh = false;
    try {
      universe = await this.dependencies.marketUniverseCache!.refresh(signal);
      universeFresh = this.dependencies.marketUniverseCache!.freshness().fresh;
    } catch {
      universeFresh = false;
    }
    if (universe.dex !== deployment.dex) throw new Error('DEX universe does not match deployment');
    runtime.universe = universe;
    runtime.adapter.updateMarketUniverse({ universe, fresh: universeFresh });
    runtime.adapter.beginCoordinatedEvaluation();
    try {
      const paperState = runtime.adapter.snapshot();
      const contexts = new Map<string, EvaluationContext>();
      const coordinated = coordinateEvaluation({
        compiled: runtime.compiled,
        triggerNodeId: input.triggerNodeId,
        triggerInput: input.triggerInput,
        universe: runtime.universe,
        contextFactory: (market, metadata) => {
          const supplied = input.contextFactory!(market, metadata);
          const context = createEvaluationContext({
            ...supplied,
            values: {
              ...supplied.values,
              'account.positions': {
                value: paperState.positions,
                provider: 'catbots.paper',
                observedAt: supplied.evaluatedAt,
                freshnessSeconds: 0,
                quality: { status: 'verified' },
                integrityHash: `paper:${runtime.deployment.id}:positions:${paperState.orders.length}`,
              },
            },
          });
          contexts.set(market, context);
          return context;
        },
        deployment: { id: runtime.deployment.id, mode: 'paper' },
        execution: {
          execute: (effect, context) => {
            runtime.adapter.selectMarketEvaluation({
              dex: deployment.dex,
              currentMarket: context.currentMarket,
              universeRevision: runtime.universe.revision,
            });
            return runtime.adapter.execute(effect, context);
          },
        },
      });
      const previous = runtime.evaluations.get(coordinated.parentTraceId);
      if (previous !== undefined || this.dependencies.executionRepository.hasTrace(coordinated.parentTraceId)) {
        runtime.adapter.rollbackEvaluation();
        return {
          traceId: coordinated.parentTraceId,
          parentTraceId: coordinated.parentTraceId,
          duplicate: true,
          events: previous ?? coordinated.parentTrace,
          children: coordinated.children,
          state: runtime.adapter.snapshot(),
        };
      }
      this.dependencies.executionRepository.recordCoordinatedTrace(runtime.deployment.id, coordinated, {
        universe: runtime.universe,
        contexts,
      });
      runtime.adapter.commitEvaluation();
      runtime.evaluations.set(coordinated.parentTraceId, coordinated.parentTrace);
      return {
        traceId: coordinated.parentTraceId,
        parentTraceId: coordinated.parentTraceId,
        duplicate: false,
        events: coordinated.parentTrace,
        children: coordinated.children,
        state: runtime.adapter.snapshot(),
      };
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
