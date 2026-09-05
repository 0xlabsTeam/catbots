import type { LegacyRiskLimits } from '@catbots/contracts';

import type { NormalizedOrderIntent } from './adapter';

export type RiskAccountState = Readonly<{
  equityUsd: string;
  dailyRealizedPnlUsd: string;
  drawdownPercent: number;
  positions: readonly Readonly<{ market: string; notionalUsd: string }>[];
  recentOrderTimestamps: readonly string[];
  accountKillSwitchActive: boolean;
  botKillSwitchActive: boolean;
}>;

export type RiskEvaluationInput = Readonly<{
  intent: NormalizedOrderIntent;
  limits: LegacyRiskLimits;
  account: RiskAccountState | undefined;
  evaluatedAt: string;
}>;

export type RiskRuleId =
  | 'risk-state-unavailable'
  | 'account-kill-switch'
  | 'bot-kill-switch'
  | 'allowed-market'
  | 'allowed-side'
  | 'max-order-usd'
  | 'max-position-usd'
  | 'max-leverage'
  | 'max-daily-loss-usd'
  | 'max-drawdown-percent'
  | 'max-orders-per-minute';

export type RiskDecision = Readonly<{
  approved: boolean;
  violatedRuleIds: readonly RiskRuleId[];
}>;

export function evaluateRisk(input: RiskEvaluationInput): RiskDecision {
  const account = input.account;
  if (account === undefined) return rejected(['risk-state-unavailable']);
  const state = parsedState(input);
  if (state === undefined) return rejected(['risk-state-unavailable']);

  const violations: RiskRuleId[] = [];
  if (account.accountKillSwitchActive) violations.push('account-kill-switch');
  if (account.botKillSwitchActive) violations.push('bot-kill-switch');
  if (!input.limits.allowedMarkets.includes(input.intent.market)) violations.push('allowed-market');
  if (input.intent.type === 'open_position') {
    if (!input.limits.allowedSides.includes(input.intent.side)) violations.push('allowed-side');
    if (state.orderNotional > state.maxOrder) violations.push('max-order-usd');
    if (state.currentMarketExposure + state.orderNotional > state.maxPosition) violations.push('max-position-usd');
    if (input.intent.leverage > input.limits.maxLeverage) violations.push('max-leverage');
  }

  if (-state.dailyPnl >= state.maxDailyLoss) violations.push('max-daily-loss-usd');
  if (account.drawdownPercent >= input.limits.maxDrawdownPercent) violations.push('max-drawdown-percent');
  if (state.recentOrders >= input.limits.maxOrdersPerMinute) violations.push('max-orders-per-minute');
  return violations.length === 0 ? { approved: true, violatedRuleIds: [] } : rejected(violations);
}

function parsedState(input: RiskEvaluationInput): Readonly<{
  orderNotional: number;
  maxOrder: number;
  maxPosition: number;
  maxDailyLoss: number;
  dailyPnl: number;
  currentMarketExposure: number;
  recentOrders: number;
}> | undefined {
  const account = input.account;
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (account === undefined || !Number.isFinite(evaluatedAt) || !Number.isFinite(account.drawdownPercent)) return undefined;
  const equity = decimal(account.equityUsd);
  const dailyPnl = decimal(account.dailyRealizedPnlUsd);
  const maxOrder = decimal(input.limits.maxOrderUsd);
  const maxPosition = decimal(input.limits.maxPositionUsd);
  const maxDailyLoss = decimal(input.limits.maxDailyLossUsd);
  const orderNotional = input.intent.type === 'open_position' ? decimal(input.intent.notionalUsd) : 0;
  const positionValues = account.positions.map(({ notionalUsd }) => decimal(notionalUsd));
  const orderTimes = account.recentOrderTimestamps.map(Date.parse);
  if ([equity, dailyPnl, maxOrder, maxPosition, maxDailyLoss, orderNotional, ...positionValues, ...orderTimes].some((value) => value === undefined)) return undefined;
  if ((equity ?? 0) <= 0 || (maxOrder ?? 0) <= 0 || (maxPosition ?? 0) <= 0 || (maxDailyLoss ?? 0) <= 0 || (orderNotional ?? 0) < 0) return undefined;
  const currentMarketExposure = account.positions.reduce(
    (total, position, index) => position.market === input.intent.market ? total + Math.abs(positionValues[index] ?? 0) : total,
    0,
  );
  const oneMinuteAgo = evaluatedAt - 60_000;
  const recentOrders = orderTimes.filter((timestamp) => timestamp !== undefined && timestamp > oneMinuteAgo && timestamp <= evaluatedAt).length;
  return {
    orderNotional: orderNotional ?? 0,
    maxOrder: maxOrder ?? 0,
    maxPosition: maxPosition ?? 0,
    maxDailyLoss: maxDailyLoss ?? 0,
    dailyPnl: dailyPnl ?? 0,
    currentMarketExposure,
    recentOrders,
  };
}

function decimal(value: string): number | undefined {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rejected(violatedRuleIds: readonly RiskRuleId[]): RiskDecision {
  return { approved: false, violatedRuleIds };
}
