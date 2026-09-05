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
    const terminal = [
      ...this.dependencies.repository.listOutboxItems(deploymentId, 'acknowledged'),
      ...this.dependencies.repository.listOutboxItems(deploymentId, 'rejected'),
    ];
    for (const item of terminal) {
      this.finalizeTraceIfReady(item, 'Reconciliation repaired a terminal Live trace.');
    }
    const uncertain = [
      ...this.dependencies.repository.listOutboxItems(deploymentId, 'claimed'),
      ...this.dependencies.repository.listOutboxItems(deploymentId, 'unknown'),
      ...this.dependencies.repository.listOutboxItems(deploymentId, 'acknowledged')
        .filter((item) => !this.dependencies.repository.hasConfirmedFill(item)),
    ];
    if (uncertain.length === 0) return;

    const page = this.dependencies.adapter.getOrderExecutionEvents === undefined
      ? await this.dependencies.adapter.getExecutionEvents(null, signal)
      : await this.dependencies.adapter.getOrderExecutionEvents(uncertain.map(({ clientOrderId }) => clientOrderId), signal);
    try { await this.dependencies.adapter.getPositions(this.dependencies.account, signal); } catch { /* Independent order evidence remains valid. */ }
    for (const item of uncertain) {
      const venueCloid = toHyperliquidCloid(item.clientOrderId);
      const venueEvent = [...page.events].reverse().find(({ clientOrderId }) => (
        clientOrderId === item.clientOrderId || clientOrderId === venueCloid
      ));
      if (venueEvent?.type === 'filled') {
        this.complete(item, venueEvent, 'acknowledged', 'execution.filled', 'Reconciliation confirmed the order fill.');
        continue;
      }
      if (venueEvent?.type === 'partially_filled_cancelled' || venueEvent?.type === 'partially_filled_rejected') {
        this.complete(item, venueEvent, 'rejected', `execution.${venueEvent.type}`,
          'Reconciliation confirmed a partial fill; the unexecuted remainder is terminal.');
        continue;
      }
      if (venueEvent?.type === 'rejected' || venueEvent?.type === 'cancelled') {
        const partial = Number(venueEvent.filledQuantity ?? 0) > 0;
        this.complete(item, venueEvent, 'rejected', partial ? `execution.partially_filled_${venueEvent.type}` : `execution.${venueEvent.type}`,
          partial ? 'Reconciliation confirmed a partial fill; the unexecuted remainder is terminal.'
            : 'Reconciliation confirmed the order did not execute.');
        continue;
      }
      if (item.status !== 'acknowledged' && this.dependencies.repository.getDeployment(deploymentId).status !== 'suspended') {
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
    this.finalizeTraceIfReady(item, 'Reconciliation completed all Live actions.');
  }

  private finalizeTraceIfReady(item: ExecutionOutboxItem, summary: string): void {
    const terminal = this.dependencies.repository.liveTraceTerminalStatus(item.traceId);
    if (terminal !== null) {
      this.dependencies.repository.appendTerminalTrace(item.traceId, [
        this.event(
          item,
          terminal === 'completed' ? 'flow.completed' : 'flow.failed',
          terminal === 'completed' ? summary : 'One or more Live actions or risk decisions failed.',
        ),
      ]);
    }
  }

  private event(item: ExecutionOutboxItem, type: AuditEventView['type'], summary: string, venueEvent?: ExecutionEvent): AuditEventView {
    const deployment = this.dependencies.repository.getDeployment(item.deploymentId);
    const trace = this.dependencies.repository.getAuditTraceContext(item.traceId);
    const requestId = (this.dependencies.idFactory ?? randomUUID)();
    return {
      id: requestId, traceId: item.traceId,
      sequence: this.dependencies.repository.nextAuditSequence(item.traceId),
      type, occurredAt: venueEvent?.occurredAt ?? this.now(),
      strategyId: deployment.strategyId, strategyVersion: deployment.strategyVersion,
      deploymentId: deployment.id, mode: 'live', nodeId: item.actionNodeId,
      ...trace,
      nodeType: item.intent.type === 'open_position' ? 'execution.open_position' : 'execution.close_position',
      summary, riskRuleIds: [],
      ...(venueEvent?.filledQuantity === undefined || !(Number(venueEvent.filledQuantity) > 0) ? {} : { fill: {
        quantity: venueEvent.filledQuantity,
        ...(venueEvent.originalQuantity === undefined ? {} : { originalQuantity: venueEvent.originalQuantity }),
        ...(venueEvent.filledNotionalUsd === undefined ? {} : { notionalUsd: venueEvent.filledNotionalUsd }),
      } }),
      ...(venueEvent === undefined ? {} : { adapter: { venue: 'hyperliquid' as const, requestId } }),
    };
  }

  private now(): string {
    return (this.dependencies.clock ?? (() => new Date()))().toISOString();
  }
}
