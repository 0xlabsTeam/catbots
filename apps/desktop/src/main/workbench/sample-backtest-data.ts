import { createHash, randomUUID } from 'node:crypto';
import {
  runBacktest,
  type AuditEvent,
  type BacktestAssumptions,
  type BacktestInput,
  type EvaluationValue,
  type JsonValue,
  type StrategyDocument,
} from '@catbots/strategy-runtime';
import { BacktestSummarySchema, type BacktestAssumptionsViewSchema, type BacktestSummary } from '@catbots/contracts';
import type { z } from 'zod';

type PublicAssumptions = z.infer<typeof BacktestAssumptionsViewSchema>;

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
  market: string,
  assumptions: PublicAssumptions,
  dependencies: SampleBacktestDependencies = {},
): { summary: BacktestSummary; artifact: string } {
  const startedAt = (dependencies.clock ?? (() => new Date()))().toISOString();
  const result = runBacktest({
    strategy,
    market,
    range: { from: assumptions.from, to: assumptions.to },
    assumptions: toRuntimeAssumptions(assumptions),
    inputs: sampleInputs(strategy, market, assumptions),
    shouldCancel: dependencies.shouldCancel,
    onProgress: (progress) => dependencies.onProgress?.(progress.completed, progress.total),
  });
  const completedAt = (dependencies.clock ?? (() => new Date()))().toISOString();
  const artifactHash = `sha256:${createHash('sha256').update(result.serializedArtifact).digest('hex')}`;
  const summary = BacktestSummarySchema.parse({
    id: (dependencies.idFactory ?? randomUUID)(),
    botId,
    revisionVersion,
    status: result.status,
    dataSource: 'Bundled sample data',
    startedAt,
    completedAt,
    assumptions,
    metrics: result.metrics,
    equityCurve: result.equityCurve,
    trades: toBacktestTrades(result.trades, result.traces),
    warnings: [
      'Bundled sample data is synthetic and is not live market data.',
      ...result.warnings,
    ],
    traces: result.traces.map(toTraceSummary),
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

function sampleInputs(strategy: StrategyDocument, market: string, assumptions: PublicAssumptions): BacktestInput[] {
  const midpoint = new Date((Date.parse(assumptions.from) + Date.parse(assumptions.to)) / 2).toISOString();
  const values = sampleValues(strategy, market, midpoint);
  return strategy.nodes.filter((node) => node.kind === 'trigger').map((trigger, index) => {
    if (trigger.type === 'trigger.event') {
      const eventType = typeof trigger.config.eventType === 'string' ? trigger.config.eventType : 'sample.event';
      return {
        occurredAt: midpoint,
        priority: index,
        stableId: `sample-${trigger.id}`,
        triggerNodeId: trigger.id,
        triggerInput: {
          kind: 'event',
          event: {
            id: `sample-event-${trigger.id}`,
            type: eventType,
            occurredAt: midpoint,
            receivedAt: midpoint,
            source: 'catbots.bundled-sample',
            payload: typeof trigger.config.filters === 'object'
              && trigger.config.filters !== null
              && !Array.isArray(trigger.config.filters)
              ? trigger.config.filters
              : {},
            quality: { status: 'verified', freshnessSeconds: 0 },
          },
        },
        values,
      };
    }
    return {
      occurredAt: midpoint,
      priority: index,
      stableId: `sample-${trigger.id}`,
      triggerNodeId: trigger.id,
      triggerInput: { kind: 'interval', occurredAt: midpoint },
      values,
    };
  });
}

function sampleValues(strategy: StrategyDocument, market: string, observedAt: string): Record<string, EvaluationValue<unknown>> {
  const raw: Record<string, JsonValue> = {
    'market.price': { market, bid: 100, ask: 100, mark: 100 },
    'market.funding': { rate: -0.0001 },
    'indicator.rsi.14': { value: 25 },
    'data.etf_flow.btc.net_daily': { usd: -100_000_000 },
  };
  for (const node of strategy.nodes) {
    for (const operand of [node.config.left, node.config.right]) {
      if (typeof operand !== 'object' || operand === null || Array.isArray(operand)) continue;
      const ref = operand.ref;
      const field = operand.field;
      if (typeof ref !== 'string' || ref === 'market.price' || raw[ref] !== undefined) continue;
      raw[ref] = typeof field === 'string' ? { [field]: 1 } : 1;
    }
  }
  return Object.fromEntries(Object.entries(raw).map(([ref, value]) => [ref, {
    value,
    provider: 'catbots.bundled-sample',
    observedAt,
    freshnessSeconds: 0,
    quality: { status: 'verified' as const },
    integrityHash: `sha256:${createHash('sha256').update(`${ref}:${observedAt}`).digest('hex')}`,
  }]));
}

function toTraceSummary(trace: readonly AuditEvent[]) {
  const last = trace.at(-1);
  const types = new Set(trace.map((event) => event.type));
  const outcome = types.has('flow.failed') ? 'failed'
    : types.has('execution.rejected') ? 'rejected'
      : types.has('flow.skipped') ? 'skipped'
        : types.has('flow.completed') ? 'executed'
          : 'unknown';
  return {
    traceId: trace[0]?.traceId ?? 'unknown-trace',
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
