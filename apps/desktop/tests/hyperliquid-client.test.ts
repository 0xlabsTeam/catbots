import { describe, expect, it, vi } from 'vitest';

import {
  createHyperliquidClient,
  createHyperliquidPublicClient,
  HyperliquidTestnetTransport,
  resolveHyperliquidSignerAddress,
} from '../src/main/execution/hyperliquid/hyperliquid-client';

const signal = new AbortController().signal;

describe('createHyperliquidClient', () => {
  it('requires terminal order-status evidence before treating a trade fragment as a full fill', async () => {
    const cloid = '0x0123456789abcdef0123456789abcdef';
    const info = {
      meta: vi.fn(), clearinghouseState: vi.fn(), allMids: vi.fn(), userRole: vi.fn(),
      userFills: vi.fn().mockResolvedValue([{ cloid, oid: 42, hash: 'trade', tid: 1, time: 1000, sz: '0.1', px: '100' }]),
      orderStatus: vi.fn().mockResolvedValue({ status: 'order', order: { status: 'open', statusTimestamp: 1000,
        order: { cloid, oid: 42, origSz: '0.2', sz: '0.1' } } }),
    };
    const client = createHyperliquidPublicClient({}, {
      createTransport: () => ({}), createInfo: () => info, createExchange: vi.fn(),
    });
    expect((await client.getUserFills(`0x${'1'.repeat(40)}`, signal))[0]?.type).toBe('partially_filled');
    info.orderStatus.mockResolvedValue({ status: 'order', order: { status: 'filled', statusTimestamp: 1000,
      order: { cloid, oid: 42, origSz: '0.2', sz: '0' } } });
    expect((await client.getUserFills(`0x${'1'.repeat(40)}`, signal))[0]?.type).toBe('filled');
    expect(info.orderStatus).toHaveBeenCalledWith({ user: `0x${'1'.repeat(40)}`, oid: 42 }, signal);
  });

  it('creates a public metadata client without constructing an exchange signer', async () => {
    const transport = {};
    const info = {
      meta: vi.fn().mockResolvedValue({ universe: [], marginTables: [], collateralToken: 0 }),
      clearinghouseState: vi.fn(), allMids: vi.fn(), userRole: vi.fn(), userFills: vi.fn(), orderStatus: vi.fn(),
    };
    const sdk = {
      createTransport: vi.fn(() => transport),
      createInfo: vi.fn(() => info),
      createExchange: vi.fn(),
    };

    const client = createHyperliquidPublicClient({ timeoutMs: 4_000 }, sdk);
    await client.getMeta(signal);

    expect(sdk.createInfo).toHaveBeenCalledWith(transport);
    expect(sdk.createExchange).not.toHaveBeenCalled();
    await expect(client.placeOrder({} as never, signal)).rejects.toMatchObject({
      code: 'HYPERLIQUID_SIGNER_REQUIRED',
    });
  });

  it('sends bounded JSON only to the fixed Hyperliquid testnet API origin', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ BTC: '100000' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const transport = new HyperliquidTestnetTransport({ fetcher, timeoutMs: 2_000, maxResponseBytes: 1_024 });

    await expect(transport.request('info', { type: 'allMids' }, signal)).resolves.toEqual({ BTC: '100000' });
    expect(fetcher).toHaveBeenCalledWith('https://api.hyperliquid-testnet.xyz/info', expect.objectContaining({
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'allMids' }),
    }));
  });

  it('rejects an oversized response with a fixed error code', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ payload: 'x'.repeat(100) }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const transport = new HyperliquidTestnetTransport({ fetcher, maxResponseBytes: 32 });

    await expect(transport.request('info', { type: 'allMids' }, signal)).rejects.toMatchObject({
      code: 'HYPERLIQUID_RESPONSE_TOO_LARGE',
    });
  });

  it('derives the Agent wallet address locally without contacting Hyperliquid', async () => {
    await expect(resolveHyperliquidSignerAddress(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    )).resolves.toMatch(/^0x[a-f0-9]{40}$/);
  });

  it('pins the SDK transport to testnet with a bounded timeout and keeps signing in the exchange client', async () => {
    const transport = {};
    const info = {
      meta: vi.fn().mockResolvedValue({ universe: [], marginTables: [], collateralToken: 0 }),
      clearinghouseState: vi.fn(), allMids: vi.fn(), userRole: vi.fn(), userFills: vi.fn(), orderStatus: vi.fn(),
    };
    const exchange = { order: vi.fn(), cancelByCloid: vi.fn(), updateLeverage: vi.fn() };
    const sdk = {
      createTransport: vi.fn(() => transport),
      createInfo: vi.fn(() => info),
      createExchange: vi.fn(() => exchange),
    };
    const privateKey = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    const client = createHyperliquidClient({ agentPrivateKey: privateKey, timeoutMs: 4_000 }, sdk);
    await client.getMeta(signal);

    expect(sdk.createTransport).toHaveBeenCalledWith({ isTestnet: true, timeout: 4_000 });
    expect(sdk.createInfo).toHaveBeenCalledWith(transport);
    expect(sdk.createExchange).toHaveBeenCalledWith(transport, privateKey);
    expect(info.meta).toHaveBeenCalledWith(signal);
  });

  it('maps an IOC order into the SDK schema and returns a sanitized venue receipt', async () => {
    const exchange = {
      order: vi.fn().mockResolvedValue({
        status: 'ok', response: { type: 'order', data: { statuses: [{ filled: { oid: 42, totalSz: '0.005', avgPx: '100000' } }] } },
      }),
      cancelByCloid: vi.fn(), updateLeverage: vi.fn(),
    };
    const client = createHyperliquidClient({
      agentPrivateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }, {
      createTransport: () => ({}),
      createInfo: () => ({ meta: vi.fn(), clearinghouseState: vi.fn(), allMids: vi.fn(), userRole: vi.fn(), userFills: vi.fn(), orderStatus: vi.fn() }),
      createExchange: () => exchange,
    });

    await expect(client.placeOrder({
      asset: 0, isBuy: true, price: '101000', size: '0.005', reduceOnly: false,
      cloid: '0x0123456789abcdef0123456789abcdef',
    }, signal)).resolves.toEqual({ status: 'ok', filled: true, venueOrderId: '42',
      filledQuantity: '0.005', originalQuantity: '0.005', filledNotionalUsd: '500' });
    expect(exchange.order).toHaveBeenCalledWith({
      orders: [{ a: 0, b: true, p: '101000', s: '0.005', r: false, t: { limit: { tif: 'Ioc' } }, c: '0x0123456789abcdef0123456789abcdef' }],
      grouping: 'na',
    }, { signal });
  });

  it('classifies a lost exchange response as unknown without exposing the SDK error', async () => {
    const exchange = {
      order: vi.fn().mockRejectedValue(new Error('transport failed with private key sentinel')),
      cancelByCloid: vi.fn(), updateLeverage: vi.fn(),
    };
    const client = createHyperliquidClient({
      agentPrivateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }, {
      createTransport: () => ({}),
      createInfo: () => ({ meta: vi.fn(), clearinghouseState: vi.fn(), allMids: vi.fn(), userRole: vi.fn(), userFills: vi.fn(), orderStatus: vi.fn() }),
      createExchange: () => exchange,
    });

    const result = await client.placeOrder({
      asset: 0, isBuy: true, price: '1', size: '1', reduceOnly: false,
      cloid: '0x0123456789abcdef0123456789abcdef',
    }, signal);

    expect(result).toEqual({ status: 'unknown', errorCode: 'HYPERLIQUID_OUTCOME_UNKNOWN' });
    expect(JSON.stringify(result)).not.toContain('sentinel');
  });
});
