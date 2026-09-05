import { createHash, randomUUID } from 'node:crypto';
import {
  BacktestSummarySchema,
  type BacktestAssumptionsViewSchema,
  type BacktestMarketUniverse,
  type BacktestSummary,
  type DexId,
} from '@catbots/contracts';
import {
  runBacktest,
  type AuditEvent,
  type BacktestAssumptions,
  type BacktestInput,
  type EvaluationValue,
  type JsonValue,
  type MarketUniverseSnapshot,
  type StrategyDocument,
} from '@catbots/strategy-runtime';
import type { z } from 'zod';

type PublicAssumptions = z.infer<typeof BacktestAssumptionsViewSchema>;

export type BundledSampleDatasetCatalog = Readonly<{
  dex: DexId;
  markets: readonly string[];
  from: string;
  to: string;
  limitations: string;
}>;

export const bundledSampleDatasetCatalog: BundledSampleDatasetCatalog = Object.freeze({
  dex: 'hyperliquid',
  markets: Object.freeze(['BTC-PERP', 'ETH-PERP']),
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-09-01T00:00:00.000Z',
  limitations: 'Bundled synthetic coverage includes only BTC-PERP and ETH-PERP; it does not represent every Hyperliquid market.',
});

export type SampleBacktestDependencies = Readonly<{
  clock?: () => Date;
  idFactory?: () => string;
  shouldCancel?: () => boolean;
  onProgress?: (completed: number, total: number) => void;
}>;

export function runBundledSampleBacktest(
  botId: string,
  revisionVersion: number,
  strategy: StrategyDocument,
  dex: DexId,
  marketUniverse: BacktestMarketUniverse,
  assumptions: PublicAssumptions,
  dependencies: SampleBacktestDependencies = {},
): { summary: BacktestSummary; artifact: string } {
  if (dex !== bundledSampleDatasetCatalog.dex) {
    throw new Error('Bundled sample dataset does not cover the selected DEX');
  }
  const startedAt = (dependencies.clock ?? (() => new Date()))().toISOString();
  const result = runBacktest({
    strategy,
    marketUniverse,
    datasetCoverage: {
      markets: bundledSampleDatasetCatalog.markets,
      from: bundledSampleDatasetCatalog.from,
      to: bundledSampleDatasetCatalog.to,
    },
    range: { from: assumptions.from, to: assumptions.to },
    assumptions: toRuntimeAssumptions(assumptions),
    inputs: buildSampleInputs(strategy, assumptions),
    shouldCancel: dependencies.shouldCancel,
    onProgress: (progress) => dependencies.onProgress?.(progress.completed, progress.total),
  });
  const completedAt = (dependencies.clock ?? (() => new Date()))().toISOString();
  const artifactHash = `sha256:${createHash('sha256').update(result.serializedArtifact).digest('hex')}`;
  const id = (dependencies.idFactory ?? randomUUID)();
  const childTraces = result.traces.flatMap(({ children }) => children.map(({ evaluation }) => evaluation.trace));
  const summary = BacktestSummarySchema.parse({
    id,
    botId,
    revisionVersion,
    status: result.status,
    dataSource: 'Bundled sample data',
    startedAt,
    completedAt,
    assumptions,
    metrics: result.metrics,
    datasetCoverage: result.datasetCoverage,
    perMarket: result.perMarket,
    equityCurve: result.equityCurve,
    trades: toBacktestTrades(result.trades, childTraces),
    warnings: [
      bundledSampleDatasetCatalog.limitations,
      'Bundled sample data is synthetic and is not live market data.',
      ...result.warnings,
    ],
    traces: result.traces.flatMap(({ parentTraceId, children }) => children.map(({ market, evaluation }) => (
      toTraceSummary(evaluation.trace, parentTraceId, market)
    ))),
    artifactHash,
  });
  return { summary, artifact: result.serializedArtifact };
}

function toRuntimeAssumptions(input: PublicAssumptions): BacktestAssumptions {
  return {
    startingCapital: input.startingCapital,
    feeRateBps: input.feeRateBps,
    slippageBps: input.slippageBps,
    latencyMs: 100,
    partialFillRatio: 1,
    maintenanceMarginRate: 0.05,
  };
}

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
      Object.freeze({ symbol: 'ETH-PERP', mark: 200, rsi: 25, funding: -0.0002, volume: 1_000_000_000, rank: 2 }),
    ]),
  }),
]);

function buildSampleInputs(strategy: StrategyDocument, assumptions: PublicAssumptions): BacktestInput[] {
  const intervalTriggers = strategy.nodes.filter((node) => node.kind === 'trigger' && node.type === 'trigger.interval');
  const eventTriggers = strategy.nodes.filter((node) => node.kind === 'trigger' && node.type === 'trigger.event');
  const inputs: BacktestInput[] = [];
  for (const [frameIndex, frame] of sampleFrames.entries()) {
    if (!withinRange(frame.occurredAt, assumptions)) continue;
    const universe = sampleUniverse(frame);
    const marketValues = Object.fromEntries(frame.markets.map((market) => [
      market.symbol,
      sampleValues(strategy, market, frame.occurredAt),
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
  if (withinRange(eventTime, assumptions)) {
    const listedFrame = sampleFrames[1]!;
    const universe = sampleUniverse({ ...listedFrame, occurredAt: eventTime, revision: 'bundled:event-frame' });
    const marketValues = Object.fromEntries(listedFrame.markets.map((market) => [
      market.symbol,
      sampleValues(strategy, market, eventTime),
    ]));
    for (const [triggerIndex, trigger] of eventTriggers.entries()) {
      const eventType = typeof trigger.config.eventType === 'string' ? trigger.config.eventType : 'sample.event';
      for (const [marketIndex, market] of listedFrame.markets.entries()) {
        inputs.push({
          occurredAt: eventTime,
          priority: intervalTriggers.length + triggerIndex * listedFrame.markets.length + marketIndex,
          stableId: `sample:event:${trigger.id}:${market.symbol}`,
          triggerNodeId: trigger.id,
          triggerInput: {
            kind: 'event',
            event: {
              id: `sample-event:${trigger.id}:${market.symbol}`,
              type: eventType,
              market: market.symbol,
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

function withinRange(timestamp: string, assumptions: PublicAssumptions): boolean {
  const parsed = Date.parse(timestamp);
  return parsed >= Date.parse(assumptions.from) && parsed <= Date.parse(assumptions.to);
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
    integrityHash: `sha256:${createHash('sha256').update(`${ref}:${market.symbol}:${observedAt}`).digest('hex')}`,
  }]));
}

function toTraceSummary(trace: readonly AuditEvent[], parentTraceId: string, market: string) {
  const last = trace.at(-1);
  const types = new Set(trace.map((event) => event.type));
  const outcome = types.has('flow.failed') ? 'failed'
    : types.has('execution.rejected') ? 'rejected'
      : types.has('flow.skipped') ? 'skipped'
        : types.has('flow.completed') ? 'executed'
          : 'unknown';
  return {
    traceId: trace[0]?.traceId ?? 'unknown-trace',
    parentTraceId,
    market,
    outcome,
    occurredAt: trace[0]?.evaluationTime ?? new Date(0).toISOString(),
    summary: last?.type.replaceAll('.', ' ') ?? 'No trace events',
  };
}

function toBacktestTrades(
  trades: readonly Readonly<Record<string, JsonValue>>[],
  traces: readonly (readonly AuditEvent[])[],
) {
  const closingTraces = traces.filter((trace) => trace.some((event) => (
    event.type === 'execution.filled' && event.nodeType === 'execution.close_position'
  )));
  return trades.map((trade, index) => ({
    traceId: closingTraces[index]?.[0]?.traceId ?? `trade:${index + 1}`,
    market: requiredTradeString(trade.market),
    side: trade.positionSide === 'short' ? 'short' as const : 'long' as const,
    openedAt: requiredTradeString(trade.openedAt ?? trade.timestamp),
    closedAt: requiredTradeString(trade.timestamp),
    entryPrice: requiredTradeString(trade.entryPrice ?? trade.price),
    exitPrice: requiredTradeString(trade.price),
    realizedPnl: requiredTradeString(trade.realizedPnl ?? '0'),
  }));
}

function requiredTradeString(value: JsonValue | undefined): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Backtest trade is missing a required value');
  return value;
}
