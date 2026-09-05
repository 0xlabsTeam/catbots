import { createHash } from 'node:crypto';

import type { PerpDexAdapter, PerpMarket } from '@catbots/execution-core';
import type { MarketUniverseMarket, MarketUniverseSnapshot } from '@catbots/strategy-runtime';

export type MarketUniverseFreshness =
  | Readonly<{ fresh: true }>
  | Readonly<{ fresh: false; reason: 'unavailable' | 'expired' }>;

export type MarketUniverseCacheOptions = Readonly<{
  adapter: Pick<PerpDexAdapter, 'getMarkets'>;
  ttlMs?: number;
  refreshIntervalMs?: number;
  clock?: () => Date;
}>;

const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_BOUNDED_DURATION_MS = 24 * 60 * 60_000;

export class MarketUniverseCache {
  private readonly adapter: Pick<PerpDexAdapter, 'getMarkets'>;
  private readonly clock: () => Date;
  private readonly ttlMs: number;
  private readonly refreshIntervalMs: number;
  private currentSnapshot: MarketUniverseSnapshot | undefined;

  constructor(options: MarketUniverseCacheOptions) {
    this.adapter = options.adapter;
    this.clock = options.clock ?? (() => new Date());
    this.ttlMs = boundedDuration(options.ttlMs ?? DEFAULT_TTL_MS, 'MARKET_UNIVERSE_TTL_INVALID');
    this.refreshIntervalMs = boundedDuration(
      options.refreshIntervalMs ?? Math.max(1, Math.floor(this.ttlMs / 2)),
      'MARKET_UNIVERSE_REFRESH_INTERVAL_INVALID',
    );
  }

  initialize(signal: AbortSignal): Promise<MarketUniverseSnapshot> {
    return this.refresh(signal);
  }

  async refresh(signal: AbortSignal): Promise<MarketUniverseSnapshot> {
    signal.throwIfAborted();
    const markets = await this.adapter.getMarkets(signal);
    signal.throwIfAborted();

    const normalized = normalizeMarkets(markets, this.currentSnapshot?.markets ?? []);
    const observedAt = validDate(this.clock(), 'MARKET_UNIVERSE_CLOCK_INVALID').toISOString();
    const snapshot = Object.freeze({
      dex: 'hyperliquid' as const,
      revision: contentRevision(normalized),
      observedAt,
      markets: normalized,
    });
    this.currentSnapshot = snapshot;
    return snapshot;
  }

  snapshot(): MarketUniverseSnapshot {
    if (this.currentSnapshot === undefined) throw new Error('MARKET_UNIVERSE_UNAVAILABLE');
    return this.currentSnapshot;
  }

  freshness(at: Date = this.clock()): MarketUniverseFreshness {
    const snapshot = this.currentSnapshot;
    if (snapshot === undefined) return Object.freeze({ fresh: false, reason: 'unavailable' });
    const checkedAt = validDate(at, 'MARKET_UNIVERSE_CLOCK_INVALID').getTime();
    const observedAt = Date.parse(snapshot.observedAt);
    return checkedAt - observedAt <= this.ttlMs
      ? Object.freeze({ fresh: true })
      : Object.freeze({ fresh: false, reason: 'expired' });
  }

  startPeriodicRefresh(signal: AbortSignal): () => boolean {
    if (signal.aborted) return () => false;
    let stopped = false;
    let refreshing = false;
    const stop = (): boolean => {
      if (stopped) return false;
      stopped = true;
      clearInterval(timer);
      signal.removeEventListener('abort', stop);
      return true;
    };
    const timer = setInterval(() => {
      if (stopped || refreshing) return;
      refreshing = true;
      void this.refresh(signal)
        .catch(() => undefined)
        .finally(() => { refreshing = false; });
    }, this.refreshIntervalMs);
    signal.addEventListener('abort', stop, { once: true });
    return stop;
  }
}

function normalizeMarkets(
  received: readonly PerpMarket[],
  previous: readonly MarketUniverseMarket[],
): readonly MarketUniverseMarket[] {
  const current = new Map<string, MarketUniverseMarket>();
  for (const market of received) {
    const normalized = normalizeMarket(market);
    if (current.has(normalized.symbol)) throw new Error('MARKET_UNIVERSE_DUPLICATE_SYMBOL');
    current.set(normalized.symbol, normalized);
  }
  for (const market of previous) {
    if (!current.has(market.symbol)) current.set(market.symbol, Object.freeze({ ...market, active: false }));
  }
  return Object.freeze([...current.values()].sort((left, right) => (
    left.symbol < right.symbol ? -1 : left.symbol > right.symbol ? 1 : 0
  )));
}

function normalizeMarket(market: PerpMarket): MarketUniverseMarket {
  const symbol = market.market.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*-PERP$/.test(symbol)
    || typeof market.active !== 'boolean'
    || !Number.isInteger(market.sizeDecimals) || market.sizeDecimals < 0
    || !Number.isInteger(market.maximumLeverage) || market.maximumLeverage < 1) {
    throw new Error('MARKET_UNIVERSE_METADATA_INVALID');
  }
  return Object.freeze({
    symbol,
    active: market.active,
    sizeDecimals: market.sizeDecimals,
    maximumLeverage: market.maximumLeverage,
  });
}

function contentRevision(markets: readonly MarketUniverseMarket[]): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(markets), 'utf8').digest('hex')}`;
}

function boundedDuration(value: number, code: string): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_BOUNDED_DURATION_MS) throw new Error(code);
  return value;
}

function validDate(value: Date, code: string): Date {
  if (!Number.isFinite(value.getTime())) throw new Error(code);
  return value;
}
