// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatbotsDesktopApi, PaperDeploymentView, RiskLimits, WorkbenchState } from '@catbots/contracts';

vi.mock('../src/renderer/workbench/StrategyGraph', () => ({
  StrategyGraph: ({ revision, onSelectNode }: { revision: WorkbenchState['currentRevision']; onSelectNode(node: NonNullable<WorkbenchState['currentRevision']>['nodes'][number]): void }) => (
    <button onClick={() => revision && onSelectNode(revision.nodes[1]!)}>Mock strategy graph</button>
  ),
}));

import { BotWorkbenchScreen } from '../src/renderer/screens/BotWorkbenchScreen';

const state: WorkbenchState = {
  bot: {
    id: '018f3f75-89ab-7def-8123-456789abcdef', name: 'BTC Flow', dex: 'hyperliquid', status: 'draft',
    createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z',
  },
  currentRevision: {
    botId: '018f3f75-89ab-7def-8123-456789abcdef', strategyId: 'strategy', version: 1, name: 'ETF momentum', status: 'draft',
    createdAt: '2026-09-04T00:00:00.000Z', approvedAt: null,
    nodes: [
      { id: 'trigger', kind: 'trigger', type: 'trigger.interval', version: 1, title: 'Interval', summary: 'Every 1h' },
      { id: 'condition', kind: 'condition', type: 'predicate.compare', version: 1, title: 'Compare', summary: 'ETF flow > 0' },
      { id: 'action', kind: 'action', type: 'execution.open_position', version: 1, title: 'Open position', summary: 'Open long' },
    ],
    edges: [
      { id: 'e1', source: 'trigger', sourcePort: 'activation', target: 'condition', targetPort: 'activation' },
      { id: 'e2', source: 'condition', sourcePort: 'result', target: 'action', targetPort: 'condition' },
    ],
  },
  revisions: [{ version: 1, status: 'draft', createdAt: '2026-09-04T00:00:00.000Z', approvedAt: null }],
  messages: [
    { id: '018f3f75-89ab-7def-8123-456789abcdea', botId: '018f3f75-89ab-7def-8123-456789abcdef', role: 'assistant', content: 'Describe your entry and exit rules.', createdAt: '2026-09-04T00:00:00.000Z' },
  ],
  backtests: [],
};

function api(): CatbotsDesktopApi['workbench'] {
  return {
    get: vi.fn().mockResolvedValue(state),
    sendMessage: vi.fn().mockImplementation(async (_input) => ({
      ...state,
      messages: [...state.messages, { id: '018f3f75-89ab-7def-8123-456789abcdeb', botId: state.bot.id, role: 'user' as const, content: 'Use ETF inflow', createdAt: '2026-09-04T00:01:00.000Z' }],
    })),
    runBacktest: vi.fn(),
    approveRevision: vi.fn().mockResolvedValue({ ...state.currentRevision, status: 'approved', approvedAt: '2026-09-04T00:02:00.000Z' }),
    getTrace: vi.fn(),
    subscribeActivity: vi.fn(() => () => undefined),
  };
}

const paperView: PaperDeploymentView = {
  deployment: {
    id: '028f3f75-89ab-7def-8123-456789abcdef', botId: state.bot.id, strategyId: 'strategy', strategyVersion: 1,
    recordVersion: 2, dex: 'hyperliquid', mode: 'paper', executionVenue: 'paper', marketAccess: { mode: 'all_active_perpetuals' }, status: 'running',
    riskLimits: {
      maxOrderUsd: '1000', maxPositionUsd: '2500', maxTotalExposureUsd: '5000', maxLeverage: 3, maxDailyLossUsd: '300',
      maxDrawdownPercent: 12, allowedSides: ['long', 'short'], maxOrdersPerMinute: 4,
    },
    createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
  },
  state: { equityUsd: '10000', positions: [], orders: [] },
  auditEvents: [],
};

function deploymentApi(): CatbotsDesktopApi['deployments'] {
  return {
    startPaper: vi.fn().mockResolvedValue(paperView),
    getPaper: vi.fn().mockResolvedValue(paperView),
    pausePaper: vi.fn().mockResolvedValue({ ...paperView, deployment: { ...paperView.deployment, status: 'paused' } }),
    stopPaper: vi.fn().mockResolvedValue({ ...paperView, deployment: { ...paperView.deployment, status: 'stopped' } }),
    prepareLive: vi.fn(), startLive: vi.fn(), getLive: vi.fn(), stopLive: vi.fn(), getActive: vi.fn().mockResolvedValue(null),
  };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('BotWorkbenchScreen', () => {
  it('loads chat and a visual flow without rendering canonical JSON', async () => {
    render(<BotWorkbenchScreen bot={state.bot} api={api()} deploymentApi={deploymentApi()} onBack={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'BTC Flow' })).toBeTruthy();
    expect(screen.getByText('Hyperliquid · Dynamic markets')).toBeTruthy();
    expect(screen.getByText('Describe your entry and exit rules.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mock strategy graph' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('schemaVersion');
    expect(document.body.textContent).not.toContain('sourcePort');
  });

  it('sends a natural-language requirement and shows safe activity state', async () => {
    const workbenchApi = api();
    const user = userEvent.setup();
    render(<BotWorkbenchScreen bot={state.bot} api={workbenchApi} deploymentApi={deploymentApi()} onBack={vi.fn()} />);
    await screen.findByRole('heading', { name: 'BTC Flow' });

    await user.type(screen.getByLabelText('Message Catbots AI'), 'Use ETF inflow');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(workbenchApi.sendMessage).toHaveBeenCalledWith({ botId: state.bot.id, message: 'Use ETF inflow' });
    expect(await screen.findByText('Use ETF inflow')).toBeTruthy();
  });

  it('preserves the Chat draft when the Agent request fails', async () => {
    const workbenchApi = api();
    workbenchApi.sendMessage = vi.fn().mockRejectedValue(new Error('provider secret detail'));
    const user = userEvent.setup();
    render(<BotWorkbenchScreen bot={state.bot} api={workbenchApi} deploymentApi={deploymentApi()} onBack={vi.fn()} />);
    await screen.findByRole('heading', { name: 'BTC Flow' });

    const composer = screen.getByLabelText('Message Catbots AI');
    await user.type(composer, 'Keep this requirement');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Catbots AI could not complete that request. Try again.')).toBeTruthy();
    expect((composer as HTMLTextAreaElement).value).toBe('Keep this requirement');
    expect(document.body.textContent).not.toContain('provider secret detail');
  });

  it('selects a node for inspection and requires explicit approval confirmation', async () => {
    const workbenchApi = api();
    const user = userEvent.setup();
    render(<BotWorkbenchScreen bot={state.bot} api={workbenchApi} deploymentApi={deploymentApi()} onBack={vi.fn()} />);
    await screen.findByRole('heading', { name: 'BTC Flow' });

    fireEvent.click(screen.getByRole('button', { name: 'Mock strategy graph' }));
    expect(screen.getByRole('heading', { name: 'Compare' })).toBeTruthy();
    expect(screen.getByText('ETF flow > 0')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Approve v1' }));
    expect(workbenchApi.approveRevision).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect(workbenchApi.approveRevision).toHaveBeenCalledWith({ botId: state.bot.id, version: 1 });
  });

  it('starts an approved revision in Paper mode and exposes performance and logs tabs', async () => {
    const workbenchApi = api();
    workbenchApi.get = vi.fn().mockResolvedValue({
      ...state,
      currentRevision: { ...state.currentRevision!, status: 'approved', approvedAt: '2026-09-05T00:00:00.000Z' },
    });
    const paperApi = deploymentApi();
    const user = userEvent.setup();
    render(<BotWorkbenchScreen bot={state.bot} api={workbenchApi} deploymentApi={paperApi} onBack={vi.fn()} />);
    await screen.findByRole('heading', { name: 'BTC Flow' });

    await user.click(screen.getByRole('button', { name: 'Run Paper' }));
    expect(paperApi.startPaper).toHaveBeenCalledWith(expect.objectContaining({
      botId: state.bot.id, strategyVersion: 1,
      riskLimits: expect.objectContaining({ maxTotalExposureUsd: '5000' }),
    }));
    expect(await screen.findByText('Paper running')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Performance' }));
    expect(screen.getByText('$10,000.00')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Logs' }));
    expect(screen.getByText('Waiting for the first trigger.')).toBeTruthy();
  });

  it('restores an active Live deployment and keeps the emergency Stop visible', async () => {
    const workbenchApi = api();
    workbenchApi.get = vi.fn().mockResolvedValue({
      ...state,
      currentRevision: { ...state.currentRevision!, status: 'approved', approvedAt: '2026-09-05T00:00:00.000Z' },
    });
    const liveApi = deploymentApi();
    const liveDeployment = {
      id: '038f3f75-89ab-7def-8123-456789abcdef', botId: state.bot.id, strategyId: 'strategy', strategyVersion: 1,
      recordVersion: 2 as const, dex: 'hyperliquid' as const, mode: 'live' as const, executionVenue: 'hyperliquid' as const, network: 'testnet' as const, maskedAccount: '0x0123…4567',
      marketAccess: { mode: 'all_active_perpetuals' as const }, riskLimits: paperView.deployment.riskLimits as RiskLimits, status: 'running' as const,
      createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    };
    vi.mocked(liveApi.getActive).mockResolvedValue(liveDeployment);
    vi.mocked(liveApi.stopLive).mockResolvedValue({ ...liveDeployment, status: 'stopped' });
    const user = userEvent.setup();
    render(<BotWorkbenchScreen bot={state.bot} api={workbenchApi} deploymentApi={liveApi} onBack={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'Stop Live' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Stop Live' }));
    expect(liveApi.stopLive).toHaveBeenCalledWith({ deploymentId: liveDeployment.id });
  });
});
