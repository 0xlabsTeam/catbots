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
  schemaVersion: '1.0', strategy: { id: 's', name: 'Safe strategy', version: 1 },
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
    expect(trace).toMatchObject({ traceId: backtest.traces[0]?.traceId, events: expect.any(Array) });
    expect(repository.getState(botId).currentRevision?.status).toBe('draft');
    await expect(service.approveRevision({ botId, version: 1 })).resolves.toMatchObject({ status: 'approved' });
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
