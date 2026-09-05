import { describe, expect, it } from 'vitest';

import { createEvaluationContext } from './evaluation-context';
import type { ProposedEffect } from './runtime';
import { SimulatedExecutionAdapter } from './simulated-adapter';

function marketContext(mark: number, bid = mark, ask = mark, market = 'BTC-PERP') {
  return createEvaluationContext({
    evaluatedAt: '2026-09-03T08:15:00.000Z',
    currentMarket: market,
    values: {
      'market.price': {
        value: { market, bid, ask, mark },
        provider: 'fixture.market', observedAt: '2026-09-03T08:15:00.000Z',
        freshnessSeconds: 0, quality: { status: 'verified' }, integrityHash: `sha256:${mark}`,
      },
    },
  });
}

function openEffect(overrides: Record<string, unknown> = {}): ProposedEffect {
  return {
    nodeId: 'a-open', type: 'execution.open_position', version: 1,
    market: 'BTC-PERP',
    config: { side: 'long', size: { type: 'quote', value: 1_000 }, leverage: 2, ...overrides },
    idempotencyKey: 'trigger-1:action:a-open',
  } as ProposedEffect;
}

function adapter(overrides: Record<string, number | string> = {}) {
  return new SimulatedExecutionAdapter({
    assumptions: {
      startingCapital: '10000', feeRateBps: 10, slippageBps: 100,
      latencyMs: 250, partialFillRatio: 0.25, maintenanceMarginRate: 0.05,
      ...overrides,
    },
  });
}

describe('SimulatedExecutionAdapter', () => {
  it('shares cash across market-keyed positions and marks each market independently', () => {
    const simulation = adapter({ slippageBps: 0, feeRateBps: 0, partialFillRatio: 1 });
    const ethEffect = {
      ...openEffect(),
      market: 'ETH-PERP',
      idempotencyKey: 'trigger-1:market:ETH-PERP:action:a-open',
    } as ProposedEffect;

    simulation.execute(openEffect(), marketContext(100));
    simulation.execute(ethEffect, marketContext(200, 200, 200, 'ETH-PERP'));
    simulation.markToMarket(marketContext(110));
    simulation.markToMarket(marketContext(180, 180, 180, 'ETH-PERP'));

    expect(simulation.snapshot()).toMatchObject({
      cash: '10000',
      equity: '10000',
      positions: [
        { market: 'BTC-PERP', quantity: '10' },
        { market: 'ETH-PERP', quantity: '5' },
      ],
    });
  });

  it('reserves margin across markets and closes only the effect market', () => {
    const simulation = adapter({ startingCapital: '1000', slippageBps: 0, feeRateBps: 0, partialFillRatio: 1 });
    const ethEffect = {
      ...openEffect({ size: { type: 'quote', value: 1_600 } }),
      market: 'ETH-PERP', idempotencyKey: 'open:ETH-PERP',
    } as ProposedEffect;
    simulation.execute(openEffect({ size: { type: 'quote', value: 1_600 } }), marketContext(100));

    expect(simulation.execute(ethEffect, marketContext(200, 200, 200, 'ETH-PERP')).events.at(-1))
      .toEqual({ type: 'execution.rejected', metadata: { code: 'INSUFFICIENT_MARGIN' } });

    const secondSimulation = adapter({ slippageBps: 0, feeRateBps: 0, partialFillRatio: 1 });
    secondSimulation.execute(openEffect(), marketContext(100));
    secondSimulation.execute({
      ...ethEffect,
      config: { ...ethEffect.config, size: { type: 'quote', value: 600 } },
    } as ProposedEffect, marketContext(200, 200, 200, 'ETH-PERP'));
    secondSimulation.execute({
      nodeId: 'close-eth', type: 'execution.close_position', version: 1,
      market: 'ETH-PERP', config: { percent: 100 }, idempotencyKey: 'close:ETH-PERP',
    } as ProposedEffect, marketContext(220, 220, 220, 'ETH-PERP'));

    expect(secondSimulation.snapshot().positions.map(({ market }) => market)).toEqual(['BTC-PERP']);
    expect(secondSimulation.snapshot().realizedPnl).toBe('60');
  });

  it('applies a frame of market marks before checking shared-account liquidation', () => {
    const simulation = adapter({
      startingCapital: '1000', slippageBps: 0, feeRateBps: 0,
      partialFillRatio: 1, maintenanceMarginRate: 0.5,
    });
    simulation.execute(openEffect({ size: { type: 'quote', value: 800 } }), marketContext(100));
    simulation.execute({
      ...openEffect({ size: { type: 'quote', value: 800 } }),
      market: 'ETH-PERP', idempotencyKey: 'open:ETH-PERP:portfolio-mark',
    } as ProposedEffect, marketContext(200, 200, 200, 'ETH-PERP'));

    const result = simulation.markPortfolio([
      marketContext(50),
      marketContext(300, 300, 300, 'ETH-PERP'),
    ]);

    expect(result.liquidated).toBe(false);
    expect(simulation.snapshot()).toMatchObject({ equity: '1000' });
    expect(simulation.snapshot().positions).toHaveLength(2);
  });

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
    const context = createEvaluationContext({
      evaluatedAt: '2026-09-03T08:15:00.000Z',
      currentMarket: 'BTC-PERP',
      values: {},
    });

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
      market: 'BTC-PERP',
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
