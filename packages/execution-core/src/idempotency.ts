import { createHash } from 'node:crypto';

export type ExecutionIdentity = Readonly<{
  deploymentId: string;
  strategyId: string;
  strategyVersion: number;
  traceId: string;
  actionNodeId: string;
  effectIdempotencyKey: string;
}>;

export function executionIdempotencyKey(input: ExecutionIdentity): string {
  const canonicalIdentity = JSON.stringify([
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
