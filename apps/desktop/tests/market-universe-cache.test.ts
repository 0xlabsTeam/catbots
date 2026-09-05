import type { PerpDexAdapter, PerpMarket } from '@catbots/execution-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarketUniverseCache } from '../src/main/execution/market-universe-cache';

const signal = new AbortController().signal;

function market(
  symbol: string,
  overrides: Partial<PerpMarket> = {},
): PerpMarket {
  const baseAsset = symbol.slice(0, -'-PERP'.length);
  return {
    market: symbol,
    baseAsset,
    quoteAsset: 'USDC',
    active: true,
    sizeDecimals: 4,
    maximumLeverage: 50,
    ...overrides,
  };
}

function adapter(...outcomes: Array<readonly PerpMarket[] | Error>): Pick<PerpDexAdapter, 'getMarkets'> {
  const getMarkets = vi.fn();
  for (const outcome of outcomes) {
    if (outcome instanceof Error) getMarkets.mockRejectedValueOnce(outcome);
    else getMarkets.mockResolvedValueOnce(outcome);
  }
  return { getMarkets };
}

describe('MarketUniverseCache', () => {
  afterEach(() => vi.useRealTimers());

  it('initializes an immutable snapshot with canonical normalized metadata and a content revision', async () => {
    let now = Date.parse('2026-09-05T00:00:00.000Z');
    const venue = adapter(
      [market('ETH-PERP'), market('BTC-PERP', { sizeDecimals: 5, maximumLeverage: 40 })],
      [market('BTC-PERP', { sizeDecimals: 5, maximumLeverage: 40 }), market('ETH-PERP')],
    );
    const cache = new MarketUniverseCache({ adapter: venue, clock: () => new Date(now), ttlMs: 1_000 });

    const initialized = await cache.initialize(signal);
    expect(initialized).toEqual({
      dex: 'hyperliquid',
      revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      observedAt: '2026-09-05T00:00:00.000Z',
      markets: [
        { symbol: 'BTC-PERP', active: true, sizeDecimals: 5, maximumLeverage: 40 },
        { symbol: 'ETH-PERP', active: true, sizeDecimals: 4, maximumLeverage: 50 },
      ],
    });
    expect(Object.isFrozen(initialized)).toBe(true);
    expect(Object.isFrozen(initialized.markets)).toBe(true);
    expect(initialized.markets.every(Object.isFrozen)).toBe(true);

    now += 100;
    const reordered = await cache.refresh(signal);
    expect(reordered.revision).toBe(initialized.revision);
    expect(cache.freshness(new Date(now))).toEqual({ fresh: true });
  });

  it('adds listings and retains removed markets as inactive tombstones after refresh', async () => {
    const venue = adapter(
      [market('OLD-PERP')],
      [market('OLD-PERP'), market('NEW-PERP', { sizeDecimals: 3, maximumLeverage: 20 })],
      [market('NEW-PERP', { sizeDecimals: 3, maximumLeverage: 20 })],
    );
    const cache = new MarketUniverseCache({ adapter: venue, ttlMs: 1_000 });

    await cache.initialize(signal);
    const afterListing = await cache.refresh(signal);
    expect(afterListing.markets.map(({ symbol }) => symbol)).toEqual(['NEW-PERP', 'OLD-PERP']);

    const afterDelisting = await cache.refresh(signal);
    expect(afterDelisting.markets).toEqual([
      { symbol: 'NEW-PERP', active: true, sizeDecimals: 3, maximumLeverage: 20 },
      { symbol: 'OLD-PERP', active: false, sizeDecimals: 4, maximumLeverage: 50 },
    ]);
  });

  it('preserves the last successful snapshot on refresh failure and expires it only after the TTL', async () => {
    let now = Date.parse('2026-09-05T00:00:00.000Z');
    const venue = adapter([market('ETH-PERP')], new Error('provider secret sentinel'));
    const cache = new MarketUniverseCache({ adapter: venue, clock: () => new Date(now), ttlMs: 1_000 });
    const lastSuccessfulSnapshot = await cache.initialize(signal);

    now += 500;
    await expect(cache.refresh(signal)).rejects.toThrow('provider secret sentinel');
    expect(cache.snapshot()).toBe(lastSuccessfulSnapshot);
    expect(cache.freshness(new Date(now))).toEqual({ fresh: true });

    now += 501;
    expect(cache.freshness(new Date(now))).toEqual({ fresh: false, reason: 'expired' });
    expect(cache.snapshot()).toBe(lastSuccessfulSnapshot);
  });

  it('runs periodic refreshes until the owning coordinator aborts them', async () => {
    vi.useFakeTimers();
    const venue = adapter([market('BTC-PERP')], [market('ETH-PERP')]);
    const cache = new MarketUniverseCache({ adapter: venue, ttlMs: 1_000, refreshIntervalMs: 100 });
    await cache.initialize(signal);
    const owner = new AbortController();

    const stop = cache.startPeriodicRefresh(owner.signal);
    await vi.advanceTimersByTimeAsync(100);
    expect(cache.snapshot().markets).toEqual([
      { symbol: 'BTC-PERP', active: false, sizeDecimals: 4, maximumLeverage: 50 },
      { symbol: 'ETH-PERP', active: true, sizeDecimals: 4, maximumLeverage: 50 },
    ]);

    owner.abort();
    await vi.advanceTimersByTimeAsync(500);
    expect(venue.getMarkets).toHaveBeenCalledTimes(2);
    expect(stop()).toBe(false);
  });
});
