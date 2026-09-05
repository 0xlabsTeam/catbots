import { LivePreflightViewSchema, type LivePreflightView, type RiskLimits } from '@catbots/contracts';

import type { HyperliquidClientPort } from './hyperliquid-client';

type CheckId = LivePreflightView['checks'][number]['id'];

export type HyperliquidPreflightInput = Readonly<{
  botId: string;
  strategyVersion: number;
  network: 'testnet';
  accountAddress: string;
  agentPrivateKey: string;
  riskLimits: RiskLimits;
  strategyApproved: boolean;
  backtestPassed: boolean;
  dataFresh: boolean;
  auditWritable: boolean;
  runtimeReady: boolean;
  reconciliationHealthy: boolean;
  client: Pick<HyperliquidClientPort, 'getUserRole' | 'getClearinghouseState'>;
  resolveSignerAddress(privateKey: string): Promise<string>;
  clock?: () => Date;
  idFactory?: () => string;
}>;

export async function runHyperliquidPreflight(input: HyperliquidPreflightInput, signal: AbortSignal): Promise<LivePreflightView> {
  const checks: Array<{
    id: CheckId;
    label: string;
    ok: boolean;
    message: string;
    repairTarget?: 'settings' | 'strategy' | 'backtest' | 'risk' | 'runtime';
  }> = [];
  const add = (id: CheckId, label: string, ok: boolean, pass: string, fail: string, repairTarget?: 'settings' | 'strategy' | 'backtest' | 'risk' | 'runtime') => {
    checks.push({ id, label, ok, message: ok ? pass : fail, ...(ok || repairTarget === undefined ? {} : { repairTarget }) });
  };

  const networkOk = input.network === 'testnet';
  add('network', 'Network', networkOk, 'Hyperliquid testnet selected.', 'Only Hyperliquid testnet is enabled.', 'settings');

  let connectionOk = false;
  let agentOk = false;
  let balanceOk = false;
  try {
    const signer = (await input.resolveSignerAddress(input.agentPrivateKey)).toLowerCase();
    const role = await input.client.getUserRole(signer, signal);
    const account = input.accountAddress.toLowerCase();
    agentOk = role.role === 'agent' && role.data?.user?.toLowerCase() === account;
    const state = await input.client.getClearinghouseState(account, signal);
    balanceOk = Number(state.marginSummary.accountValue) > 0 && Number(state.withdrawable) >= 0;
    connectionOk = true;
  } catch {
    connectionOk = false;
  }
  add('connection', 'Connection', connectionOk, 'Hyperliquid testnet responded.', 'Hyperliquid testnet connection failed.', 'settings');
  add('agent-wallet', 'Agent wallet', agentOk, 'Approved Agent wallet matches the account.', 'Use an approved Agent/API Wallet for this account.', 'settings');
  add('account-balance', 'Account balance', balanceOk, 'Perpetual account balance is available.', 'Fund the testnet perpetual account.', 'settings');
  add('risk-limits', 'Risk limits', riskLimitsReady(input.riskLimits), 'Risk limits are valid.', 'Review risk limits.', 'risk');
  add('strategy', 'Strategy', input.strategyApproved, 'Strategy revision is approved.', 'Approve this exact strategy revision.', 'strategy');
  add('backtest', 'Backtest', input.backtestPassed, 'A completed Backtest is available.', 'Run a successful Backtest.', 'backtest');
  add('data-freshness', 'Data freshness', input.dataFresh, 'Required data is fresh.', 'Required data is stale or unavailable.', 'runtime');
  add('audit-storage', 'Audit storage', input.auditWritable, 'Audit storage is writable.', 'Audit storage is unavailable.', 'runtime');
  add('runtime', 'Runtime', input.runtimeReady, 'Runtime worker is ready.', 'Runtime worker is unavailable.', 'runtime');
  add('reconciliation', 'Reconciliation', input.reconciliationHealthy, 'Reconciliation is healthy.', 'Reconciliation must complete before Live execution.', 'runtime');

  const timestamp = (input.clock ?? (() => new Date()))().toISOString();
  return LivePreflightViewSchema.parse({
    id: (input.idFactory ?? crypto.randomUUID)(),
    botId: input.botId,
    strategyVersion: input.strategyVersion,
    network: 'testnet',
    maskedAccount: maskAccount(input.accountAddress),
    checkedAt: timestamp,
    ready: checks.every(({ ok }) => ok),
    checks,
  });
}

function maskAccount(value: string): string {
  return value.length >= 10 ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'Invalid account';
}

function riskLimitsReady(limits: RiskLimits): boolean {
  return limits.allowedSides.length > 0
    && Number(limits.maxOrderUsd) > 0 && Number(limits.maxPositionUsd) >= Number(limits.maxOrderUsd)
    && Number(limits.maxTotalExposureUsd) >= Number(limits.maxPositionUsd)
    && limits.maxLeverage > 0 && Number(limits.maxDailyLossUsd) > 0
    && limits.maxDrawdownPercent > 0 && limits.maxOrdersPerMinute > 0;
}
