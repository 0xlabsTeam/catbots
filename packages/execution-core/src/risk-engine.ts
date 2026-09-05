import type { DexId, LegacyRiskLimits, RiskLimits } from '@catbots/contracts';

import type { NormalizedOrderIntent } from './adapter';

export type RiskMarketMetadata = Readonly<{
  market: string;
  active: boolean;
  sizeDecimals: number;
  maximumLeverage: number;
}>;

export type RiskPosition = Readonly<{
  market: string;
  side?: 'long' | 'short';
  notionalUsd: string;
}>;

export type RiskAccountState = Readonly<{
  equityUsd: string;
  dailyRealizedPnlUsd: string;
  drawdownPercent: number;
  positions: readonly RiskPosition[];
  recentOrderTimestamps: readonly string[];
  accountKillSwitchActive: boolean;
  botKillSwitchActive: boolean;
}>;

export type LegacyRiskEvaluationInput = Readonly<{
  intent: NormalizedOrderIntent;
  limits: LegacyRiskLimits;
  account: RiskAccountState | undefined;
  evaluatedAt: string;
}>;

export type RiskEvaluationInput = Readonly<{
  intent: NormalizedOrderIntent;
  limits: RiskLimits;
  account: RiskAccountState | undefined;
  botDex: DexId;
  deploymentDex: DexId;
  evaluationDex: DexId;
  currentMarket: string;
  effectMarket: string;
  evaluationUniverseRevision: string;
  marketMetadataRevision: string | undefined;
  marketMetadataDex: DexId;
  marketMetadata: RiskMarketMetadata | undefined;
  universeFresh: boolean;
  evaluatedAt: string;
}>;

export type RiskRuleId =
  | 'risk-state-unavailable'
  | 'account-kill-switch'
  | 'bot-kill-switch'
  | 'dex-mismatch'
  | 'evaluation-market-mismatch'
  | 'market-metadata-stale'
  | 'market-inactive'
  | 'reduction-unproven'
  | 'allowed-market'
  | 'allowed-side'
  | 'max-order-usd'
  | 'max-position-usd'
  | 'max-total-exposure-usd'
  | 'max-leverage'
  | 'max-daily-loss-usd'
  | 'max-drawdown-percent'
  | 'max-orders-per-minute';

export type RiskDecision = Readonly<{
  approved: boolean;
  violatedRuleIds: readonly RiskRuleId[];
}>;

export function evaluateRisk(input: RiskEvaluationInput): RiskDecision;
export function evaluateRisk(input: LegacyRiskEvaluationInput): RiskDecision;
export function evaluateRisk(input: RiskEvaluationInput | LegacyRiskEvaluationInput): RiskDecision {
  return 'allowedMarkets' in input.limits && !('maxTotalExposureUsd' in input.limits)
    ? evaluateLegacyRisk(input as LegacyRiskEvaluationInput)
    : evaluateDynamicRisk(input as RiskEvaluationInput);
}

function evaluateDynamicRisk(input: RiskEvaluationInput): RiskDecision {
  const state = parsedState(input, true);
  if (state === undefined) return rejected(['risk-state-unavailable']);

  if (input.botDex !== 'hyperliquid'
    || input.deploymentDex !== input.botDex
    || input.evaluationDex !== input.botDex
    || input.marketMetadataDex !== input.botDex) {
    return rejected(['dex-mismatch']);
  }
  if (!exactIdentity(input.currentMarket)
    || input.effectMarket !== input.currentMarket
    || input.intent.market !== input.effectMarket) {
    return rejected(['evaluation-market-mismatch']);
  }

  const increasing = input.intent.type === 'open_position';
  if (!increasing && !isProvablyReducing(input, state)) return rejected(['reduction-unproven']);
  if (increasing && hasOpposingOrUnknownPosition(input)) return rejected(['reduction-unproven']);
  if (increasing && !hasCurrentMarketMetadata(input)) return rejected(['market-metadata-stale']);
  if (increasing && !input.marketMetadata!.active) return rejected(['market-inactive']);

  const violations = commonViolations(input, state);
  if (increasing) {
    if (!input.limits.allowedSides.includes(input.intent.side)) violations.push('allowed-side');
    if (state.orderNotional > state.maxOrder) violations.push('max-order-usd');
    if (state.currentMarketExposure + state.orderNotional > state.maxPosition) violations.push('max-position-usd');
    if (state.totalExposure + state.orderNotional > state.maxTotalExposure) violations.push('max-total-exposure-usd');
    if (input.intent.leverage > input.limits.maxLeverage
      || input.intent.leverage > input.marketMetadata!.maximumLeverage) violations.push('max-leverage');
  }
  return violations.length === 0 ? approved() : rejected(violations);
}

function evaluateLegacyRisk(input: LegacyRiskEvaluationInput): RiskDecision {
  const state = parsedState(input, false);
  if (state === undefined) return rejected(['risk-state-unavailable']);

  const account = input.account!;
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
  return violations.length === 0 ? approved() : rejected(violations);
}

type CommonRiskInput = Readonly<{
  intent: NormalizedOrderIntent;
  limits: LegacyRiskLimits | RiskLimits;
  account: RiskAccountState | undefined;
  evaluatedAt: string;
}>;

type ParsedRiskState = Readonly<{
  orderNotional: number;
  maxOrder: number;
  maxPosition: number;
  maxTotalExposure: number;
  maxDailyLoss: number;
  dailyPnl: number;
  positionValues: readonly number[];
  currentMarketExposure: number;
  totalExposure: number;
  recentOrders: number;
}>;

function parsedState(input: CommonRiskInput, requireSignedPositions: boolean): ParsedRiskState | undefined {
  const account = input.account;
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (account === undefined || !Number.isFinite(evaluatedAt) || !Number.isFinite(account.drawdownPercent)) return undefined;
  const equity = decimal(account.equityUsd);
  const dailyPnl = decimal(account.dailyRealizedPnlUsd);
  const maxOrder = decimal(input.limits.maxOrderUsd);
  const maxPosition = decimal(input.limits.maxPositionUsd);
  const maxTotalExposure = 'maxTotalExposureUsd' in input.limits
    ? decimal(input.limits.maxTotalExposureUsd)
    : Number.POSITIVE_INFINITY;
  const maxDailyLoss = decimal(input.limits.maxDailyLossUsd);
  const orderNotional = input.intent.type === 'open_position' ? decimal(input.intent.notionalUsd) : 0;
  const parsedPositionValues = account.positions.map(({ notionalUsd }) => decimal(notionalUsd));
  const orderTimes = account.recentOrderTimestamps.map(Date.parse);
  if ([
    equity, dailyPnl, maxOrder, maxPosition, maxTotalExposure, maxDailyLoss, orderNotional,
    ...parsedPositionValues, ...orderTimes,
  ].some((value) => value === undefined)) return undefined;
  const positionValues = parsedPositionValues as number[];
  if ((equity ?? 0) <= 0
    || (maxOrder ?? 0) <= 0
    || (maxPosition ?? 0) <= 0
    || (maxTotalExposure ?? 0) <= 0
    || (maxDailyLoss ?? 0) <= 0
    || (orderNotional ?? 0) < 0) return undefined;
  if (requireSignedPositions && (
    positionValues.some((value) => (value ?? 0) <= 0)
    || account.positions.some(({ market, side }) => (
      !exactIdentity(market) || (side !== undefined && side !== 'long' && side !== 'short')
    ))
  )) return undefined;
  const currentMarketExposure = account.positions.reduce(
    (total, position, index) => position.market === input.intent.market ? total + Math.abs(positionValues[index] ?? 0) : total,
    0,
  );
  const totalExposure = positionValues.reduce((total, value) => total + Math.abs(value ?? 0), 0);
  const oneMinuteAgo = evaluatedAt - 60_000;
  const recentOrders = orderTimes.filter((timestamp) => timestamp !== undefined && timestamp > oneMinuteAgo && timestamp <= evaluatedAt).length;
  return {
    orderNotional: orderNotional ?? 0,
    maxOrder: maxOrder ?? 0,
    maxPosition: maxPosition ?? 0,
    maxTotalExposure: maxTotalExposure ?? 0,
    maxDailyLoss: maxDailyLoss ?? 0,
    dailyPnl: dailyPnl ?? 0,
    positionValues,
    currentMarketExposure,
    totalExposure,
    recentOrders,
  };
}

function commonViolations(input: CommonRiskInput, state: ParsedRiskState): RiskRuleId[] {
  const account = input.account!;
  const violations: RiskRuleId[] = [];
  if (account.accountKillSwitchActive) violations.push('account-kill-switch');
  if (account.botKillSwitchActive) violations.push('bot-kill-switch');
  if (-state.dailyPnl >= state.maxDailyLoss) violations.push('max-daily-loss-usd');
  if (account.drawdownPercent >= input.limits.maxDrawdownPercent) violations.push('max-drawdown-percent');
  if (state.recentOrders >= input.limits.maxOrdersPerMinute) violations.push('max-orders-per-minute');
  return violations;
}

function isProvablyReducing(input: RiskEvaluationInput, state: ParsedRiskState): boolean {
  if (input.intent.type !== 'close_position'
    || !Number.isFinite(input.intent.percent)
    || input.intent.percent <= 0
    || input.intent.percent > 100) return false;
  const matching = input.account!.positions
    .map((position, index) => ({ position, notionalUsd: state.positionValues[index] }))
    .filter(({ position }) => position.market === input.intent.market);
  if (matching.length !== 1) return false;
  const known = matching[0];
  if (known === undefined
    || (known.position.side !== 'long' && known.position.side !== 'short')
    || known.notionalUsd === undefined
    || known.notionalUsd <= 0) return false;
  return known.notionalUsd * (1 - input.intent.percent / 100) >= 0;
}

function hasOpposingOrUnknownPosition(input: RiskEvaluationInput): boolean {
  if (input.intent.type !== 'open_position') return false;
  const intendedSide = input.intent.side;
  return input.account!.positions.some((position) => (
    position.market === input.intent.market && position.side !== intendedSide
  ));
}

function hasCurrentMarketMetadata(input: RiskEvaluationInput): boolean {
  return input.universeFresh
    && exactIdentity(input.evaluationUniverseRevision)
    && input.marketMetadataRevision === input.evaluationUniverseRevision
    && validMarketMetadata(input.marketMetadata)
    && input.marketMetadata.market === input.currentMarket;
}

function validMarketMetadata(metadata: RiskMarketMetadata | undefined): metadata is RiskMarketMetadata {
  return metadata !== undefined
    && exactIdentity(metadata.market)
    && typeof metadata.active === 'boolean'
    && Number.isInteger(metadata.sizeDecimals)
    && metadata.sizeDecimals >= 0
    && Number.isInteger(metadata.maximumLeverage)
    && metadata.maximumLeverage >= 1;
}

function exactIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function decimal(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function approved(): RiskDecision {
  return { approved: true, violatedRuleIds: [] };
}

function rejected(violatedRuleIds: readonly RiskRuleId[]): RiskDecision {
  return { approved: false, violatedRuleIds };
}
