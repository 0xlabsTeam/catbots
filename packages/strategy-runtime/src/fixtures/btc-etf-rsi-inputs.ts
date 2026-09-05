import type { LegacySingleMarketBacktestRequest } from '../backtest';
import type { EvaluationValue, TriggerEvent } from '../evaluation-context';
import { btcEtfRsiStrategy } from './btc-etf-rsi';

function value(
  input: unknown,
  observedAt: string,
  identity: string,
  status: 'verified' | 'stale' = 'verified',
): EvaluationValue<unknown> {
  return {
    value: input,
    provider: identity.startsWith('etf') ? 'fixture.etf_flow' : 'fixture.market',
    observedAt,
    freshnessSeconds: status === 'stale' ? 3_600 : 0,
    quality: { status },
    integrityHash: `sha256:${identity}`,
  };
}

function market(mark: number, observedAt: string): EvaluationValue<unknown> {
  return value({ market: 'BTC-PERP', bid: mark, ask: mark, mark }, observedAt, `price-${mark}`);
}

export function btcEtfRsiBacktestRequest(): LegacySingleMarketBacktestRequest {
  const etfEvent: TriggerEvent = {
    id: 'evt-etf-negative',
    type: 'data.etf_flow.updated',
    market: 'BTC-PERP',
    occurredAt: '2026-09-03T08:45:00.000Z',
    receivedAt: '2026-09-03T08:45:02.000Z',
    source: 'fixture.etf_flow',
    payload: { asset: 'BTC', usd: -100_000_000 },
    quality: { status: 'verified', freshnessSeconds: 2 },
  };

  return {
    strategy: btcEtfRsiStrategy,
    market: 'BTC-PERP',
    range: { from: '2026-09-03T08:00:00.000Z', to: '2026-09-03T08:45:00.000Z' },
    assumptions: {
      startingCapital: '10000', feeRateBps: 10, slippageBps: 0,
      latencyMs: 100, partialFillRatio: 0.5, maintenanceMarginRate: 0.05,
    },
    inputs: [
      {
        occurredAt: '2026-09-03T08:15:00.000Z', priority: 1, stableId: 'interval-0815',
        triggerNodeId: 't-15m',
        triggerInput: { kind: 'interval', occurredAt: '2026-09-03T08:15:00.000Z' },
        values: {
          'market.price': market(100, '2026-09-03T08:15:00.000Z'),
          'indicator.rsi.14': value({ value: 25 }, '2026-09-03T08:15:00.000Z', 'rsi-25'),
          'market.funding': value({ rate: 0.001 }, '2026-09-03T08:15:00.000Z', 'funding-positive'),
        },
      },
      {
        occurredAt: '2026-09-03T08:30:00.000Z', priority: 1, stableId: 'interval-0830',
        triggerNodeId: 't-15m',
        triggerInput: { kind: 'interval', occurredAt: '2026-09-03T08:30:00.000Z' },
        values: {
          'market.price': market(105, '2026-09-03T08:30:00.000Z'),
          'indicator.rsi.14': value({ value: 25 }, '2026-09-03T07:30:00.000Z', 'rsi-stale', 'stale'),
          'market.funding': value({ rate: 0.001 }, '2026-09-03T08:30:00.000Z', 'funding-positive-2'),
        },
      },
      {
        occurredAt: '2026-09-03T08:45:00.000Z', priority: 2, stableId: 'event-etf-negative',
        triggerNodeId: 't-etf',
        triggerInput: { kind: 'event', event: etfEvent },
        values: {
          'market.price': market(110, '2026-09-03T08:45:00.000Z'),
          'data.etf_flow.btc.net_daily': value({ usd: -100_000_000 }, '2026-09-03T08:45:00.000Z', 'etf-negative'),
        },
      },
    ],
  };
}
