import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RiskLimits } from '@catbots/contracts';
import { createEvaluationContext, parseStrategyDocument } from '@catbots/strategy-runtime';

import { BotRepository } from '../src/main/bots/bot-repository';
import { DeploymentService } from '../src/main/execution/deployment-service';
import { ExecutionRepository } from '../src/main/execution/execution-repository';
import { PaperAdapter } from '../src/main/execution/paper-adapter';
import { openDatabase } from '../src/main/storage/database';
import { migrateDatabase } from '../src/main/storage/migrations';
import { WorkbenchRepository } from '../src/main/workbench/workbench-repository';

const now = '2026-09-05T08:15:00.000Z';
const limits: RiskLimits = {
  maxOrderUsd: '1000', maxPositionUsd: '2500', maxTotalExposureUsd: '5000', maxLeverage: 3,
  maxDailyLossUsd: '300', maxDrawdownPercent: 12,
  allowedSides: ['long', 'short'], maxOrdersPerMinute: 4,
};

let database: Database.Database;
let botId: string;
let workbench: WorkbenchRepository;
let executions: ExecutionRepository;

beforeEach(() => {
  database = openDatabase(':memory:');
  migrateDatabase(database);
  botId = new BotRepository(database, () => new Date(now)).createDraft({ name: 'Paper BTC', market: 'BTC-PERP' }).id;
  workbench = new WorkbenchRepository(database, () => new Date(now), randomUUID);
  workbench.createValidatedRevision(botId, parseStrategyDocument({
    schemaVersion: '1.0',
    strategy: { id: 'paper-btc', name: 'Paper BTC', version: 99 },
    nodes: [
      { id: 'clock', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
      { id: 'flat', kind: 'condition', type: 'predicate.position_state', version: 1, config: { state: 'flat', market: 'BTC-PERP' } },
      { id: 'open', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 500 }, leverage: 2 } },
    ],
    edges: [
      { id: 'e1', source: 'clock', sourcePort: 'activation', target: 'flat', targetPort: 'activation' },
      { id: 'e2', source: 'flat', sourcePort: 'result', target: 'open', targetPort: 'condition' },
    ],
  }));
  executions = new ExecutionRepository(database);
});

afterEach(() => database.close());

function context(evaluatedAt = now) {
  return createEvaluationContext({
    evaluatedAt,
    currentMarket: 'BTC-PERP',
    values: {
      'market.price': {
        value: { market: 'BTC-PERP', bid: 99, ask: 101, mark: 100 },
        provider: 'paper.fixture', observedAt: evaluatedAt, freshnessSeconds: 0,
        quality: { status: 'verified' }, integrityHash: 'sha256:price',
      },
      'account.positions': {
        value: [], provider: 'caller.fixture', observedAt: evaluatedAt, freshnessSeconds: 0,
        quality: { status: 'verified' }, integrityHash: 'sha256:positions',
      },
    },
  });
}

function service() {
  return new DeploymentService({
    executionRepository: executions,
    workbenchRepository: workbench,
    clock: () => new Date(now),
    idFactory: randomUUID,
  });
}

function dynamicPaperAdapter(totalExposure = '5000') {
  return new PaperAdapter({
    recordVersion: 2,
    deploymentId: randomUUID(),
    strategyId: 'dynamic-paper',
    strategyVersion: 1,
    botDex: 'hyperliquid',
    deploymentDex: 'hyperliquid',
    riskLimits: { ...limits, maxTotalExposureUsd: totalExposure, maxOrdersPerMinute: 10 },
    universe: {
      dex: 'hyperliquid',
      revision: 'sha256:universe-1',
      observedAt: now,
      markets: [
        {
          symbol: 'ETH-PERP', active: true,
          sizeDecimals: 4, maximumLeverage: 50,
        },
      ],
    },
    universeFresh: true,
  });
}

function dynamicContext(market: string, evaluatedAt = now) {
  return createEvaluationContext({
    evaluatedAt,
    currentMarket: market,
    values: {
      'market.price': {
        value: { market, bid: 99, ask: 101, mark: 100 },
        provider: 'paper.fixture', observedAt: evaluatedAt, freshnessSeconds: 0,
        quality: { status: 'verified' }, integrityHash: `sha256:price:${market}`,
      },
    },
  });
}

function openEffect(market: string, key: string, notionalUsd = 500) {
  return {
    nodeId: 'open',
    type: 'execution.open_position',
    version: 1,
    market,
    config: { side: 'long', size: { type: 'quote', value: notionalUsd }, leverage: 2 },
    idempotencyKey: key,
  } as const;
}

function closeEffect(market: string, key: string, percent = 100) {
  return {
    nodeId: 'close',
    type: 'execution.close_position',
    version: 1,
    market,
    config: { percent },
    idempotencyKey: key,
  } as const;
}

function executeDynamic(
  adapter: PaperAdapter,
  effect: ReturnType<typeof openEffect> | ReturnType<typeof closeEffect>,
  revision: string,
  evaluatedAt = now,
) {
  adapter.beginEvaluation({
    dex: 'hyperliquid',
    currentMarket: effect.market,
    universeRevision: revision,
  });
  const result = adapter.execute(effect, dynamicContext(effect.market, evaluatedAt));
  adapter.commitEvaluation();
  return result;
}

describe('Paper deployment', () => {
  it('fails closed for a DEX-scoped bot with no legacy market hint', () => {
    const newBotId = new BotRepository(database, () => new Date(now)).createDraft({ name: 'DEX Paper', dex: 'hyperliquid' }).id;
    workbench.createValidatedRevision(newBotId, parseStrategyDocument({
      schemaVersion: '1.0', strategy: { id: 'dex-paper', name: 'DEX Paper', version: 1 },
      nodes: [
        { id: 'clock', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
        { id: 'flat', kind: 'condition', type: 'predicate.position_state', version: 1, config: { state: 'flat', market: 'BTC-PERP' } },
        { id: 'open', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 500 }, leverage: 2 } },
      ],
      edges: [
        { id: 'e1', source: 'clock', sourcePort: 'activation', target: 'flat', targetPort: 'activation' },
        { id: 'e2', source: 'flat', sourcePort: 'result', target: 'open', targetPort: 'condition' },
      ],
    }));
    workbench.approveRevision(newBotId, 1);

    expect(() => service().startPaper({ botId: newBotId, strategyVersion: 1, riskLimits: limits })).toThrow('DYNAMIC_MARKET_RUNTIME_NOT_READY');
  });

  it('runs an approved strategy through the canonical evaluator and persists the full trace', () => {
    workbench.approveRevision(botId, 1);
    const deployments = service();
    const deployment = deployments.startPaper({ botId, strategyVersion: 1, riskLimits: limits });

    const result = deployments.ingest({
      deploymentId: deployment.id,
      triggerNodeId: 'clock',
      triggerInput: { kind: 'interval', occurredAt: now },
      context: context(),
    });

    expect(result.duplicate).toBe(false);
    expect(result.events.map(({ type }) => type)).toEqual([
      'trigger.received', 'context.resolution_started', 'context.resolved',
      'condition.evaluated', 'action.proposed', 'risk.approved', 'execution.queued',
      'execution.submitted', 'execution.acknowledged', 'execution.filled', 'flow.completed',
    ]);
    expect(executions.listAuditEvents(result.traceId).map(({ type }) => type)).toEqual(result.events.map(({ type }) => type));
    expect(deployments.getPaperState(deployment.id)).toMatchObject({
      orders: [expect.objectContaining({ market: 'BTC-PERP', side: 'long', notionalUsd: '500' })],
      positions: [expect.objectContaining({ market: 'BTC-PERP', side: 'long', leverage: 2 })],
    });
  });

  it('records a risk rejection without queueing or filling an order', () => {
    workbench.approveRevision(botId, 1);
    const deployments = service();
    const deployment = deployments.startPaper({
      botId,
      strategyVersion: 1,
      riskLimits: { ...limits, maxOrderUsd: '100' },
    });

    const result = deployments.ingest({
      deploymentId: deployment.id,
      triggerNodeId: 'clock',
      triggerInput: { kind: 'interval', occurredAt: now },
      context: context(),
    });

    expect(result.events.map(({ type }) => type)).toContain('risk.rejected');
    expect(result.events.map(({ type }) => type)).not.toContain('execution.queued');
    expect(deployments.getPaperState(deployment.id).orders).toEqual([]);
  });

  it('resolves position conditions from current Paper state instead of caller-supplied account data', () => {
    workbench.approveRevision(botId, 1);
    const deployments = service();
    const deployment = deployments.startPaper({ botId, strategyVersion: 1, riskLimits: limits });
    deployments.ingest({
      deploymentId: deployment.id,
      triggerNodeId: 'clock',
      triggerInput: { kind: 'interval', occurredAt: now },
      context: context(),
    });
    const next = '2026-09-05T08:30:00.000Z';

    const result = deployments.ingest({
      deploymentId: deployment.id,
      triggerNodeId: 'clock',
      triggerInput: { kind: 'interval', occurredAt: next },
      context: context(next),
    });

    expect(result.events.at(-1)?.type).toBe('flow.skipped');
    expect(deployments.getPaperState(deployment.id).orders).toHaveLength(1);
  });

  it('deduplicates the same trigger and keeps Stop persistent', () => {
    workbench.approveRevision(botId, 1);
    const deployments = service();
    const deployment = deployments.startPaper({ botId, strategyVersion: 1, riskLimits: limits });
    const request = {
      deploymentId: deployment.id,
      triggerNodeId: 'clock',
      triggerInput: { kind: 'interval' as const, occurredAt: now },
      context: context(),
    };

    const first = deployments.ingest(request);
    const duplicate = deployments.ingest(request);

    expect(duplicate).toMatchObject({ traceId: first.traceId, duplicate: true });
    expect(deployments.getPaperState(deployment.id).orders).toHaveLength(1);
    expect(deployments.stop(deployment.id)).toMatchObject({ status: 'stopped' });
    expect(executions.listRecoverableDeployments()).toEqual([]);
    expect(() => deployments.ingest(request)).toThrow(/not running/i);
  });

  it('pauses evaluation without discarding the Paper position or preventing Stop', () => {
    workbench.approveRevision(botId, 1);
    const deployments = service();
    const deployment = deployments.startPaper({ botId, strategyVersion: 1, riskLimits: limits });
    const request = {
      deploymentId: deployment.id,
      triggerNodeId: 'clock',
      triggerInput: { kind: 'interval' as const, occurredAt: now },
      context: context(),
    };
    deployments.ingest(request);

    expect(deployments.pause(deployment.id)).toMatchObject({ status: 'paused' });
    expect(() => deployments.ingest(request)).toThrow(/not running/i);
    expect(deployments.getPaperState(deployment.id).positions).toHaveLength(1);
    expect(deployments.stop(deployment.id)).toMatchObject({ status: 'stopped' });
  });

  it('requires approval and rolls back staged Paper state when audit persistence fails', () => {
    const deployments = service();
    expect(() => deployments.startPaper({ botId, strategyVersion: 1, riskLimits: limits })).toThrow(/approved/i);

    workbench.approveRevision(botId, 1);
    const deployment = deployments.startPaper({ botId, strategyVersion: 1, riskLimits: limits });
    database.exec(`
      CREATE TRIGGER force_paper_audit_failure BEFORE INSERT ON audit_events
      BEGIN SELECT RAISE(ABORT, 'forced paper audit failure'); END;
    `);
    expect(() => deployments.ingest({
      deploymentId: deployment.id,
      triggerNodeId: 'clock',
      triggerInput: { kind: 'interval', occurredAt: now },
      context: context(),
    })).toThrow(/forced paper audit failure/i);
    expect(deployments.getPaperState(deployment.id).orders).toEqual([]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM audit_traces').get()).toEqual({ count: 0 });
  });
});

describe('Dynamic-market Paper adapter', () => {
  it('uses effect.market and keeps positions and orders market-keyed as the DEX snapshot refreshes', () => {
    const adapter = dynamicPaperAdapter();
    executeDynamic(adapter, openEffect('ETH-PERP', 'effect:eth'), 'sha256:universe-1');
    executeDynamic(
      adapter,
      openEffect('ETH-PERP', 'effect:eth-increase', 200),
      'sha256:universe-1',
      '2026-09-05T08:15:30.000Z',
    );
    adapter.updateMarketUniverse({
      universe: {
        dex: 'hyperliquid',
        revision: 'sha256:universe-2',
        observedAt: '2026-09-05T08:16:00.000Z',
        markets: [
          {
            symbol: 'ETH-PERP', active: true,
            sizeDecimals: 4, maximumLeverage: 50,
          },
          {
            symbol: 'BTC-PERP', active: true,
            sizeDecimals: 5, maximumLeverage: 40,
          },
        ],
      },
      fresh: true,
    });
    executeDynamic(
      adapter,
      openEffect('BTC-PERP', 'effect:btc'),
      'sha256:universe-2',
      '2026-09-05T08:16:00.000Z',
    );

    expect(adapter.snapshot().positions.map(({ market }) => market).sort()).toEqual(['BTC-PERP', 'ETH-PERP']);
    expect(adapter.snapshot().positions.find(({ market }) => market === 'ETH-PERP')?.notionalUsd).toBe('700');
    expect(adapter.snapshot().orders.map(({ market }) => market)).toEqual(['ETH-PERP', 'ETH-PERP', 'BTC-PERP']);
  });

  it('allows a true reduction after delisting but rejects an inactive increase and an over-close', () => {
    const adapter = dynamicPaperAdapter();
    executeDynamic(adapter, openEffect('ETH-PERP', 'effect:open'), 'sha256:universe-1');
    adapter.updateMarketUniverse({
      universe: {
        dex: 'hyperliquid',
        revision: 'sha256:universe-2',
        observedAt: '2026-09-05T08:16:00.000Z',
        markets: [{
          symbol: 'ETH-PERP', active: false,
          sizeDecimals: 4, maximumLeverage: 50,
        }],
      },
      fresh: true,
    });

    expect(executeDynamic(
      adapter,
      openEffect('ETH-PERP', 'effect:inactive-open'),
      'sha256:universe-2',
      '2026-09-05T08:16:00.000Z',
    ).events).toContainEqual({ type: 'risk.rejected', metadata: { violatedRuleIds: ['market-inactive'] } });
    expect(executeDynamic(
      adapter,
      closeEffect('ETH-PERP', 'effect:over-close', 101),
      'sha256:universe-2',
      '2026-09-05T08:17:00.000Z',
    ).events).toContainEqual({ type: 'risk.rejected', metadata: { violatedRuleIds: ['reduction-unproven'] } });
    expect(executeDynamic(
      adapter,
      closeEffect('ETH-PERP', 'effect:close'),
      'sha256:universe-2',
      '2026-09-05T08:18:00.000Z',
    ).events.map(({ type }) => type)).toContain('execution.filled');
    expect(adapter.snapshot().positions).toEqual([]);
  });

  it('shares portfolio exposure across markets and rejects a mismatched evaluation revision', () => {
    const adapter = dynamicPaperAdapter('700');
    executeDynamic(adapter, openEffect('ETH-PERP', 'effect:eth'), 'sha256:universe-1');
    adapter.updateMarketUniverse({
      universe: {
        dex: 'hyperliquid',
        revision: 'sha256:universe-2',
        observedAt: '2026-09-05T08:16:00.000Z',
        markets: [
          {
            symbol: 'ETH-PERP', active: true,
            sizeDecimals: 4, maximumLeverage: 50,
          },
          {
            symbol: 'BTC-PERP', active: true,
            sizeDecimals: 5, maximumLeverage: 40,
          },
        ],
      },
      fresh: true,
    });

    expect(executeDynamic(
      adapter,
      openEffect('BTC-PERP', 'effect:btc'),
      'sha256:universe-2',
      '2026-09-05T08:16:00.000Z',
    ).events).toContainEqual({
      type: 'risk.rejected', metadata: { violatedRuleIds: ['max-total-exposure-usd'] },
    });
    expect(executeDynamic(
      adapter,
      openEffect('BTC-PERP', 'effect:stale-child'),
      'sha256:universe-1',
      '2026-09-05T08:17:00.000Z',
    ).events).toContainEqual({
      type: 'risk.rejected', metadata: { violatedRuleIds: ['market-metadata-stale'] },
    });
  });
});
