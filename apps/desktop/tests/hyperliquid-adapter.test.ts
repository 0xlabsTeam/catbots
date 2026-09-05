import { describe, expect, it, vi } from 'vitest';

import { HyperliquidAdapter } from '../src/main/execution/hyperliquid/hyperliquid-adapter';
import type { HyperliquidClientPort } from '../src/main/execution/hyperliquid/hyperliquid-client';

const signal = new AbortController().signal;
const account = '0x0123456789abcdef0123456789abcdef01234567';

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
}> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function client(overrides: Partial<HyperliquidClientPort> = {}): HyperliquidClientPort {
  return {
    getMeta: vi.fn().mockResolvedValue({
      universe: [
        { name: 'BTC', szDecimals: 5, maxLeverage: 40 },
        { name: 'ETH', szDecimals: 4, maxLeverage: 50 },
        { name: 'OLD', szDecimals: 2, maxLeverage: 3, isDelisted: true },
      ],
    }),
    getClearinghouseState: vi.fn().mockResolvedValue({
      marginSummary: { accountValue: '10000' },
      withdrawable: '7500',
      assetPositions: [{ position: { coin: 'BTC', szi: '-0.25', positionValue: '25000', entryPx: '100000', leverage: { value: 3 } } }],
    }),
    getAllMids: vi.fn().mockResolvedValue({ BTC: '100000' }),
    getUserRole: vi.fn().mockResolvedValue({ role: 'agent', data: { user: account } }),
    placeOrder: vi.fn().mockResolvedValue({ status: 'ok', venueOrderId: '12345' }),
    cancelByCloid: vi.fn().mockResolvedValue({ status: 'ok' }),
    updateLeverage: vi.fn().mockResolvedValue({ status: 'ok' }),
    getUserFills: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('HyperliquidAdapter', () => {
  it('normalizes testnet perpetual market metadata', async () => {
    const adapter = new HyperliquidAdapter({ client: client() });

    await expect(adapter.getMarkets(signal)).resolves.toEqual([
      {
        market: 'BTC-PERP', baseAsset: 'BTC', quoteAsset: 'USDC', active: true,
        sizeDecimals: 5, maximumLeverage: 40,
      },
      {
        market: 'ETH-PERP', baseAsset: 'ETH', quoteAsset: 'USDC', active: true,
        sizeDecimals: 4, maximumLeverage: 50,
      },
      {
        market: 'OLD-PERP', baseAsset: 'OLD', quoteAsset: 'USDC', active: false,
        sizeDecimals: 2, maximumLeverage: 3,
      },
    ]);
  });

  it('fetches fresh metadata each time the market universe is requested', async () => {
    const api = client({
      getMeta: vi.fn()
        .mockResolvedValueOnce({ universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }] })
        .mockResolvedValueOnce({ universe: [{ name: 'ETH', szDecimals: 4, maxLeverage: 50 }] }),
    });
    const adapter = new HyperliquidAdapter({ client: api });

    await expect(adapter.getMarkets(signal)).resolves.toEqual([
      expect.objectContaining({ market: 'BTC-PERP' }),
    ]);
    await expect(adapter.getMarkets(signal)).resolves.toEqual([
      expect.objectContaining({ market: 'ETH-PERP' }),
    ]);
    expect(api.getMeta).toHaveBeenCalledTimes(2);
  });

  it('does not let an older metadata response replace newer order-resolution precision', async () => {
    const olderActive = deferred<Awaited<ReturnType<HyperliquidClientPort['getMeta']>>>();
    const newerDelisted = deferred<Awaited<ReturnType<HyperliquidClientPort['getMeta']>>>();
    const api = client({
      getMeta: vi.fn()
        .mockReturnValueOnce(olderActive.promise)
        .mockReturnValueOnce(newerDelisted.promise),
      getAllMids: vi.fn().mockResolvedValue({ ETH: '100' }),
    });
    const adapter = new HyperliquidAdapter({ client: api });

    const olderRequest = adapter.getMarkets(signal);
    const newerRequest = adapter.getMarkets(signal);
    newerDelisted.resolve({
      universe: [{ name: 'ETH', szDecimals: 2, maxLeverage: 50, isDelisted: true }],
    });
    await newerRequest;
    olderActive.resolve({ universe: [{ name: 'ETH', szDecimals: 5, maxLeverage: 50 }] });
    await olderRequest;

    await adapter.placeOrder({
      type: 'open_position', market: 'ETH-PERP', side: 'long', orderType: 'market',
      notionalUsd: '12.345', leverage: 2, clientOrderId: 'cb_overlap',
    }, signal);
    expect(api.placeOrder).toHaveBeenCalledWith(expect.objectContaining({ size: '0.12' }), signal);
  });

  it('makes a pending lazy order and later orders use newer concurrently refreshed metadata', async () => {
    const olderLazy = deferred<Awaited<ReturnType<HyperliquidClientPort['getMeta']>>>();
    const newerMarkets = deferred<Awaited<ReturnType<HyperliquidClientPort['getMeta']>>>();
    const api = client({
      getMeta: vi.fn()
        .mockReturnValueOnce(olderLazy.promise)
        .mockReturnValueOnce(newerMarkets.promise),
      getAllMids: vi.fn().mockResolvedValue({ ETH: '100' }),
    });
    const adapter = new HyperliquidAdapter({ client: api });
    const order = (clientOrderId: string) => ({
      type: 'open_position' as const,
      market: 'ETH-PERP',
      side: 'long' as const,
      orderType: 'market' as const,
      notionalUsd: '12.345',
      leverage: 2,
      clientOrderId,
    });

    const pendingOrder = adapter.placeOrder(order('cb_lazy_overlap'), signal);
    const marketRefresh = adapter.getMarkets(signal);
    newerMarkets.resolve({
      universe: [{ name: 'ETH', szDecimals: 2, maxLeverage: 50, isDelisted: true }],
    });
    await marketRefresh;
    olderLazy.resolve({ universe: [{ name: 'ETH', szDecimals: 5, maxLeverage: 50 }] });

    await pendingOrder;
    await adapter.placeOrder(order('cb_after_overlap'), signal);
    expect(api.placeOrder).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ size: '0.12' }),
      signal,
    );
    expect(api.placeOrder).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ size: '0.12' }),
      signal,
    );
  });

  it('queries the master account and normalizes balances and signed positions', async () => {
    const api = client();
    const adapter = new HyperliquidAdapter({ client: api });

    await expect(adapter.getBalances(account, signal)).resolves.toEqual([
      { asset: 'USDC', total: '10000', available: '7500' },
    ]);
    await expect(adapter.getPositions(account, signal)).resolves.toEqual([
      { market: 'BTC-PERP', side: 'short', notionalUsd: '25000', quantity: '0.25', entryPrice: '100000', leverage: 3 },
    ]);
    expect(api.getClearinghouseState).toHaveBeenCalledWith(account.toLowerCase(), signal);
  });

  it('converts a normalized market intent into a deterministic IOC testnet order', async () => {
    const api = client();
    const adapter = new HyperliquidAdapter({ client: api, slippageBps: 100 });
    const intent = {
      type: 'open_position' as const,
      market: 'BTC-PERP', side: 'long' as const, orderType: 'market' as const,
      notionalUsd: '500', leverage: 2, clientOrderId: 'cb_0123456789abcdef0123456789ab',
    };

    await expect(adapter.placeOrder(intent, signal)).resolves.toEqual({
      status: 'acknowledged', clientOrderId: intent.clientOrderId, venueOrderId: '12345',
    });
    expect(api.placeOrder).toHaveBeenCalledWith({
      asset: 0,
      isBuy: true,
      price: '101000',
      size: '0.005',
      reduceOnly: false,
      cloid: expect.stringMatching(/^0x[a-f0-9]{32}$/),
    }, signal);
  });

  it('fails closed with a fixed code before submission when the market is unknown', async () => {
    const api = client();
    const adapter = new HyperliquidAdapter({ client: api });
    const error = await adapter.placeOrder({
      type: 'open_position', market: 'DOGE-PERP', side: 'long', orderType: 'market',
      notionalUsd: '10', leverage: 1, clientOrderId: 'cb_doge',
    }, signal).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'HYPERLIQUID_MARKET_UNAVAILABLE' });
    expect(api.placeOrder).not.toHaveBeenCalled();
  });

  it('maps fill events back to the original deterministic client order ID for reconciliation', async () => {
    const api = client();
    const adapter = new HyperliquidAdapter({ client: api, account });
    const clientOrderId = 'cb_0123456789abcdef0123456789ab';
    await adapter.placeOrder({
      type: 'open_position', market: 'BTC-PERP', side: 'long', orderType: 'market',
      notionalUsd: '500', leverage: 2, clientOrderId,
    }, signal);
    const cloid = vi.mocked(api.placeOrder).mock.calls[0]?.[0].cloid;
    vi.mocked(api.getUserFills).mockResolvedValueOnce([{
      id: 'fill-1', clientOrderId: cloid!, type: 'filled', occurredAt: '2026-09-05T00:00:00.000Z',
      filledQuantity: '0.005', averagePrice: '100000',
    }]);

    await expect(adapter.getExecutionEvents(null, signal)).resolves.toEqual({
      events: [expect.objectContaining({ id: 'fill-1', clientOrderId })],
      cursor: '2026-09-05T00:00:00.000Z',
    });
  });

  it('submits closes as reduce-only orders against the current master-account position', async () => {
    const api = client();
    const adapter = new HyperliquidAdapter({ client: api, account });

    await adapter.closePosition({ type: 'close_position', market: 'BTC-PERP', percent: 50, clientOrderId: 'cb_close' }, signal);

    expect(api.placeOrder).toHaveBeenCalledWith(expect.objectContaining({
      asset: 0, isBuy: true, size: '0.125', reduceOnly: true,
    }), signal);
  });
});
