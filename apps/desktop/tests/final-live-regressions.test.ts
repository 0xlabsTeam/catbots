import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RiskLimits } from '@catbots/contracts';
import type { ExecutionReceipt, PerpDexAdapter } from '@catbots/execution-core';
import { createEvaluationContext, parseStrategyDocument, type MarketUniverseSnapshot } from '@catbots/strategy-runtime';
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
  await new OutboxExecutor({ repository: f.repository, adapter: venue(item.clientOrderId, 'rejected') })
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
