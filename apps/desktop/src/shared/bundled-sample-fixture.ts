import type { DexId } from '@catbots/contracts';
import type {
  BacktestInput,
  EvaluationValue,
  JsonValue,
  MarketUniverseSnapshot,
  StrategyDocument,
} from '@catbots/strategy-runtime';

export type BundledSampleDatasetCatalog = Readonly<{
  dex: DexId;
  markets: readonly string[];
  from: string;
  to: string;
  limitations: string;
}>;

export type BundledSampleRange = Readonly<{ from: string; to: string }>;

export const bundledSampleDatasetCatalog: BundledSampleDatasetCatalog = Object.freeze({
  dex: 'hyperliquid',
  markets: Object.freeze(['BTC-PERP', 'ETH-PERP']),
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-09-01T00:00:00.000Z',
  limitations: 'Bundled synthetic coverage includes only BTC-PERP and ETH-PERP; it does not represent every Hyperliquid market.',
});

type SampleFrame = Readonly<{
  occurredAt: string;
  revision: string;
  markets: readonly Readonly<{
    symbol: string;
    mark: number;
    rsi: number;
    funding: number;
    volume: number;
    rank: number;
  }>[];
}>;

const sampleFrames: readonly SampleFrame[] = Object.freeze([
  Object.freeze({
    occurredAt: '2026-08-10T00:00:00.000Z',
    revision: 'bundled:before-eth-listing',
    markets: Object.freeze([
      Object.freeze({ symbol: 'BTC-PERP', mark: 100, rsi: 25, funding: -0.0001, volume: 2_000_000_000, rank: 1 }),
    ]),
  }),
  Object.freeze({
    occurredAt: '2026-08-20T00:00:00.000Z',
    revision: 'bundled:eth-listed',
    markets: Object.freeze([
      Object.freeze({ symbol: 'BTC-PERP', mark: 100, rsi: 85, funding: 0.0001, volume: 2_100_000_000, rank: 1 }),
      Object.freeze({ symbol: 'ETH-PERP', mark: 200, rsi: 15, funding: -0.0002, volume: 1_000_000_000, rank: 2 }),
    ]),
  }),
  Object.freeze({
    occurredAt: '2026-08-28T00:00:00.000Z',
    revision: 'bundled:eth-overbought',
    markets: Object.freeze([
      Object.freeze({ symbol: 'BTC-PERP', mark: 100, rsi: 85, funding: 0.0001, volume: 2_200_000_000, rank: 1 }),
      Object.freeze({ symbol: 'ETH-PERP', mark: 220, rsi: 85, funding: 0.0001, volume: 1_100_000_000, rank: 2 }),
    ]),
  }),
]);

export function buildBundledSampleInputs(
  strategy: StrategyDocument,
  range: BundledSampleRange,
  integrityHash: (identity: string) => string,
): BacktestInput[] {
  const intervalTriggers = strategy.nodes.filter((node) => node.kind === 'trigger' && node.type === 'trigger.interval');
  const eventTriggers = strategy.nodes.filter((node) => node.kind === 'trigger' && node.type === 'trigger.event');
  const inputs: BacktestInput[] = [];
  for (const [frameIndex, frame] of sampleFrames.entries()) {
    if (!withinRange(frame.occurredAt, range)) continue;
    const universe = sampleUniverse(frame);
    const marketValues = Object.fromEntries(frame.markets.map((market) => [
      market.symbol,
      sampleValues(strategy, market, frame.occurredAt, integrityHash),
    ]));
    for (const [triggerIndex, trigger] of intervalTriggers.entries()) {
      inputs.push({
        occurredAt: frame.occurredAt,
        priority: triggerIndex,
        stableId: `sample:${frameIndex}:${trigger.id}`,
        triggerNodeId: trigger.id,
        triggerInput: { kind: 'interval', occurredAt: frame.occurredAt },
        universe,
        marketValues,
        fundingRates: Object.fromEntries(frame.markets.map(({ symbol, funding }) => [symbol, funding])),
      });
    }
  }

  const eventTime = '2026-08-25T00:00:00.000Z';
  if (withinRange(eventTime, range)) {
    const listedFrame = sampleFrames[1]!;
    const universe = sampleUniverse({ ...listedFrame, occurredAt: eventTime, revision: 'bundled:event-frame' });
    const marketValues = Object.fromEntries(listedFrame.markets.map((market) => [
      market.symbol,
      sampleValues(strategy, market, eventTime, integrityHash),
    ]));
    for (const [triggerIndex, trigger] of eventTriggers.entries()) {
      const eventType = typeof trigger.config.eventType === 'string' ? trigger.config.eventType : 'sample.event';
      const eventMarkets = trigger.config.scope === 'dex' ? [undefined] : listedFrame.markets;
      for (const [marketIndex, market] of eventMarkets.entries()) {
        const marketLabel = market?.symbol ?? 'dex';
        inputs.push({
          occurredAt: eventTime,
          priority: intervalTriggers.length + triggerIndex * listedFrame.markets.length + marketIndex,
          stableId: `sample:event:${trigger.id}:${marketLabel}`,
          triggerNodeId: trigger.id,
          triggerInput: {
            kind: 'event',
            event: {
              id: `sample-event:${trigger.id}:${marketLabel}`,
              type: eventType,
              ...(market === undefined ? {} : { market: market.symbol }),
              occurredAt: eventTime,
              receivedAt: eventTime,
              source: 'catbots.bundled-sample',
              payload: typeof trigger.config.filters === 'object'
                && trigger.config.filters !== null
                && !Array.isArray(trigger.config.filters)
                ? trigger.config.filters
                : {},
              quality: { status: 'verified', freshnessSeconds: 0 },
            },
          },
          universe,
          marketValues,
        });
      }
    }
  }
  return inputs;
}

function withinRange(timestamp: string, range: BundledSampleRange): boolean {
  const parsed = Date.parse(timestamp);
  return parsed >= Date.parse(range.from) && parsed <= Date.parse(range.to);
}

function sampleUniverse(frame: SampleFrame): MarketUniverseSnapshot {
  return {
    dex: bundledSampleDatasetCatalog.dex,
    revision: frame.revision,
    observedAt: frame.occurredAt,
    markets: frame.markets.map(({ symbol }) => ({
      symbol,
      active: true,
      sizeDecimals: 4,
      maximumLeverage: 20,
    })),
  };
}

function sampleValues(
  strategy: StrategyDocument,
  market: SampleFrame['markets'][number],
  observedAt: string,
  integrityHash: (identity: string) => string,
): Record<string, EvaluationValue<unknown>> {
  const raw: Record<string, JsonValue> = {
    'market.price': { market: market.symbol, bid: market.mark, ask: market.mark, mark: market.mark },
    'market.funding': { rate: market.funding },
    'market.volume': { notional24h: market.volume },
    'market.rank': { value: market.rank },
    'indicator.rsi.14': { value: market.rsi },
    'data.etf_flow.btc.net_daily': { usd: -100_000_000 },
  };
  for (const node of strategy.nodes) {
    for (const operand of [node.config.left, node.config.right]) {
      if (typeof operand !== 'object' || operand === null || Array.isArray(operand)) continue;
      const ref = operand.ref;
      const field = operand.field;
      if (typeof ref !== 'string' || ref === 'market.symbol' || raw[ref] !== undefined) continue;
      raw[ref] = typeof field === 'string' ? { [field]: 1 } : 1;
    }
  }
  return Object.fromEntries(Object.entries(raw).map(([ref, value]) => [ref, {
    value,
    provider: 'catbots.bundled-sample',
    observedAt,
    freshnessSeconds: 0,
    quality: { status: 'verified' as const },
    integrityHash: integrityHash(`${ref}:${market.symbol}:${observedAt}`),
  }]));
}
