import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuditEventView, Deployment } from '@catbots/contracts';
import { parseStrategyDocument } from '@catbots/strategy-runtime';

import { BotRepository } from '../src/main/bots/bot-repository';
import { ExecutionRepository, type LiveActionProposal } from '../src/main/execution/execution-repository';
import { openDatabase } from '../src/main/storage/database';
import { migrateDatabase } from '../src/main/storage/migrations';
import { WorkbenchRepository } from '../src/main/workbench/workbench-repository';

export const liveNow = '2026-09-05T00:00:00.000Z';
export const liveDeploymentId = '028f3f75-89ab-7def-8123-456789abcdef';
export const liveTraceId = 'trace:btc-risk:v1:event-1';
export const liveIdempotencyKey = 'sha256:action-1';
export const liveClientOrderId = 'cb_action_1';

export type LiveFixture = Readonly<{
  database: Database.Database;
  repository: ExecutionRepository;
  deployment: Deployment;
  proposal: LiveActionProposal;
}>;

export function createLiveFixture(): LiveFixture {
  const database = openDatabase(':memory:');
  migrateDatabase(database);
  const botId = new BotRepository(database, () => new Date(liveNow)).createDraft({ name: 'BTC Risk', market: 'BTC-PERP' }).id;
  const workbench = new WorkbenchRepository(database, () => new Date(liveNow), randomUUID);
  workbench.createValidatedRevision(botId, parseStrategyDocument({
    schemaVersion: '1.0',
    strategy: { id: 'btc-risk', name: 'BTC Risk', version: 99 },
    nodes: [
      { id: 'clock', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
      { id: 'flat', kind: 'condition', type: 'predicate.position_state', version: 1, config: { state: 'flat', market: 'BTC-PERP' } },
      { id: 'open', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 500 }, leverage: 2 } },
    ],
    edges: [
      { id: 'e1', source: 'clock', sourcePort: 'activation', target: 'flat', targetPort: 'activation' },
      { id: 'e2', source: 'flat', sourcePort: 'result', target: 'open', targetPort: 'condition' },
    ],
  }));
  workbench.approveRevision(botId, 1);
  const repository = new ExecutionRepository(database);
  const deployment: Deployment = {
    id: liveDeploymentId, botId, strategyId: 'btc-risk', strategyVersion: 1,
    mode: 'live', venue: 'hyperliquid', network: 'testnet', maskedAccount: '0x1234…cdef',
    marketBindings: ['BTC-PERP'], status: 'running', createdAt: liveNow, updatedAt: liveNow,
    riskLimits: {
      maxOrderUsd: '1000', maxPositionUsd: '2500', maxLeverage: 3,
      maxDailyLossUsd: '300', maxDrawdownPercent: 12,
      allowedMarkets: ['BTC-PERP'], allowedSides: ['long', 'short'], maxOrdersPerMinute: 4,
    },
  };
  repository.createDeployment(deployment);
  const makeEvent = (id: string, sequence: number, type: AuditEventView['type']): AuditEventView => ({
    id, traceId: liveTraceId, sequence, type, occurredAt: liveNow,
    strategyId: 'btc-risk', strategyVersion: 1, deploymentId: liveDeploymentId, mode: 'live',
    nodeId: 'open', nodeType: 'execution.open_position', summary: type, riskRuleIds: [],
  });
  const proposal: LiveActionProposal = {
    trace: { id: liveTraceId, deploymentId: liveDeploymentId, triggerEventId: 'event-1', idempotencyKey: 'trigger-key-1', createdAt: liveNow },
    events: [
      makeEvent('038f3f75-89ab-7def-8123-456789abcdef', 1, 'action.proposed'),
      makeEvent('048f3f75-89ab-7def-8123-456789abcdef', 2, 'risk.approved'),
    ],
    outbox: {
      id: '058f3f75-89ab-7def-8123-456789abcdef', deploymentId: liveDeploymentId,
      traceId: liveTraceId, actionNodeId: 'open', idempotencyKey: liveIdempotencyKey,
      clientOrderId: liveClientOrderId,
      intent: { type: 'open_position', market: 'BTC-PERP', side: 'long', orderType: 'market', notionalUsd: '500', leverage: 2, clientOrderId: liveClientOrderId },
      createdAt: liveNow,
    },
  };
  repository.proposeLiveAction(proposal);
  return { database, repository, deployment, proposal };
}
