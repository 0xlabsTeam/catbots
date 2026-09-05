import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BacktestSummary, LocalConfig, RiskLimits } from '@catbots/contracts';
import { createEvaluationContext, parseStrategyDocument } from '@catbots/strategy-runtime';

import { BotRepository } from '../src/main/bots/bot-repository';
import { DeploymentService } from '../src/main/execution/deployment-service';
import { ExecutionRepository } from '../src/main/execution/execution-repository';
import { OutboxExecutor } from '../src/main/execution/outbox-executor';
import type { HyperliquidClientPort } from '../src/main/execution/hyperliquid/hyperliquid-client';
import { openDatabase } from '../src/main/storage/database';
import { migrateDatabase } from '../src/main/storage/migrations';
import { WorkbenchRepository } from '../src/main/workbench/workbench-repository';

const now = '2026-09-05T08:15:00.000Z';
const account = '0x0123456789abcdef0123456789abcdef01234567';
const limits: RiskLimits = {
  maxOrderUsd: '1000', maxPositionUsd: '2500', maxTotalExposureUsd: '5000', maxLeverage: 3, maxDailyLossUsd: '300',
  maxDrawdownPercent: 12, allowedSides: ['long', 'short'], maxOrdersPerMinute: 4,
};
let database: Database.Database;

function secretScan(value: unknown, secret: string): string[] {
  const serialized = JSON.stringify(value);
  return [secret, '"agentPrivateKey"', '"apiKey"', '"authorization"']
    .filter((needle) => serialized.includes(needle));
}

beforeEach(() => { database = openDatabase(':memory:'); migrateDatabase(database); });
afterEach(() => database.close());

describe('DeploymentService Live gate', () => {
  it('binds a fresh successful Agent-wallet preflight to exact inputs and typed confirmation', async () => {
    const botId = new BotRepository(database, () => new Date(now)).createDraft({ name: 'BTC Live', dex: 'hyperliquid' }).id;
    const workbench = new WorkbenchRepository(database, () => new Date(now), randomUUID);
    workbench.createValidatedRevision(botId, parseStrategyDocument({
      schemaVersion: '2.0', strategy: { id: 'btc-live', name: 'BTC Live', version: 1 },
      marketScope: { type: 'dex_universe' },
      nodes: [
        { id: 'clock', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
        { id: 'flat', kind: 'condition', type: 'predicate.position_state', version: 2, config: { state: 'flat' } },
        { id: 'open', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 500 }, leverage: 2 } },
      ],
      edges: [
        { id: 'e1', source: 'clock', sourcePort: 'activation', target: 'flat', targetPort: 'activation' },
        { id: 'e2', source: 'flat', sourcePort: 'result', target: 'open', targetPort: 'condition' },
      ],
    }));
    workbench.approveRevision(botId, 1);
    const baseState = workbench.getState(botId, 1);
    const backtest = { revisionVersion: 1, status: 'completed' } as BacktestSummary;
    const config: LocalConfig = {
      profile: { name: 'Local', telemetry: false },
      llm: { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'local', model: 'qwen' },
      exchanges: { hyperliquid: { network: 'testnet', accountAddress: account, agentPrivateKey: 'agent-secret-sentinel' } },
    };
    const client: HyperliquidClientPort = {
      getMeta: vi.fn(), getAllMids: vi.fn().mockResolvedValue({ BTC: '100000' }),
      getUserRole: vi.fn().mockResolvedValue({ role: 'agent', data: { user: account } }),
      getClearinghouseState: vi.fn().mockResolvedValue({ marginSummary: { accountValue: '1000' }, withdrawable: '500', assetPositions: [] }),
      placeOrder: vi.fn(), cancelByCloid: vi.fn(), updateLeverage: vi.fn(), getUserFills: vi.fn(),
    };
    const ids = vi.fn().mockReturnValueOnce('028f3f75-89ab-7def-8123-456789abcdef').mockReturnValueOnce('038f3f75-89ab-7def-8123-456789abcdef');
    const refresh = vi.fn().mockResolvedValue({
      dex: 'hyperliquid', revision: 'sha256:live-universe', observedAt: now,
      markets: [{ symbol: 'BTC-PERP', active: true, sizeDecimals: 5, maximumLeverage: 40 }],
    });
    const service = new DeploymentService({
      executionRepository: new ExecutionRepository(database),
      workbenchRepository: {
        getState: () => ({ ...baseState, backtests: [backtest] }),
        getStrategyDocument: (requestedBotId, version) => workbench.getStrategyDocument(requestedBotId, version),
        getStoredIdentity: (requestedBotId) => workbench.getStoredIdentity(requestedBotId),
      },
      configRepository: { load: async () => config }, runtimeReady: () => true,
      marketUniverseCache: { refresh, freshness: () => ({ fresh: true }) },
      createHyperliquidClient: () => client, resolveSignerAddress: async () => '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      clock: () => new Date(now), idFactory: ids,
    });

    const preflight = await service.prepareLive({ botId, strategyVersion: 1, riskLimits: limits, network: 'testnet' }, new AbortController().signal);
    expect(preflight.ready).toBe(true);
    expect(JSON.stringify(preflight)).not.toContain('agent-secret-sentinel');
    await expect(service.startLive({ botId, strategyVersion: 1, riskLimits: limits, network: 'testnet', preflightId: preflight.id, confirmationBotName: 'btc live' })).rejects.toThrow(/confirmation/i);

    await expect(service.startLive({ botId, strategyVersion: 1, riskLimits: limits, network: 'testnet', preflightId: preflight.id, confirmationBotName: 'BTC Live' })).resolves.toMatchObject({
      recordVersion: 2, dex: 'hyperliquid', mode: 'live', executionVenue: 'hyperliquid', network: 'testnet',
      status: 'running', maskedAccount: '0x0123…4567', marketAccess: { mode: 'all_active_perpetuals' }, riskLimits: limits,
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('binds coordinator-generated Live actions to each child through risk, outbox, and durable audit', async () => {
    const botId = new BotRepository(database, () => new Date(now)).createDraft({ name: 'Live Coordinator', dex: 'hyperliquid' }).id;
    const workbench = new WorkbenchRepository(database, () => new Date(now), randomUUID);
    workbench.createValidatedRevision(botId, parseStrategyDocument({
      schemaVersion: '2.0', strategy: { id: 'live-coordinator', name: 'Live Coordinator', version: 1 },
      marketScope: { type: 'dex_universe' },
      nodes: [
        { id: 'clock', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
        { id: 'flat', kind: 'condition', type: 'predicate.position_state', version: 2, config: { state: 'flat' } },
        { id: 'open', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 500 }, leverage: 2 } },
        { id: 'oversized', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 2000 }, leverage: 2 } },
      ],
      edges: [
        { id: 'e1', source: 'clock', sourcePort: 'activation', target: 'flat', targetPort: 'activation' },
        { id: 'e2', source: 'flat', sourcePort: 'result', target: 'open', targetPort: 'condition' },
        { id: 'e3', source: 'flat', sourcePort: 'result', target: 'oversized', targetPort: 'condition' },
      ],
    }));
    workbench.approveRevision(botId, 1);
    const repository = new ExecutionRepository(database);
    const deploymentId = '128f3f75-89ab-7def-8123-456789abcdef';
    repository.createDeployment({
      id: deploymentId, botId, strategyId: 'live-coordinator', strategyVersion: 1,
      recordVersion: 2, dex: 'hyperliquid', mode: 'live', executionVenue: 'hyperliquid', network: 'testnet',
      maskedAccount: '0x0123…4567', marketAccess: { mode: 'all_active_perpetuals' }, riskLimits: limits,
      status: 'running', createdAt: now, updatedAt: now,
    });
    const universe = {
      dex: 'hyperliquid' as const, revision: 'sha256:live-two', observedAt: now,
      markets: [
        { symbol: 'BTC-PERP', active: true, sizeDecimals: 5, maximumLeverage: 40 },
        { symbol: 'ETH-PERP', active: true, sizeDecimals: 4, maximumLeverage: 30 },
      ],
    };
    const service = new DeploymentService({
      executionRepository: repository, workbenchRepository: workbench,
      marketUniverseCache: { refresh: async () => universe, freshness: () => ({ fresh: true }) },
      clock: () => new Date(now), idFactory: randomUUID,
    });
    const secret = 'coordinator-secret-sentinel';
    const contextFor = (selectedMarket: string, currentMarket = selectedMarket) => createEvaluationContext({
      evaluatedAt: now, currentMarket,
      values: {
        'account.positions': { value: [], provider: 'live.account', observedAt: now, freshnessSeconds: 0, quality: { status: 'verified' as const }, integrityHash: `sha256:positions:${selectedMarket}` },
        'account.equity': { value: 10000, provider: 'live.account', observedAt: now, freshnessSeconds: 0, quality: { status: 'verified' as const }, integrityHash: 'sha256:equity' },
        'runtime.private-state': {
          value: { apiKey: secret, agentPrivateKey: secret, authorization: `Bearer ${secret}` },
          provider: 'live.runtime', observedAt: now, freshnessSeconds: 0,
          quality: { status: 'verified' as const }, integrityHash: 'sha256:private-state',
        },
      },
    });
    expect(secretScan(contextFor('BTC-PERP'), secret)).toEqual([
      secret, '"agentPrivateKey"', '"apiKey"', '"authorization"',
    ]);
    const riskBindings: Array<{ market: string; currentMarket: string }> = [];
    const request = {
      deploymentId, triggerNodeId: 'clock', triggerInput: { kind: 'interval' as const, occurredAt: now },
      contextFactory: (market: string) => contextFor(market),
      riskAccountFactory: (market: string, context: { currentMarket: string }) => {
        riskBindings.push({ market, currentMarket: context.currentMarket });
        return {
          equityUsd: '10000', dailyRealizedPnlUsd: '0', drawdownPercent: 0, positions: [],
          recentOrderTimestamps: [], accountKillSwitchActive: false, botKillSwitchActive: false,
        };
      },
    };

    const first = await service.ingestLive(request);
    const run = repository.listTriggerRun(first.parentTraceId);
    const generatedBindings = first.children.flatMap((child) => child.evaluation.effects.map((effect) => ({
      childMarket: child.market, effectMarket: effect.market, nodeId: effect.nodeId,
    })));

    expect(first.children.map(({ market }) => market)).toEqual(['BTC-PERP', 'ETH-PERP']);
    expect(generatedBindings).toEqual([
      { childMarket: 'BTC-PERP', effectMarket: 'BTC-PERP', nodeId: 'open' },
      { childMarket: 'BTC-PERP', effectMarket: 'BTC-PERP', nodeId: 'oversized' },
      { childMarket: 'ETH-PERP', effectMarket: 'ETH-PERP', nodeId: 'open' },
      { childMarket: 'ETH-PERP', effectMarket: 'ETH-PERP', nodeId: 'oversized' },
    ]);
    expect(riskBindings).toHaveLength(4);
    expect(riskBindings.every(({ market, currentMarket }) => market === currentMarket)).toBe(true);
    expect(run.children.map(({ market }) => market)).toEqual(['BTC-PERP', 'ETH-PERP']);
    expect(run.children.every(({ status }) => status === 'open')).toBe(true);
    expect(run.children.every(({ events }) => (
      events.filter(({ type }) => type === 'action.proposed').length === 2
      && events.some(({ type, nodeId }) => type === 'risk.approved' && nodeId === 'open')
      && events.some(({ type, nodeId }) => type === 'risk.rejected' && nodeId === 'oversized')
    ))).toBe(true);
    expect(run.children.every(({ events }) => (
      events.some(({ type, nodeId, effect }) => type === 'action.proposed' && nodeId === 'open'
        && effect?.type === 'execution.open_position' && effect.config.size?.value === 500)
      && events.some(({ type, nodeId, effect }) => type === 'action.proposed' && nodeId === 'oversized'
        && effect?.type === 'execution.open_position' && effect.config.size?.value === 2000)
    ))).toBe(true);
    expect(run.children.every((child) => child.events
      .filter(({ type }) => type === 'action.proposed' || type.startsWith('risk.'))
      .every(({ market, effect }) => market === child.market && (effect === undefined || effect.market === child.market))
    )).toBe(true);
    const duplicate = await service.ingestLive(request);
    expect(duplicate).toMatchObject({ duplicate: true, parentTraceId: first.parentTraceId });
    const outboxItems = repository.listOutboxItems(deploymentId);
    expect(outboxItems.map(({ traceId, intent }) => ({ traceId, market: intent.market })))
      .toEqual(run.children.map(({ traceId, market }) => ({ traceId, market })));
    const storedAuditEvents = (database.prepare(`
      SELECT event_json FROM audit_events
      WHERE trace_id IN (SELECT id FROM audit_traces WHERE deployment_id = ?)
      ORDER BY rowid
    `).all(deploymentId) as Array<{ event_json: string }>)
      .map(({ event_json: eventJson }) => JSON.parse(eventJson) as unknown);
    expect(secretScan({
      generatedActions: first.children.flatMap(({ evaluation }) => evaluation.effects),
      generatedAuditDetails: first.children.flatMap(({ evaluation }) => evaluation.trace),
    }, secret)).toEqual([]);
    expect(secretScan({ run, outboxItems, storedAuditEvents }, secret)).toEqual([]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM execution_outbox').get()).toEqual({ count: 2 });
    expect(database.prepare('SELECT COUNT(DISTINCT client_order_id) AS count FROM execution_outbox').get()).toEqual({ count: 2 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM audit_traces').get()).toEqual({ count: 3 });

    const executor = new OutboxExecutor({
      repository,
      adapter: {
        getMarkets: vi.fn(), getBalances: vi.fn(), getPositions: vi.fn(),
        placeOrder: vi.fn(async (intent) => ({
          status: 'filled' as const, clientOrderId: intent.clientOrderId, venueOrderId: `venue:${intent.market}`,
        })),
        cancelOrder: vi.fn(), updateLeverage: vi.fn(), closePosition: vi.fn(), getExecutionEvents: vi.fn(),
      },
    });
    for (const item of repository.listOutboxItems(deploymentId)) {
      await executor.runOnce(item.idempotencyKey, new AbortController().signal);
    }
    const terminalRun = repository.listTriggerRun(first.parentTraceId);
    expect(terminalRun.children.every(({ status, events }) => (
      status === 'failed'
      && events.some(({ type }) => type === 'risk.rejected')
      && events.at(-1)?.type === 'flow.failed'
    ))).toBe(true);

    const mismatched = await service.ingestLive({
      ...request,
      triggerInput: { kind: 'interval', occurredAt: '2026-09-05T08:30:00.000Z' },
      contextFactory: (market: string) => contextFor(market, 'BTC-PERP'),
    });
    const mismatchedRun = repository.listTriggerRun(mismatched.parentTraceId);
    const failedEth = mismatched.children.find(({ market }) => market === 'ETH-PERP');
    expect(failedEth?.evaluation.effects).toEqual([]);
    expect(failedEth?.evaluation.trace.map(({ type }) => type)).toContain('context.failed');
    expect(mismatchedRun.children.find(({ market }) => market === 'ETH-PERP')).toMatchObject({ status: 'failed' });
    expect(repository.listOutboxItems(deploymentId)
      .filter(({ traceId }) => traceId === failedEth?.evaluation.traceId)).toEqual([]);
    expect(mismatched).toMatchObject({ duplicate: false, outboxCount: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM execution_outbox').get()).toEqual({ count: 3 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM audit_traces').get()).toEqual({ count: 6 });

    database.exec(`CREATE TRIGGER force_live_outbox_failure BEFORE INSERT ON execution_outbox
      BEGIN SELECT RAISE(ABORT, 'forced live outbox failure'); END;`);
    await expect(service.ingestLive({
      ...request,
      triggerInput: { kind: 'interval', occurredAt: '2026-09-05T08:45:00.000Z' },
    })).rejects.toThrow(/forced live outbox failure/i);
    expect(database.prepare('SELECT COUNT(*) AS count FROM execution_outbox').get()).toEqual({ count: 3 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM audit_traces').get()).toEqual({ count: 6 });
  });

  it('rejects a legacy strategy before creating a new Live deployment', async () => {
    const botId = new BotRepository(database, () => new Date(now)).createDraft({ name: 'Legacy Live', market: 'BTC-PERP' }).id;
    const workbench = new WorkbenchRepository(database, () => new Date(now), randomUUID);
    workbench.createValidatedRevision(botId, parseStrategyDocument({
      schemaVersion: '1.0', strategy: { id: 'legacy-live', name: 'Legacy Live', version: 1 },
      nodes: [
        { id: 'clock', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
        { id: 'flat', kind: 'condition', type: 'predicate.position_state', version: 1, config: { state: 'flat', market: 'BTC-PERP' } },
      ],
      edges: [{ id: 'e1', source: 'clock', sourcePort: 'activation', target: 'flat', targetPort: 'activation' }],
    }));
    workbench.approveRevision(botId, 1);
    const baseState = workbench.getState(botId, 1);
    const service = new DeploymentService({
      executionRepository: new ExecutionRepository(database),
      workbenchRepository: {
        getState: () => ({ ...baseState, backtests: [{ revisionVersion: 1, status: 'completed' } as BacktestSummary] }),
        getStrategyDocument: (requestedBotId, version) => workbench.getStrategyDocument(requestedBotId, version),
        getStoredIdentity: (requestedBotId) => workbench.getStoredIdentity(requestedBotId),
      },
      configRepository: { load: async () => ({
        profile: { name: 'Local', telemetry: false },
        llm: { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'local', model: 'qwen' },
        exchanges: { hyperliquid: { network: 'testnet', accountAddress: account, agentPrivateKey: 'agent-secret-sentinel' } },
      }) },
      runtimeReady: () => true,
      marketUniverseCache: {
        refresh: vi.fn().mockResolvedValue({ dex: 'hyperliquid', revision: 'sha256:legacy', observedAt: now, markets: [] }),
        freshness: () => ({ fresh: true }),
      },
      createHyperliquidClient: () => ({
        getMeta: vi.fn(), getAllMids: vi.fn().mockResolvedValue({ BTC: '100000' }),
        getUserRole: vi.fn().mockResolvedValue({ role: 'agent', data: { user: account } }),
        getClearinghouseState: vi.fn().mockResolvedValue({ marginSummary: { accountValue: '1000' }, withdrawable: '500', assetPositions: [] }),
        placeOrder: vi.fn(), cancelByCloid: vi.fn(), updateLeverage: vi.fn(), getUserFills: vi.fn(),
      }),
      resolveSignerAddress: async () => '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      clock: () => new Date(now), idFactory: randomUUID,
    });

    await expect(service.prepareLive(
      { botId, strategyVersion: 1, riskLimits: limits, network: 'testnet' },
      new AbortController().signal,
    )).rejects.toThrow('Strategy 2.0 is required');
  });
});
