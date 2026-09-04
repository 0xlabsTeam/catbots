import { describe, expect, it, vi } from 'vitest';

import type { EvaluationValue } from './evaluation-context';
import { runBacktest, type BacktestRequest } from './backtest';
import { btcEtfRsiBacktestRequest } from './fixtures/btc-etf-rsi-inputs';
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

function observed(value: unknown, hash: string): EvaluationValue<unknown> {
  return {
    value, provider: 'fixture', observedAt: '2026-09-03T08:15:00.000Z',
    freshnessSeconds: 0, quality: { status: 'verified' }, integrityHash: hash,
  };
}

function request(): BacktestRequest {
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

describe('runBacktest', () => {
  it('replays point-in-time inputs and returns metrics, trades, and complete traces', () => {
    const result = runBacktest(request());

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
    const first = runBacktest(request());
    const second = runBacktest(request());
    const changedRequest = request();
    changedRequest.inputs[1]!.values['indicator.rsi'] = observed({ value: 20 }, 'sha256:rsi-changed');
    const changed = runBacktest(changedRequest);
    const changedAssumptionsRequest = request();
    changedAssumptionsRequest.assumptions = { ...changedAssumptionsRequest.assumptions, feeRateBps: 20 };
    const changedAssumptions = runBacktest(changedAssumptionsRequest);
    const changedStrategyRequest = request();
    changedStrategyRequest.strategy = parseStrategyDocument({
      ...strategy,
      strategy: { ...strategy.strategy, version: 2 },
    });
    const changedStrategy = runBacktest(changedStrategyRequest);

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
    const result = runBacktest({
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
    const sparse = request();
    sparse.inputs.splice(1);
    sparse.inputs[0]!.values['indicator.rsi'] = {
      ...sparse.inputs[0]!.values['indicator.rsi']!,
      quality: { status: 'stale' },
    };

    expect(runBacktest(sparse).warnings).toEqual(['insufficient_history', 'stale_data']);
  });

  it('reproduces the M1 interval/event, nested-condition, open/close acceptance flow', () => {
    const first = runBacktest(btcEtfRsiBacktestRequest());
    const second = runBacktest(btcEtfRsiBacktestRequest());

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
