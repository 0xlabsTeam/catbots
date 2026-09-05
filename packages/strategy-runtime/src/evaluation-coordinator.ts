import { AuditTraceBuilder, type AuditEvent } from './audit-trace';
import { createEvaluationContext, type EvaluationContext } from './evaluation-context';
import type { CompiledStrategy } from './graph-validator';
import {
  orderedActiveMarkets,
  type MarketUniverseMarket,
  type MarketUniverseSnapshot,
} from './market-universe';
import {
  evaluateTrigger,
  type RuntimeEvaluation,
  type RuntimeExecutionPort,
} from './runtime';
import {
  deriveTriggerIdempotencyKey,
  matchesEventTrigger,
  matchesIntervalTrigger,
  type EventTriggerConfig,
  type IntervalTriggerConfig,
  type TriggerInput,
} from './triggers';

export type EvaluationContextFactory = (
  market: string,
  metadata: MarketUniverseMarket,
) => EvaluationContext;

export type CoordinateEvaluationRequest = Readonly<{
  compiled: CompiledStrategy;
  triggerNodeId: string;
  triggerInput: TriggerInput;
  universe: MarketUniverseSnapshot;
  contextFactory: EvaluationContextFactory;
  deployment: Readonly<{ id: string; mode: 'backtest' | 'paper' | 'live' }>;
  execution: RuntimeExecutionPort;
}>;

export type CoordinatedEvaluation = Readonly<{
  parentTraceId: string;
  parentTrace: readonly AuditEvent[];
  children: readonly Readonly<{
    market: string;
    parentTraceId: string;
    outcome: 'completed' | 'skipped' | 'failed';
    evaluation: RuntimeEvaluation;
  }>[];
}>;

const contextResolutionFailure = Object.freeze({
  code: 'CONTEXT_RESOLUTION_FAILED',
  message: 'Market context could not be resolved.',
});

function triggerTime(input: TriggerInput): string {
  return input.kind === 'event' ? input.event.occurredAt : input.occurredAt;
}

function terminalOutcome(evaluation: RuntimeEvaluation): 'completed' | 'skipped' | 'failed' {
  const terminal = evaluation.trace.at(-1)?.type;
  if (terminal === 'flow.completed') return 'completed';
  if (terminal === 'flow.skipped') return 'skipped';
  return 'failed';
}

function traceComponent(value: string): string {
  return encodeURIComponent(value);
}

export function coordinateEvaluation(request: CoordinateEvaluationRequest): CoordinatedEvaluation {
  const { compiled, triggerNodeId, triggerInput, universe, contextFactory, deployment, execution } = request;
  const trigger = compiled.document.nodes.find((node) => node.id === triggerNodeId);
  if (!trigger || trigger.kind !== 'trigger' || !compiled.triggerIds.includes(triggerNodeId)) {
    throw new Error(`Unknown Trigger node: ${triggerNodeId}`);
  }
  const matches = trigger.type === 'trigger.interval' && triggerInput.kind === 'interval'
    ? matchesIntervalTrigger(trigger.config as IntervalTriggerConfig, triggerInput.occurredAt)
    : trigger.type === 'trigger.event' && triggerInput.kind === 'event'
      ? matchesEventTrigger(trigger.config as EventTriggerConfig, triggerInput.event)
      : false;
  if (!matches) {
    throw new Error(`Input does not match Trigger node: ${triggerNodeId}`);
  }

  const triggerKey = deriveTriggerIdempotencyKey(triggerNodeId, triggerInput);
  const parentIdempotencyKey = [
    'deployment', traceComponent(deployment.id),
    triggerKey,
    'dex', traceComponent(universe.dex),
    'universe', traceComponent(universe.revision),
  ].join(':');
  const parentTraceId = [
    'trace', traceComponent(compiled.document.strategy.id),
    `v${compiled.document.strategy.version}`,
    parentIdempotencyKey,
  ].join(':');
  const evaluationTime = triggerTime(triggerInput);
  const trace = new AuditTraceBuilder({
    traceId: parentTraceId,
    idempotencyKey: parentIdempotencyKey,
    strategyId: compiled.document.strategy.id,
    strategyVersion: compiled.document.strategy.version,
    deploymentId: deployment.id,
    mode: deployment.mode,
    triggerNodeId,
    ...(triggerInput.kind === 'event' ? { triggerEventId: triggerInput.event.id } : {}),
    evaluationTime,
    createdAt: evaluationTime,
    actor: 'strategy-runtime',
  });
  trace.append('trigger.received', { occurredAt: evaluationTime, input: triggerInput }, {
    id: trigger.id, type: trigger.type, version: trigger.version,
  });

  const activeMarkets = orderedActiveMarkets(universe);
  const isMarketScopedEvent = triggerInput.kind === 'event'
    && ((trigger.config as EventTriggerConfig).scope ?? 'market') === 'market';
  const markets = isMarketScopedEvent
    ? activeMarkets.filter(({ symbol }) => symbol === triggerInput.event.market)
    : activeMarkets;
  trace.append('universe.resolved', {
    dex: universe.dex,
    revision: universe.revision,
    observedAt: universe.observedAt,
    markets: activeMarkets.map(({ symbol }) => symbol),
    selectedMarkets: markets.map(({ symbol }) => symbol),
  });

  const children = markets.map((metadata) => {
    const market = metadata.symbol;
    const childTraceId = `${parentTraceId}:market:${traceComponent(market)}`;
    let context: EvaluationContext | undefined;
    try {
      const resolved = contextFactory(market, metadata);
      if (resolved.currentMarket !== market) {
        throw new Error(
          `Resolved currentMarket ${resolved.currentMarket} does not match selected market ${market}`,
        );
      }
      context = createEvaluationContext({
        evaluatedAt: resolved.evaluatedAt,
        currentMarket: resolved.currentMarket,
        ...(resolved.triggerEvent ? { triggerEvent: resolved.triggerEvent } : {}),
        values: resolved.values,
      });
    } catch {
      context = undefined;
    }
    const evaluation = context
      ? evaluateTrigger({
          compiled,
          triggerNodeId,
          triggerInput,
          context,
          deployment,
          execution,
          traceId: childTraceId,
          auditIdentity: { market, universeRevision: universe.revision },
        })
      : evaluateTrigger({
        compiled,
        triggerNodeId,
        triggerInput,
        context: undefined,
        contextFailure: contextResolutionFailure,
        deployment,
        execution,
        traceId: childTraceId,
        auditIdentity: { market, universeRevision: universe.revision },
      });
    const outcome = terminalOutcome(evaluation);
    trace.append('market.evaluation_completed', { market, childTraceId, outcome });
    return Object.freeze({ market, parentTraceId, outcome, evaluation });
  });

  const failedMarkets = children
    .filter(({ outcome }) => outcome === 'failed')
    .map(({ market }) => market);
  if (failedMarkets.length > 0) {
    trace.append('flow.failed', { failedMarkets });
  } else if (children.length === 0) {
    trace.append('flow.skipped', {
      reason: triggerInput.kind === 'event'
        ? 'market.not_active_or_present'
        : 'universe.no_active_markets',
    });
  } else {
    trace.append('flow.completed', { evaluatedMarkets: children.length });
  }
  return Object.freeze({
    parentTraceId,
    parentTrace: trace.snapshot(),
    children: Object.freeze(children),
  });
}
