import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BacktestSummary, LocalConfig, RiskLimits } from '@catbots/contracts';
import { parseStrategyDocument } from '@catbots/strategy-runtime';

import { BotRepository } from '../src/main/bots/bot-repository';
import { DeploymentService } from '../src/main/execution/deployment-service';
import { ExecutionRepository } from '../src/main/execution/execution-repository';
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
