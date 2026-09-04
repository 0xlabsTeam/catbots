import { randomUUID } from 'node:crypto';
import type { AuditEventView } from '@catbots/contracts';
import type { ExecutionReceipt, PerpDexAdapter } from '@catbots/execution-core';

import type { ExecutionOutboxItem, ExecutionRepository } from './execution-repository';

export class OutboxExecutor {
  constructor(private readonly dependencies: Readonly<{
    repository: ExecutionRepository;
    adapter: PerpDexAdapter;
    clock?: () => Date;
    idFactory?: () => string;
  }>) {}

  async runOnce(idempotencyKey: string, signal: AbortSignal): Promise<ExecutionOutboxItem> {
    const existing = this.dependencies.repository.getOutboxItem(idempotencyKey);
    if (existing === null) throw executionError('EXECUTION_OUTBOX_NOT_FOUND');
    if (existing.status === 'unknown') throw executionError('EXECUTION_RECONCILIATION_REQUIRED');
    if (existing.status !== 'pending') return existing;

    const submitted = this.event(existing, 'execution.submitted', 'Order submission durably started.');
    const claimed = this.dependencies.repository.claimOutboxItem(idempotencyKey, submitted.occurredAt, submitted);
    if (claimed === null) {
      const current = this.dependencies.repository.getOutboxItem(idempotencyKey);
      if (current?.status === 'unknown') throw executionError('EXECUTION_RECONCILIATION_REQUIRED');
      if (current === null) throw executionError('EXECUTION_OUTBOX_NOT_FOUND');
      return current;
    }

    let receipt: ExecutionReceipt;
    try {
      receipt = claimed.intent.type === 'close_position'
        ? await this.dependencies.adapter.closePosition(claimed.intent, signal)
        : await this.dependencies.adapter.placeOrder(claimed.intent, signal);
    } catch {
      receipt = { status: 'unknown', clientOrderId: claimed.clientOrderId, errorCode: 'ADAPTER_REQUEST_FAILED' };
    }
    if (receipt.clientOrderId !== claimed.clientOrderId) {
      receipt = { status: 'unknown', clientOrderId: claimed.clientOrderId, errorCode: 'ADAPTER_IDENTITY_MISMATCH' };
    }

    const auditType = receipt.status === 'acknowledged' ? 'execution.acknowledged'
      : receipt.status === 'rejected' ? 'execution.rejected' : 'execution.unknown';
    const outcome = this.event(
      claimed,
      auditType,
      receipt.status === 'unknown' ? 'Order outcome is unknown; reconciliation is required.' : `Order ${receipt.status}.`,
      receipt,
    );
    const recorded = this.dependencies.repository.recordAdapterOutcome(idempotencyKey, outcome, receipt.status);
    if (receipt.status === 'unknown') throw executionError('EXECUTION_OUTCOME_UNKNOWN');

    const terminalType = receipt.status === 'acknowledged' ? 'flow.completed' : 'flow.failed';
    this.dependencies.repository.appendTerminalTrace(claimed.traceId, [
      this.event(recorded, terminalType, receipt.status === 'acknowledged' ? 'Live action completed.' : 'Live action failed.'),
    ]);
    return recorded;
  }

  private event(
    item: ExecutionOutboxItem,
    type: AuditEventView['type'],
    summary: string,
    receipt?: ExecutionReceipt,
  ): AuditEventView {
    const deployment = this.dependencies.repository.getDeployment(item.deploymentId);
    const occurredAt = (this.dependencies.clock ?? (() => new Date()))().toISOString();
    const requestId = (this.dependencies.idFactory ?? randomUUID)();
    return {
      id: requestId,
      traceId: item.traceId,
      sequence: this.dependencies.repository.nextAuditSequence(item.traceId),
      type,
      occurredAt,
      strategyId: deployment.strategyId,
      strategyVersion: deployment.strategyVersion,
      deploymentId: deployment.id,
      mode: 'live',
      nodeId: item.actionNodeId,
      nodeType: item.intent.type === 'open_position' ? 'execution.open_position' : 'execution.close_position',
      summary,
      riskRuleIds: [],
      adapter: {
        venue: 'hyperliquid', requestId,
        ...(receipt?.venueOrderId === undefined ? {} : { venueOrderId: receipt.venueOrderId }),
        ...(receipt?.errorCode === undefined ? {} : { errorCode: receipt.errorCode }),
        retryCount: Math.max(item.attempts - 1, 0),
      },
    };
  }
}

function executionError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
