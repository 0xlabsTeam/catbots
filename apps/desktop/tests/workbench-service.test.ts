import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseStrategyDocument } from '@catbots/strategy-runtime';
import type { CompatibleChatProvider } from '../src/main/llm/compatible-chat-provider';

import { BotRepository } from '../src/main/bots/bot-repository';
import { openDatabase } from '../src/main/storage/database';
import { migrateDatabase } from '../src/main/storage/migrations';
import { WorkbenchRepository } from '../src/main/workbench/workbench-repository';
import { WorkbenchService } from '../src/main/workbench/workbench-service';

let database: Database.Database;
let botId: string;
let repository: WorkbenchRepository;

const strategy = parseStrategyDocument({
  schemaVersion: '2.0', strategy: { id: 's', name: 'Safe strategy', version: 1 },
  marketScope: { type: 'dex_universe' },
  nodes: [
    { id: 't', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '1h', alignment: 'utc' } },
    { id: 'c', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { literal: 2 }, operator: 'gt', right: { literal: 1 } } },
    { id: 'a', kind: 'action', type: 'state.set', version: 1, config: { key: 'signal', value: true } },
  ],
  edges: [
    { id: 'e1', source: 't', sourcePort: 'activation', target: 'c', targetPort: 'activation' },
    { id: 'e2', source: 'c', sourcePort: 'result', target: 'a', targetPort: 'condition' },
  ],
});

const legacyOpeningStrategy = parseStrategyDocument({
  schemaVersion: '1.0',
  strategy: { id: 'legacy-open', name: 'Legacy BTC open', version: 1 },
  nodes: [
    { id: 't', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '1h', alignment: 'utc' } },
    { id: 'c', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { literal: 2 }, operator: 'gt', right: { literal: 1 } } },
    { id: 'a', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 100 } } },
  ],
  edges: [
    { id: 'e1', source: 't', sourcePort: 'activation', target: 'c', targetPort: 'activation' },
    { id: 'e2', source: 'c', sourcePort: 'result', target: 'a', targetPort: 'condition' },
  ],
});

beforeEach(() => {
  database = openDatabase(':memory:');
  migrateDatabase(database);
  botId = new BotRepository(database).createDraft({ name: 'Bot', market: 'BTC-PERP' }).id;
  repository = new WorkbenchRepository(database);
});

afterEach(() => database.close());

function createService(provider: CompatibleChatProvider = { complete: vi.fn(async () => ({ text: 'What is your exit rule?', toolCalls: [] })) }) {
  return new WorkbenchService({
    repository,
    configRepository: { load: vi.fn(async () => ({
      profile: { name: 'Local', telemetry: false },
      llm: { provider: 'openai-compatible' as const, baseUrl: 'https://api.example/v1', apiKey: 'main-only-secret', model: 'model' },
      exchanges: {},
    })) },
    providerFactory: vi.fn(() => provider),
    idFactory: randomUUID,
  });
}

describe('WorkbenchService', () => {
  it('sends messages for a DEX-scoped bot without a legacy market dependency', async () => {
    const dynamicBot = new BotRepository(database).createDraft({ name: 'Dynamic Bot', dex: 'hyperliquid' });
    const provider = { complete: vi.fn(async () => ({ text: 'Which markets should I screen?', toolCalls: [] })) };
    const service = createService(provider);

    const state = await service.sendMessage({ botId: dynamicBot.id, message: 'Build momentum' });

    expect(state.bot).toMatchObject({ dex: 'hyperliquid' });
    expect(provider.complete).toHaveBeenCalledOnce();
  });

  it('loads Main-only provider settings and returns sanitized Agent state', async () => {
    const provider = { complete: vi.fn(async () => ({ text: 'What is your exit rule?', toolCalls: [] })) };
    const service = createService(provider);

    const state = await service.sendMessage({ botId, message: 'Build momentum' });

    expect(provider.complete).toHaveBeenCalledOnce();
    expect(state.messages.at(-1)?.content).toBe('What is your exit rule?');
    expect(JSON.stringify(state)).not.toContain('main-only-secret');
  });

  it('runs sample backtests, returns trace details, and approves only on explicit call', async () => {
    repository.createValidatedRevision(botId, strategy);
    const service = createService();

    const backtest = await service.runBacktest({
      botId,
      revisionVersion: 1,
      marketUniverse: { mode: 'all_available' },
      assumptions: {
        from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', startingCapital: '10000', feeRateBps: 3.5, slippageBps: 1,
      },
    });
    const trace = await service.getTrace({ botId, traceId: backtest.traces[0]?.traceId ?? '' });

    expect(backtest.dataSource).toBe('Bundled sample data');
    expect(backtest.datasetCoverage.markets).toEqual(['BTC-PERP', 'ETH-PERP']);
    expect(backtest.perMarket.map(({ market }) => market)).toEqual(['BTC-PERP', 'ETH-PERP']);
    expect(trace).toMatchObject({ traceId: backtest.traces[0]?.traceId, events: expect.any(Array) });
    expect(repository.getState(botId).currentRevision?.status).toBe('draft');
    await expect(service.approveRevision({ botId, version: 1 })).resolves.toMatchObject({ status: 'approved' });
  });

  it('keeps a Strategy 1.0 backtest bound to its trusted legacy BTC market', async () => {
    repository.createValidatedRevision(botId, legacyOpeningStrategy);
    const service = createService();

    const backtest = await service.runBacktest({
      botId,
      revisionVersion: 1,
      marketUniverse: { mode: 'all_available' },
      assumptions: {
        from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', startingCapital: '10000', feeRateBps: 0, slippageBps: 0,
      },
    });
    const artifact = JSON.parse(repository.getTraceArtifact(botId, backtest.artifactHash)) as {
      snapshot: { positions: Array<{ market: string }> };
    };

    expect(backtest.perMarket.map(({ market }) => market)).toEqual(['BTC-PERP']);
    expect(new Set(backtest.traces.map(({ market }) => market))).toEqual(new Set(['BTC-PERP']));
    expect(new Set(artifact.snapshot.positions.map(({ market }) => market))).toEqual(new Set(['BTC-PERP']));
  });

  it('fails closed when a Strategy 1.0 revision has no trusted legacy market binding', async () => {
    const dynamicBot = new BotRepository(database).createDraft({ name: 'Unbound legacy', dex: 'hyperliquid' });
    repository.createValidatedRevision(dynamicBot.id, legacyOpeningStrategy);
    const service = createService();

    await expect(service.runBacktest({
      botId: dynamicBot.id,
      revisionVersion: 1,
      marketUniverse: { mode: 'all_available' },
      assumptions: {
        from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', startingCapital: '10000', feeRateBps: 0, slippageBps: 0,
      },
    })).rejects.toThrow('LEGACY_STRATEGY_MARKET_MIGRATION_REQUIRED');
  });

  it('publishes validated activity and removes subscribers', async () => {
    const service = createService();
    const listener = vi.fn();
    const unsubscribe = service.subscribeActivity(listener);

    await service.sendMessage({ botId, message: 'Hello' });
    unsubscribe();
    await service.sendMessage({ botId, message: 'Again' });

    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls.every(([activity]) => activity.botId === botId)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
