import { describe, expect, it } from 'vitest';

import {
  AuditEventViewSchema,
  DeploymentSchema,
  DynamicDeploymentSchema,
  GetDeploymentInputSchema,
  LivePreflightViewSchema,
  PaperDeploymentViewSchema,
  PauseDeploymentInputSchema,
  DynamicRiskLimitsSchema,
  LegacyRiskLimitsSchema,
  StartLiveInputSchema,
  StartPaperInputSchema,
} from './execution';

const botId = '018f3f75-89ab-7def-8123-456789abcdef';
const deploymentId = '028f3f75-89ab-7def-8123-456789abcdef';
const timestamp = '2026-09-05T00:00:00.000Z';

const riskLimits = {
  maxOrderUsd: '1000',
  maxPositionUsd: '2500',
  maxLeverage: 3,
  maxDailyLossUsd: '300',
  maxDrawdownPercent: 12,
  allowedMarkets: ['BTC-PERP'],
  allowedSides: ['long', 'short'],
  maxOrdersPerMinute: 4,
} as const;

const dynamicRiskLimits = {
  maxOrderUsd: '1000',
  maxPositionUsd: '2500',
  maxTotalExposureUsd: '5000',
  maxLeverage: 3,
  maxDailyLossUsd: '300',
  maxDrawdownPercent: 12,
  allowedSides: ['long', 'short'],
  maxOrdersPerMinute: 4,
} as const;

describe('execution contracts', () => {
  it('accepts a renderer-safe Paper deployment bound to one approved revision', () => {
    const deployment = DeploymentSchema.parse({
      id: deploymentId,
      botId,
      strategyId: 'btc-combined-flow',
      strategyVersion: 3,
      recordVersion: 1,
      mode: 'paper',
      venue: 'paper',
      network: 'paper',
      marketBindings: ['BTC-PERP'],
      riskLimits,
      status: 'running',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(deployment).toMatchObject({
      strategyVersion: 3,
      mode: 'paper',
      status: 'running',
    });
    expect(DeploymentSchema.safeParse({ ...deployment, agentPrivateKey: 'secret' }).success).toBe(false);
  });

  it('accepts a dynamic deployment with DEX-wide market access', () => {
    const dynamicDeployment = {
      id: deploymentId,
      botId,
      strategyId: 'eth-rsi',
      strategyVersion: 2,
      recordVersion: 2,
      dex: 'hyperliquid',
      mode: 'paper',
      executionVenue: 'paper',
      marketAccess: { mode: 'all_active_perpetuals' },
      riskLimits: dynamicRiskLimits,
      status: 'running',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    expect(DynamicDeploymentSchema.parse(dynamicDeployment)).toMatchObject({
      dex: 'hyperliquid',
      executionVenue: 'paper',
      marketAccess: { mode: 'all_active_perpetuals' },
    });
    expect(DeploymentSchema.safeParse({
      id: deploymentId,
      botId,
      strategyId: 'btc-rsi',
      strategyVersion: 1,
      recordVersion: 1,
      mode: 'paper',
      venue: 'paper',
      network: 'paper',
      marketBindings: ['BTC-PERP'],
      riskLimits,
      status: 'stopped',
      createdAt: timestamp,
      updatedAt: timestamp,
    }).success).toBe(true);
    expect(DynamicDeploymentSchema.safeParse({ ...dynamicDeployment, marketBindings: ['ETH-PERP'] }).success).toBe(false);
  });

  it.each([
    ['zero order size', { ...riskLimits, maxOrderUsd: '0' }],
    ['negative daily loss', { ...riskLimits, maxDailyLossUsd: '-1' }],
    ['non-decimal position size', { ...riskLimits, maxPositionUsd: 'NaN' }],
    ['duplicate market', { ...riskLimits, allowedMarkets: ['BTC-PERP', 'BTC-PERP'] }],
    ['zero frequency', { ...riskLimits, maxOrdersPerMinute: 0 }],
  ])('rejects unsafe risk limits: %s', (_name, candidate) => {
    expect(LegacyRiskLimitsSchema.safeParse(candidate).success).toBe(false);
  });

  it('uses strict Paper and Live start requests with testnet-only Live confirmation', () => {
    expect(DynamicRiskLimitsSchema.safeParse(dynamicRiskLimits).success).toBe(true);
    expect(StartPaperInputSchema.safeParse({ botId, strategyVersion: 3, riskLimits: dynamicRiskLimits }).success).toBe(true);
    expect(StartLiveInputSchema.safeParse({
      botId,
      strategyVersion: 3,
      riskLimits: dynamicRiskLimits,
      network: 'testnet',
      confirmationBotName: 'BTC Guard',
      preflightId: deploymentId,
    }).success).toBe(true);
    expect(StartLiveInputSchema.safeParse({
      botId,
      strategyVersion: 3,
      riskLimits,
      network: 'mainnet',
      confirmationBotName: 'BTC Guard',
      preflightId: deploymentId,
    }).success).toBe(false);
  });

  it('exposes fixed preflight and audit metadata without accepting credential fields', () => {
    const preflight = {
      id: deploymentId,
      botId,
      strategyVersion: 3,
      network: 'testnet',
      maskedAccount: '0x1234…cdef',
      checkedAt: timestamp,
      ready: true,
      checks: [
        { id: 'agent-wallet', label: 'Agent wallet', ok: true, message: 'Approved Agent wallet' },
        { id: 'audit-storage', label: 'Audit storage', ok: true, message: 'Writable' },
      ],
    };
    expect(LivePreflightViewSchema.safeParse(preflight).success).toBe(true);
    expect(LivePreflightViewSchema.safeParse({ ...preflight, privateKey: 'secret' }).success).toBe(false);

    const audit = {
      id: deploymentId,
      traceId: 'trace-1',
      sequence: 7,
      type: 'execution.acknowledged',
      occurredAt: timestamp,
      strategyId: 'btc-combined-flow',
      strategyVersion: 3,
      deploymentId,
      mode: 'live',
      summary: 'Hyperliquid acknowledged the order.',
      riskRuleIds: [],
      adapter: { venue: 'hyperliquid', requestId: 'request-1', statusCode: 200, venueOrderId: 'oid-1' },
    };
    expect(AuditEventViewSchema.safeParse(audit).success).toBe(true);
    expect(AuditEventViewSchema.safeParse({
      ...audit,
      adapter: { ...audit.adapter, authorization: 'Bearer secret' },
    }).success).toBe(false);
    expect(AuditEventViewSchema.safeParse({ ...audit, type: 'market.evaluation_completed' }).success).toBe(true);
  });

  it('exposes a strict renderer-safe Paper state with its durable audit log', () => {
    const deployment = DeploymentSchema.parse({
      id: deploymentId,
      botId,
      strategyId: 'btc-combined-flow',
      strategyVersion: 3,
      recordVersion: 1,
      mode: 'paper',
      venue: 'paper',
      network: 'paper',
      marketBindings: ['BTC-PERP'],
      riskLimits,
      status: 'running',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const view = {
      deployment,
      state: {
        equityUsd: '10000',
        positions: [{ market: 'BTC-PERP', side: 'long', notionalUsd: '500', quantity: '5', entryPrice: '100', leverage: 2 }],
        orders: [{
          type: 'open_position', market: 'BTC-PERP', side: 'long', orderType: 'market',
          notionalUsd: '500', leverage: 2, clientOrderId: 'paper-order-1', status: 'filled', filledAt: timestamp,
        }],
      },
      auditEvents: [{
        id: 'event-1', traceId: 'trace-1', sequence: 1, type: 'trigger.received',
        occurredAt: timestamp, strategyId: deployment.strategyId, strategyVersion: 3,
        deploymentId, mode: 'paper', summary: 'trigger received', riskRuleIds: [],
      }],
    };

    expect(PaperDeploymentViewSchema.parse(view)).toEqual(view);
    expect(PaperDeploymentViewSchema.safeParse({ ...view, agentPrivateKey: 'secret' }).success).toBe(false);
    expect(PaperDeploymentViewSchema.safeParse({ ...view, state: { ...view.state, equityUsd: '-1' } }).success).toBe(false);
  });

  it('uses strict deployment query and pause requests', () => {
    expect(GetDeploymentInputSchema.safeParse({ deploymentId }).success).toBe(true);
    expect(PauseDeploymentInputSchema.safeParse({ deploymentId }).success).toBe(true);
    expect(GetDeploymentInputSchema.safeParse({ deploymentId, privateKey: 'secret' }).success).toBe(false);
  });
});
