import { describe, expect, it } from 'vitest';

import { calculateBacktestMetrics, calculatePerMarketBacktestMetrics } from './metrics';

describe('calculateBacktestMetrics', () => {
  it('returns finite zero metrics for an empty trading run', () => {
    expect(calculateBacktestMetrics({
      startingCapital: '10000',
      equityCurve: [{ timestamp: '2026-09-01T00:00:00.000Z', equity: '10000' }],
      closedTrades: [], totalFees: '0', totalFunding: '0',
    })).toEqual({
      returnPercent: 0,
      maximumDrawdownPercent: 0,
      sharpeLike: 0,
      winRatePercent: 0,
      tradeCount: 0,
      fees: '0',
      funding: '0',
      endingEquity: '10000',
      realizedPnl: '0',
    });
  });

  it('derives return and peak-to-trough drawdown from hand-checked equity', () => {
    const metrics = calculateBacktestMetrics({
      startingCapital: '100',
      equityCurve: [
        { timestamp: '2026-09-01T00:00:00.000Z', equity: '100' },
        { timestamp: '2026-09-02T00:00:00.000Z', equity: '120' },
        { timestamp: '2026-09-03T00:00:00.000Z', equity: '90' },
      ],
      closedTrades: [], totalFees: '2.5', totalFunding: '1.25',
    });

    expect(metrics.returnPercent).toBe(-10);
    expect(metrics.maximumDrawdownPercent).toBe(25);
    expect(metrics.sharpeLike).toBeCloseTo(-0.157135, 5);
    expect(metrics.fees).toBe('2.5');
    expect(metrics.funding).toBe('1.25');
  });

  it('counts only closed trades and calculates win rate from realized PnL', () => {
    const metrics = calculateBacktestMetrics({
      startingCapital: '100', equityCurve: [], totalFees: '0', totalFunding: '0',
      closedTrades: [
        { realizedPnl: '10' },
        { realizedPnl: '-5' },
        { realizedPnl: '0' },
      ],
    });

    expect(metrics.tradeCount).toBe(3);
    expect(metrics.winRatePercent).toBeCloseTo(33.33333333, 7);
    expect(metrics.endingEquity).toBe('100');
    expect(metrics.realizedPnl).toBe('5');
  });

  it('attributes closed trades and the aggregate drawdown window by market', () => {
    const perMarket = calculatePerMarketBacktestMetrics({
      startingCapital: '100',
      markets: ['ETH-PERP', 'BTC-PERP'],
      equityCurve: [
        { timestamp: '2026-09-01T00:00:00.000Z', equity: '100' },
        { timestamp: '2026-09-02T00:00:00.000Z', equity: '120' },
        { timestamp: '2026-09-03T00:00:00.000Z', equity: '90' },
      ],
      marketContributionCurve: [
        { timestamp: '2026-09-01T00:00:00.000Z', contributions: { 'BTC-PERP': '0', 'ETH-PERP': '0' } },
        { timestamp: '2026-09-02T00:00:00.000Z', contributions: { 'BTC-PERP': '10', 'ETH-PERP': '10' } },
        { timestamp: '2026-09-03T00:00:00.000Z', contributions: { 'BTC-PERP': '-5', 'ETH-PERP': '-5' } },
      ],
      closedTrades: [
        { market: 'ETH-PERP', realizedPnl: '-5' },
        { market: 'BTC-PERP', realizedPnl: '10' },
      ],
    });

    expect(perMarket).toEqual([
      { market: 'BTC-PERP', realizedPnl: '10', tradeCount: 1, winRatePercent: 100, drawdownContributionPercent: 12.5 },
      { market: 'ETH-PERP', realizedPnl: '-5', tradeCount: 1, winRatePercent: 0, drawdownContributionPercent: 12.5 },
    ]);
  });

  it('rejects non-finite or non-positive capital inputs', () => {
    expect(() => calculateBacktestMetrics({
      startingCapital: 'NaN', equityCurve: [], closedTrades: [], totalFees: '0', totalFunding: '0',
    })).toThrow(/starting capital/i);
    expect(() => calculateBacktestMetrics({
      startingCapital: '0', equityCurve: [], closedTrades: [], totalFees: '0', totalFunding: '0',
    })).toThrow(/starting capital/i);
  });
});
