import type Database from 'better-sqlite3';
import { isDeepStrictEqual } from 'node:util';
import {
  AuditEventViewSchema,
  DeploymentSchema,
  type AuditEventView,
  type Deployment,
} from '@catbots/contracts';
import type { NormalizedOrderIntent } from '@catbots/execution-core';
import type { AuditEvent } from '@catbots/strategy-runtime';

export type AuditTraceIdentity = Readonly<{
  id: string;
  deploymentId: string;
  triggerEventId: string;
  idempotencyKey: string;
  createdAt: string;
}>;

export type ExecutionOutboxInput = Readonly<{
  id: string;
  deploymentId: string;
  traceId: string;
  actionNodeId: string;
  idempotencyKey: string;
  clientOrderId: string;
  intent: NormalizedOrderIntent;
  createdAt: string;
}>;

export type ExecutionOutboxItem = ExecutionOutboxInput & Readonly<{
  status: 'pending' | 'claimed' | 'acknowledged' | 'rejected' | 'unknown';
  attempts: number;
  claimedAt: string | null;
  updatedAt: string;
}>;

export type LiveActionProposal = Readonly<{
  trace: AuditTraceIdentity;
  events: readonly [AuditEventView, AuditEventView];
  outbox: ExecutionOutboxInput;
}>;

type DeploymentRow = Record<string, unknown>;
type OutboxRow = Record<string, unknown>;

export class ExecutionRepository {
  constructor(private readonly database: Database.Database) {}

  createDeployment(input: Deployment): Deployment {
    const deployment = DeploymentSchema.parse(input);
    const revision = this.database.prepare(`
      SELECT strategy_id, status FROM strategy_revisions
      WHERE bot_id = ? AND version = ?
    `).get(deployment.botId, deployment.strategyVersion) as { strategy_id: unknown; status: unknown } | undefined;
    if (revision?.status !== 'approved' || revision.strategy_id !== deployment.strategyId) {
      throw new Error('Deployment requires the matching approved strategy revision');
    }
    this.database.prepare(`
      INSERT INTO deployments (
        id, bot_id, strategy_id, strategy_version, mode, venue, network, masked_account,
        market_bindings_json, risk_limits_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      deployment.id,
      deployment.botId,
      deployment.strategyId,
      deployment.strategyVersion,
      deployment.mode,
      deployment.venue,
      deployment.network,
      deployment.mode === 'live' ? deployment.maskedAccount : null,
      JSON.stringify(deployment.marketBindings),
      JSON.stringify(deployment.riskLimits),
      deployment.status,
      deployment.createdAt,
      deployment.updatedAt,
    );
    return this.getDeployment(deployment.id);
  }

  getDeployment(id: string): Deployment {
    const row = this.database.prepare('SELECT * FROM deployments WHERE id = ?').get(id) as DeploymentRow | undefined;
    if (row === undefined) throw new Error('Deployment not found');
    return toDeployment(row);
  }

  proposeLiveAction(input: LiveActionProposal): ExecutionOutboxItem {
    const existing = this.findOutboxItem(input.outbox.idempotencyKey);
    if (existing !== null) {
      if (!sameOutboxIdentity(existing, input.outbox)) throw new Error('Execution idempotency collision');
      return existing;
    }
    return this.database.transaction(() => {
      const deployment = this.getDeployment(input.outbox.deploymentId);
      validateProposal(input, deployment);
      this.database.prepare(`
        INSERT INTO audit_traces (
          id, deployment_id, trigger_event_id, idempotency_key, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'open', ?, ?)
      `).run(
        input.trace.id,
        input.trace.deploymentId,
        input.trace.triggerEventId,
        input.trace.idempotencyKey,
        input.trace.createdAt,
        input.trace.createdAt,
      );
      const append = this.database.prepare(`
        INSERT INTO audit_events (id, trace_id, sequence, type, event_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const event of input.events) {
        append.run(event.id, event.traceId, event.sequence, event.type, JSON.stringify(event), event.occurredAt);
      }
      this.database.prepare(`
        INSERT INTO execution_outbox (
          id, deployment_id, trace_id, action_node_id, idempotency_key, client_order_id,
          intent_json, status, attempts, claimed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?)
      `).run(
        input.outbox.id,
        input.outbox.deploymentId,
        input.outbox.traceId,
        input.outbox.actionNodeId,
        input.outbox.idempotencyKey,
        input.outbox.clientOrderId,
        JSON.stringify(input.outbox.intent),
        input.outbox.createdAt,
        input.outbox.createdAt,
      );
      const created = this.findOutboxItem(input.outbox.idempotencyKey);
      if (created === null) throw new Error('Created outbox item could not be loaded');
      return created;
    }).immediate();
  }

  claimOutboxItem(idempotencyKey: string, claimedAt: string): ExecutionOutboxItem | null {
    return this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE execution_outbox
        SET status = 'claimed', attempts = attempts + 1, claimed_at = ?, updated_at = ?
        WHERE idempotency_key = ? AND status = 'pending'
      `).run(claimedAt, claimedAt, idempotencyKey);
      return result.changes === 1 ? this.findOutboxItem(idempotencyKey) : null;
    }).immediate();
  }

  recordAdapterOutcome(
    idempotencyKey: string,
    source: AuditEventView,
    status: Extract<ExecutionOutboxItem['status'], 'acknowledged' | 'rejected' | 'unknown'>,
  ): ExecutionOutboxItem {
    return this.database.transaction(() => {
      const item = this.findOutboxItem(idempotencyKey);
      if (item === null || item.status !== 'claimed') throw new Error('Claimed outbox item not found');
      const event = AuditEventViewSchema.parse(source);
      this.requireNextAuditEvent(item.traceId, event);
      const result = this.database.prepare(`
        UPDATE execution_outbox SET status = ?, updated_at = ?
        WHERE idempotency_key = ? AND status = 'claimed'
      `).run(status, event.occurredAt, idempotencyKey);
      if (result.changes !== 1) throw new Error('Outbox outcome could not be recorded');
      this.insertAuditEvent(event);
      const updated = this.findOutboxItem(idempotencyKey);
      if (updated === null) throw new Error('Updated outbox item could not be loaded');
      return updated;
    }).immediate();
  }

  appendTerminalTrace(traceId: string, sources: readonly AuditEventView[]): AuditEventView[] {
    if (sources.length === 0) throw new Error('Terminal trace events are required');
    return this.database.transaction(() => {
      for (const source of sources) {
        const event = AuditEventViewSchema.parse(source);
        this.requireNextAuditEvent(traceId, event);
        this.insertAuditEvent(event);
      }
      const terminal = sources.at(-1)?.type;
      const status = terminal === 'flow.completed' ? 'completed' : terminal === 'flow.failed' ? 'failed' : undefined;
      if (status === undefined) throw new Error('Trace must end with a terminal flow event');
      const completedAt = sources.at(-1)?.occurredAt;
      const result = this.database.prepare(`
        UPDATE audit_traces SET status = ?, updated_at = ? WHERE id = ? AND status = 'open'
      `).run(status, completedAt, traceId);
      if (result.changes !== 1) throw new Error('Open audit trace not found');
      return this.listAuditEvents(traceId);
    }).immediate();
  }

  requestStop(deploymentId: string, requestedAt: string): Deployment {
    const current = this.getDeployment(deploymentId);
    if (current.status === 'stopping') return current;
    const result = this.database.prepare(`
      UPDATE deployments SET status = 'stopping', updated_at = ?
      WHERE id = ? AND status IN ('running', 'paused', 'recovering')
    `).run(requestedAt, deploymentId);
    if (result.changes !== 1) throw new Error('Deployment cannot be stopped from its current state');
    return this.getDeployment(deploymentId);
  }

  pause(deploymentId: string, pausedAt: string): Deployment {
    const result = this.database.prepare(`
      UPDATE deployments SET status = 'paused', updated_at = ? WHERE id = ? AND status = 'running'
    `).run(pausedAt, deploymentId);
    if (result.changes !== 1) throw new Error('Running deployment not found');
    return this.getDeployment(deploymentId);
  }

  listRecoverableDeployments(): Deployment[] {
    return this.database.prepare(`
      SELECT * FROM deployments
      WHERE status IN ('running', 'paused', 'stopping', 'recovering')
      ORDER BY created_at, rowid
    `).all().map((row) => toDeployment(row as DeploymentRow));
  }

  listAuditEvents(traceId: string): AuditEventView[] {
    return this.database.prepare(`
      SELECT event_json FROM audit_events WHERE trace_id = ? ORDER BY sequence
    `).all(traceId).map((row) => {
      const serialized = (row as { event_json: unknown }).event_json;
      if (typeof serialized !== 'string') throw new Error('Stored audit event is invalid');
      return AuditEventViewSchema.parse(JSON.parse(serialized));
    });
  }

  listDeploymentAuditEvents(deploymentId: string, limit = 200): AuditEventView[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('Audit event limit is invalid');
    return this.database.prepare(`
      SELECT audit_events.event_json FROM audit_events
      JOIN audit_traces ON audit_traces.id = audit_events.trace_id
      WHERE audit_traces.deployment_id = ?
      ORDER BY audit_traces.created_at DESC, audit_traces.rowid DESC, audit_events.sequence ASC
      LIMIT ?
    `).all(deploymentId, limit).map((row) => {
      const serialized = (row as { event_json: unknown }).event_json;
      if (typeof serialized !== 'string') throw new Error('Stored audit event is invalid');
      return AuditEventViewSchema.parse(JSON.parse(serialized));
    });
  }

  hasTrace(traceId: string): boolean {
    return this.database.prepare('SELECT 1 FROM audit_traces WHERE id = ?').get(traceId) !== undefined;
  }

  recordPaperTrace(deploymentId: string, sourceEvents: readonly AuditEvent[]): AuditEventView[] {
    if (sourceEvents.length === 0) throw new Error('Paper trace events are required');
    const traceId = sourceEvents[0]?.traceId ?? '';
    if (this.hasTrace(traceId)) return this.listAuditEvents(traceId);
    return this.database.transaction(() => {
      const deployment = this.getDeployment(deploymentId);
      if (deployment.mode !== 'paper' || deployment.status !== 'running') throw new Error('Running Paper deployment not found');
      const events = sourceEvents.map(toAuditEventView);
      if (events.some((event, index) => event.deploymentId !== deploymentId || event.sequence !== index + 1 || event.traceId !== traceId)) {
        throw new Error('Paper trace identity or sequence does not match');
      }
      const last = events.at(-1);
      if (last === undefined) throw new Error('Paper trace events are required');
      const status = last?.type === 'flow.completed' ? 'completed' : last?.type === 'flow.failed' ? 'failed'
        : last?.type === 'flow.skipped' ? 'completed' : undefined;
      if (status === undefined) throw new Error('Paper trace must be terminal');
      const first = sourceEvents[0];
      if (first === undefined) throw new Error('Paper trace identity is missing');
      this.database.prepare(`
        INSERT INTO audit_traces (
          id, deployment_id, trigger_event_id, idempotency_key, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        traceId,
        deploymentId,
        first.triggerEventId ?? `interval:${first.evaluationTime}`,
        first.idempotencyKey,
        status,
        first.createdAt,
        last.occurredAt,
      );
      for (const event of events) this.insertAuditEvent(event);
      return events;
    }).immediate();
  }

  completeStop(deploymentId: string, completedAt: string): Deployment {
    const result = this.database.prepare(`
      UPDATE deployments SET status = 'stopped', updated_at = ? WHERE id = ? AND status = 'stopping'
    `).run(completedAt, deploymentId);
    if (result.changes !== 1) throw new Error('Stopping deployment not found');
    return this.getDeployment(deploymentId);
  }

  private findOutboxItem(idempotencyKey: string): ExecutionOutboxItem | null {
    const row = this.database.prepare(`
      SELECT * FROM execution_outbox WHERE idempotency_key = ?
    `).get(idempotencyKey) as OutboxRow | undefined;
    return row === undefined ? null : toOutboxItem(row);
  }

  private requireNextAuditEvent(traceId: string, event: AuditEventView): void {
    const trace = this.database.prepare('SELECT deployment_id, status FROM audit_traces WHERE id = ?')
      .get(traceId) as { deployment_id: unknown; status: unknown } | undefined;
    if (trace === undefined || trace.status !== 'open' || event.traceId !== traceId || event.deploymentId !== trace.deployment_id) {
      throw new Error('Open audit trace identity does not match');
    }
    const row = this.database.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM audit_events WHERE trace_id = ?')
      .get(traceId) as { sequence: number };
    if (event.sequence !== row.sequence + 1) throw new Error('Audit event sequence is not contiguous');
  }

  private insertAuditEvent(event: AuditEventView): void {
    this.database.prepare(`
      INSERT INTO audit_events (id, trace_id, sequence, type, event_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(event.id, event.traceId, event.sequence, event.type, JSON.stringify(event), event.occurredAt);
  }
}

function sameOutboxIdentity(existing: ExecutionOutboxItem, proposed: ExecutionOutboxInput): boolean {
  return existing.deploymentId === proposed.deploymentId
    && existing.traceId === proposed.traceId
    && existing.actionNodeId === proposed.actionNodeId
    && existing.clientOrderId === proposed.clientOrderId
    && isDeepStrictEqual(existing.intent, proposed.intent);
}

function validateProposal(input: LiveActionProposal, deployment: Deployment): void {
  if (deployment.mode !== 'live') throw new Error('Live outbox requires a Live deployment');
  if (input.trace.deploymentId !== deployment.id || input.outbox.deploymentId !== deployment.id) {
    throw new Error('Proposal deployment does not match');
  }
  if (input.trace.id !== input.outbox.traceId) throw new Error('Proposal trace does not match');
  if (input.events[0].type !== 'action.proposed' || input.events[1].type !== 'risk.approved') {
    throw new Error('Live proposal requires action and approved risk audit events');
  }
  for (const [index, source] of input.events.entries()) {
    const event = AuditEventViewSchema.parse(source);
    if (event.traceId !== input.trace.id || event.deploymentId !== deployment.id || event.sequence !== index + 1) {
      throw new Error('Proposal audit event identity or sequence does not match');
    }
  }
  if (input.outbox.intent.clientOrderId !== input.outbox.clientOrderId) {
    throw new Error('Outbox client order ID does not match its intent');
  }
}

function toDeployment(row: DeploymentRow): Deployment {
  const common = {
    id: row.id,
    botId: row.bot_id,
    strategyId: row.strategy_id,
    strategyVersion: row.strategy_version,
    mode: row.mode,
    venue: row.venue,
    network: row.network,
    marketBindings: parseStoredJson(row.market_bindings_json),
    riskLimits: parseStoredJson(row.risk_limits_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return DeploymentSchema.parse(row.mode === 'live' ? { ...common, maskedAccount: row.masked_account } : common);
}

function toOutboxItem(row: OutboxRow): ExecutionOutboxItem {
  if (typeof row.id !== 'string' || typeof row.deployment_id !== 'string' || typeof row.trace_id !== 'string'
    || typeof row.action_node_id !== 'string' || typeof row.idempotency_key !== 'string'
    || typeof row.client_order_id !== 'string' || typeof row.created_at !== 'string'
    || typeof row.updated_at !== 'string' || typeof row.status !== 'string' || typeof row.attempts !== 'number') {
    throw new Error('Stored outbox item is invalid');
  }
  if (!['pending', 'claimed', 'acknowledged', 'rejected', 'unknown'].includes(row.status)) {
    throw new Error('Stored outbox status is invalid');
  }
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    traceId: row.trace_id,
    actionNodeId: row.action_node_id,
    idempotencyKey: row.idempotency_key,
    clientOrderId: row.client_order_id,
    intent: parseStoredJson(row.intent_json) as NormalizedOrderIntent,
    status: row.status as ExecutionOutboxItem['status'],
    attempts: row.attempts,
    claimedAt: typeof row.claimed_at === 'string' ? row.claimed_at : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseStoredJson(value: unknown): unknown {
  if (typeof value !== 'string') throw new Error('Stored JSON value is invalid');
  return JSON.parse(value);
}

function toAuditEventView(event: AuditEvent): AuditEventView {
  const violatedRuleIds = Array.isArray(event.details.violatedRuleIds)
    ? event.details.violatedRuleIds.filter((value): value is string => typeof value === 'string')
    : [];
  return AuditEventViewSchema.parse({
    id: event.id,
    traceId: event.traceId,
    sequence: event.sequence,
    type: event.type,
    occurredAt: event.createdAt,
    strategyId: event.strategyId,
    strategyVersion: event.strategyVersion,
    deploymentId: event.deploymentId,
    mode: event.mode,
    ...(event.nodeId === undefined ? {} : { nodeId: event.nodeId }),
    ...(event.nodeType === undefined ? {} : { nodeType: event.nodeType }),
    summary: event.type.replaceAll('.', ' '),
    riskRuleIds: violatedRuleIds,
  });
}
