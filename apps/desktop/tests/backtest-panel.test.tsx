// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BacktestSummary, CatbotsDesktopApi, StrategyRevision } from '@catbots/contracts';

import { BacktestPanel } from '../src/renderer/workbench/BacktestPanel';

const botId = '018f3f75-89ab-7def-8123-456789abcdef';
const revision = {
  botId, strategyId: 's', version: 1, name: 'Momentum', status: 'draft', createdAt: '2026-09-04T00:00:00.000Z', approvedAt: null,
  nodes: [{ id: 't', kind: 'trigger', type: 'trigger.interval', version: 1, title: 'Interval', summary: 'Every 1h' }], edges: [],
} satisfies StrategyRevision;
const backtest = {
  id: '018f3f75-89ab-7def-8123-456789abcdea', botId, revisionVersion: 1, status: 'completed', dataSource: 'Bundled sample data',
  startedAt: '2026-09-04T00:00:00.000Z', completedAt: '2026-09-04T00:01:00.000Z',
  assumptions: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', startingCapital: '10000', feeRateBps: 3.5, slippageBps: 1 },
  metrics: { returnPercent: 4.2, maximumDrawdownPercent: 1.1, sharpeLike: 1.4, winRatePercent: 60, tradeCount: 5, fees: '12.34', funding: '-1.25' },
  equityCurve: [{ timestamp: '2026-08-01T00:00:00.000Z', equity: '10000' }, { timestamp: '2026-09-01T00:00:00.000Z', equity: '10420' }],
  trades: [], warnings: ['Bundled sample data is synthetic and is not live market data.'],
  traces: [{ traceId: 'trace-1', outcome: 'executed', occurredAt: '2026-08-02T00:00:00.000Z', summary: 'flow completed' }],
  artifactHash: `sha256:${'a'.repeat(64)}`,
} satisfies BacktestSummary;

function api(): CatbotsDesktopApi['workbench'] {
  return {
    get: vi.fn(), sendMessage: vi.fn(), approveRevision: vi.fn(), subscribeActivity: vi.fn(() => () => undefined),
    runBacktest: vi.fn().mockResolvedValue(backtest),
    getTrace: vi.fn().mockResolvedValue({
      traceId: 'trace-1', outcome: 'executed', events: [
        { sequence: 1, type: 'trigger.received', occurredAt: '2026-08-02T00:00:00.000Z', nodeId: 't', summary: 'trigger received', details: {} },
        { sequence: 2, type: 'flow.completed', occurredAt: '2026-08-02T00:00:01.000Z', summary: 'flow completed', details: {} },
      ],
    }),
  };
}

afterEach(cleanup);

describe('BacktestPanel', () => {
  it('runs the selected revision and shows provenance, assumptions, and performance', async () => {
    const workbenchApi = api();
    const user = userEvent.setup();
    render(<BacktestPanel botId={botId} revision={revision} backtests={[]} api={workbenchApi} onCompleted={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Run backtest' }));

    expect(workbenchApi.runBacktest).toHaveBeenCalledWith(expect.objectContaining({ botId, revisionVersion: 1 }));
    expect(await screen.findByText('Bundled sample data')).toBeTruthy();
    expect(screen.getByText('+4.20%')).toBeTruthy();
    expect(screen.getByText('1.10%')).toBeTruthy();
    expect(screen.getByLabelText('Equity curve')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('not live market data');
  });

  it('loads an execution trace as an ordered readable timeline', async () => {
    const workbenchApi = api();
    const user = userEvent.setup();
    render(<BacktestPanel botId={botId} revision={revision} backtests={[backtest]} api={workbenchApi} onCompleted={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /trace-1/ }));

    expect(workbenchApi.getTrace).toHaveBeenCalledWith({ botId, traceId: 'trace-1' });
    expect(await screen.findByText('trigger received')).toBeTruthy();
    expect(screen.getAllByText('flow completed')).toHaveLength(2);
    expect(screen.getByText('Node t')).toBeTruthy();
  });
});
