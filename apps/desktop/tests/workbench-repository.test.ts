import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BacktestSummary } from '@catbots/contracts';
import { parseStrategyDocument, type StrategyDocument } from '@catbots/strategy-runtime';

import { BotRepository } from '../src/main/bots/bot-repository';
import { openDatabase } from '../src/main/storage/database';
import { migrateDatabase } from '../src/main/storage/migrations';
import { WorkbenchRepository } from '../src/main/workbench/workbench-repository';

let database: Database.Database;
let botId: string;
let now: Date;
let repository: WorkbenchRepository;

function strategy(name = 'ETF flow momentum'): StrategyDocument {
  return parseStrategyDocument({
    schemaVersion: '1.0',
    strategy: { id: 'etf-flow-momentum', name, version: 99 },
    nodes: [
      { id: 'clock', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '1h', alignment: 'utc' } },
      { id: 'price', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'market.price' }, operator: 'gt', right: { literal: 100 } } },
      { id: 'buy', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long' } },
    ],
    edges: [
      { id: 'clock-price', source: 'clock', sourcePort: 'activation', target: 'price', targetPort: 'activation' },
      { id: 'price-buy', source: 'price', sourcePort: 'result', target: 'buy', targetPort: 'condition' },
    ],
  });
}

function backtestSummary(revisionVersion: number, artifact: string): BacktestSummary {
  return {
    id: randomUUID(),
    botId,
    revisionVersion,
    status: 'completed',
    dataSource: 'Bundled sample data',
    startedAt: '2026-09-01T00:00:00.000Z',
    completedAt: '2026-09-01T00:01:00.000Z',
    assumptions: {
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      startingCapital: '10000',
      feeRateBps: 3.5,
      slippageBps: 1,
    },
    metrics: {
      returnPercent: 4.2,
      maximumDrawdownPercent: 1.1,
      sharpeLike: 1.4,
      winRatePercent: 60,
      tradeCount: 5,
      fees: '12.34',
      funding: '-1.25',
    },
    equityCurve: [
      { timestamp: '2026-08-01T00:00:00.000Z', equity: '10000' },
      { timestamp: '2026-09-01T00:00:00.000Z', equity: '10420' },
    ],
    trades: [],
    warnings: ['Sample data is not live market data.'],
    traces: [{ traceId: 'trace-1', outcome: 'executed', occurredAt: '2026-08-02T00:00:00.000Z', summary: 'Opened long' }],
    artifactHash: `sha256:${createHash('sha256').update(artifact).digest('hex')}`,
  };
}

beforeEach(() => {
  database = openDatabase(':memory:');
  migrateDatabase(database);
  now = new Date('2026-09-04T00:00:00.000Z');
  botId = new BotRepository(database, () => now).createDraft({ name: 'My BTC bot', market: 'BTC-PERP' }).id;
  repository = new WorkbenchRepository(database, () => now, randomUUID);
});

afterEach(() => database.close());

describe('WorkbenchRepository', () => {
  it('creates validated immutable revisions with repository-assigned versions', () => {
    const input = strategy();
    const first = repository.createValidatedRevision(botId, input);
    now = new Date('2026-09-04T00:01:00.000Z');
    const second = repository.createValidatedRevision(botId, strategy('ETF flow momentum v2'));

    expect(first).toMatchObject({ botId, version: 1, status: 'draft', name: 'ETF flow momentum' });
    expect(second).toMatchObject({ botId, version: 2, status: 'draft', name: 'ETF flow momentum v2' });
    expect(input.strategy.version).toBe(99);
    expect(first.nodes).toEqual([
      expect.objectContaining({ id: 'clock', title: 'Interval', summary: 'Every 1h' }),
      expect.objectContaining({ id: 'price', title: 'Compare', summary: 'market.price > 100' }),
      expect.objectContaining({ id: 'buy', title: 'Open position' }),
    ]);
    expect(repository.getStrategyDocument(botId, 1).strategy.version).toBe(1);
    expect(repository.getState(botId).currentRevision?.version).toBe(2);
    expect(repository.getState(botId, 1).currentRevision?.version).toBe(1);
    expect(() => database.prepare('UPDATE strategy_revisions SET document_json = ? WHERE bot_id = ? AND version = 1').run('{}', botId))
      .toThrow(/immutable/i);
  });

  it('rejects invalid graphs without persisting a revision', () => {
    const invalid = strategy();
    invalid.edges = [
      { id: 'clock-buy', source: 'clock', sourcePort: 'activation', target: 'buy', targetPort: 'condition' },
    ];

    expect(() => repository.createValidatedRevision(botId, invalid)).toThrow(/invalid strategy/i);
    expect(database.prepare('SELECT COUNT(*) AS count FROM strategy_revisions').get()).toEqual({ count: 0 });
  });

  it('approves only an existing revision while preserving its document', () => {
    repository.createValidatedRevision(botId, strategy());
    const before = repository.getStrategyDocument(botId, 1);

    const approved = repository.approveRevision(botId, 1);

    expect(approved).toMatchObject({ version: 1, status: 'approved', approvedAt: now.toISOString() });
    expect(repository.getStrategyDocument(botId, 1)).toEqual(before);
    expect(() => repository.approveRevision(botId, 2)).toThrow(/not found/i);
  });

  it('returns ordered chat, revision, and backtest history as workbench state', () => {
    repository.appendChatMessage(botId, 'user', 'Build an ETF flow bot');
    now = new Date('2026-09-04T00:01:00.000Z');
    repository.appendChatMessage(botId, 'assistant', 'I created the first draft.');
    const revision = repository.createValidatedRevision(botId, strategy());
    const artifact = JSON.stringify({ traces: [{ traceId: 'trace-1', outcome: 'executed', events: [] }] });
    const summary = backtestSummary(revision.version, artifact);
    repository.createBacktestRun(summary, artifact);
    repository.createBacktestRun({ ...summary, id: randomUUID() }, artifact);

    const state = repository.getState(botId);

    expect(state.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'Build an ETF flow bot' },
      { role: 'assistant', content: 'I created the first draft.' },
    ]);
    expect(state.currentRevision?.version).toBe(1);
    expect(state.revisions).toHaveLength(1);
    expect(state.backtests).toHaveLength(2);
    expect(database.prepare('SELECT COUNT(*) AS count FROM backtest_traces').get()).toEqual({ count: 1 });
    expect(repository.getTraceArtifact(botId, summary.artifactHash)).toBe(artifact);
  });

  it('rejects a backtest artifact whose content does not match its hash', () => {
    repository.createValidatedRevision(botId, strategy());
    const summary = backtestSummary(1, 'expected');

    expect(() => repository.createBacktestRun(summary, 'tampered')).toThrow(/artifact hash/i);
  });

  it('does not expose records across bot boundaries', () => {
    repository.createValidatedRevision(botId, strategy());
    const otherBotId = new BotRepository(database, () => now).createDraft({ name: 'Other bot', market: 'ETH-PERP' }).id;

    expect(() => repository.getStrategyDocument(otherBotId, 1)).toThrow(/not found/i);
    expect(() => repository.getTraceArtifact(otherBotId, `sha256:${'0'.repeat(64)}`)).toThrow(/not found/i);
  });
});
