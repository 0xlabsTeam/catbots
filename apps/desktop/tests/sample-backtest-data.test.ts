import { describe, expect, it } from 'vitest';
import { parseStrategyDocument } from '@catbots/strategy-runtime';

import {
  bundledSampleDatasetCatalog,
  runBundledSampleBacktest,
} from '../src/main/workbench/sample-backtest-data';

const complexStrategy = parseStrategyDocument({
  schemaVersion: '2.0',
  strategy: { id: 'complex-trade', name: 'Complex trade', version: 1 },
  marketScope: { type: 'dex_universe' },
  nodes: [
    { id: 't-open', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
    { id: 'c-symbol', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'market.symbol' }, operator: 'eq', right: { literal: 'BTC-PERP' } } },
    { id: 'c-flat', kind: 'condition', type: 'predicate.position_state', version: 2, config: { state: 'flat' } },
    { id: 'c-rsi', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'indicator.rsi.14', field: 'value' }, operator: 'lt', right: { literal: 35 } } },
    { id: 'c-funding', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'market.funding', field: 'rate' }, operator: 'lt', right: { literal: 0 } } },
    { id: 'c-at-least', kind: 'condition', type: 'combine.at_least', version: 1, config: { count: 2 } },
    { id: 'c-entry', kind: 'condition', type: 'combine.all', version: 1, config: {} },
    { id: 'a-open', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'equity_percent', value: 10 }, leverage: 2 } },
    { id: 't-close', kind: 'trigger', type: 'trigger.event', version: 1, config: { eventType: 'data.etf_flow.updated', filters: { asset: 'BTC' } } },
    { id: 'c-etf', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'data.etf_flow.btc.net_daily', field: 'usd' }, operator: 'lt', right: { literal: 0 } } },
    { id: 'a-close', kind: 'action', type: 'execution.close_position', version: 1, config: { percent: 100 } },
  ],
  edges: [
    { id: 'e1', source: 't-open', sourcePort: 'activation', target: 'c-flat', targetPort: 'activation' },
    { id: 'e-symbol-1', source: 't-open', sourcePort: 'activation', target: 'c-symbol', targetPort: 'activation' },
    { id: 'e2', source: 't-open', sourcePort: 'activation', target: 'c-rsi', targetPort: 'activation' },
    { id: 'e3', source: 't-open', sourcePort: 'activation', target: 'c-funding', targetPort: 'activation' },
    { id: 'e4', source: 'c-rsi', sourcePort: 'result', target: 'c-at-least', targetPort: 'conditions' },
    { id: 'e5', source: 'c-funding', sourcePort: 'result', target: 'c-at-least', targetPort: 'conditions' },
    { id: 'e6', source: 'c-flat', sourcePort: 'result', target: 'c-entry', targetPort: 'conditions' },
    { id: 'e-symbol-2', source: 'c-symbol', sourcePort: 'result', target: 'c-entry', targetPort: 'conditions' },
    { id: 'e7', source: 'c-at-least', sourcePort: 'result', target: 'c-entry', targetPort: 'conditions' },
    { id: 'e8', source: 'c-entry', sourcePort: 'result', target: 'a-open', targetPort: 'condition' },
    { id: 'e9', source: 't-close', sourcePort: 'activation', target: 'c-etf', targetPort: 'activation' },
    { id: 'e10', source: 'c-etf', sourcePort: 'result', target: 'a-close', targetPort: 'condition' },
  ],
});

const multiMarketPartialCloseStrategy = parseStrategyDocument({
  schemaVersion: '2.0',
  strategy: { id: 'multi-close', name: 'Multi-market partial close', version: 1 },
  marketScope: { type: 'dex_universe' },
  nodes: [
    { id: 't-open', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '1d', alignment: 'utc' } },
    { id: 'c-open', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { literal: 1 }, operator: 'eq', right: { literal: 1 } } },
    { id: 'a-open', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 100 } } },
    { id: 't-close', kind: 'trigger', type: 'trigger.event', version: 1, config: { eventType: 'sample.close', filters: {}, scope: 'market' } },
    { id: 'c-close', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { literal: 1 }, operator: 'eq', right: { literal: 1 } } },
    { id: 'a-close-half', kind: 'action', type: 'execution.close_position', version: 1, config: { side: 'long', percent: 50 } },
    { id: 'a-close-rest', kind: 'action', type: 'execution.close_position', version: 1, config: { side: 'long', percent: 100 } },
  ],
  edges: [
    { id: 'e1', source: 't-open', sourcePort: 'activation', target: 'c-open', targetPort: 'activation' },
    { id: 'e2', source: 'c-open', sourcePort: 'result', target: 'a-open', targetPort: 'condition' },
    { id: 'e3', source: 't-close', sourcePort: 'activation', target: 'c-close', targetPort: 'activation' },
    { id: 'e4', source: 'c-close', sourcePort: 'result', target: 'a-close-half', targetPort: 'condition' },
    { id: 'e5', source: 'c-close', sourcePort: 'result', target: 'a-close-rest', targetPort: 'condition' },
  ],
});

const dexEventStrategy = parseStrategyDocument({
  schemaVersion: '2.0',
  strategy: { id: 'dex-event', name: 'DEX event fanout', version: 1 },
  marketScope: { type: 'dex_universe' },
  nodes: [
    { id: 't-dex', kind: 'trigger', type: 'trigger.event', version: 1, config: { eventType: 'sample.dex_event', filters: {}, scope: 'dex' } },
    { id: 'c-open', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { literal: true }, operator: 'eq', right: { literal: true } } },
    { id: 'a-open', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 100 } } },
  ],
  edges: [
    { id: 'e1', source: 't-dex', sourcePort: 'activation', target: 'c-open', targetPort: 'activation' },
    { id: 'e2', source: 'c-open', sourcePort: 'result', target: 'a-open', targetPort: 'condition' },
  ],
});

const ethRsiRuntimeStrategy = parseStrategyDocument({
  schemaVersion: '2.0',
  strategy: { id: 'eth-rsi-runtime', name: 'ETH RSI runtime contract', version: 1 },
  marketScope: { type: 'dex_universe' },
  nodes: [
    { id: 'entry-clock', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '1d', alignment: 'utc' } },
    { id: 'entry-symbol', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'market.symbol' }, operator: 'eq', right: { literal: 'ETH-PERP' } } },
    { id: 'entry-rsi', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'indicator.rsi.14', field: 'value' }, operator: 'lt', right: { literal: 20 } } },
    { id: 'entry-all', kind: 'condition', type: 'combine.all', version: 1, config: {} },
    { id: 'entry-long', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 100 } } },
    { id: 'exit-clock', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '1d', alignment: 'utc' } },
    { id: 'exit-symbol', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'market.symbol' }, operator: 'eq', right: { literal: 'ETH-PERP' } } },
    { id: 'exit-rsi', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'indicator.rsi.14', field: 'value' }, operator: 'gt', right: { literal: 80 } } },
    { id: 'exit-position', kind: 'condition', type: 'predicate.position_state', version: 2, config: { state: 'long' } },
    { id: 'exit-all', kind: 'condition', type: 'combine.all', version: 1, config: {} },
    { id: 'exit-close', kind: 'action', type: 'execution.close_position', version: 1, config: { side: 'long', percent: 100 } },
  ],
  edges: [
    { id: 'e1', source: 'entry-clock', sourcePort: 'activation', target: 'entry-symbol', targetPort: 'activation' },
    { id: 'e2', source: 'entry-clock', sourcePort: 'activation', target: 'entry-rsi', targetPort: 'activation' },
    { id: 'e3', source: 'entry-symbol', sourcePort: 'result', target: 'entry-all', targetPort: 'conditions' },
    { id: 'e4', source: 'entry-rsi', sourcePort: 'result', target: 'entry-all', targetPort: 'conditions' },
    { id: 'e5', source: 'entry-all', sourcePort: 'result', target: 'entry-long', targetPort: 'condition' },
    { id: 'e6', source: 'exit-clock', sourcePort: 'activation', target: 'exit-symbol', targetPort: 'activation' },
    { id: 'e7', source: 'exit-clock', sourcePort: 'activation', target: 'exit-rsi', targetPort: 'activation' },
    { id: 'e8', source: 'exit-clock', sourcePort: 'activation', target: 'exit-position', targetPort: 'activation' },
    { id: 'e9', source: 'exit-symbol', sourcePort: 'result', target: 'exit-all', targetPort: 'conditions' },
    { id: 'e10', source: 'exit-rsi', sourcePort: 'result', target: 'exit-all', targetPort: 'conditions' },
    { id: 'e11', source: 'exit-position', sourcePort: 'result', target: 'exit-all', targetPort: 'conditions' },
    { id: 'e12', source: 'exit-all', sourcePort: 'result', target: 'exit-close', targetPort: 'condition' },
  ],
});

describe('bundled sample backtest presentation', () => {
  it('declares a deliberately limited BTC and ETH point-in-time dataset', () => {
    expect(bundledSampleDatasetCatalog).toEqual({
      dex: 'hyperliquid',
      markets: ['BTC-PERP', 'ETH-PERP'],
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      limitations: expect.stringContaining('only BTC-PERP and ETH-PERP'),
    });
  });

  it('returns the closed trade that contributes to the performance metrics', () => {
    const result = runBundledSampleBacktest(
      '018f3f75-89ab-7def-8123-456789abcdef',
      1,
      complexStrategy,
      'hyperliquid',
      { mode: 'all_available' },
      {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
        startingCapital: '10000',
        feeRateBps: 5,
        slippageBps: 1,
      },
      {
        clock: () => new Date('2026-09-04T00:00:00.000Z'),
        idFactory: () => '018f3f75-89ab-7def-8123-456789abcdea',
      },
    );

    expect(result.summary.metrics.tradeCount).toBe(1);
    expect(result.summary.datasetCoverage).toEqual({
      markets: ['BTC-PERP', 'ETH-PERP'],
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
    });
    expect(result.summary.perMarket.map(({ market }) => market)).toEqual(['BTC-PERP', 'ETH-PERP']);
    expect(result.summary.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('only BTC-PERP and ETH-PERP'),
    ]));
    expect(result.summary.trades).toEqual([
      expect.objectContaining({
        traceId: expect.stringContaining(':t-close:'),
        market: 'BTC-PERP',
        side: 'long',
        entryPrice: '100.01',
        exitPrice: '99.99',
        realizedPnl: expect.any(String),
      }),
    ]);
    const artifact = JSON.parse(result.artifact) as {
      traces: Array<{ parentTrace: Array<{ type: string; details: { markets?: string[] } }> }>;
    };
    const resolvedUniverses = artifact.traces.flatMap(({ parentTrace }) => parentTrace)
      .filter(({ type }) => type === 'universe.resolved')
      .map(({ details }) => details.markets);
    expect(resolvedUniverses).toContainEqual(['BTC-PERP']);
    expect(resolvedUniverses).toContainEqual(['BTC-PERP', 'ETH-PERP']);
  });

  it('maps every multi-market partial close to the child trace containing its action', () => {
    const result = runBundledSampleBacktest(
      '018f3f75-89ab-7def-8123-456789abcdef',
      1,
      multiMarketPartialCloseStrategy,
      'hyperliquid',
      { mode: 'all_available' },
      {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
        startingCapital: '10000',
        feeRateBps: 0,
        slippageBps: 0,
      },
    );
    const artifact = JSON.parse(result.artifact) as {
      traces: Array<{ children: Array<{ market: string; evaluation: { trace: Array<{ traceId: string; type: string; nodeId?: string }> } }> }>;
    };
    const childTraces = artifact.traces.flatMap(({ children }) => children);
    const childrenByTrace = new Map(childTraces.map((child) => [child.evaluation.trace[0]?.traceId, child]));

    expect(result.summary.trades).toHaveLength(4);
    for (const trade of result.summary.trades) {
      const child = childrenByTrace.get(trade.traceId);
      expect(child?.market).toBe(trade.market);
      expect(child?.evaluation.trace.filter(({ type }) => type === 'execution.filled').map(({ nodeId }) => nodeId))
        .toEqual(expect.arrayContaining(['a-close-half', 'a-close-rest']));
    }
    const btcTraceIds = result.summary.trades.filter(({ market }) => market === 'BTC-PERP').map(({ traceId }) => traceId);
    const ethTraceIds = result.summary.trades.filter(({ market }) => market === 'ETH-PERP').map(({ traceId }) => traceId);
    expect(new Set(btcTraceIds).size).toBe(1);
    expect(new Set(ethTraceIds).size).toBe(1);
    expect(btcTraceIds[0]).not.toBe(ethTraceIds[0]);
  });

  it('emits one marketless DEX Event parent and fans out without duplicate positions', () => {
    const result = runBundledSampleBacktest(
      '018f3f75-89ab-7def-8123-456789abcdef',
      1,
      dexEventStrategy,
      'hyperliquid',
      { mode: 'all_available' },
      {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
        startingCapital: '10000',
        feeRateBps: 0,
        slippageBps: 0,
      },
    );
    const artifact = JSON.parse(result.artifact) as {
      traces: Array<{
        parentTrace: Array<{ type: string; details: { input?: { event?: { market?: string } } } }>;
        children: Array<{ market: string }>;
      }>;
      snapshot: { positions: Array<{ market: string }> };
    };

    expect(artifact.traces).toHaveLength(1);
    expect(artifact.traces[0]?.children.map(({ market }) => market)).toEqual(['BTC-PERP', 'ETH-PERP']);
    expect(artifact.traces[0]?.parentTrace.find(({ type }) => type === 'trigger.received')?.details.input?.event)
      .not.toHaveProperty('market');
    expect(artifact.snapshot.positions.map(({ market }) => market)).toEqual(['BTC-PERP', 'ETH-PERP']);
  });

  it('executes the ETH RSI document deterministically without touching BTC or opening Short', () => {
    const result = runBundledSampleBacktest(
      '018f3f75-89ab-7def-8123-456789abcdef',
      1,
      ethRsiRuntimeStrategy,
      'hyperliquid',
      { mode: 'all_available' },
      {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
        startingCapital: '10000',
        feeRateBps: 0,
        slippageBps: 0,
      },
    );
    const artifact = JSON.parse(result.artifact) as {
      traces: Array<{ children: Array<{ market: string; evaluation: { trace: Array<{ type: string; nodeId?: string; details: { effect?: { type?: string; market?: string; config?: { side?: string } } } }> } }> }>;
      snapshot: { positions: Array<{ market: string; side: string }> };
    };
    const proposed = artifact.traces.flatMap(({ children }) => children)
      .flatMap(({ evaluation }) => evaluation.trace)
      .filter(({ type }) => type === 'action.proposed')
      .map(({ nodeId, details }) => ({ nodeId, effect: details.effect }));

    expect(result.summary.trades).toEqual([
      expect.objectContaining({ market: 'ETH-PERP', side: 'long' }),
    ]);
    expect(artifact.snapshot.positions).toEqual([]);
    expect(proposed).toEqual([
      expect.objectContaining({ nodeId: 'entry-long', effect: expect.objectContaining({ market: 'ETH-PERP', config: expect.objectContaining({ side: 'long' }) }) }),
      expect.objectContaining({ nodeId: 'exit-close', effect: expect.objectContaining({ market: 'ETH-PERP', type: 'execution.close_position' }) }),
    ]);
    expect(proposed).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ effect: expect.objectContaining({ config: expect.objectContaining({ side: 'short' }) }) }),
    ]));
  });
});
