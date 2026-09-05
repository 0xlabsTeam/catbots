import {
  clientOrderId,
  evaluateRisk,
  type ClosePositionIntent,
  type NormalizedOrderIntent,
  type OpenPositionIntent,
  type PerpPosition,
} from '@catbots/execution-core';
import type { DexId, LegacyRiskLimits, RiskLimits } from '@catbots/contracts';
import type {
  EvaluationContext,
  ExecutionTraceEvent,
  MarketUniverseSnapshot,
  ProposedEffect,
  RuntimeExecutionPort,
} from '@catbots/strategy-runtime';

export type PaperOrder = NormalizedOrderIntent & Readonly<{ status: 'filled'; filledAt: string }>;
export type PaperState = Readonly<{
  equityUsd: string;
  positions: readonly PerpPosition[];
  orders: readonly PaperOrder[];
}>;

type MutablePaperState = {
  equityUsd: string;
  positions: PerpPosition[];
  orders: PaperOrder[];
  recentOrderTimestamps: string[];
  outcomes: Map<string, readonly ExecutionTraceEvent[]>;
};

type LegacyPaperAdapterInput = Readonly<{
  deploymentId: string;
  strategyId: string;
  strategyVersion: number;
  market: string;
  riskLimits: LegacyRiskLimits;
}>;

export type PaperMarketUniverseSnapshot = MarketUniverseSnapshot;

type DynamicPaperAdapterInput = Readonly<{
  recordVersion: 2;
  deploymentId: string;
  strategyId: string;
  strategyVersion: number;
  botDex: DexId;
  deploymentDex: DexId;
  riskLimits: RiskLimits;
  universe: PaperMarketUniverseSnapshot;
  universeFresh: boolean;
}>;

export type PaperEvaluationIdentity = Readonly<{
  dex: DexId;
  currentMarket: string;
  universeRevision: string;
}>;

type PaperUniverseState = Readonly<{
  universe: PaperMarketUniverseSnapshot;
  fresh: boolean;
}>;

export class PaperAdapter implements RuntimeExecutionPort {
  private committed: MutablePaperState = {
    equityUsd: '10000', positions: [], orders: [], recentOrderTimestamps: [], outcomes: new Map(),
  };
  private staged: MutablePaperState | undefined;
  private currentUniverse: PaperUniverseState | undefined;
  private stagedUniverse: PaperUniverseState | undefined;
  private evaluationIdentity: PaperEvaluationIdentity | undefined;

  constructor(private readonly input: LegacyPaperAdapterInput | DynamicPaperAdapterInput) {
    if (isDynamic(input)) {
      this.assertUniverseDex(input.universe);
      this.currentUniverse = freezeUniverse(input.universe, input.universeFresh);
    }
  }

  beginEvaluation(identity?: PaperEvaluationIdentity): void {
    if (isDynamic(this.input) && identity === undefined) throw new Error('Dynamic Paper evaluation identity is required');
    if (!isDynamic(this.input) && identity !== undefined) throw new Error('Legacy Paper evaluation does not accept dynamic identity');
    this.beginCoordinatedEvaluation();
    if (identity !== undefined) this.selectMarketEvaluation(identity);
  }

  beginCoordinatedEvaluation(): void {
    if (this.staged !== undefined) throw new Error('Paper evaluation is already active');
    this.staged = cloneState(this.committed);
    this.stagedUniverse = this.currentUniverse;
    this.evaluationIdentity = undefined;
  }

  selectMarketEvaluation(identity: PaperEvaluationIdentity): void {
    if (!isDynamic(this.input)) throw new Error('Legacy Paper deployment does not accept dynamic identity');
    if (this.staged === undefined) throw new Error('Paper evaluation is not active');
    this.evaluationIdentity = Object.freeze({ ...identity });
  }

  commitEvaluation(): void {
    if (this.staged === undefined) throw new Error('Paper evaluation is not active');
    this.committed = this.staged;
    this.staged = undefined;
    this.stagedUniverse = undefined;
    this.evaluationIdentity = undefined;
  }

  rollbackEvaluation(): void {
    this.staged = undefined;
    this.stagedUniverse = undefined;
    this.evaluationIdentity = undefined;
  }

  updateMarketUniverse(input: Readonly<{ universe: PaperMarketUniverseSnapshot; fresh: boolean }>): void {
    if (!isDynamic(this.input)) throw new Error('Legacy Paper deployment has a fixed market');
    if (this.staged !== undefined) throw new Error('Cannot replace the Paper universe during an evaluation');
    this.assertUniverseDex(input.universe);
    this.currentUniverse = freezeUniverse(input.universe, input.fresh);
  }

  execute(effect: ProposedEffect, context: EvaluationContext): Readonly<{ events: readonly ExecutionTraceEvent[] }> {
    const state = this.staged;
    if (state === undefined) throw new Error('Paper execution requires an active staged evaluation');
    const previous = state.outcomes.get(effect.idempotencyKey);
    if (previous !== undefined) return { events: previous };
    const intent = toIntent(this.input, effect, context, state.equityUsd);
    if (intent === undefined) return remember(state, effect.idempotencyKey, [
      { type: 'risk.rejected', metadata: { violatedRuleIds: ['risk-state-unavailable'] } },
    ]);
    const account = {
      equityUsd: state.equityUsd,
      dailyRealizedPnlUsd: '0',
      drawdownPercent: 0,
      positions: state.positions.map(({ market, side, notionalUsd }) => ({ market, side, notionalUsd })),
      recentOrderTimestamps: state.recentOrderTimestamps,
      accountKillSwitchActive: false,
      botKillSwitchActive: false,
    };
    const decision = isDynamic(this.input)
      ? this.evaluateDynamicRisk(intent, effect, context, account)
      : evaluateRisk({
        intent,
        limits: this.input.riskLimits,
        account,
        evaluatedAt: context.evaluatedAt,
      });
    if (!decision.approved) return remember(state, effect.idempotencyKey, [
      { type: 'risk.rejected', metadata: { violatedRuleIds: decision.violatedRuleIds } },
    ]);
    const price = paperPrice(context, intent.market);
    if (price === undefined) return remember(state, effect.idempotencyKey, [
      { type: 'risk.approved', metadata: { evaluator: 'paper.risk-engine' } },
      { type: 'execution.queued', metadata: { clientOrderId: intent.clientOrderId } },
      { type: 'execution.rejected', metadata: { code: 'MARKET_PRICE_UNAVAILABLE' } },
    ]);
    const order = Object.freeze({ ...intent, status: 'filled' as const, filledAt: context.evaluatedAt });
    applyFill(state, order, price, isDynamic(this.input));
    state.orders.push(order);
    state.recentOrderTimestamps.push(context.evaluatedAt);
    return remember(state, effect.idempotencyKey, [
      { type: 'risk.approved', metadata: { evaluator: 'paper.risk-engine' } },
      { type: 'execution.queued', metadata: { clientOrderId: intent.clientOrderId } },
      { type: 'execution.submitted', metadata: { clientOrderId: intent.clientOrderId } },
      { type: 'execution.acknowledged', metadata: { clientOrderId: intent.clientOrderId } },
      { type: 'execution.filled', metadata: { clientOrderId: intent.clientOrderId, price: String(price) } },
    ]);
  }

  snapshot(): PaperState {
    return Object.freeze({
      equityUsd: this.committed.equityUsd,
      positions: Object.freeze(this.committed.positions.map((position) => Object.freeze({ ...position }))),
      orders: Object.freeze(this.committed.orders.map((order) => Object.freeze({ ...order }))),
    });
  }

  private evaluateDynamicRisk(
    intent: NormalizedOrderIntent,
    effect: ProposedEffect,
    context: EvaluationContext,
    account: Parameters<typeof evaluateRisk>[0]['account'],
  ) {
    const deployment = this.input;
    const identity = this.evaluationIdentity;
    const universeState = this.stagedUniverse;
    if (!isDynamic(deployment) || identity === undefined || universeState === undefined) {
      return { approved: false as const, violatedRuleIds: ['risk-state-unavailable'] as const };
    }
    if (identity.currentMarket !== context.currentMarket) {
      return { approved: false as const, violatedRuleIds: ['evaluation-market-mismatch'] as const };
    }
    const selected = universeState.universe.markets.find(({ symbol }) => symbol === effect.market);
    const metadata = selected === undefined ? undefined : {
      market: selected.symbol,
      active: selected.active,
      sizeDecimals: selected.sizeDecimals,
      maximumLeverage: selected.maximumLeverage,
    };
    return evaluateRisk({
      intent,
      limits: deployment.riskLimits,
      account,
      botDex: deployment.botDex,
      deploymentDex: deployment.deploymentDex,
      evaluationDex: identity.dex,
      currentMarket: identity.currentMarket,
      effectMarket: effect.market,
      evaluationUniverseRevision: identity.universeRevision,
      marketMetadataRevision: universeState.universe.revision,
      marketMetadataDex: universeState.universe.dex,
      marketMetadata: metadata,
      universeFresh: universeState.fresh,
      evaluatedAt: context.evaluatedAt,
    });
  }

  private assertUniverseDex(universe: PaperMarketUniverseSnapshot): void {
    if (!isDynamic(this.input) || universe.dex !== this.input.botDex || this.input.deploymentDex !== this.input.botDex) {
      throw new Error('Paper DEX identity mismatch');
    }
  }
}

function toIntent(
  deployment: ConstructorParameters<typeof PaperAdapter>[0],
  effect: ProposedEffect,
  context: EvaluationContext,
  equityUsd: string,
): NormalizedOrderIntent | undefined {
  const identity = {
    deploymentId: deployment.deploymentId,
    strategyId: deployment.strategyId,
    strategyVersion: deployment.strategyVersion,
    traceId: `paper:${effect.idempotencyKey}`,
    actionNodeId: effect.nodeId,
    effectIdempotencyKey: effect.idempotencyKey,
  };
  const orderId = clientOrderId(identity);
  if (effect.type === 'execution.close_position') {
    const percent = typeof effect.config.percent === 'number' ? effect.config.percent : 100;
    const market = isDynamic(deployment) ? effect.market : deployment.market;
    if (!isDynamic(deployment) && (!Number.isFinite(percent) || percent <= 0 || percent > 100)) return undefined;
    return typeof percent === 'number'
      ? { type: 'close_position', market, percent, clientOrderId: orderId }
      : undefined;
  }
  if (effect.type !== 'execution.open_position') return undefined;
  const size = effect.config.size;
  const side = effect.config.side;
  const leverage = effect.config.leverage ?? 1;
  if ((side !== 'long' && side !== 'short') || typeof leverage !== 'number'
    || size === null || typeof size !== 'object' || Array.isArray(size) || typeof size.value !== 'number') return undefined;
  const notional = size.type === 'quote' ? size.value
    : size.type === 'equity_percent' ? Number(equityUsd) * size.value / 100 : Number.NaN;
  if (!Number.isFinite(notional) || notional <= 0) return undefined;
  return {
    type: 'open_position', market: isDynamic(deployment) ? effect.market : deployment.market, side, orderType: 'market',
    notionalUsd: decimal(notional), leverage, clientOrderId: orderId,
  } satisfies OpenPositionIntent;
}

function paperPrice(context: EvaluationContext, market: string): number | undefined {
  const source = context.values['market.price'];
  if (source?.quality.status !== 'verified' || source.freshnessSeconds < 0) return undefined;
  const value = source.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value.market !== market) return undefined;
  const price = typeof value.mark === 'number' ? value.mark : undefined;
  return price !== undefined && Number.isFinite(price) && price > 0 ? price : undefined;
}

function applyFill(state: MutablePaperState, order: PaperOrder, price: number, aggregateByMarket: boolean): void {
  if (order.type === 'open_position') {
    const existing = aggregateByMarket
      ? state.positions.find(({ market }) => market === order.market)
      : undefined;
    if (existing !== undefined) {
      if (existing.side !== order.side) throw new Error('Paper risk approved an implicit position flip');
      const existingQuantity = Number(existing.quantity);
      const addedQuantity = Number(order.notionalUsd) / price;
      const nextQuantity = existingQuantity + addedQuantity;
      state.positions[state.positions.indexOf(existing)] = {
        ...existing,
        notionalUsd: decimal(Number(existing.notionalUsd) + Number(order.notionalUsd)),
        quantity: decimal(nextQuantity),
        entryPrice: decimal((Number(existing.notionalUsd) + Number(order.notionalUsd)) / nextQuantity),
        leverage: order.leverage,
      };
      return;
    }
    state.positions.push({
      market: order.market,
      side: order.side,
      notionalUsd: order.notionalUsd,
      quantity: decimal(Number(order.notionalUsd) / price),
      entryPrice: decimal(price),
      leverage: order.leverage,
    });
    return;
  }
  const position = state.positions.find(({ market }) => market === order.market);
  if (position === undefined) return;
  if (order.percent === 100) {
    state.positions.splice(state.positions.indexOf(position), 1);
    return;
  }
  const ratio = (100 - order.percent) / 100;
  state.positions[state.positions.indexOf(position)] = {
    ...position,
    notionalUsd: decimal(Number(position.notionalUsd) * ratio),
    quantity: decimal(Number(position.quantity) * ratio),
  };
}

function remember(state: MutablePaperState, key: string, events: readonly ExecutionTraceEvent[]) {
  const frozen = Object.freeze([...events]);
  state.outcomes.set(key, frozen);
  return { events: frozen };
}

function cloneState(source: MutablePaperState): MutablePaperState {
  return {
    equityUsd: source.equityUsd,
    positions: source.positions.map((position) => ({ ...position })),
    orders: source.orders.map((order) => ({ ...order })),
    recentOrderTimestamps: [...source.recentOrderTimestamps],
    outcomes: new Map(source.outcomes),
  };
}

function decimal(value: number): string {
  return Number(value.toFixed(8)).toString();
}

function isDynamic(
  input: LegacyPaperAdapterInput | DynamicPaperAdapterInput,
): input is DynamicPaperAdapterInput {
  return 'recordVersion' in input && input.recordVersion === 2;
}

function freezeUniverse(universe: PaperMarketUniverseSnapshot, fresh: boolean): PaperUniverseState {
  return Object.freeze({
    fresh,
    universe: Object.freeze({
      ...universe,
      markets: Object.freeze(universe.markets.map((market) => Object.freeze({ ...market }))),
    }),
  });
}
