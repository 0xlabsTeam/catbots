import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegacyRiskLimits, RiskLimits } from '@catbots/contracts';
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
const legacyLimits: LegacyRiskLimits = {
  maxOrderUsd: '1000', maxPositionUsd: '2500', maxLeverage: 3,
  maxDailyLossUsd: '300', maxDrawdownPercent: 12,
  allowedMarkets: ['BTC-PERP'], allowedSides: ['long', 'short'], maxOrdersPerMinute: 4,
};
const dynamicUniverse = {
  dex: 'hyperliquid' as const,
  revision: 'sha256:paper-universe',
  observedAt: now,
  markets: [
    { symbol: 'BTC-PERP', active: true, sizeDecimals: 5, maximumLeverage: 40 },
    { symbol: 'ETH-PERP', active: true, sizeDecimals: 4, maximumLeverage: 30 },
  ],
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

function createDynamicBot(approve = true): string {
  const dynamicBotId = new BotRepository(database, () => new Date(now))
    .createDraft({ name: 'Dynamic Paper', dex: 'hyperliquid' }).id;
  workbench.createValidatedRevision(dynamicBotId, parseStrategyDocument({
    schemaVersion: '2.0',
    strategy: { id: 'dynamic-paper', name: 'Dynamic Paper', version: 1 },
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
  if (approve) workbench.approveRevision(dynamicBotId, 1);
  return dynamicBotId;
}

function dynamicService(refresh = vi.fn().mockResolvedValue(dynamicUniverse)) {
  return {
    refresh,
    deployments: new DeploymentService({
      executionRepository: executions,
      workbenchRepository: workbench,
      marketUniverseCache: { refresh, freshness: () => ({ fresh: true }) },
      clock: () => new Date(now),
      idFactory: randomUUID,
    }),
  };
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
  it('starts only an approved Strategy 2.0 deployment after refreshing its DEX universe', async () => {
    const dynamicBotId = new BotRepository(database, () => new Date(now))
      .createDraft({ name: 'Dynamic Paper', dex: 'hyperliquid' }).id;
    workbench.createValidatedRevision(dynamicBotId, parseStrategyDocument({
      schemaVersion: '2.0',
      strategy: { id: 'dynamic-paper', name: 'Dynamic Paper', version: 1 },
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
    workbench.approveRevision(dynamicBotId, 1);
    const refresh = vi.fn().mockResolvedValue(dynamicUniverse);
    const deployments = new DeploymentService({
      executionRepository: executions,
      workbenchRepository: workbench,
      marketUniverseCache: { refresh, freshness: () => ({ fresh: true }) },
      clock: () => new Date(now),
      idFactory: randomUUID,
    });

    await expect(deployments.startPaper({
      botId: dynamicBotId, strategyVersion: 1, riskLimits: limits,
    }, new AbortController().signal)).resolves.toMatchObject({
      recordVersion: 2,
      dex: 'hyperliquid',
      executionVenue: 'paper',
      marketAccess: { mode: 'all_active_perpetuals' },
      riskLimits: limits,
    });
    expect(refresh).toHaveBeenCalledOnce();

    workbench.approveRevision(botId, 1);
    await expect(deployments.startPaper({
      botId, strategyVersion: 1, riskLimits: limits,
    }, new AbortController().signal)).rejects.toThrow('Strategy 2.0 is required');
  });

  it('coordinates, audits, and deduplicates one interval across all active Paper markets', async () => {
    const dynamicBotId = createDynamicBot();
    const { deployments } = dynamicService();
    const deployment = await deployments.startPaper(
      { botId: dynamicBotId, strategyVersion: 1, riskLimits: limits },
      new AbortController().signal,
    );
    const request = {
      deploymentId: deployment.id,
      triggerNodeId: 'clock',
      triggerInput: { kind: 'interval' as const, occurredAt: now },
      contextFactory: (market: string) => createEvaluationContext({
        evaluatedAt: now,
        currentMarket: market,
        values: {
          'market.price': {
            value: { market, bid: 99, ask: 101, mark: 100 },
            provider: 'paper.fixture', observedAt: now, freshnessSeconds: 0,
            quality: { status: 'verified' as const }, integrityHash: `sha256:price:${market}`,
          },
        },
      }),
    };

    const first = await deployments.ingest(request);
    const duplicate = await deployments.ingest(request);

    expect(first.duplicate).toBe(false);
    expect(first.children.map(({ market }) => market)).toEqual(['BTC-PERP', 'ETH-PERP']);
    expect(duplicate).toMatchObject({ parentTraceId: first.parentTraceId, duplicate: true });
    expect(deployments.getPaperState(deployment.id).orders.map(({ market }) => market)).toEqual([
      'BTC-PERP', 'ETH-PERP',
    ]);
    expect(executions.listTriggerRun(first.parentTraceId).children).toEqual([
      expect.objectContaining({ market: 'BTC-PERP', universeRevision: dynamicUniverse.revision }),
      expect.objectContaining({ market: 'ETH-PERP', universeRevision: dynamicUniverse.revision }),
    ]);
  });

  it('keeps legacy deployments readable and stoppable without allowing a new legacy start', async () => {
    workbench.approveRevision(botId, 1);
    const legacy = executions.createDeployment({
      id: randomUUID(), botId, strategyId: 'paper-btc', strategyVersion: 1,
      recordVersion: 1, mode: 'paper', venue: 'paper', network: 'paper',
      marketBindings: ['BTC-PERP'], riskLimits: legacyLimits, status: 'running',
      createdAt: now, updatedAt: now,
    });
    const { deployments } = dynamicService();

    await expect(deployments.startPaper(
      { botId, strategyVersion: 1, riskLimits: limits },
      new AbortController().signal,
    )).rejects.toThrow('Strategy 2.0 is required');
    expect(executions.getDeployment(legacy.id)).toMatchObject({ recordVersion: 1, marketBindings: ['BTC-PERP'] });
    expect(deployments.stop(legacy.id)).toMatchObject({ status: 'stopped' });
  });

  it('records per-market risk rejection without queueing or filling orders', async () => {
    const dynamicBotId = createDynamicBot();
    const { deployments } = dynamicService();
    const deployment = await deployments.startPaper({
      botId: dynamicBotId, strategyVersion: 1, riskLimits: { ...limits, maxOrderUsd: '100' },
    });
    const result = await deployments.ingest({
      deploymentId: deployment.id,
      triggerNodeId: 'clock',
      triggerInput: { kind: 'interval', occurredAt: now },
      contextFactory: (market) => dynamicContext(market),
    });

    expect(result.children.every(({ evaluation }) => evaluation.trace.some(({ type }) => type === 'risk.rejected'))).toBe(true);
    expect(deployments.getPaperState(deployment.id).orders).toEqual([]);
  });

  it('rolls back all market state on audit failure and preserves pause and Stop controls', async () => {
    const unapprovedBotId = createDynamicBot(false);
    const first = dynamicService().deployments;
    await expect(first.startPaper({ botId: unapprovedBotId, strategyVersion: 1, riskLimits: limits }))
      .rejects.toThrow(/approved/i);

    workbench.approveRevision(unapprovedBotId, 1);
    const deployment = await first.startPaper({ botId: unapprovedBotId, strategyVersion: 1, riskLimits: limits });
    database.exec(`
      CREATE TRIGGER force_paper_audit_failure BEFORE INSERT ON audit_events
      BEGIN SELECT RAISE(ABORT, 'forced paper audit failure'); END;
    `);
    await expect(first.ingest({
      deploymentId: deployment.id,
      triggerNodeId: 'clock',
      triggerInput: { kind: 'interval', occurredAt: now },
      contextFactory: (market) => dynamicContext(market),
    })).rejects.toThrow(/forced paper audit failure/i);
    expect(first.getPaperState(deployment.id).orders).toEqual([]);
    database.exec('DROP TRIGGER force_paper_audit_failure');
    expect(first.pause(deployment.id)).toMatchObject({ status: 'paused' });
    expect(first.stop(deployment.id)).toMatchObject({ status: 'stopped' });
  });
});

describe('Dynamic-market Paper adapter', () => {
  it('rejects when the staged evaluation market differs from the effect and execution context', () => {
    const adapter = dynamicPaperAdapter();
    adapter.updateMarketUniverse({
      universe: {
        dex: 'hyperliquid',
        revision: 'sha256:universe-2',
        observedAt: '2026-09-05T08:16:00.000Z',
        markets: [
          {
            symbol: 'ETH-PERP', active: true, sizeDecimals: 4, maximumLeverage: 50,
          },
          {
            symbol: 'BTC-PERP', active: true, sizeDecimals: 5, maximumLeverage: 40,
          },
        ],
      },
      fresh: true,
    });
    const before = adapter.snapshot();
    adapter.beginEvaluation({
      dex: 'hyperliquid',
      currentMarket: 'ETH-PERP',
      universeRevision: 'sha256:universe-2',
    });

    const result = adapter.execute(
      openEffect('BTC-PERP', 'effect:wrong-staged-market'),
      dynamicContext('BTC-PERP'),
    );
    adapter.commitEvaluation();

    expect(result.events).toEqual([{
      type: 'risk.rejected',
      metadata: { violatedRuleIds: ['evaluation-market-mismatch'] },
    }]);
    expect(adapter.snapshot()).toEqual(before);
  });

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

describe('Legacy Paper adapter compatibility', () => {
  it('rejects a close above 100 percent without changing the position or recording an order', () => {
    const adapter = new PaperAdapter({
      deploymentId: randomUUID(),
      strategyId: 'legacy-paper',
      strategyVersion: 1,
      market: 'BTC-PERP',
      riskLimits: legacyLimits,
    });
    adapter.beginEvaluation();
    adapter.execute(openEffect('BTC-PERP', 'legacy:open'), dynamicContext('BTC-PERP'));
    adapter.commitEvaluation();
    const before = adapter.snapshot();

    adapter.beginEvaluation();
    const result = adapter.execute(
      closeEffect('BTC-PERP', 'legacy:over-close', 150),
      dynamicContext('BTC-PERP', '2026-09-05T08:16:00.000Z'),
    );
    adapter.commitEvaluation();

    expect(result.events).toEqual([{
      type: 'risk.rejected',
      metadata: { violatedRuleIds: ['risk-state-unavailable'] },
    }]);
    expect(adapter.snapshot()).toEqual(before);
    expect(adapter.snapshot().positions[0]).toMatchObject({
      market: 'BTC-PERP', side: 'long', notionalUsd: '500',
    });
  });
});
