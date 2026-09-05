// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotSummary, CatbotsDesktopApi, LivePreflightView, RiskLimits, StrategyRevision } from '@catbots/contracts';

import { LiveReviewScreen } from '../src/renderer/screens/LiveReviewScreen';

const bot: BotSummary = {
  id: '018f3f75-89ab-7def-8123-456789abcdef', name: 'BTC Flow', dex: 'hyperliquid', status: 'draft',
  createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
};
const revision: StrategyRevision = {
  botId: bot.id, strategyId: 'btc-flow', version: 2, name: 'BTC Flow', status: 'approved',
  schemaVersion: '2.0', marketScope: { type: 'dex_universe' },
  createdAt: '2026-09-05T00:00:00.000Z', approvedAt: '2026-09-05T00:01:00.000Z', nodes: [], edges: [],
};
const riskLimits: RiskLimits = {
  maxOrderUsd: '1000', maxPositionUsd: '2500', maxTotalExposureUsd: '5000', maxLeverage: 3, maxDailyLossUsd: '300',
  maxDrawdownPercent: 12, allowedSides: ['long', 'short'], maxOrdersPerMinute: 4,
};
const preflight: LivePreflightView = {
  id: '028f3f75-89ab-7def-8123-456789abcdef', botId: bot.id, strategyVersion: 2,
  network: 'testnet', maskedAccount: '0x1234…cdef', checkedAt: '2026-09-05T00:02:00.000Z', ready: true,
  checks: [
    { id: 'connection', label: 'Connection', ok: true, message: 'Hyperliquid testnet responded.' },
    { id: 'agent-wallet', label: 'Agent wallet', ok: true, message: 'Approved Agent wallet matches the account.' },
    { id: 'risk-limits', label: 'Risk limits', ok: true, message: 'Risk limits are valid.' },
    { id: 'strategy', label: 'Strategy', ok: true, message: 'Strategy revision is approved.' },
    { id: 'backtest', label: 'Backtest', ok: true, message: 'A completed Backtest is available.' },
    { id: 'data-freshness', label: 'Data freshness', ok: true, message: 'Required data is fresh.' },
  ],
};

function deploymentApi(): CatbotsDesktopApi['deployments'] {
  return {
    startPaper: vi.fn(), getPaper: vi.fn(), pausePaper: vi.fn(), stopPaper: vi.fn(),
    prepareLive: vi.fn().mockResolvedValue(preflight),
    startLive: vi.fn().mockResolvedValue({
      id: '038f3f75-89ab-7def-8123-456789abcdef', botId: bot.id, strategyId: revision.strategyId,
      strategyVersion: revision.version, recordVersion: 2, dex: 'hyperliquid', mode: 'live', executionVenue: 'hyperliquid', network: 'testnet', maskedAccount: preflight.maskedAccount,
      marketAccess: { mode: 'all_active_perpetuals' }, riskLimits, status: 'running', createdAt: preflight.checkedAt, updatedAt: preflight.checkedAt,
    }),
    getLive: vi.fn(), stopLive: vi.fn(), getActive: vi.fn().mockResolvedValue(null),
  };
}

afterEach(cleanup);

describe('LiveReviewScreen', () => {
  it('shows the dedicated safety review and requires exact case-sensitive bot-name confirmation', async () => {
    const api = deploymentApi();
    const user = userEvent.setup();
    render(<LiveReviewScreen bot={bot} revision={revision} riskLimits={riskLimits} api={api} onBack={vi.fn()} onRunPaper={vi.fn()} onStarted={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Review Live deployment' })).toBeTruthy();
    expect(screen.getByText('Hyperliquid testnet')).toBeTruthy();
    expect(screen.getByText('DEX: Hyperliquid')).toBeTruthy();
    expect(screen.getByText('Market access: All active perpetual markets')).toBeTruthy();
    expect(screen.getByText(/Universe data.*fresh/i)).toBeTruthy();
    expect(screen.getByText('Max total exposure')).toBeTruthy();
    expect(screen.getByText('$5,000.00')).toBeTruthy();
    expect(screen.getByText(/shared across every market/i)).toBeTruthy();
    expect(screen.queryByText(/Market: ETH-PERP/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Run Paper instead' })).toBeTruthy();
    const start = screen.getByRole('button', { name: 'Start Live' });
    expect((start as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByLabelText('Type bot name to confirm'), 'btc flow');
    expect((start as HTMLButtonElement).disabled).toBe(true);
    await user.clear(screen.getByLabelText('Type bot name to confirm'));
    await user.type(screen.getByLabelText('Type bot name to confirm'), bot.name);
    expect((start as HTMLButtonElement).disabled).toBe(false);
    await user.click(start);

    expect(api.startLive).toHaveBeenCalledWith({
      botId: bot.id, strategyVersion: revision.version, network: 'testnet', riskLimits,
      confirmationBotName: bot.name, preflightId: preflight.id,
    });
  });

  it('keeps Live disabled and exposes repair targets when any preflight check fails', async () => {
    const api = deploymentApi();
    vi.mocked(api.prepareLive).mockResolvedValue({
      ...preflight, ready: false,
      checks: preflight.checks.map((check) => check.id === 'agent-wallet'
        ? { ...check, ok: false, message: 'Use an approved Agent/API Wallet.', repairTarget: 'settings' as const }
        : check),
    });
    const user = userEvent.setup();
    render(<LiveReviewScreen bot={bot} revision={revision} riskLimits={riskLimits} api={api} onBack={vi.fn()} onRunPaper={vi.fn()} onStarted={vi.fn()} />);

    await screen.findByText('Use an approved Agent/API Wallet.');
    await user.type(screen.getByLabelText('Type bot name to confirm'), bot.name);
    expect((screen.getByRole('button', { name: 'Start Live' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'Open settings' })).toBeTruthy();
  });
});
