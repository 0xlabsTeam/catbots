import {
  clientOrderId,
  evaluateRisk,
  type ClosePositionIntent,
  type NormalizedOrderIntent,
  type OpenPositionIntent,
  type PerpPosition,
} from '@catbots/execution-core';
import type { LegacyRiskLimits } from '@catbots/contracts';
import type {
  EvaluationContext,
  ExecutionTraceEvent,
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

export class PaperAdapter implements RuntimeExecutionPort {
  private committed: MutablePaperState = {
    equityUsd: '10000', positions: [], orders: [], recentOrderTimestamps: [], outcomes: new Map(),
  };
  private staged: MutablePaperState | undefined;

  constructor(private readonly input: Readonly<{
    deploymentId: string;
    strategyId: string;
    strategyVersion: number;
    market: string;
    riskLimits: LegacyRiskLimits;
  }>) {}

  beginEvaluation(): void {
    if (this.staged !== undefined) throw new Error('Paper evaluation is already active');
    this.staged = cloneState(this.committed);
  }

  commitEvaluation(): void {
    if (this.staged === undefined) throw new Error('Paper evaluation is not active');
    this.committed = this.staged;
    this.staged = undefined;
  }

  rollbackEvaluation(): void {
    this.staged = undefined;
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
    const decision = evaluateRisk({
      intent,
      limits: this.input.riskLimits,
      account: {
        equityUsd: state.equityUsd,
        dailyRealizedPnlUsd: '0',
        drawdownPercent: 0,
        positions: state.positions.map(({ market, notionalUsd }) => ({ market, notionalUsd })),
        recentOrderTimestamps: state.recentOrderTimestamps,
        accountKillSwitchActive: false,
        botKillSwitchActive: false,
      },
      evaluatedAt: context.evaluatedAt,
    });
    if (!decision.approved) return remember(state, effect.idempotencyKey, [
      { type: 'risk.rejected', metadata: { violatedRuleIds: decision.violatedRuleIds } },
    ]);
    const price = paperPrice(context, this.input.market);
    if (price === undefined) return remember(state, effect.idempotencyKey, [
      { type: 'risk.approved', metadata: { evaluator: 'paper.risk-engine' } },
      { type: 'execution.queued', metadata: { clientOrderId: intent.clientOrderId } },
      { type: 'execution.rejected', metadata: { code: 'MARKET_PRICE_UNAVAILABLE' } },
    ]);
    const order = Object.freeze({ ...intent, status: 'filled' as const, filledAt: context.evaluatedAt });
    applyFill(state, order, price);
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
    return percent > 0 && percent <= 100
      ? { type: 'close_position', market: deployment.market, percent, clientOrderId: orderId }
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
    type: 'open_position', market: deployment.market, side, orderType: 'market',
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

function applyFill(state: MutablePaperState, order: PaperOrder, price: number): void {
  if (order.type === 'open_position') {
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
