import { afterEach, expect, it, vi } from 'vitest';
import { ReconciliationService } from '../src/main/execution/reconciliation-service';
import { ExecutionRepository } from '../src/main/execution/execution-repository';
import { createHyperliquidClient, createHyperliquidPublicClient } from '../src/main/execution/hyperliquid/hyperliquid-client';
import { OutboxExecutor } from '../src/main/execution/outbox-executor';
import type { PerpDexAdapter } from '@catbots/execution-core';
import { HyperliquidAdapter } from '../src/main/execution/hyperliquid/hyperliquid-adapter';
import { toHyperliquidCloid } from '../src/main/execution/hyperliquid/hyperliquid-normalization';
import { createLiveFixture, liveClientOrderId, liveDeploymentId, liveIdempotencyKey } from './live-execution-fixture';

const databases: Array<{ close(): void }> = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));
const account = `0x${'1'.repeat(40)}`;
const signal = new AbortController().signal;

it('leaves a mixed child open until all actions are terminal, then reports partial failure exactly once', async () => {
  const f = createLiveFixture(); databases.push(f.database);
  const proposal = f.proposal;
  f.repository.proposeLiveAction({ trace: proposal.trace,
    events: [
      { ...proposal.events[0], id: 'second-proposal', sequence: 4, nodeId: 'second' },
      { ...proposal.events[1], id: 'second-risk', sequence: 5, nodeId: 'second' },
    ], outbox: { ...proposal.outbox, id: 'second-outbox', actionNodeId: 'second',
      idempotencyKey: 'second-key', clientOrderId: 'second-client', intent: { ...proposal.outbox.intent, clientOrderId: 'second-client' } },
  });
  const adapter: PerpDexAdapter = {
    getMarkets: vi.fn(), getBalances: vi.fn(), getPositions: vi.fn().mockResolvedValue([]), cancelOrder: vi.fn(),
    updateLeverage: vi.fn(), closePosition: vi.fn(),
    placeOrder: vi.fn().mockResolvedValueOnce({ status: 'partially_filled_cancelled', clientOrderId: liveClientOrderId,
      filledQuantity: '0.002', originalQuantity: '0.005', filledNotionalUsd: '200' })
      .mockResolvedValueOnce({ status: 'acknowledged', clientOrderId: 'second-client' }),
    getExecutionEvents: vi.fn().mockResolvedValue({ events: [{ id: 'second-fill', type: 'filled',
      clientOrderId: 'second-client', occurredAt: '2026-09-05T00:00:03.000Z' }], cursor: null }),
  };
  const executor = new OutboxExecutor({ repository: f.repository, adapter });
  await executor.runOnce(liveIdempotencyKey, signal);
  await executor.runOnce('second-key', signal);
  expect(f.repository.listAuditEvents(proposal.trace.id).some(({ type }) => type.startsWith('flow.'))).toBe(false);
  const reconciliation = new ReconciliationService({ repository: new ExecutionRepository(f.database), adapter, account });
  await reconciliation.reconcileDeployment(liveDeploymentId, signal);
  await reconciliation.reconcileDeployment(liveDeploymentId, signal);
  const events = f.repository.listAuditEvents(proposal.trace.id);
  expect(events.filter(({ type }) => type.startsWith('flow.')).map(({ type }) => type)).toEqual(['flow.failed']);
  expect(events.filter(({ type }) => type === 'execution.partially_filled_cancelled')).toHaveLength(1);
  expect(events.filter(({ type }) => type === 'execution.filled')).toEqual([expect.objectContaining({ nodeId: 'second' })]);
  expect(f.repository.withLiveRiskReservations(liveDeploymentId, ({ positions }) => positions)).toEqual([
    expect.objectContaining({ notionalUsd: '200' }),
  ]);
});

it('persists an immediate IOC partial fill as terminal cancellation, not a complete fill', async () => {
  const f = createLiveFixture(); databases.push(f.database);
  const info = { meta: vi.fn().mockResolvedValue({ universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }] }),
    allMids: vi.fn().mockResolvedValue({ BTC: '100000' }), userRole: vi.fn(), clearinghouseState: vi.fn(),
    userFills: vi.fn(), orderStatus: vi.fn(),
  };
  const exchange = { order: vi.fn().mockResolvedValue({ status: 'ok', response: { data: { statuses: [
    { filled: { oid: 42, totalSz: '0.002', avgPx: '100000' } },
  ] } } }), cancelByCloid: vi.fn(), updateLeverage: vi.fn() };
  const client = createHyperliquidClient({ agentPrivateKey: `0x${'a'.repeat(64)}` }, {
    createTransport: () => ({}), createInfo: () => info, createExchange: () => exchange,
  });
  await new OutboxExecutor({ repository: f.repository, adapter: new HyperliquidAdapter({ client, account }) })
    .runOnce(liveIdempotencyKey, signal);
  const events = f.repository.listAuditEvents(f.proposal.trace.id);
  expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'execution.partially_filled_cancelled',
    fill: { quantity: '0.002', originalQuantity: '0.005', notionalUsd: '200' },
  })]));
  expect(events.at(-1)?.type).toBe('flow.failed');
  expect(events.some(({ type }) => type === 'execution.filled')).toBe(false);
  expect(exchange.order).toHaveBeenCalledTimes(1);
});

it.each(['canceled', 'rejected'] as const)('records terminal partial %s through SDK, adapter, durable reconciliation and restart', async (status) => {
  const f = createLiveFixture();
  databases.push(f.database);
  const cloid = toHyperliquidCloid(liveClientOrderId);
  const info = {
    meta: vi.fn(), allMids: vi.fn(), userRole: vi.fn(),
    clearinghouseState: vi.fn().mockResolvedValue({ marginSummary: { accountValue: '10000' }, withdrawable: '9000', assetPositions: [] }),
    userFills: vi.fn().mockResolvedValue([{ cloid, oid: 42, hash: 'trade', tid: 1, time: 1000, sz: '0.002', px: '100000' }]),
    orderStatus: vi.fn().mockResolvedValue({ status: 'order', order: {
      status, statusTimestamp: Date.parse('2026-09-05T00:00:02.000Z'),
      order: { cloid, oid: 42, origSz: '0.005', sz: '0.003' },
    } }),
  };
  const client = createHyperliquidPublicClient({}, { createTransport: () => ({}), createInfo: () => info, createExchange: vi.fn() });
  const adapter = new HyperliquidAdapter({ client, account });
  f.repository.claimOutboxItem(liveIdempotencyKey, '2026-09-05T00:00:01.000Z');
  await Promise.all([
    new ReconciliationService({ repository: f.repository, adapter, account }).reconcileDeployment(liveDeploymentId, signal),
    new ReconciliationService({ repository: new ExecutionRepository(f.database), adapter, account }).reconcileDeployment(liveDeploymentId, signal),
  ]);
  const restarted = new ExecutionRepository(f.database);
  const eventType = status === 'canceled' ? 'execution.partially_filled_cancelled' : 'execution.partially_filled_rejected';
  const events = restarted.listAuditEvents(f.proposal.trace.id);
  expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: eventType, fill: {
    quantity: '0.002', originalQuantity: '0.005', notionalUsd: '200',
  } })]));
  expect(events.at(-1)?.type).toBe('flow.failed');
  expect(events.some(({ type }) => type === 'execution.filled' || type === 'flow.completed')).toBe(false);
  expect(restarted.getOutboxItem(liveIdempotencyKey)?.status).toBe('rejected');
  expect(restarted.withLiveRiskReservations(liveDeploymentId, ({ positions }) => positions)).toEqual([
    expect.objectContaining({ market: 'BTC-PERP', side: 'long', notionalUsd: '200' }),
  ]);
  await new ReconciliationService({ repository: restarted, adapter, account }).reconcileDeployment(liveDeploymentId, signal);
  expect(restarted.listAuditEvents(f.proposal.trace.id)).toEqual(events);
  expect(info.orderStatus).toHaveBeenCalledTimes(2);
});

it('bounds fallback status requests and keeps good evidence when one unrelated order fails', async () => {
  let active = 0;
  let maximum = 0;
  const fills = Array.from({ length: 250 }, (_, oid) => ({ oid, cloid: `0x${oid.toString(16).padStart(32, '0')}`,
    hash: `trade-${oid}`, tid: oid, time: 1000, sz: '0.1', px: '100' }));
  const info = { meta: vi.fn(), allMids: vi.fn(), userRole: vi.fn(), clearinghouseState: vi.fn(),
    userFills: vi.fn().mockResolvedValue(fills),
    orderStatus: vi.fn(async ({ oid }: { oid: number | string }) => {
      if (typeof oid !== 'number') throw new Error('Numeric identity expected in fallback');
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active--;
      if (oid === 3) throw new Error('unrelated private provider error');
      return { status: 'order', order: { status: 'filled', statusTimestamp: 1000,
        order: { oid, cloid: fills[oid]!.cloid, origSz: '0.1', sz: '0' } } };
    }),
  };
  const client = createHyperliquidPublicClient({}, { createTransport: () => ({}), createInfo: () => info, createExchange: vi.fn() });
  const events = await client.getUserFills(account, signal);
  expect(maximum).toBeLessThanOrEqual(4);
  expect(events).toHaveLength(249);
  expect(events.some(({ clientOrderId }) => clientOrderId === fills[249]!.cloid)).toBe(true);
  expect(JSON.stringify(events)).not.toContain('private');
});

it('queries only requested unsettled identities and isolates an individual lookup failure', async () => {
  const ids = ['1', '2'].map((id) => `0x${id.repeat(32)}`);
  const info = { meta: vi.fn(), allMids: vi.fn(), userRole: vi.fn(), clearinghouseState: vi.fn(),
    userFills: vi.fn().mockResolvedValue(Array.from({ length: 250 }, (_, oid) => ({ oid }))),
    orderStatus: vi.fn(async ({ oid }: { oid: number | string }) => {
      if (oid === ids[0]) throw new Error('one unavailable identity');
      return { status: 'order', order: { status: 'filled', statusTimestamp: 1000,
        order: { oid: 999, cloid: oid, origSz: '0.1', sz: '0' } } };
    }),
  };
  const client = createHyperliquidPublicClient({}, { createTransport: () => ({}), createInfo: () => info, createExchange: vi.fn() });
  const adapter = new HyperliquidAdapter({ client, account });
  const page = await adapter.getOrderExecutionEvents(ids, signal);
  expect(page.events).toEqual([expect.objectContaining({ type: 'filled', clientOrderId: ids[1] })]);
  expect(info.orderStatus.mock.calls.map(([input]) => input.oid)).toEqual(ids);
});
