import type { JsonValue } from './strategy-schema';

export type AuditEventType =
  | 'trigger.received'
  | 'universe.resolved'
  | 'market.evaluation_started'
  | 'market.evaluation_completed'
  | 'context.resolution_started'
  | 'context.resolved'
  | 'context.failed'
  | 'condition.evaluated'
  | 'action.proposed'
  | 'risk.approved'
  | 'risk.rejected'
  | 'execution.queued'
  | 'execution.submitted'
  | 'execution.acknowledged'
  | 'execution.rejected'
  | 'execution.partially_filled'
  | 'execution.filled'
  | 'execution.cancelled'
  | 'flow.skipped'
  | 'flow.completed'
  | 'flow.failed';

export type AuditEvent = Readonly<{
  id: string;
  traceId: string;
  sequence: number;
  type: AuditEventType;
  causationId?: string;
  idempotencyKey: string;
  strategyId: string;
  strategyVersion: number;
  deploymentId: string;
  mode: 'backtest' | 'paper' | 'live';
  triggerNodeId: string;
  triggerEventId?: string;
  evaluationTime: string;
  nodeId?: string;
  nodeType?: string;
  nodeVersion?: number;
  details: Readonly<Record<string, JsonValue>>;
  createdAt: string;
  actor: 'strategy-runtime';
}>;

const sensitiveKey = /authorization|api[-_]?key|private[-_]?key|secret/i;

export function sanitizeAuditValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !sensitiveKey.test(key))
        .map(([key, child]) => [key, sanitizeAuditValue(child)]),
    );
  }
  return String(value);
}

type TraceIdentity = Omit<AuditEvent,
  'id' | 'sequence' | 'type' | 'causationId' | 'nodeId' | 'nodeType' | 'nodeVersion' | 'details'
>;

export class AuditTraceBuilder {
  readonly #identity: TraceIdentity;
  readonly #events: AuditEvent[] = [];

  constructor(identity: TraceIdentity) {
    this.#identity = Object.freeze({ ...identity });
  }

  append(
    type: AuditEventType,
    details: Readonly<Record<string, unknown>> = {},
    node?: Readonly<{ id: string; type: string; version: number }>,
  ): AuditEvent {
    const sequence = this.#events.length + 1;
    const previous = this.#events.at(-1);
    const event = Object.freeze({
      ...this.#identity,
      id: `${this.#identity.traceId}:${sequence}`,
      sequence,
      type,
      ...(previous ? { causationId: previous.id } : {}),
      ...(node ? { nodeId: node.id, nodeType: node.type, nodeVersion: node.version } : {}),
      details: Object.freeze(sanitizeAuditValue(details) as Readonly<Record<string, JsonValue>>),
    });
    this.#events.push(event);
    return event;
  }

  snapshot(): readonly AuditEvent[] {
    return Object.freeze([...this.#events]);
  }
}
