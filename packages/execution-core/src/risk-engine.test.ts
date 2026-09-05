import { describe, expect, it } from 'vitest';
import type { RiskLimits } from '@catbots/contracts';

import { evaluateRisk, type RiskEvaluationInput } from './risk-engine';

const limits: RiskLimits = {
  maxOrderUsd: '1000',
  maxPositionUsd: '2500',
  maxTotalExposureUsd: '5000',
  maxLeverage: 3,
  maxDailyLossUsd: '300',
  maxDrawdownPercent: 12,
  allowedSides: ['long', 'short'],
  maxOrdersPerMinute: 2,
};

const input: RiskEvaluationInput = {
  intent: {
    type: 'open_position',
    market: 'BTC-PERP',
    side: 'long',
    orderType: 'market',
    notionalUsd: '500',
    leverage: 2,
    clientOrderId: 'cb_order_1',
  },
  limits,
  account: {
    equityUsd: '10000',
    dailyRealizedPnlUsd: '-25',
    drawdownPercent: 2,
    positions: [],
    recentOrderTimestamps: [],
    accountKillSwitchActive: false,
    botKillSwitchActive: false,
  },
  evaluatedAt: '2026-09-05T00:01:00.000Z',
};

describe('evaluateRisk', () => {
  it('approves an order inside every configured limit', () => {
    expect(evaluateRisk(input)).toEqual({ approved: true, violatedRuleIds: [] });
  });

  it.each([
    ['max-order-usd', { intent: { ...input.intent, notionalUsd: '1000.01' } }],
    ['max-leverage', { intent: { ...input.intent, leverage: 4 } }],
    ['allowed-side', { limits: { ...limits, allowedSides: ['short'] } }],
    ['max-position-usd', { account: { ...input.account, positions: [{ market: 'BTC-PERP', notionalUsd: '2200' }] } }],
    ['max-daily-loss-usd', { account: { ...input.account, dailyRealizedPnlUsd: '-300' } }],
    ['max-drawdown-percent', { account: { ...input.account, drawdownPercent: 12 } }],
    ['max-orders-per-minute', { account: { ...input.account, recentOrderTimestamps: ['2026-09-05T00:00:01.000Z', '2026-09-05T00:00:30.000Z'] } }],
    ['account-kill-switch', { account: { ...input.account, accountKillSwitchActive: true } }],
    ['bot-kill-switch', { account: { ...input.account, botKillSwitchActive: true } }],
  ] as const)('rejects a proposed order that violates %s', (ruleId, override) => {
    const baseAccount = input.account;
    if (baseAccount === undefined) throw new Error('Risk fixture requires account state');
    const patch = override as {
      intent?: Partial<RiskEvaluationInput['intent']>;
      account?: Partial<NonNullable<RiskEvaluationInput['account']>>;
      limits?: Partial<RiskLimits>;
    };
    const candidate = {
      ...input,
      intent: { ...input.intent, ...patch.intent },
      account: { ...baseAccount, ...patch.account } as NonNullable<RiskEvaluationInput['account']>,
      limits: { ...limits, ...patch.limits },
    } as RiskEvaluationInput;

    expect(evaluateRisk(candidate)).toEqual({ approved: false, violatedRuleIds: [ruleId] });
  });

  it('fails closed when current account risk state is unavailable or malformed', () => {
    expect(evaluateRisk({ ...input, account: undefined })).toEqual({
      approved: false,
      violatedRuleIds: ['risk-state-unavailable'],
    });
    expect(evaluateRisk({
      ...input,
      account: { ...input.account!, equityUsd: 'not-a-number' },
    })).toEqual({
      approved: false,
      violatedRuleIds: ['risk-state-unavailable'],
    });
  });
});
