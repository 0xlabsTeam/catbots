import { randomUUID } from 'node:crypto';
import type { AuditEventView } from '@catbots/contracts';
import type { ExecutionEvent, PerpDexAdapter } from '@catbots/execution-core';

import type { ExecutionOutboxItem, ExecutionRepository } from './execution-repository';
import { toHyperliquidCloid } from './hyperliquid/hyperliquid-normalization';

export class ReconciliationService {
  constructor(private readonly dependencies: Readonly<{
    repository: ExecutionRepository;
    adapter: PerpDexAdapter;
    account: string;
    clock?: () => Date;
    idFactory?: () => string;
  }>) {}

  async reconcileDeployment(deploymentId: string, signal: AbortSignal): Promise<void> {
    const deployment = this.dependencies.repository.getDeployment(deploymentId);
    if (deployment.mode !== 'live') throw new Error('Live deployment required');
    const uncertain = [
      ...this.dependencies.repository.listOutboxItems(deploymentId, 'claimed'),
      ...this.dependencies.repository.listOutboxItems(deploymentId, 'unknown'),
    ];
    if (uncertain.length === 0) return;

    const page = await this.dependencies.adapter.getExecutionEvents(null, signal);
    await this.dependencies.adapter.getPositions(this.dependencies.account, signal);
    for (const item of uncertain) {
      const venueCloid = toHyperliquidCloid(item.clientOrderId);
      const venueEvent = [...page.events].reverse().find(({ clientOrderId }) => (
        clientOrderId === item.clientOrderId || clientOrderId === venueCloid
      ));
      if (venueEvent?.type === 'filled') {
        this.complete(item, venueEvent, 'acknowledged', 'execution.filled', 'Reconciliation confirmed the order fill.');
        continue;
      }
      if (venueEvent?.type === 'rejected' || venueEvent?.type === 'cancelled') {
        this.complete(item, venueEvent, 'rejected', `execution.${venueEvent.type}`, 'Reconciliation confirmed the order did not execute.');
        continue;
      }
      this.dependencies.repository.appendTerminalTrace(item.traceId, [
        this.event(item, 'flow.failed', 'Reconciliation could not prove a safe order outcome.'),
      ]);
      if (this.dependencies.repository.getDeployment(deploymentId).status !== 'suspended') {
        this.dependencies.repository.suspendDeployment(deploymentId, this.now());
      }
    }
  }

  private complete(
    item: ExecutionOutboxItem,
    venueEvent: ExecutionEvent,
    status: 'acknowledged' | 'rejected',
    type: AuditEventView['type'],
    summary: string,
  ): void {
    this.dependencies.repository.recordReconciledOutcome(item.idempotencyKey, this.event(item, type, summary, venueEvent), status);
    this.dependencies.repository.appendTerminalTrace(item.traceId, [
      this.event(item, status === 'acknowledged' ? 'flow.completed' : 'flow.failed', `Reconciled Live action ${status}.`),
    ]);
  }

  private event(item: ExecutionOutboxItem, type: AuditEventView['type'], summary: string, venueEvent?: ExecutionEvent): AuditEventView {
    const deployment = this.dependencies.repository.getDeployment(item.deploymentId);
    const requestId = (this.dependencies.idFactory ?? randomUUID)();
    return {
      id: requestId, traceId: item.traceId,
      sequence: this.dependencies.repository.nextAuditSequence(item.traceId),
      type, occurredAt: venueEvent?.occurredAt ?? this.now(),
      strategyId: deployment.strategyId, strategyVersion: deployment.strategyVersion,
      deploymentId: deployment.id, mode: 'live', nodeId: item.actionNodeId,
      nodeType: item.intent.type === 'open_position' ? 'execution.open_position' : 'execution.close_position',
      summary, riskRuleIds: [],
      ...(venueEvent === undefined ? {} : { adapter: { venue: 'hyperliquid' as const, requestId } }),
    };
  }

  private now(): string {
    return (this.dependencies.clock ?? (() => new Date()))().toISOString();
  }
}
