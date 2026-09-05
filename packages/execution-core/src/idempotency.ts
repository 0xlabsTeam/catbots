import { createHash } from 'node:crypto';

export type LegacyExecutionIdentity = Readonly<{
  deploymentId: string;
  strategyId: string;
  strategyVersion: number;
  traceId: string;
  actionNodeId: string;
  effectIdempotencyKey: string;
}>;

export type DynamicExecutionIdentity = Readonly<{
  deploymentId: string;
  strategyId: string;
  strategyVersion: number;
  parentTraceId: string;
  childTraceId: string;
  market: string;
  actionNodeId: string;
}>;

export type ExecutionIdentity = LegacyExecutionIdentity | DynamicExecutionIdentity;

export function executionIdempotencyKey(input: ExecutionIdentity): string {
  const canonicalIdentity = 'parentTraceId' in input
    ? JSON.stringify([
        2,
        input.deploymentId,
        input.strategyId,
        input.strategyVersion,
        input.parentTraceId,
        input.childTraceId,
        input.market,
        input.actionNodeId,
      ])
    : JSON.stringify([
        input.deploymentId,
        input.strategyId,
        input.strategyVersion,
        input.traceId,
        input.actionNodeId,
        input.effectIdempotencyKey,
      ]);
  return `sha256:${createHash('sha256').update(canonicalIdentity).digest('hex')}`;
}

export function clientOrderId(input: ExecutionIdentity): string {
  return `cb_${executionIdempotencyKey(input).slice('sha256:'.length, 'sha256:'.length + 28)}`;
}
