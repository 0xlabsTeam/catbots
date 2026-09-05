import { describe, expect, it } from 'vitest';
import type { LegacyRiskLimits, RiskLimits } from '@catbots/contracts';

import {
  evaluateRisk,
  type LegacyRiskEvaluationInput,
  type RiskEvaluationInput,
} from './risk-engine';

const limits: LegacyRiskLimits = {
  maxOrderUsd: '1000',
  maxPositionUsd: '2500',
  maxLeverage: 3,
  maxDailyLossUsd: '300',
  maxDrawdownPercent: 12,
  allowedMarkets: ['BTC-PERP'],
  allowedSides: ['long', 'short'],
  maxOrdersPerMinute: 2,
};

const input: LegacyRiskEvaluationInput = {
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

describe('evaluateRisk for a legacy deployment', () => {
  it('approves an order inside every configured limit', () => {
    expect(evaluateRisk(input)).toEqual({ approved: true, violatedRuleIds: [] });
  });

  it.each([
    ['max-order-usd', { intent: { ...input.intent, notionalUsd: '1000.01' } }],
    ['max-leverage', { intent: { ...input.intent, leverage: 4 } }],
    ['allowed-market', { intent: { ...input.intent, market: 'ETH-PERP' } }],
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
      intent?: Partial<LegacyRiskEvaluationInput['intent']>;
      account?: Partial<NonNullable<LegacyRiskEvaluationInput['account']>>;
      limits?: Partial<LegacyRiskLimits>;
    };
    const candidate = {
      ...input,
      intent: { ...input.intent, ...patch.intent },
      account: { ...baseAccount, ...patch.account } as NonNullable<LegacyRiskEvaluationInput['account']>,
      limits: { ...limits, ...patch.limits },
    } as LegacyRiskEvaluationInput;

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

const dynamicLimits: RiskLimits = {
  maxOrderUsd: '1000',
  maxPositionUsd: '2500',
  maxTotalExposureUsd: '5000',
  maxLeverage: 3,
  maxDailyLossUsd: '300',
  maxDrawdownPercent: 12,
  allowedSides: ['long', 'short'],
  maxOrdersPerMinute: 2,
};

const dynamicInput = {
  intent: {
    type: 'open_position' as const,
    market: 'ETH-PERP',
    side: 'long' as const,
    orderType: 'market' as const,
    notionalUsd: '500',
    leverage: 2,
    clientOrderId: 'cb_dynamic_1',
  },
  limits: dynamicLimits,
  account: {
    equityUsd: '10000',
    dailyRealizedPnlUsd: '-25',
    drawdownPercent: 2,
    positions: [],
    recentOrderTimestamps: [],
    accountKillSwitchActive: false,
    botKillSwitchActive: false,
  },
  botDex: 'hyperliquid' as const,
  deploymentDex: 'hyperliquid' as const,
  evaluationDex: 'hyperliquid' as const,
  currentMarket: 'ETH-PERP',
  effectMarket: 'ETH-PERP',
  evaluationUniverseRevision: 'sha256:universe-1',
  marketMetadataRevision: 'sha256:universe-1',
  marketMetadataDex: 'hyperliquid' as const,
  marketMetadata: {
    market: 'ETH-PERP',
    active: true,
    sizeDecimals: 4,
    maximumLeverage: 50,
  },
  universeFresh: true,
  evaluatedAt: '2026-09-05T00:01:00.000Z',
} satisfies RiskEvaluationInput;

describe('evaluateRisk for a dynamic-market deployment', () => {
  it('requires Bot, deployment, and evaluation DEX identities to match', () => {
    expect(evaluateRisk(dynamicInput)).toEqual({ approved: true, violatedRuleIds: [] });
    expect(evaluateRisk({ ...dynamicInput, deploymentDex: 'other' as never })).toEqual({
      approved: false,
      violatedRuleIds: ['dex-mismatch'],
    });
    expect(evaluateRisk({ ...dynamicInput, evaluationDex: 'other' as never })).toEqual({
      approved: false,
      violatedRuleIds: ['dex-mismatch'],
    });
    expect(evaluateRisk({ ...dynamicInput, marketMetadataDex: 'other' as never })).toEqual({
      approved: false,
      violatedRuleIds: ['dex-mismatch'],
    });
  });

  it('requires the effect and normalized intent to remain bound to currentMarket', () => {
    expect(evaluateRisk({ ...dynamicInput, effectMarket: 'BTC-PERP' })).toEqual({
      approved: false,
      violatedRuleIds: ['evaluation-market-mismatch'],
    });
    expect(evaluateRisk({
      ...dynamicInput,
      intent: { ...dynamicInput.intent, market: 'BTC-PERP' },
    })).toEqual({
      approved: false,
      violatedRuleIds: ['evaluation-market-mismatch'],
    });
  });

  it('fails closed for missing, stale, or wrong-revision metadata on an increase', () => {
    expect(evaluateRisk({ ...dynamicInput, marketMetadata: undefined })).toEqual({
      approved: false,
      violatedRuleIds: ['market-metadata-stale'],
    });
    expect(evaluateRisk({ ...dynamicInput, universeFresh: false })).toEqual({
      approved: false,
      violatedRuleIds: ['market-metadata-stale'],
    });
    expect(evaluateRisk({ ...dynamicInput, marketMetadataRevision: 'sha256:universe-2' })).toEqual({
      approved: false,
      violatedRuleIds: ['market-metadata-stale'],
    });
    expect(evaluateRisk({
      ...dynamicInput,
      marketMetadata: { ...dynamicInput.marketMetadata, maximumLeverage: Number.NaN },
    })).toEqual({
      approved: false,
      violatedRuleIds: ['market-metadata-stale'],
    });
  });

  it('rejects an increase on an inactive market', () => {
    expect(evaluateRisk({
      ...dynamicInput,
      marketMetadata: { ...dynamicInput.marketMetadata, active: false },
    })).toEqual({ approved: false, violatedRuleIds: ['market-inactive'] });
  });

  it('allows only a provable close of a known signed position on an inactive market', () => {
    const closeLong = {
      ...dynamicInput,
      intent: {
        type: 'close_position' as const,
        market: 'ETH-PERP',
        percent: 100,
        clientOrderId: 'cb_close_1',
      },
      marketMetadata: { ...dynamicInput.marketMetadata, active: false },
      account: {
        ...dynamicInput.account,
        positions: [{ market: 'ETH-PERP', side: 'long' as const, notionalUsd: '700' }],
      },
    };
    expect(evaluateRisk(closeLong)).toEqual({ approved: true, violatedRuleIds: [] });
    expect(evaluateRisk({
      ...closeLong,
      marketMetadata: undefined,
      marketMetadataRevision: undefined,
      universeFresh: false,
    })).toEqual({ approved: true, violatedRuleIds: [] });
    expect(evaluateRisk({
      ...closeLong,
      account: { ...closeLong.account, positions: [] },
    })).toEqual({ approved: false, violatedRuleIds: ['reduction-unproven'] });
    expect(evaluateRisk({
      ...closeLong,
      intent: { ...closeLong.intent, percent: 100.01 },
    })).toEqual({ approved: false, violatedRuleIds: ['reduction-unproven'] });
    expect(evaluateRisk({
      ...closeLong,
      account: {
        ...closeLong.account,
        positions: [
          { market: 'ETH-PERP', side: 'long' as const, notionalUsd: '700' },
          { market: 'ETH-PERP', side: 'short' as const, notionalUsd: '50' },
        ],
      },
    })).toEqual({ approved: false, violatedRuleIds: ['reduction-unproven'] });
  });

  it('does not treat an opposite open intent as an implicit reduction or flip', () => {
    expect(evaluateRisk({
      ...dynamicInput,
      intent: { ...dynamicInput.intent, side: 'short' },
      account: {
        ...dynamicInput.account,
        positions: [{ market: 'ETH-PERP', side: 'long', notionalUsd: '700' }],
      },
    })).toEqual({ approved: false, violatedRuleIds: ['reduction-unproven'] });
  });

  it('applies total exposure and order-rate budgets across every market', () => {
    expect(evaluateRisk({
      ...dynamicInput,
      account: {
        ...dynamicInput.account,
        positions: [
          { market: 'BTC-PERP', side: 'long' as const, notionalUsd: '3000' },
          { market: 'SOL-PERP', side: 'short' as const, notionalUsd: '1700' },
        ],
      },
    })).toEqual({ approved: false, violatedRuleIds: ['max-total-exposure-usd'] });
    expect(evaluateRisk({
      ...dynamicInput,
      account: {
        ...dynamicInput.account,
        recentOrderTimestamps: ['2026-09-05T00:00:15.000Z', '2026-09-05T00:00:45.000Z'],
      },
    })).toEqual({ approved: false, violatedRuleIds: ['max-orders-per-minute'] });
  });
});
