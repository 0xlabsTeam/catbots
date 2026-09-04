import type {
  BacktestAssumptions,
  SimulatedPosition,
  SimulationLedgerEntry,
  SimulationSnapshot,
} from './backtest-types';
import type { EvaluationContext } from './evaluation-context';
import type {
  ExecutionTraceEvent,
  ProposedEffect,
  RuntimeExecutionPort,
} from './runtime';

type NumericPosition = {
  market: string;
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  leverage: number;
  openedAt: string;
};

type MarketPrice = { market: string; bid: number; ask: number; mark: number };

function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Simulation produced a non-finite number');
  const normalized = Math.abs(value) < 0.000000005 ? 0 : value;
  return Number(normalized.toFixed(8)).toString();
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function marketPrice(context: EvaluationContext, expectedMarket: string): MarketPrice | undefined {
  const source = context.values['market.price'];
  if (!source || source.quality.status !== 'verified' || source.freshnessSeconds < 0) return undefined;
  const value = source.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const market = value.market;
  const bid = numeric(value.bid);
  const ask = numeric(value.ask);
  const mark = numeric(value.mark);
  if (market !== expectedMarket || bid === undefined || ask === undefined || mark === undefined) return undefined;
  if (bid <= 0 || ask <= 0 || mark <= 0) return undefined;
  return { market, bid, ask, mark };
}

function validateAssumptions(assumptions: BacktestAssumptions): number {
  const capital = Number(assumptions.startingCapital);
  if (!Number.isFinite(capital) || capital <= 0) throw new Error('Starting capital must be positive');
  if (assumptions.feeRateBps < 0 || assumptions.slippageBps < 0 || assumptions.latencyMs < 0) {
    throw new Error('Simulation costs and latency cannot be negative');
  }
  if (assumptions.partialFillRatio <= 0 || assumptions.partialFillRatio > 1) {
    throw new Error('Partial fill ratio must be greater than zero and at most one');
  }
  if (assumptions.maintenanceMarginRate < 0 || assumptions.maintenanceMarginRate >= 1) {
    throw new Error('Maintenance margin rate must be between zero and one');
  }
  return capital;
}

function rejected(code: string): Readonly<{ events: readonly ExecutionTraceEvent[] }> {
  return { events: [
    { type: 'risk.approved', metadata: { decision: 'approved', evaluator: 'backtest.simulation' } },
    { type: 'execution.queued' },
    { type: 'execution.rejected', metadata: { code } },
  ] };
}

export class SimulatedExecutionAdapter implements RuntimeExecutionPort {
  readonly #market: string;
  readonly #assumptions: BacktestAssumptions;
  readonly #positions: NumericPosition[] = [];
  readonly #ledger: SimulationLedgerEntry[] = [];
  readonly #outcomes = new Map<string, Readonly<{ events: readonly ExecutionTraceEvent[] }>>();
  #cash: number;
  #totalFees = 0;
  #totalFunding = 0;
  #realizedPnl = 0;
  #lastMark?: number;

  constructor(input: Readonly<{ market: string; assumptions: BacktestAssumptions }>) {
    this.#market = input.market;
    this.#assumptions = Object.freeze({ ...input.assumptions });
    this.#cash = validateAssumptions(this.#assumptions);
  }

  execute(effect: ProposedEffect, context: EvaluationContext): Readonly<{ events: readonly ExecutionTraceEvent[] }> {
    const previous = this.#outcomes.get(effect.idempotencyKey);
    if (previous) return previous;
    const price = marketPrice(context, this.#market);
    if (!price) return this.#remember(effect.idempotencyKey, rejected('MARKET_PRICE_UNAVAILABLE'));
    this.#lastMark = price.mark;

    const outcome = effect.type === 'execution.open_position'
      ? this.#open(effect, context, price)
      : effect.type === 'execution.close_position'
        ? this.#close(effect, context, price)
        : rejected('UNSUPPORTED_EFFECT');
    return this.#remember(effect.idempotencyKey, outcome);
  }

  applyFunding(rate: number, context: EvaluationContext): void {
    const price = marketPrice(context, this.#market);
    if (!price || !Number.isFinite(rate)) throw new Error('Funding requires a valid point-in-time price and rate');
    this.#lastMark = price.mark;
    for (const position of this.#positions) {
      const signedCost = position.quantity * price.mark * rate * (position.side === 'long' ? 1 : -1);
      this.#cash -= signedCost;
      this.#totalFunding += signedCost;
      this.#ledger.push(Object.freeze({
        type: 'funding', timestamp: context.evaluatedAt, market: this.#market,
        rate: decimal(rate), amount: decimal(signedCost),
      }));
    }
  }

  markToMarket(context: EvaluationContext): Readonly<{ liquidated: boolean }> {
    const price = marketPrice(context, this.#market);
    if (!price) throw new Error('Mark-to-market requires a valid point-in-time price');
    this.#lastMark = price.mark;
    let liquidated = false;
    for (const position of [...this.#positions]) {
      const equity = this.#cash + this.#unrealized(position, price.mark);
      const maintenanceMargin = position.quantity * price.mark * this.#assumptions.maintenanceMarginRate;
      if (equity <= maintenanceMargin) {
        const pnl = this.#unrealized(position, price.mark);
        this.#cash += pnl;
        this.#realizedPnl += pnl;
        this.#positions.splice(this.#positions.indexOf(position), 1);
        this.#ledger.push(Object.freeze({
          type: 'liquidation', timestamp: context.evaluatedAt, market: this.#market,
          side: position.side, quantity: decimal(position.quantity), price: decimal(price.mark),
          realizedPnl: decimal(pnl), entryPrice: decimal(position.entryPrice), openedAt: position.openedAt,
        }));
        liquidated = true;
      }
    }
    return { liquidated };
  }

  snapshot(): SimulationSnapshot {
    const equity = this.#cash + this.#positions.reduce(
      (total, position) => total + this.#unrealized(position, this.#lastMark ?? position.entryPrice),
      0,
    );
    const positions: SimulatedPosition[] = this.#positions.map((position) => Object.freeze({
      market: position.market,
      side: position.side,
      quantity: decimal(position.quantity),
      entryPrice: decimal(position.entryPrice),
      leverage: decimal(position.leverage),
    }));
    return Object.freeze({
      cash: decimal(this.#cash),
      equity: decimal(equity),
      positions: Object.freeze(positions),
      ledger: Object.freeze([...this.#ledger]),
      totalFees: decimal(this.#totalFees),
      totalFunding: decimal(this.#totalFunding),
      realizedPnl: decimal(this.#realizedPnl),
    });
  }

  #open(
    effect: ProposedEffect,
    context: EvaluationContext,
    price: MarketPrice,
  ): Readonly<{ events: readonly ExecutionTraceEvent[] }> {
    const side = effect.config.side;
    const size = effect.config.size;
    const leverage = numeric(effect.config.leverage) ?? 1;
    if ((side !== 'long' && side !== 'short') || size === null || typeof size !== 'object' || Array.isArray(size)) {
      return rejected('INVALID_ORDER_INTENT');
    }
    const sizeValue = numeric(size.value);
    if (sizeValue === undefined || sizeValue <= 0 || leverage <= 0) return rejected('INVALID_ORDER_INTENT');
    const notional = size.type === 'equity_percent'
      ? Number(this.snapshot().equity) * sizeValue / 100
      : size.type === 'quote' ? sizeValue : Number.NaN;
    if (!Number.isFinite(notional) || notional <= 0) return rejected('INVALID_ORDER_INTENT');
    if (notional / leverage > Number(this.snapshot().equity)) return rejected('INSUFFICIENT_MARGIN');

    const slip = this.#assumptions.slippageBps / 10_000;
    const fillPrice = side === 'long' ? price.ask * (1 + slip) : price.bid * (1 - slip);
    const quantity = notional / fillPrice;
    const fee = notional * this.#assumptions.feeRateBps / 10_000;
    const filledAt = new Date(Date.parse(context.evaluatedAt) + this.#assumptions.latencyMs).toISOString();
    this.#cash -= fee;
    this.#totalFees += fee;
    this.#positions.push({ market: this.#market, side, quantity, entryPrice: fillPrice, leverage, openedAt: filledAt });
    this.#ledger.push(Object.freeze({
      type: 'fill', timestamp: filledAt, market: this.#market, side,
      quantity: decimal(quantity), price: decimal(fillPrice), fee: decimal(fee), effectType: effect.type,
    }));
    return { events: this.#fillEvents(effect, quantity, fillPrice, fee, filledAt) };
  }

  #close(
    effect: ProposedEffect,
    context: EvaluationContext,
    price: MarketPrice,
  ): Readonly<{ events: readonly ExecutionTraceEvent[] }> {
    const position = this.#positions[0];
    if (!position) return rejected('POSITION_NOT_FOUND');
    const percent = numeric(effect.config.percent) ?? 100;
    if (percent <= 0 || percent > 100) return rejected('INVALID_ORDER_INTENT');
    const slip = this.#assumptions.slippageBps / 10_000;
    const fillPrice = position.side === 'long' ? price.bid * (1 - slip) : price.ask * (1 + slip);
    const quantity = position.quantity * percent / 100;
    const pnl = (position.side === 'long' ? fillPrice - position.entryPrice : position.entryPrice - fillPrice) * quantity;
    const fee = quantity * fillPrice * this.#assumptions.feeRateBps / 10_000;
    this.#cash += pnl - fee;
    this.#realizedPnl += pnl;
    this.#totalFees += fee;
    position.quantity -= quantity;
    if (position.quantity <= 0.000000005) this.#positions.splice(0, 1);
    const filledAt = new Date(Date.parse(context.evaluatedAt) + this.#assumptions.latencyMs).toISOString();
    this.#ledger.push(Object.freeze({
      type: 'fill', timestamp: filledAt, market: this.#market,
      side: position.side === 'long' ? 'short' : 'long', quantity: decimal(quantity),
      positionSide: position.side, entryPrice: decimal(position.entryPrice), openedAt: position.openedAt,
      price: decimal(fillPrice), fee: decimal(fee), realizedPnl: decimal(pnl), effectType: effect.type,
    }));
    return { events: this.#fillEvents(effect, quantity, fillPrice, fee, filledAt) };
  }

  #fillEvents(
    effect: ProposedEffect,
    quantity: number,
    price: number,
    fee: number,
    filledAt: string,
  ): readonly ExecutionTraceEvent[] {
    const events: ExecutionTraceEvent[] = [
      { type: 'risk.approved', metadata: { decision: 'approved', evaluator: 'backtest.simulation' } },
      { type: 'execution.queued', metadata: { effectIdempotencyKey: effect.idempotencyKey } },
      { type: 'execution.submitted', metadata: { clientOrderId: effect.idempotencyKey } },
      { type: 'execution.acknowledged', metadata: { latencyMs: this.#assumptions.latencyMs } },
    ];
    if (this.#assumptions.partialFillRatio < 1) {
      events.push({
        type: 'execution.partially_filled',
        metadata: { quantity: decimal(quantity * this.#assumptions.partialFillRatio), price: decimal(price) },
      });
    }
    events.push({
      type: 'execution.filled',
      metadata: { quantity: decimal(quantity), price: decimal(price), fee: decimal(fee), filledAt },
    });
    return Object.freeze(events);
  }

  #unrealized(position: NumericPosition, mark: number): number {
    return (position.side === 'long' ? mark - position.entryPrice : position.entryPrice - mark) * position.quantity;
  }

  #remember(
    idempotencyKey: string,
    outcome: Readonly<{ events: readonly ExecutionTraceEvent[] }>,
  ): Readonly<{ events: readonly ExecutionTraceEvent[] }> {
    const snapshot = Object.freeze({ events: Object.freeze([...outcome.events]) });
    this.#outcomes.set(idempotencyKey, snapshot);
    return snapshot;
  }
}
