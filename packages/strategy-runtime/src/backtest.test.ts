import { describe, expect, it, vi } from 'vitest';

import type { EvaluationValue } from './evaluation-context';
import {
  runBacktest,
  runSingleMarketBacktest,
  type BacktestRequest,
  type LegacySingleMarketBacktestRequest,
} from './backtest';
import { btcEtfRsiBacktestRequest } from './fixtures/btc-etf-rsi-inputs';
import type { MarketUniverseSnapshot } from './market-universe';
import { parseStrategyDocument } from './strategy-schema';

const strategy = parseStrategyDocument({
  schemaVersion: '1.0',
  strategy: { id: 'btc-rsi', name: 'BTC RSI', version: 1 },
  nodes: [
    { id: 't-15m', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
    { id: 'c-rsi', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'indicator.rsi', field: 'value' }, operator: 'lt', right: { literal: 30 } } },
    { id: 'a-long', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 1_000 }, leverage: 2 } },
  ],
  edges: [
    { id: 'e1', source: 't-15m', sourcePort: 'activation', target: 'c-rsi', targetPort: 'activation' },
    { id: 'e2', source: 'c-rsi', sourcePort: 'result', target: 'a-long', targetPort: 'condition' },
  ],
});

function observed(
  value: unknown,
  hash: string,
  observedAt = '2026-09-03T08:15:00.000Z',
): EvaluationValue<unknown> {
  return {
    value, provider: 'fixture', observedAt,
    freshnessSeconds: 0, quality: { status: 'verified' }, integrityHash: hash,
  };
}

function request(): LegacySingleMarketBacktestRequest {
  return {
    strategy,
    market: 'BTC-PERP',
    range: { from: '2026-09-03T08:00:00.000Z', to: '2026-09-03T08:30:00.000Z' },
    assumptions: {
      startingCapital: '10000', feeRateBps: 10, slippageBps: 0,
      latencyMs: 0, partialFillRatio: 1, maintenanceMarginRate: 0.05,
    },
    inputs: [
      {
        occurredAt: '2026-09-03T08:15:00.000Z', priority: 1, stableId: 'input-1',
        triggerNodeId: 't-15m', triggerInput: { kind: 'interval', occurredAt: '2026-09-03T08:15:00.000Z' },
        values: {
          'market.price': observed({ market: 'BTC-PERP', bid: 100, ask: 100, mark: 100 }, 'sha256:price-1'),
          'indicator.rsi': observed({ value: 25 }, 'sha256:rsi-1'),
        },
      },
      {
        occurredAt: '2026-09-03T08:30:00.000Z', priority: 1, stableId: 'input-2',
        triggerNodeId: 't-15m', triggerInput: { kind: 'interval', occurredAt: '2026-09-03T08:30:00.000Z' },
        values: {
          'market.price': observed({ market: 'BTC-PERP', bid: 105, ask: 105, mark: 105 }, 'sha256:price-2'),
          'indicator.rsi': observed({ value: 45 }, 'sha256:rsi-2'),
        },
      },
    ],
  };
}

function universe(revision: string, observedAt: string, markets: readonly string[]): MarketUniverseSnapshot {
  return {
    dex: 'hyperliquid', revision, observedAt,
    markets: markets.map((symbol) => ({ symbol, active: true, sizeDecimals: 4, maximumLeverage: 20 })),
  };
}

function marketValues(market: string, mark: number, rsi: number, observedAt: string) {
  return {
    'market.price': observed({ market, bid: mark, ask: mark, mark }, `sha256:price:${market}:${mark}`, observedAt),
    'indicator.rsi': observed({ value: rsi }, `sha256:rsi:${market}:${rsi}`, observedAt),
  };
}

function twoMarketRequest(): BacktestRequest {
  const firstTimestamp = '2026-09-03T08:15:00.000Z';
  const secondTimestamp = '2026-09-03T08:30:00.000Z';
  return {
    strategy,
    marketUniverse: { mode: 'all_available' },
    datasetCoverage: {
      markets: ['ETH-PERP', 'BTC-PERP'],
      from: '2026-09-03T08:00:00.000Z',
      to: secondTimestamp,
    },
    range: { from: '2026-09-03T08:00:00.000Z', to: secondTimestamp },
    assumptions: {
      startingCapital: '10000', feeRateBps: 0, slippageBps: 0,
      latencyMs: 0, partialFillRatio: 1, maintenanceMarginRate: 0.05,
    },
    inputs: [
      {
        occurredAt: firstTimestamp, priority: 1, stableId: 'dynamic-1',
        triggerNodeId: 't-15m', triggerInput: { kind: 'interval', occurredAt: firstTimestamp },
        universe: universe('universe:1', firstTimestamp, ['BTC-PERP']),
        marketValues: { 'BTC-PERP': marketValues('BTC-PERP', 100, 25, firstTimestamp) },
      },
      {
        occurredAt: secondTimestamp, priority: 1, stableId: 'dynamic-2',
        triggerNodeId: 't-15m', triggerInput: { kind: 'interval', occurredAt: secondTimestamp },
        universe: universe('universe:2', secondTimestamp, ['ETH-PERP', 'BTC-PERP']),
        marketValues: {
          'BTC-PERP': marketValues('BTC-PERP', 110, 45, secondTimestamp),
          'ETH-PERP': marketValues('ETH-PERP', 200, 25, secondTimestamp),
        },
      },
    ],
  };
}

function portfolioValues(market: string, mark: number, observedAt: string) {
  return {
    'market.price': observed({ market, bid: mark, ask: mark, mark }, `sha256:portfolio:${market}:${mark}`, observedAt),
    'indicator.rsi.14': observed({ value: 25 }, `sha256:portfolio:rsi:${market}:${observedAt}`, observedAt),
    'market.funding': observed({ rate: 0.001 }, `sha256:portfolio:funding:${market}:${observedAt}`, observedAt),
    'data.etf_flow.btc.net_daily': observed({ usd: -1 }, `sha256:portfolio:flow:${market}:${observedAt}`, observedAt),
  };
}

function portfolioRoundTripRequest(): BacktestRequest {
  const intervalAt = '2026-09-03T08:15:00.000Z';
  const ethCloseAt = '2026-09-03T08:30:00.000Z';
  const btcCloseAt = '2026-09-03T08:45:00.000Z';
  const closeEvent = (id: string, market: string, occurredAt: string) => ({
    id, type: 'data.etf_flow.updated', market, occurredAt, receivedAt: occurredAt,
    source: 'fixture.etf', payload: { asset: 'BTC' },
    quality: { status: 'verified' as const, freshnessSeconds: 0 },
  });
  return {
    strategy: btcEtfRsiBacktestRequest().strategy,
    marketUniverse: { mode: 'all_available' },
    datasetCoverage: {
      markets: ['BTC-PERP', 'ETH-PERP'],
      from: '2026-09-03T08:00:00.000Z', to: btcCloseAt,
    },
    range: { from: '2026-09-03T08:00:00.000Z', to: btcCloseAt },
    assumptions: {
      startingCapital: '10000', feeRateBps: 0, slippageBps: 0,
      latencyMs: 0, partialFillRatio: 1, maintenanceMarginRate: 0.05,
    },
    inputs: [
      {
        occurredAt: intervalAt, priority: 1, stableId: 'portfolio-open',
        triggerNodeId: 't-15m', triggerInput: { kind: 'interval', occurredAt: intervalAt },
        universe: universe('universe:open', intervalAt, ['BTC-PERP', 'ETH-PERP']),
        marketValues: {
          'BTC-PERP': portfolioValues('BTC-PERP', 100, intervalAt),
          'ETH-PERP': portfolioValues('ETH-PERP', 200, intervalAt),
        },
      },
      {
        occurredAt: ethCloseAt, priority: 1, stableId: 'portfolio-close-eth',
        triggerNodeId: 't-etf',
        triggerInput: { kind: 'event', event: closeEvent('close-eth', 'ETH-PERP', ethCloseAt) },
        universe: universe('universe:close-eth', ethCloseAt, ['BTC-PERP', 'ETH-PERP']),
        marketValues: {
          'BTC-PERP': portfolioValues('BTC-PERP', 105, ethCloseAt),
          'ETH-PERP': portfolioValues('ETH-PERP', 220, ethCloseAt),
        },
      },
      {
        occurredAt: btcCloseAt, priority: 1, stableId: 'portfolio-close-btc',
        triggerNodeId: 't-etf',
        triggerInput: { kind: 'event', event: closeEvent('close-btc', 'BTC-PERP', btcCloseAt) },
        universe: universe('universe:close-btc', btcCloseAt, ['BTC-PERP', 'ETH-PERP']),
        marketValues: {
          'BTC-PERP': portfolioValues('BTC-PERP', 110, btcCloseAt),
          'ETH-PERP': portfolioValues('ETH-PERP', 225, btcCloseAt),
        },
      },
    ],
  };
}

describe('runBacktest', () => {
  it.each([
    ['non-parseable', 'not-a-timestamp'],
    ['future-dated', '2026-09-03T08:31:00.000Z'],
  ])('rejects a %s universe snapshot before replay or portfolio mutation', (_label, observedAt) => {
    const base = twoMarketRequest();
    const second = base.inputs[1]!;
    const shouldCancel = vi.fn(() => false);
    const onProgress = vi.fn();

    expect(() => runBacktest({
      ...base,
      inputs: [base.inputs[0]!, {
        ...second,
        universe: { ...second.universe, observedAt },
      }],
      shouldCancel,
      onProgress,
    })).toThrow('BACKTEST_FRAME_UNIVERSE_TIME_INVALID');
    expect(shouldCancel).not.toHaveBeenCalled();
    expect(onProgress.mock.calls.map(([progress]) => progress.phase)).toEqual(['validating']);
  });

  it('replays the point-in-time dataset universe instead of a current live universe', () => {
    const result = runBacktest(twoMarketRequest());
    const marketsAt = (timestamp: string) => result.traces
      .filter(({ parentTrace }) => parentTrace[0]?.evaluationTime === timestamp)
      .flatMap(({ children }) => children.map(({ market }) => market));

    expect(marketsAt('2026-09-03T08:15:00.000Z')).toEqual(['BTC-PERP']);
    expect(marketsAt('2026-09-03T08:30:00.000Z')).toEqual(['BTC-PERP', 'ETH-PERP']);
    expect(result.datasetCoverage.markets).toEqual(['BTC-PERP', 'ETH-PERP']);
  });

  it('uses one shared account and reports deterministic per-market metrics', () => {
    const result = runBacktest(twoMarketRequest());

    expect(result.snapshot.positions.map(({ market }) => market).sort()).toEqual(['BTC-PERP', 'ETH-PERP']);
    expect(result.metrics.endingEquity).toBe(result.equityCurve.at(-1)?.equity);
    expect(result.perMarket.reduce((total, metric) => total + Number(metric.realizedPnl), 0).toString())
      .toBe(result.metrics.realizedPnl);
    expect(result.metrics.realizedPnl).toBe(result.snapshot.realizedPnl);
    expect(result.perMarket.map(({ market }) => market)).toEqual(['BTC-PERP', 'ETH-PERP']);
  });

  it('reconciles non-zero realized PnL and trade outcomes across markets', () => {
    const result = runBacktest(portfolioRoundTripRequest());

    expect(result.snapshot.positions).toEqual([]);
    expect(result.metrics).toMatchObject({ endingEquity: '10200', realizedPnl: '200', tradeCount: 2 });
    expect(result.perMarket).toEqual([
      expect.objectContaining({ market: 'BTC-PERP', realizedPnl: '100', tradeCount: 1, winRatePercent: 100 }),
      expect.objectContaining({ market: 'ETH-PERP', realizedPnl: '100', tradeCount: 1, winRatePercent: 100 }),
    ]);
    expect(result.perMarket.reduce((total, metric) => total + Number(metric.realizedPnl), 0).toString())
      .toBe(result.metrics.realizedPnl);
  });

  it('filters frame membership by the requested dataset markets and rejects absent includes', () => {
    const included = { ...twoMarketRequest(), marketUniverse: { mode: 'include' as const, markets: ['BTC-PERP'] } };

    const result = runBacktest(included);

    expect(result.traces.flatMap(({ children }) => children.map(({ market }) => market)))
      .toEqual(['BTC-PERP', 'BTC-PERP']);
    expect(result.datasetCoverage.markets).toEqual(['BTC-PERP', 'ETH-PERP']);

    const absent = { ...twoMarketRequest(), marketUniverse: { mode: 'include' as const, markets: ['SOL-PERP'] } };
    expect(() => runBacktest(absent)).toThrow(/absent from dataset coverage.*SOL-PERP/i);
  });

  it('evaluates a market Event only for its event market through the coordinator', () => {
    const occurredAt = '2026-09-03T08:45:00.000Z';
    const event = {
      id: 'eth-etf-event', type: 'data.etf_flow.updated', market: 'ETH-PERP',
      occurredAt, receivedAt: occurredAt, source: 'fixture.etf', payload: { asset: 'BTC' },
      quality: { status: 'verified' as const, freshnessSeconds: 0 },
    };
    const result = runBacktest({
      strategy: btcEtfRsiBacktestRequest().strategy,
      marketUniverse: { mode: 'all_available' },
      datasetCoverage: {
        markets: ['BTC-PERP', 'ETH-PERP'],
        from: '2026-09-03T08:00:00.000Z', to: occurredAt,
      },
      range: { from: '2026-09-03T08:00:00.000Z', to: occurredAt },
      assumptions: request().assumptions,
      inputs: [{
        occurredAt, priority: 1, stableId: 'event-eth', triggerNodeId: 't-etf',
        triggerInput: { kind: 'event', event },
        universe: universe('universe:event', occurredAt, ['BTC-PERP', 'ETH-PERP']),
        marketValues: {
          'BTC-PERP': {
            ...marketValues('BTC-PERP', 100, 25, occurredAt),
            'data.etf_flow.btc.net_daily': observed({ usd: -1 }, 'sha256:flow:btc', occurredAt),
          },
          'ETH-PERP': {
            ...marketValues('ETH-PERP', 200, 25, occurredAt),
            'data.etf_flow.btc.net_daily': observed({ usd: -1 }, 'sha256:flow:eth', occurredAt),
          },
        },
      }],
    });

    expect(result.traces[0]?.children.map(({ market }) => market)).toEqual(['ETH-PERP']);
    expect(result.traces[0]?.children[0]?.evaluation.trace[0]).toMatchObject({
      market: 'ETH-PERP', universeRevision: 'universe:event',
    });
  });

  it('reports deterministic market-specific stale and missing-coverage warnings', () => {
    const base = twoMarketRequest();
    const second = base.inputs[1]!;
    const btcValues = second.marketValues['BTC-PERP']!;
    const result = runBacktest({
      ...base,
      inputs: [base.inputs[0]!, {
        ...second,
        marketValues: {
          'BTC-PERP': {
            ...btcValues,
            'indicator.rsi': {
              ...btcValues['indicator.rsi']!,
              quality: { status: 'stale' },
            },
          },
        },
      }],
    });

    expect(result.warnings).toEqual(['missing_market_coverage', 'stale_data:BTC-PERP']);
  });

  it.each([
    ['missing', undefined, ['stale_mark:BTC-PERP:missing']],
    ['invalid', 'invalid', ['stale_mark:BTC-PERP:invalid']],
    ['unauthorized', 'unauthorized', ['stale_mark:BTC-PERP:unauthorized']],
    ['stale', 'stale', ['stale_data:BTC-PERP', 'stale_mark:BTC-PERP:stale']],
  ] as const)(
    'warns when an inactive held market falls back from a %s current-frame price',
    (_label, status, expectedWarnings) => {
      const base = twoMarketRequest();
      const first = base.inputs[0]!;
      const second = base.inputs[1]!;
      const currentPrice = second.marketValues['BTC-PERP']!['market.price']!;
      const marketPrice: Record<string, EvaluationValue<unknown>> = {};
      if (status !== undefined) {
        marketPrice['market.price'] = { ...currentPrice, quality: { status } };
      }
      const result = runBacktest({
        ...base,
        datasetCoverage: { ...base.datasetCoverage, markets: ['BTC-PERP'] },
        inputs: [first, {
          ...second,
          universe: {
            dex: 'hyperliquid', revision: 'universe:inactive', observedAt: second.occurredAt,
            markets: [{
              symbol: 'BTC-PERP', active: false, sizeDecimals: 4, maximumLeverage: 20,
            }],
          },
          marketValues: {
            'BTC-PERP': {
              ...marketPrice,
              'indicator.rsi': second.marketValues['BTC-PERP']!['indicator.rsi']!,
            },
          },
        }],
      });

      expect(result.snapshot).toMatchObject({
        equity: '10000',
        positions: [expect.objectContaining({ market: 'BTC-PERP', entryPrice: '100' })],
      });
      expect(result.traces[1]?.children).toEqual([]);
      expect(result.warnings).toEqual(expectedWarnings);
    },
  );

  it('marks an inactive held market when its current-frame price is usable', () => {
    const base = twoMarketRequest();
    const second = base.inputs[1]!;
    const result = runBacktest({
      ...base,
      datasetCoverage: { ...base.datasetCoverage, markets: ['BTC-PERP'] },
      inputs: [base.inputs[0]!, {
        ...second,
        universe: {
          dex: 'hyperliquid', revision: 'universe:inactive-priced', observedAt: second.occurredAt,
          markets: [{ symbol: 'BTC-PERP', active: false, sizeDecimals: 4, maximumLeverage: 20 }],
        },
        marketValues: { 'BTC-PERP': second.marketValues['BTC-PERP']! },
      }],
    });

    expect(result.snapshot).toMatchObject({
      equity: '10100',
      positions: [expect.objectContaining({ market: 'BTC-PERP' })],
    });
    expect(result.traces[1]?.children).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('replays point-in-time inputs and returns metrics, trades, and complete traces', () => {
    const result = runSingleMarketBacktest(request());

    expect(result.status).toBe('completed');
    expect(result.traces).toHaveLength(2);
    expect(result.traces[0]?.at(-1)?.type).toBe('flow.completed');
    expect(result.traces[1]?.at(-1)?.type).toBe('flow.skipped');
    expect(result.equityCurve).toEqual([
      { timestamp: '2026-09-03T08:00:00.000Z', equity: '10000' },
      { timestamp: '2026-09-03T08:15:00.000Z', equity: '9999' },
      { timestamp: '2026-09-03T08:30:00.000Z', equity: '10049' },
    ]);
    expect(result.metrics).toMatchObject({ returnPercent: 0.49, tradeCount: 0, fees: '1' });
    expect(result.manifest).toEqual(expect.objectContaining({
      strategyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      inputHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      assumptionsHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      artifactHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    }));
  });

  it('is reproducible and changes the appropriate hash when an input changes', () => {
    const first = runSingleMarketBacktest(request());
    const second = runSingleMarketBacktest(request());
    const changedRequest = request();
    changedRequest.inputs[1]!.values['indicator.rsi'] = observed({ value: 20 }, 'sha256:rsi-changed');
    const changed = runSingleMarketBacktest(changedRequest);
    const assumptionsRequest = request();
    const changedAssumptionsRequest = {
      ...assumptionsRequest,
      assumptions: { ...assumptionsRequest.assumptions, feeRateBps: 20 },
    };
    const changedAssumptions = runSingleMarketBacktest(changedAssumptionsRequest);
    const changedStrategyRequest = {
      ...request(),
      strategy: parseStrategyDocument({
        ...strategy,
        strategy: { ...strategy.strategy, version: 2 },
      }),
    };
    const changedStrategy = runSingleMarketBacktest(changedStrategyRequest);

    expect(first.serializedArtifact).toBe(second.serializedArtifact);
    expect(first.manifest.artifactHash).toBe(second.manifest.artifactHash);
    expect(changed.manifest.strategyHash).toBe(first.manifest.strategyHash);
    expect(changed.manifest.inputHash).not.toBe(first.manifest.inputHash);
    expect(changed.manifest.artifactHash).not.toBe(first.manifest.artifactHash);
    expect(changedAssumptions.manifest.inputHash).toBe(first.manifest.inputHash);
    expect(changedAssumptions.manifest.assumptionsHash).not.toBe(first.manifest.assumptionsHash);
    expect(changedStrategy.manifest.inputHash).toBe(first.manifest.inputHash);
    expect(changedStrategy.manifest.strategyHash).not.toBe(first.manifest.strategyHash);
  });

  it('reports progress phases and returns a reproducible partial result when cancelled', () => {
    const onProgress = vi.fn();
    let checks = 0;
    const result = runSingleMarketBacktest({
      ...request(),
      shouldCancel: () => ++checks > 1,
      onProgress,
    });

    expect(result.status).toBe('cancelled');
    expect(result.traces).toHaveLength(1);
    expect(onProgress.mock.calls.map(([progress]) => progress.phase)).toEqual([
      'validating', 'replaying', 'calculating', 'completed',
    ]);
  });

  it('warns when historical coverage is sparse or a supplied value is stale', () => {
    const base = request();
    const first = base.inputs[0]!;
    const sparse = {
      ...base,
      inputs: [{
        ...first,
        values: {
          ...first.values,
          'indicator.rsi': {
            ...first.values['indicator.rsi']!,
            quality: { status: 'stale' as const },
          },
        },
      }],
    };

    expect(runSingleMarketBacktest(sparse).warnings).toEqual(['insufficient_history', 'stale_data:BTC-PERP']);
  });

  it('reproduces the M1 interval/event, nested-condition, open/close acceptance flow', () => {
    const first = runSingleMarketBacktest(btcEtfRsiBacktestRequest());
    const second = runSingleMarketBacktest(btcEtfRsiBacktestRequest());

    expect(first.serializedArtifact).toBe(second.serializedArtifact);
    expect(first.manifest.artifactHash).toBe(second.manifest.artifactHash);
    expect(first.traces.map((trace) => trace.at(-1)?.type)).toEqual([
      'flow.completed', 'flow.skipped', 'flow.completed',
    ]);
    expect(first.traces[1]).toContainEqual(expect.objectContaining({
      type: 'condition.evaluated',
      nodeId: 'c-rsi',
      details: expect.objectContaining({ result: 'unknown', reason: 'data.stale' }),
    }));
    expect(first.trades).toHaveLength(1);
    expect(first.metrics).toMatchObject({ tradeCount: 1, winRatePercent: 100 });
  });
});
