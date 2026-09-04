import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BotRepository } from '../src/main/bots/bot-repository';
import { createAgentToolCatalog } from '../src/main/agent/agent-tools';
import { openDatabase } from '../src/main/storage/database';
import { migrateDatabase } from '../src/main/storage/migrations';
import { WorkbenchRepository } from '../src/main/workbench/workbench-repository';

let database: Database.Database;
let botId: string;
let repository: WorkbenchRepository;

const validStrategy = {
  schemaVersion: '1.0',
  strategy: { id: 'momentum', name: 'Momentum', version: 1 },
  nodes: [
    { id: 'clock', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '1h', alignment: 'utc' } },
    { id: 'price', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'market.price', field: 'mark' }, operator: 'gt', right: { literal: 90 } } },
    { id: 'buy', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 1000 } } },
  ],
  edges: [
    { id: 'e1', source: 'clock', sourcePort: 'activation', target: 'price', targetPort: 'activation' },
    { id: 'e2', source: 'price', sourcePort: 'result', target: 'buy', targetPort: 'condition' },
  ],
};

beforeEach(() => {
  database = openDatabase(':memory:');
  migrateDatabase(database);
  botId = new BotRepository(database, () => new Date('2026-09-04T00:00:00.000Z')).createDraft({ name: 'Bot', market: 'BTC-PERP' }).id;
  repository = new WorkbenchRepository(database, () => new Date('2026-09-04T00:00:00.000Z'), randomUUID);
});

afterEach(() => database.close());

describe('Agent tool catalog', () => {
  it('exposes exactly the six approved tools with strict object schemas', () => {
    const catalog = createAgentToolCatalog({ botId, market: 'BTC-PERP', repository });

    expect(catalog.definitions.map(({ name }) => name)).toEqual([
      'list_nodes', 'list_data_products', 'validate_strategy', 'backtest_strategy', 'explain_strategy', 'compare_versions',
    ]);
    expect(catalog.definitions.every(({ inputSchema }) => inputSchema.additionalProperties === false)).toBe(true);
  });

  it('validates and persists only structurally valid strategies', () => {
    const catalog = createAgentToolCatalog({ botId, market: 'BTC-PERP', repository });

    const invalid = catalog.execute('validate_strategy', { strategy: { ...validStrategy, edges: [] } });
    const valid = catalog.execute('validate_strategy', { strategy: validStrategy });

    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_STRATEGY' } });
    expect(valid).toMatchObject({ ok: true, revision: { version: 1, status: 'draft' } });
    expect(repository.getState(botId).revisions).toHaveLength(1);
  });

  it('rejects unknown tools and malformed arguments with stable structured errors', () => {
    const catalog = createAgentToolCatalog({ botId, market: 'BTC-PERP', repository });

    expect(catalog.execute('delete_everything', {})).toEqual({ ok: false, error: { code: 'UNKNOWN_TOOL', message: 'Tool is not available.' } });
    expect(catalog.execute('backtest_strategy', { revisionVersion: -1 })).toMatchObject({ ok: false, error: { code: 'INVALID_TOOL_ARGUMENTS' } });
  });

  it('runs a deterministic sample backtest and stores its trace artifact', () => {
    const catalog = createAgentToolCatalog({ botId, market: 'BTC-PERP', repository });
    catalog.execute('validate_strategy', { strategy: validStrategy });

    const result = catalog.execute('backtest_strategy', {
      revisionVersion: 1,
      assumptions: {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
        startingCapital: '10000',
        feeRateBps: 3.5,
        slippageBps: 1,
      },
    });

    expect(result).toMatchObject({ ok: true, backtest: { dataSource: 'Bundled sample data', revisionVersion: 1, status: 'completed' } });
    expect(repository.getState(botId).backtests).toHaveLength(1);
  });

  it('explains and compares immutable revisions without exposing config JSON', () => {
    const catalog = createAgentToolCatalog({ botId, market: 'BTC-PERP', repository });
    catalog.execute('validate_strategy', { strategy: validStrategy });
    catalog.execute('validate_strategy', { strategy: { ...validStrategy, strategy: { ...validStrategy.strategy, name: 'Momentum v2' } } });

    const explanation = catalog.execute('explain_strategy', { revisionVersion: 1 });
    const comparison = catalog.execute('compare_versions', { leftVersion: 1, rightVersion: 2 });

    expect(explanation).toMatchObject({ ok: true, explanation: expect.stringContaining('Interval') });
    expect(comparison).toMatchObject({ ok: true, comparison: expect.stringContaining('Momentum v2') });
    expect(JSON.stringify([explanation, comparison])).not.toContain('startingCapital');
  });
});
