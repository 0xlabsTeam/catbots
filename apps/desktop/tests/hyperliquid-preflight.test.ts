import { describe, expect, it, vi } from 'vitest';
import type { RiskLimits } from '@catbots/contracts';

import { runHyperliquidPreflight } from '../src/main/execution/hyperliquid/hyperliquid-preflight';

const botId = '018f3f75-89ab-7def-8123-456789abcdef';
const account = '0x0123456789abcdef0123456789abcdef01234567';
const agent = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const timestamp = '2026-09-05T00:00:00.000Z';
const riskLimits: RiskLimits = {
  maxOrderUsd: '1000', maxPositionUsd: '2500', maxTotalExposureUsd: '5000', maxLeverage: 3,
  maxDailyLossUsd: '300', maxDrawdownPercent: 12,
  allowedSides: ['long', 'short'], maxOrdersPerMinute: 4,
};

function input() {
  return {
    botId,
    strategyVersion: 1,
    network: 'testnet' as const,
    accountAddress: account,
    agentPrivateKey: 'private-key-sentinel',
    riskLimits,
    strategyApproved: true,
    backtestPassed: true,
    dataFresh: true,
    auditWritable: true,
    runtimeReady: true,
    reconciliationHealthy: true,
    client: {
      getUserRole: vi.fn().mockResolvedValue({ role: 'agent', data: { user: account } }),
      getClearinghouseState: vi.fn().mockResolvedValue({ marginSummary: { accountValue: '1000' }, withdrawable: '900', assetPositions: [] }),
    },
    resolveSignerAddress: vi.fn().mockResolvedValue(agent),
    clock: () => new Date(timestamp),
    idFactory: () => '028f3f75-89ab-7def-8123-456789abcdef',
  };
}

describe('runHyperliquidPreflight', () => {
  it('passes only when the configured signer is an Agent wallet approved for the master account', async () => {
    const source = input();
    const result = await runHyperliquidPreflight(source, new AbortController().signal);

    expect(result.ready).toBe(true);
    expect(result.maskedAccount).toBe('0x0123…4567');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'network', ok: true }),
      expect.objectContaining({ id: 'agent-wallet', ok: true }),
      expect.objectContaining({ id: 'account-balance', ok: true }),
      expect.objectContaining({ id: 'reconciliation', ok: true }),
    ]));
    expect(source.client.getUserRole).toHaveBeenCalledWith(agent, expect.any(AbortSignal));
    expect(JSON.stringify(result)).not.toContain(source.agentPrivateKey);
    expect(JSON.stringify(result)).not.toContain(account);
  });

  it('fails closed when the signer is a master wallet instead of an approved Agent wallet', async () => {
    const source = input();
    source.client.getUserRole.mockResolvedValue({ role: 'user' });

    const result = await runHyperliquidPreflight(source, new AbortController().signal);

    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: 'agent-wallet', ok: false, repairTarget: 'settings',
    }));
  });

  it('converts transport failures into fixed failed checks without leaking credentials', async () => {
    const source = input();
    source.client.getUserRole.mockRejectedValue(new Error(`remote failure ${source.agentPrivateKey}`));

    const result = await runHyperliquidPreflight(source, new AbortController().signal);

    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'connection', ok: false }));
    expect(JSON.stringify(result)).not.toContain(source.agentPrivateKey);
  });
});
