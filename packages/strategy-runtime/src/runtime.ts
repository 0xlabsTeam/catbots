import { AuditTraceBuilder, type AuditEvent, type AuditEventType } from './audit-trace';
import { evaluateConditionNode, type ConditionResult } from './condition-evaluator';
import type { EvaluationContext } from './evaluation-context';
import type { CompiledStrategy } from './graph-validator';
import type { JsonValue, StrategyNode } from './strategy-schema';
import { deriveTriggerIdempotencyKey, type TriggerInput } from './triggers';

export type ProposedEffect = Readonly<{
  nodeId: string;
  type: string;
  version: number;
  config: Readonly<Record<string, JsonValue>>;
  idempotencyKey: string;
}>;

export type ExecutionTraceEvent = Readonly<{
  type: Extract<AuditEventType,
    | 'execution.submitted'
    | 'execution.acknowledged'
    | 'execution.rejected'
    | 'execution.partially_filled'
    | 'execution.filled'
    | 'execution.cancelled'
  >;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type RuntimeExecutionPort = Readonly<{
  execute: (effect: ProposedEffect, context: EvaluationContext) => Readonly<{
    events: readonly ExecutionTraceEvent[];
  }>;
}>;

export type RuntimeEvaluationRequest = Readonly<{
  compiled: CompiledStrategy;
  triggerNodeId: string;
  triggerInput: TriggerInput;
  context: EvaluationContext;
  deployment: Readonly<{ id: string; mode: 'backtest' | 'paper' | 'live' }>;
  execution: RuntimeExecutionPort;
}>;

export type RuntimeEvaluation = Readonly<{
  traceId: string;
  idempotencyKey: string;
  effects: readonly ProposedEffect[];
  conditionResults: ReadonlyMap<string, ConditionResult>;
  trace: readonly AuditEvent[];
}>;

function nodeIdentity(node: StrategyNode) {
  return { id: node.id, type: node.type, version: node.version } as const;
}

function triggerEventId(input: TriggerInput): string | undefined {
  return input.kind === 'event' ? input.event.id : undefined;
}

function triggerTime(input: TriggerInput): string {
  return input.kind === 'event' ? input.event.occurredAt : input.occurredAt;
}

function endsExecutionSuccessfully(events: readonly ExecutionTraceEvent[]): boolean {
  return events.at(-1)?.type === 'execution.filled';
}

export function evaluateTrigger(request: RuntimeEvaluationRequest): RuntimeEvaluation {
  const { compiled, triggerNodeId, triggerInput, context, deployment, execution } = request;
  const trigger = compiled.document.nodes.find((node) => node.id === triggerNodeId);
  if (!trigger || trigger.kind !== 'trigger' || !compiled.triggerIds.includes(triggerNodeId)) {
    throw new Error(`Unknown Trigger node: ${triggerNodeId}`);
  }

  const idempotencyKey = deriveTriggerIdempotencyKey(triggerNodeId, triggerInput);
  const traceId = `trace:${compiled.document.strategy.id}:v${compiled.document.strategy.version}:${idempotencyKey}`;
  const trace = new AuditTraceBuilder({
    traceId,
    idempotencyKey,
    strategyId: compiled.document.strategy.id,
    strategyVersion: compiled.document.strategy.version,
    deploymentId: deployment.id,
    mode: deployment.mode,
    triggerNodeId,
    ...(triggerEventId(triggerInput) ? { triggerEventId: triggerEventId(triggerInput) } : {}),
    evaluationTime: context.evaluatedAt,
    createdAt: context.evaluatedAt,
    actor: 'strategy-runtime',
  });

  trace.append('trigger.received', { occurredAt: triggerTime(triggerInput), input: triggerInput }, nodeIdentity(trigger));
  trace.append('context.resolution_started');
  trace.append('context.resolved', { references: Object.keys(context.values).sort() });

  const conditionResults = new Map<string, ConditionResult>();
  const ownedNodes = new Set(
    [...compiled.triggerOwners.entries()]
      .filter(([, owners]) => owners.includes(triggerNodeId))
      .map(([nodeId]) => nodeId),
  );

  for (const nodeId of compiled.topologicalNodeIds) {
    if (!ownedNodes.has(nodeId)) continue;
    const node = compiled.document.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.kind !== 'condition') continue;
    const children = (compiled.incomingEdges.get(node.id) ?? [])
      .map((edge) => conditionResults.get(edge.source))
      .filter((result): result is ConditionResult => result !== undefined);
    const result = evaluateConditionNode(node, context, children);
    conditionResults.set(node.id, result);
    trace.append('condition.evaluated', {
      result: result.value,
      reason: result.reason,
      inputs: result.inputs,
    }, nodeIdentity(node));
  }

  const effects: ProposedEffect[] = [];
  let executionFailed = false;
  for (const nodeId of compiled.topologicalNodeIds) {
    if (!ownedNodes.has(nodeId)) continue;
    const node = compiled.document.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.kind !== 'action') continue;
    const controller = (compiled.incomingEdges.get(node.id) ?? [])
      .map((edge) => conditionResults.get(edge.source))
      .find((result) => result !== undefined);
    if (controller?.value !== true) continue;

    const effect = Object.freeze({
      nodeId: node.id,
      type: node.type,
      version: node.version,
      config: node.config,
      idempotencyKey: `${idempotencyKey}:action:${node.id}`,
    });
    effects.push(effect);
    trace.append('action.proposed', { effect }, nodeIdentity(node));
    trace.append('risk.approved', { decision: 'approved', evaluator: `${deployment.mode}.simulation` }, nodeIdentity(node));
    trace.append('execution.queued', { effectIdempotencyKey: effect.idempotencyKey }, nodeIdentity(node));
    try {
      const outcome = execution.execute(effect, context);
      for (const event of outcome.events) trace.append(event.type, event.metadata ?? {}, nodeIdentity(node));
      if (!endsExecutionSuccessfully(outcome.events)) executionFailed = true;
    } catch (error) {
      executionFailed = true;
      trace.append('flow.failed', { code: 'execution.exception', message: error instanceof Error ? error.message : String(error) });
      break;
    }
  }

  const currentTrace = trace.snapshot();
  if (!currentTrace.some((event) => event.type.startsWith('flow.'))) {
    if (effects.length === 0) {
      trace.append('flow.skipped', { reason: 'condition.not_true' });
    } else if (executionFailed) {
      trace.append('flow.failed', { reason: 'execution.not_filled' });
    } else {
      trace.append('flow.completed', { proposedActions: effects.length });
    }
  }

  return Object.freeze({
    traceId,
    idempotencyKey,
    effects: Object.freeze(effects),
    conditionResults,
    trace: trace.snapshot(),
  });
}
