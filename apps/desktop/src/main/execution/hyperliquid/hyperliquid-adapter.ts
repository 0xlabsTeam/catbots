import type {
  CancelOrderIntent,
  ClosePositionIntent,
  ExecutionEventPage,
  ExecutionReceipt,
  NormalizedOrderIntent,
  PerpBalance,
  PerpDexAdapter,
  PerpMarket,
  PerpPosition,
  UpdateLeverageIntent,
} from '@catbots/execution-core';

import type { HyperliquidActionResult, HyperliquidClientPort, HyperliquidMeta } from './hyperliquid-client';
import { decimal, fixedError, formatOrderPrice, formatOrderSize, toCatbotsMarket, toHyperliquidCloid, toHyperliquidCoin } from './hyperliquid-normalization';

export class HyperliquidAdapter implements PerpDexAdapter {
  private meta: HyperliquidMeta | undefined;
  private nextMetaGeneration = 0;
  private publishedMetaGeneration = 0;
  private readonly originalClientIds = new Map<string, string>();

  constructor(private readonly options: Readonly<{
    client: HyperliquidClientPort;
    account?: string;
    slippageBps?: number;
  }>) {}

  async getMarkets(signal: AbortSignal): Promise<readonly PerpMarket[]> {
    const meta = await this.fetchAndPublishMeta(signal);
    return meta.universe.map(({ name, szDecimals, maxLeverage, isDelisted }) => ({
      market: toCatbotsMarket(name),
      baseAsset: name,
      quoteAsset: 'USDC',
      active: isDelisted !== true,
      sizeDecimals: szDecimals,
      maximumLeverage: maxLeverage,
    }));
  }

  async getBalances(account: string, signal: AbortSignal): Promise<readonly PerpBalance[]> {
    const state = await this.options.client.getClearinghouseState(normalizeAddress(account), signal);
    return [{ asset: 'USDC', total: positiveOrZero(state.marginSummary.accountValue), available: positiveOrZero(state.withdrawable) }];
  }

  async getPositions(account: string, signal: AbortSignal): Promise<readonly PerpPosition[]> {
    const state = await this.options.client.getClearinghouseState(normalizeAddress(account), signal);
    return state.assetPositions.flatMap(({ position }) => {
      const quantity = Number(position.szi);
      if (!Number.isFinite(quantity) || quantity === 0) return [];
      return [{
        market: toCatbotsMarket(position.coin),
        side: quantity > 0 ? 'long' as const : 'short' as const,
        notionalUsd: positive(position.positionValue),
        quantity: decimal(Math.abs(quantity)),
        entryPrice: positive(position.entryPx),
        leverage: positiveInteger(position.leverage.value),
      }];
    });
  }

  async placeOrder(order: NormalizedOrderIntent, signal: AbortSignal): Promise<ExecutionReceipt> {
    if (order.type === 'close_position') return this.closePosition(order, signal);
    const market = await this.resolveMarket(order.market, signal);
    const mids = await this.options.client.getAllMids(signal);
    const mid = Number(mids[market.coin]);
    if (!Number.isFinite(mid) || mid <= 0) throw fixedError('HYPERLIQUID_MARKET_PRICE_UNAVAILABLE');
    const slippage = (this.options.slippageBps ?? 100) / 10_000;
    const price = mid * (order.side === 'long' ? 1 + slippage : 1 - slippage);
    const cloid = this.rememberClientOrderId(order.clientOrderId);
    const result = await this.options.client.placeOrder({
      asset: market.asset,
      isBuy: order.side === 'long',
      price: formatOrderPrice(price, market.szDecimals),
      size: formatOrderSize(Number(order.notionalUsd) / mid, market.szDecimals),
      reduceOnly: false,
      cloid,
    }, signal);
    return receipt(result, order.clientOrderId);
  }

  async cancelOrder(order: CancelOrderIntent, signal: AbortSignal): Promise<ExecutionReceipt> {
    const market = await this.resolveMarket(order.market, signal);
    return receipt(await this.options.client.cancelByCloid({
      asset: market.asset, cloid: toHyperliquidCloid(order.clientOrderId),
    }, signal), order.clientOrderId);
  }

  async updateLeverage(input: UpdateLeverageIntent, signal: AbortSignal): Promise<ExecutionReceipt> {
    const market = await this.resolveMarket(input.market, signal);
    const result = await this.options.client.updateLeverage({ asset: market.asset, leverage: input.leverage }, signal);
    return receipt(result, `leverage:${input.market}:${input.leverage}`);
  }

  async closePosition(input: ClosePositionIntent, signal: AbortSignal): Promise<ExecutionReceipt> {
    if (this.options.account === undefined) throw fixedError('HYPERLIQUID_ACCOUNT_REQUIRED');
    const position = (await this.getPositions(this.options.account, signal)).find(({ market }) => market === input.market);
    if (position === undefined) return { status: 'rejected', clientOrderId: input.clientOrderId, errorCode: 'POSITION_NOT_FOUND' };
    const market = await this.resolveMarket(input.market, signal);
    const mids = await this.options.client.getAllMids(signal);
    const mid = Number(mids[market.coin]);
    if (!Number.isFinite(mid) || mid <= 0) throw fixedError('HYPERLIQUID_MARKET_PRICE_UNAVAILABLE');
    const isBuy = position.side === 'short';
    const slippage = (this.options.slippageBps ?? 100) / 10_000;
    const cloid = this.rememberClientOrderId(input.clientOrderId);
    const result = await this.options.client.placeOrder({
      asset: market.asset,
      isBuy,
      price: formatOrderPrice(mid * (isBuy ? 1 + slippage : 1 - slippage), market.szDecimals),
      size: formatOrderSize(Number(position.quantity) * input.percent / 100, market.szDecimals),
      reduceOnly: true,
      cloid,
    }, signal);
    return receipt(result, input.clientOrderId);
  }

  async getExecutionEvents(cursor: string | null, signal: AbortSignal): Promise<ExecutionEventPage> {
    if (this.options.account === undefined) throw fixedError('HYPERLIQUID_ACCOUNT_REQUIRED');
    const fills = await this.options.client.getUserFills(normalizeAddress(this.options.account), signal);
    const filtered = cursor === null ? fills : fills.filter(({ occurredAt }) => occurredAt > cursor);
    return {
      events: filtered.map((fill) => ({
        ...fill,
        clientOrderId: this.originalClientIds.get(fill.clientOrderId) ?? fill.clientOrderId,
      })),
      cursor: filtered.at(-1)?.occurredAt ?? cursor,
    };
  }

  private async getMeta(signal: AbortSignal): Promise<HyperliquidMeta> {
    return this.meta ?? this.fetchAndPublishMeta(signal);
  }

  private async fetchAndPublishMeta(signal: AbortSignal): Promise<HyperliquidMeta> {
    const generation = ++this.nextMetaGeneration;
    const response = await this.options.client.getMeta(signal);
    if (generation > this.publishedMetaGeneration) {
      this.meta = response;
      this.publishedMetaGeneration = generation;
      return response;
    }
    return this.meta!;
  }

  private async resolveMarket(market: string, signal: AbortSignal): Promise<{ asset: number; coin: string; szDecimals: number }> {
    const coin = toHyperliquidCoin(market);
    const meta = await this.getMeta(signal);
    const asset = meta.universe.findIndex(({ name }) => name === coin);
    if (asset < 0) throw fixedError('HYPERLIQUID_MARKET_UNAVAILABLE');
    return { asset, coin, szDecimals: meta.universe[asset]!.szDecimals };
  }

  private rememberClientOrderId(clientOrderId: string): string {
    const cloid = toHyperliquidCloid(clientOrderId);
    this.originalClientIds.set(cloid, clientOrderId);
    return cloid;
  }
}

function receipt(result: HyperliquidActionResult, clientOrderId: string): ExecutionReceipt {
  if (result.status === 'ok') return { status: 'acknowledged', clientOrderId, ...(result.venueOrderId === undefined ? {} : { venueOrderId: result.venueOrderId }) };
  return {
    status: result.status === 'unknown' ? 'unknown' : 'rejected',
    clientOrderId,
    errorCode: result.errorCode ?? (result.status === 'unknown' ? 'HYPERLIQUID_OUTCOME_UNKNOWN' : 'HYPERLIQUID_REJECTED'),
  };
}

function normalizeAddress(value: string): string {
  const address = value.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) throw fixedError('HYPERLIQUID_ACCOUNT_INVALID');
  return address;
}

function positive(value: string): string {
  const number = Math.abs(Number(value));
  if (!Number.isFinite(number) || number <= 0) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
  return decimal(number);
}

function positiveOrZero(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
  return number.toString();
}

function positiveInteger(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
  return value;
}
