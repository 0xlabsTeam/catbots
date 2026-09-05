import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RiskLimits } from '@catbots/contracts';
import type { ExecutionReceipt, PerpDexAdapter } from '@catbots/execution-core';
import { coordinateEvaluation, createBuiltinRegistry, createEvaluationContext, parseStrategyDocument, validateStrategy, type MarketUniverseSnapshot } from '@catbots/strategy-runtime';
import { BotRepository } from '../src/main/bots/bot-repository';
import { DeploymentService } from '../src/main/execution/deployment-service';
import { ExecutionRepository } from '../src/main/execution/execution-repository';
import { OutboxExecutor } from '../src/main/execution/outbox-executor';
import { ReconciliationService } from '../src/main/execution/reconciliation-service';
import { openDatabase } from '../src/main/storage/database';
import { migrateDatabase } from '../src/main/storage/migrations';
import { WorkbenchRepository } from '../src/main/workbench/workbench-repository';

const now = '2026-09-05T08:15:00.000Z';
const limits: RiskLimits = {
  maxOrderUsd: '1000', maxPositionUsd: '2500', maxTotalExposureUsd: '1000', maxLeverage: 3,
  maxDailyLossUsd: '300', maxDrawdownPercent: 12, allowedSides: ['long', 'short'], maxOrdersPerMinute: 4,
};
let database: Database.Database;
beforeEach(() => { database = openDatabase(':memory:'); migrateDatabase(database); });
afterEach(() => database.close());

function fixture(close = false, riskLimits = limits, eventTrigger = false) {
  const workbench = new WorkbenchRepository(database);
  const repository = new ExecutionRepository(database);
  const botId = new BotRepository(database).createDraft({ name: 'Final regression', dex: 'hyperliquid' }).id;
  workbench.createValidatedRevision(botId, parseStrategyDocument({
    schemaVersion: '2.0', strategy: { id: 'final', name: 'Final regression', version: 1 }, marketScope: { type: 'dex_universe' },
    nodes: [
      { id: 'clock', kind: 'trigger', type: eventTrigger ? 'trigger.event' : 'trigger.interval', version: 1,
        config: eventTrigger ? { eventType: 'market.trade', filters: {} } : { every: '15m', alignment: 'utc' } },
      { id: 'yes', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { literal: 1 }, operator: 'eq', right: { literal: 1 } } },
      { id: 'order', kind: 'action', type: close ? 'execution.close_position' : 'execution.open_position', version: 1,
        config: close ? {} : { side: 'long', size: { type: 'quote', value: 700 }, leverage: 2 } },
    ],
    edges: [
      { id: 'e1', source: 'clock', sourcePort: 'activation', target: 'yes', targetPort: 'activation' },
      { id: 'e2', source: 'yes', sourcePort: 'result', target: 'order', targetPort: 'condition' },
    ],
  }));
  workbench.approveRevision(botId, 1);
  const deployment = repository.createDeployment({
    id: randomUUID(), botId, strategyId: 'final', strategyVersion: 1, recordVersion: 2, dex: 'hyperliquid',
    mode: 'live', executionVenue: 'hyperliquid', network: 'testnet', maskedAccount: '0x0123…4567',
    marketAccess: { mode: 'all_active_perpetuals' }, riskLimits, status: 'running', createdAt: now, updatedAt: now,
  });
  const universe: MarketUniverseSnapshot = {
    dex: 'hyperliquid', revision: 'first', observedAt: now,
    markets: [{ symbol: 'BTC-PERP', active: true, sizeDecimals: 5, maximumLeverage: 40 }],
  };
  const refresh = vi.fn(async () => universe);
  const service = new DeploymentService({ executionRepository: repository, workbenchRepository: workbench,
    marketUniverseCache: { refresh, freshness: () => ({ fresh: true }) } });
  const account = {
    equityUsd: '10000', dailyRealizedPnlUsd: '0', drawdownPercent: 0,
    positions: close ? [{ market: 'BTC-PERP', side: 'long' as const, notionalUsd: '700' }] : [],
    recentOrderTimestamps: [] as string[], accountKillSwitchActive: false, botKillSwitchActive: false,
  };
  const request = (occurredAt = now, eventId = occurredAt) => ({
    deploymentId: deployment.id, triggerNodeId: 'clock', triggerInput: eventTrigger
      ? { kind: 'event' as const, event: { id: eventId, type: 'market.trade', market: 'BTC-PERP', occurredAt,
        receivedAt: occurredAt, source: 'test.market', payload: {}, quality: { status: 'verified' as const, freshnessSeconds: 0 } } }
      : { kind: 'interval' as const, occurredAt },
    contextFactory: (market: string) => createEvaluationContext({ evaluatedAt: occurredAt, currentMarket: market, values: {} }),
    riskAccountFactory: () => account,
  });
  return { repository, workbench, service, deployment, universe, refresh, request, account };
}

function venue(clientOrderId: string, status: ExecutionReceipt['status']): PerpDexAdapter {
  return {
    getMarkets: vi.fn(), getBalances: vi.fn(), getPositions: vi.fn().mockResolvedValue([]),
    placeOrder: vi.fn().mockResolvedValue({ status, clientOrderId }),
    cancelOrder: vi.fn(), updateLeverage: vi.fn(), closePosition: vi.fn(), getExecutionEvents: vi.fn(),
  };
}

it('queues a validated close with omitted percent as a full close', async () => {
  const f = fixture(true);
  const result = await f.service.ingestLive(f.request());
  expect(result.outboxCount).toBe(1);
  expect(f.repository.listOutboxItems(f.deployment.id)[0]?.intent).toMatchObject({ type: 'close_position', percent: 100 });
});

it('rate-limits delayed queued submissions atomically by claim time across restart without starving the queue', async () => {
  const f = fixture(false, { ...limits, maxTotalExposureUsd: '5000', maxOrdersPerMinute: 1 });
  const arrivalOrder = ['2026-09-05T08:30:00.000Z', '2026-09-05T08:45:00.000Z', now];
  for (const timestamp of arrivalOrder) {
    expect((await f.service.ingestLive(f.request(timestamp))).outboxCount).toBe(1);
  }
  const items = arrivalOrder.map((timestamp) => f.repository.listOutboxItems(f.deployment.id).find(({ createdAt }) => createdAt === timestamp)!);
  let submissionTime = '2026-09-05T09:00:00.000Z';
  const adapter = venue('', 'acknowledged');
  vi.mocked(adapter.placeOrder).mockImplementation(async (intent) => ({ status: 'acknowledged', clientOrderId: intent.clientOrderId }));
  const executor = new OutboxExecutor({ repository: f.repository, adapter, clock: () => new Date(submissionTime) });
  // A later item may be polled first, but cannot steal the oldest pending reservation.
  expect((await executor.runOnce(items[2]!.idempotencyKey, new AbortController().signal)).status).toBe('pending');
  await Promise.all(items.map((item) => executor.runOnce(item.idempotencyKey, new AbortController().signal)));
  expect(adapter.placeOrder).toHaveBeenCalledTimes(1);
  expect(items.map(({ idempotencyKey }) => f.repository.getOutboxItem(idempotencyKey)?.status)).toEqual(['acknowledged', 'pending', 'pending']);
  const restarted = new OutboxExecutor({ repository: new ExecutionRepository(database), adapter, clock: () => new Date(submissionTime) });
  await restarted.runOnce(items[1]!.idempotencyKey, new AbortController().signal);
  expect(adapter.placeOrder).toHaveBeenCalledTimes(1);
  submissionTime = '2026-09-05T09:01:00.000Z';
  await restarted.runOnce(items[1]!.idempotencyKey, new AbortController().signal);
  submissionTime = '2026-09-05T09:02:00.000Z';
  await restarted.runOnce(items[2]!.idempotencyKey, new AbortController().signal);
  expect(adapter.placeOrder).toHaveBeenCalledTimes(3);
  expect(items.map(({ idempotencyKey }) => {
    const item = f.repository.getOutboxItem(idempotencyKey)!;
    return [item.attempts, item.claimedAt];
  })).toEqual([
    [1, '2026-09-05T09:00:00.000Z'], [1, '2026-09-05T09:01:00.000Z'], [1, '2026-09-05T09:02:00.000Z'],
  ]);
});

it('keeps an in-flight submission reservation occupied beyond a minute and through its receipt window', async () => {
  const f = fixture(false, { ...limits, maxTotalExposureUsd: '5000', maxOrdersPerMinute: 1 });
  await f.service.ingestLive(f.request());
  await f.service.ingestLive(f.request('2026-09-05T08:30:00.000Z'));
  const [first, second] = f.repository.listOutboxItems(f.deployment.id);
  let submissionTime = '2026-09-05T09:00:00.000Z';
  let resolveReceipt!: (receipt: ExecutionReceipt) => void;
  const adapter = venue('', 'acknowledged');
  vi.mocked(adapter.placeOrder).mockImplementationOnce(() => new Promise((resolve) => { resolveReceipt = resolve; }))
    .mockImplementation(async (intent) => ({ status: 'acknowledged', clientOrderId: intent.clientOrderId }));
  const executor = new OutboxExecutor({ repository: f.repository, adapter, clock: () => new Date(submissionTime) });
  const inFlight = executor.runOnce(first!.idempotencyKey, new AbortController().signal);
  submissionTime = '2026-09-05T09:02:00.000Z';
  const restarted = new OutboxExecutor({ repository: new ExecutionRepository(database), adapter, clock: () => new Date(submissionTime) });
  expect((await restarted.runOnce(second!.idempotencyKey, new AbortController().signal)).status).toBe('pending');
  resolveReceipt({ status: 'acknowledged', clientOrderId: first!.clientOrderId });
  await inFlight;
  expect((await restarted.runOnce(second!.idempotencyKey, new AbortController().signal)).status).toBe('pending');
  submissionTime = '2026-09-05T09:03:00.000Z';
  expect((await restarted.runOnce(second!.idempotencyKey, new AbortController().signal)).status).toBe('acknowledged');
  expect(adapter.placeOrder).toHaveBeenCalledTimes(2);
});

it('deduplicates a trigger occurrence after universe revision changes and keeps the first evidence', async () => {
  const f = fixture();
  const first = await f.service.ingestLive(f.request());
  f.refresh.mockResolvedValue({ ...f.universe, revision: 'second', markets: [...f.universe.markets,
    { symbol: 'ETH-PERP', active: true, sizeDecimals: 4, maximumLeverage: 30 }] });
  const retry = await f.service.ingestLive(f.request());
  expect(retry).toMatchObject({ duplicate: true, parentTraceId: first.parentTraceId, outboxCount: 0 });
  expect(f.repository.listOutboxItems(f.deployment.id)).toHaveLength(1);
  expect(f.repository.listTriggerRun(first.parentTraceId).parent.universeRevision).toBe('first');
});

it('retains a legacy durable parent identity when retrying after the encoded-key upgrade', async () => {
  const f = fixture();
  const validation = validateStrategy(f.workbench.getStrategyDocument(f.deployment.botId, 1), createBuiltinRegistry());
  if (!validation.valid) throw new Error('Fixture must compile');
  const contexts = new Map([['BTC-PERP', f.request().contextFactory('BTC-PERP')]]);
  const source = coordinateEvaluation({ compiled: validation.compiled, triggerNodeId: 'clock',
    triggerInput: f.request().triggerInput, universe: f.universe, deployment: { id: f.deployment.id, mode: 'live' },
    contextFactory: (market) => contexts.get(market)!, execution: { execute: () => ({ events: [
      { type: 'risk.rejected', metadata: { violatedRuleIds: ['max-total-exposure-usd'] } },
    ] }) },
  });
  const oldParent = `trace:final:v1:deployment:${f.deployment.id}:clock:interval:${now}:dex:hyperliquid:strategy:final:v1`;
  const legacy = JSON.parse(JSON.stringify(source).replaceAll(source.parentTraceId, oldParent));
  f.repository.recordCoordinatedTrace(f.deployment.id, legacy, { universe: f.universe, contexts });
  const before = f.repository.listTriggerRun(oldParent);
  f.refresh.mockResolvedValue({ ...f.universe, revision: 'second' });
  const retry = await f.service.ingestLive(f.request());
  expect(retry).toMatchObject({ duplicate: true, parentTraceId: oldParent, outboxCount: 0 });
  expect(f.repository.listTriggerRun(oldParent)).toEqual(before);
  expect(f.repository.listOutboxItems(f.deployment.id)).toEqual([]);
});

it('reserves unsettled Live exposure durably across three ingestion calls', async () => {
  const f = fixture();
  expect((await f.service.ingestLive(f.request())).outboxCount).toBe(1);
  const restarted = new DeploymentService({ executionRepository: f.repository, workbenchRepository: f.workbench,
    marketUniverseCache: { refresh: f.refresh, freshness: () => ({ fresh: true }) } });
  const second = await restarted.ingestLive(f.request('2026-09-05T08:30:00.000Z'));
  const third = await restarted.ingestLive(f.request('2026-09-05T08:45:00.000Z'));
  expect([second.outboxCount, third.outboxCount]).toEqual([0, 0]);
  expect(f.repository.listOutboxItems(f.deployment.id).map(({ intent }) => intent)).toHaveLength(1);
  expect(f.repository.listTriggerRun(third.parentTraceId).children[0]?.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'risk.rejected', riskRuleIds: ['max-total-exposure-usd'] }),
  ]));
});

it.each(['claimed', 'unknown', 'acknowledged'] as const)('retains %s exposure across ingestion calls', async (status) => {
  const f = fixture();
  await f.service.ingestLive(f.request());
  const item = f.repository.listOutboxItems(f.deployment.id)[0]!;
  if (status === 'claimed') f.repository.claimOutboxItem(item.idempotencyKey, now);
  else await new OutboxExecutor({ repository: f.repository, adapter: venue(item.clientOrderId, status) })
    .runOnce(item.idempotencyKey, new AbortController().signal).catch(() => undefined);
  expect(f.repository.getOutboxItem(item.idempotencyKey)?.status).toBe(status);
  expect((await f.service.ingestLive(f.request('2026-09-05T08:30:00.000Z'))).outboxCount).toBe(0);
});

it('releases rejected exposure but retains durable order-rate reservations until the window expires', async () => {
  const f = fixture(false, { ...limits, maxOrdersPerMinute: 1 }, true);
  await f.service.ingestLive(f.request(now, 'first'));
  const item = f.repository.listOutboxItems(f.deployment.id)[0]!;
  await new OutboxExecutor({ repository: f.repository, adapter: venue(item.clientOrderId, 'rejected'), clock: () => new Date(now) })
    .runOnce(item.idempotencyKey, new AbortController().signal);
  const second = await f.service.ingestLive(f.request('2026-09-05T08:15:30.000Z', 'second'));
  expect(second.outboxCount).toBe(0);
  expect(f.repository.listTriggerRun(second.parentTraceId).children[0]?.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'risk.rejected', riskRuleIds: ['max-orders-per-minute'] }),
  ]));
  expect((await f.service.ingestLive(f.request('2026-09-05T08:16:01.000Z', 'third'))).outboxCount).toBe(1);
});

it('does not double reserve confirmed fills already reflected in the trusted account', async () => {
  const f = fixture(false, { ...limits, maxTotalExposureUsd: '1500' });
  await f.service.ingestLive(f.request());
  const item = f.repository.listOutboxItems(f.deployment.id)[0]!;
  await new OutboxExecutor({ repository: f.repository, adapter: venue(item.clientOrderId, 'filled') })
    .runOnce(item.idempotencyKey, new AbortController().signal);
  f.account.positions.push({ market: 'BTC-PERP', side: 'long', notionalUsd: '700' });
  expect((await f.service.ingestLive(f.request('2026-09-05T08:30:00.000Z'))).outboxCount).toBe(1);
});

it('retains terminal partial exposure until the trusted position snapshot includes that outcome', async () => {
  const f = fixture();
  await f.service.ingestLive(f.request());
  const item = f.repository.listOutboxItems(f.deployment.id)[0]!;
  const adapter = venue(item.clientOrderId, 'acknowledged');
  await new OutboxExecutor({ repository: f.repository, adapter, clock: () => new Date(now) })
    .runOnce(item.idempotencyKey, new AbortController().signal);
  vi.mocked(adapter.getExecutionEvents).mockResolvedValue({ events: [{
    id: 'partial-terminal', clientOrderId: item.clientOrderId, type: 'cancelled',
    occurredAt: '2026-09-05T08:15:01.000Z', filledQuantity: '0.002', originalQuantity: '0.007', filledNotionalUsd: '200',
  }], cursor: null });
  await new ReconciliationService({ repository: f.repository, adapter, account: 'test' })
    .reconcileDeployment(f.deployment.id, new AbortController().signal);
  expect(f.repository.withLiveRiskReservations(f.deployment.id, ({ positions }) => positions)).toEqual([
    expect.objectContaining({ notionalUsd: '200' }),
  ]);
  f.account.positions.push({ market: 'BTC-PERP', side: 'long', notionalUsd: '200' });
  expect((await f.service.ingestLive(f.request('2026-09-05T08:30:00.000Z'))).outboxCount).toBe(0);
  const next = f.request('2026-09-05T08:45:00.000Z');
  expect((await f.service.ingestLive({ ...next, riskAccountFactory: () => ({
    ...f.account, positionsObservedAt: '2026-09-05T08:44:59.000Z',
  }) })).outboxCount).toBe(1);
});

it('rejects increases when a trusted active snapshot cannot be refreshed', async () => {
  const f = fixture();
  await f.service.ingestLive(f.request());
  f.refresh.mockRejectedValue(new Error('metadata offline'));
  const offline = await f.service.ingestLive(f.request('2026-09-05T08:30:00.000Z'));
  expect(offline.outboxCount).toBe(0);
  expect(f.repository.listTriggerRun(offline.parentTraceId).children[0]?.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'risk.rejected', riskRuleIds: ['market-metadata-stale'] }),
  ]));
});

it('persists queue evidence and waits for a confirmed fill after acknowledgement, including restart', async () => {
  const f = fixture();
  const result = await f.service.ingestLive(f.request());
  const item = f.repository.listOutboxItems(f.deployment.id)[0]!;
  expect(f.repository.listAuditEvents(item.traceId).map(({ type }) => type)).toContain('execution.queued');
  const adapter: PerpDexAdapter = {
    getMarkets: vi.fn(), getBalances: vi.fn(), getPositions: vi.fn().mockResolvedValue([]),
    placeOrder: vi.fn().mockResolvedValue({ status: 'acknowledged', clientOrderId: item.clientOrderId }),
    cancelOrder: vi.fn(), updateLeverage: vi.fn(), closePosition: vi.fn(),
    getExecutionEvents: vi.fn().mockResolvedValue({ events: [
      { id: 'fill', clientOrderId: item.clientOrderId, type: 'filled', occurredAt: now, filledQuantity: '0.007', averagePrice: '100000' },
    ], cursor: null }),
  };
  await new OutboxExecutor({ repository: f.repository, adapter }).runOnce(item.idempotencyKey, new AbortController().signal);
  expect(f.repository.listTriggerRun(result.parentTraceId).children[0]?.status).toBe('open');
  expect(f.repository.listAuditEvents(item.traceId).map(({ type }) => type)).not.toContain('execution.filled');
  const restarted = new ExecutionRepository(database);
  const reconciliation = new ReconciliationService({ repository: restarted, adapter, account: 'test-account' });
  await reconciliation.reconcileDeployment(f.deployment.id, new AbortController().signal);
  await reconciliation.reconcileDeployment(f.deployment.id, new AbortController().signal);
  expect(restarted.listTriggerRun(result.parentTraceId).children[0]?.status).toBe('completed');
  const types = restarted.listAuditEvents(item.traceId).map(({ type }) => type);
  expect(types.filter((type) => type === 'execution.filled')).toHaveLength(1);
  expect(types.filter((type) => type === 'flow.completed')).toHaveLength(1);
  expect(adapter.placeOrder).toHaveBeenCalledOnce();
});

it('records a final adapter fill and closes the child without a second venue query', async () => {
  const f = fixture();
  const result = await f.service.ingestLive(f.request());
  const item = f.repository.listOutboxItems(f.deployment.id)[0]!;
  const adapter: PerpDexAdapter = {
    getMarkets: vi.fn(), getBalances: vi.fn(), getPositions: vi.fn(),
    placeOrder: vi.fn().mockResolvedValue({ status: 'filled', clientOrderId: item.clientOrderId }),
    cancelOrder: vi.fn(), updateLeverage: vi.fn(), closePosition: vi.fn(), getExecutionEvents: vi.fn(),
  };
  await new OutboxExecutor({ repository: f.repository, adapter }).runOnce(item.idempotencyKey, new AbortController().signal);
  expect(f.repository.listTriggerRun(result.parentTraceId).children[0]?.status).toBe('completed');
  expect(f.repository.listAuditEvents(item.traceId).map(({ type }) => type).slice(-2)).toEqual(['execution.filled', 'flow.completed']);
});

it('evaluates held inactive markets for closes and preserves that path on metadata refresh failure', async () => {
  const f = fixture(true);
  f.refresh.mockResolvedValue({ ...f.universe, revision: 'inactive', markets: f.universe.markets.map((market) => ({ ...market, active: false })) });
  const inactive = await f.service.ingestLive(f.request());
  expect(inactive.children.map(({ market }) => market)).toEqual(['BTC-PERP']);
  expect(inactive.outboxCount).toBe(1);
  f.refresh.mockRejectedValue(new Error('metadata offline'));
  const offline = await f.service.ingestLive(f.request('2026-09-05T08:30:00.000Z'));
  expect(offline.outboxCount).toBe(1);
  expect(offline.children[0]?.evaluation.effects[0]?.type).toBe('execution.close_position');
});
