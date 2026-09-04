import { describe, expect, it } from 'vitest';

import { createEvaluationContext } from './evaluation-context';
import type { ProposedEffect } from './runtime';
import { SimulatedExecutionAdapter } from './simulated-adapter';

function marketContext(mark: number, bid = mark, ask = mark) {
  return createEvaluationContext({
    evaluatedAt: '2026-09-03T08:15:00.000Z',
    values: {
      'market.price': {
        value: { market: 'BTC-PERP', bid, ask, mark },
        provider: 'fixture.market', observedAt: '2026-09-03T08:15:00.000Z',
        freshnessSeconds: 0, quality: { status: 'verified' }, integrityHash: `sha256:${mark}`,
      },
    },
  });
}

function openEffect(overrides: Record<string, unknown> = {}): ProposedEffect {
  return {
    nodeId: 'a-open', type: 'execution.open_position', version: 1,
    config: { side: 'long', size: { type: 'quote', value: 1_000 }, leverage: 2, ...overrides },
    idempotencyKey: 'trigger-1:action:a-open',
  } as ProposedEffect;
}

function adapter(overrides: Record<string, number | string> = {}) {
  return new SimulatedExecutionAdapter({
    market: 'BTC-PERP',
    assumptions: {
      startingCapital: '10000', feeRateBps: 10, slippageBps: 100,
      latencyMs: 250, partialFillRatio: 0.25, maintenanceMarginRate: 0.05,
      ...overrides,
    },
  });
}

describe('SimulatedExecutionAdapter', () => {
  it('fills a market intent with explicit slippage, latency, partial fill, and fee assumptions', () => {
    const simulation = adapter();

    const outcome = simulation.execute(openEffect(), marketContext(100));

    expect(outcome.events.map((event) => event.type)).toEqual([
      'risk.approved', 'execution.queued', 'execution.submitted', 'execution.acknowledged',
      'execution.partially_filled', 'execution.filled',
    ]);
    expect(outcome.events.at(-1)?.metadata).toMatchObject({
      price: '101', quantity: '9.9009901', fee: '1', filledAt: '2026-09-03T08:15:00.250Z',
    });
    expect(simulation.snapshot()).toMatchObject({
      cash: '9999',
      positions: [{ market: 'BTC-PERP', side: 'long', quantity: '9.9009901', entryPrice: '101', leverage: '2' }],
    });
  });

  it('rejects an order when required point-in-time price data is missing', () => {
    const simulation = adapter();
    const context = createEvaluationContext({ evaluatedAt: '2026-09-03T08:15:00.000Z', values: {} });

    expect(simulation.execute(openEffect(), context).events).toEqual([
      { type: 'risk.approved', metadata: { decision: 'approved', evaluator: 'backtest.simulation' } },
      { type: 'execution.queued' },
      { type: 'execution.rejected', metadata: { code: 'MARKET_PRICE_UNAVAILABLE' } },
    ]);
    expect(simulation.snapshot().positions).toEqual([]);
  });

  it('rejects an order whose initial margin exceeds current equity', () => {
    const simulation = adapter({ slippageBps: 0, feeRateBps: 0 });

    expect(simulation.execute(openEffect({ size: { type: 'quote', value: 30_000 } }), marketContext(100)).events).toEqual([
      { type: 'risk.approved', metadata: { decision: 'approved', evaluator: 'backtest.simulation' } },
      { type: 'execution.queued' },
      { type: 'execution.rejected', metadata: { code: 'INSUFFICIENT_MARGIN' } },
    ]);
  });

  it('applies funding and realizes PnL when closing a position', () => {
    const simulation = adapter({ slippageBps: 0, feeRateBps: 0, partialFillRatio: 1 });
    simulation.execute(openEffect(), marketContext(100));

    simulation.applyFunding(0.01, marketContext(100));
    const close: ProposedEffect = {
      nodeId: 'a-close', type: 'execution.close_position', version: 1,
      config: { percent: 100 }, idempotencyKey: 'trigger-2:action:a-close',
    };
    simulation.execute(close, marketContext(110));

    expect(simulation.snapshot()).toMatchObject({
      cash: '10090',
      positions: [],
      totalFunding: '10',
      realizedPnl: '100',
    });
  });

  it('liquidates when marked equity reaches maintenance margin', () => {
    const simulation = adapter({
      startingCapital: '1000', slippageBps: 0, feeRateBps: 0, partialFillRatio: 1,
    });
    simulation.execute(openEffect({ size: { type: 'quote', value: 5_000 }, leverage: 5 }), marketContext(100));

    const result = simulation.markToMarket(marketContext(84));

    expect(result.liquidated).toBe(true);
    expect(simulation.snapshot().positions).toEqual([]);
    expect(simulation.snapshot().ledger.at(-1)).toMatchObject({ type: 'liquidation', price: '84' });
  });

  it('uses the idempotency key to prevent duplicate fills', () => {
    const simulation = adapter({ slippageBps: 0, feeRateBps: 0 });
    const effect = openEffect();

    const first = simulation.execute(effect, marketContext(100));
    const second = simulation.execute(effect, marketContext(100));

    expect(second).toEqual(first);
    expect(simulation.snapshot().positions).toHaveLength(1);
  });
});
