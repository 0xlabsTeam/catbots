import { describe, expect, it } from 'vitest';
import { parseStrategyDocument } from '@catbots/strategy-runtime';

import { runBundledSampleBacktest } from '../src/main/workbench/sample-backtest-data';

const complexStrategy = parseStrategyDocument({
  schemaVersion: '1.0',
  strategy: { id: 'complex-trade', name: 'Complex trade', version: 1 },
  nodes: [
    { id: 't-open', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
    { id: 'c-flat', kind: 'condition', type: 'predicate.position_state', version: 1, config: { state: 'flat', market: 'BTC-PERP' } },
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
    { id: 'e2', source: 't-open', sourcePort: 'activation', target: 'c-rsi', targetPort: 'activation' },
    { id: 'e3', source: 't-open', sourcePort: 'activation', target: 'c-funding', targetPort: 'activation' },
    { id: 'e4', source: 'c-rsi', sourcePort: 'result', target: 'c-at-least', targetPort: 'conditions' },
    { id: 'e5', source: 'c-funding', sourcePort: 'result', target: 'c-at-least', targetPort: 'conditions' },
    { id: 'e6', source: 'c-flat', sourcePort: 'result', target: 'c-entry', targetPort: 'conditions' },
    { id: 'e7', source: 'c-at-least', sourcePort: 'result', target: 'c-entry', targetPort: 'conditions' },
    { id: 'e8', source: 'c-entry', sourcePort: 'result', target: 'a-open', targetPort: 'condition' },
    { id: 'e9', source: 't-close', sourcePort: 'activation', target: 'c-etf', targetPort: 'activation' },
    { id: 'e10', source: 'c-etf', sourcePort: 'result', target: 'a-close', targetPort: 'condition' },
  ],
});

describe('bundled sample backtest presentation', () => {
  it('returns the closed trade that contributes to the performance metrics', () => {
    const result = runBundledSampleBacktest(
      '018f3f75-89ab-7def-8123-456789abcdef',
      1,
      complexStrategy,
      'BTC-PERP',
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
  });
});
