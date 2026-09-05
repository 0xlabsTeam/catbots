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
  type JsonValue,
  type StrategyDocument,
} from '@catbots/strategy-runtime';
import type { z } from 'zod';
import {
  buildBundledSampleInputs,
  bundledSampleDatasetCatalog as sharedBundledSampleDatasetCatalog,
  type BundledSampleDatasetCatalog,
} from '../../shared/bundled-sample-fixture';

type PublicAssumptions = z.infer<typeof BacktestAssumptionsViewSchema>;

export type { BundledSampleDatasetCatalog };
export const bundledSampleDatasetCatalog = sharedBundledSampleDatasetCatalog;

export type SampleBacktestDependencies = Readonly<{
  clock?: () => Date;
  idFactory?: () => string;
  shouldCancel?: () => boolean;
  onProgress?: (completed: number, total: number) => void;
  trustedLegacyMarketBinding?: string | null;
}>;

export const legacyStrategyMarketMigrationRequired = 'LEGACY_STRATEGY_MARKET_MIGRATION_REQUIRED';

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
    marketUniverse: backtestMarketUniverse(strategy, marketUniverse, dependencies.trustedLegacyMarketBinding),
    datasetCoverage: {
      markets: bundledSampleDatasetCatalog.markets,
      from: bundledSampleDatasetCatalog.from,
      to: bundledSampleDatasetCatalog.to,
    },
    range: { from: assumptions.from, to: assumptions.to },
    assumptions: toRuntimeAssumptions(assumptions),
    inputs: buildBundledSampleInputs(strategy, assumptions, (identity) => (
      `sha256:${createHash('sha256').update(identity).digest('hex')}`
    )),
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

function backtestMarketUniverse(
  strategy: StrategyDocument,
  requested: BacktestMarketUniverse,
  trustedLegacyMarketBinding: string | null | undefined,
): BacktestMarketUniverse {
  if (strategy.schemaVersion === '2.0') return requested;
  const market = trustedLegacyMarketBinding?.trim();
  if (!market) throw new Error(legacyStrategyMarketMigrationRequired);
  return { mode: 'include', markets: [market] };
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
  const traceIdsByEffect = new Map<string, string>();
  for (const trace of traces) {
    for (const event of trace) {
      const effectIdempotencyKey = event.details.effectIdempotencyKey;
      if (event.type === 'execution.queued' && typeof effectIdempotencyKey === 'string') {
        traceIdsByEffect.set(effectIdempotencyKey, event.traceId);
      }
    }
  }
  return trades.map((trade, index) => ({
    traceId: typeof trade.effectIdempotencyKey === 'string'
      ? traceIdsByEffect.get(trade.effectIdempotencyKey) ?? `trade:${index + 1}`
      : `trade:${index + 1}`,
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
