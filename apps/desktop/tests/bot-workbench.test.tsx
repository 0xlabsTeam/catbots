// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatbotsDesktopApi, WorkbenchState } from '@catbots/contracts';

vi.mock('../src/renderer/workbench/StrategyGraph', () => ({
  StrategyGraph: ({ revision, onSelectNode }: { revision: WorkbenchState['currentRevision']; onSelectNode(node: NonNullable<WorkbenchState['currentRevision']>['nodes'][number]): void }) => (
    <button onClick={() => revision && onSelectNode(revision.nodes[1]!)}>Mock strategy graph</button>
  ),
}));

import { BotWorkbenchScreen } from '../src/renderer/screens/BotWorkbenchScreen';

const state: WorkbenchState = {
  bot: {
    id: '018f3f75-89ab-7def-8123-456789abcdef', name: 'BTC Flow', market: 'BTC-PERP', status: 'draft',
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

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('BotWorkbenchScreen', () => {
  it('loads chat and a visual flow without rendering canonical JSON', async () => {
    render(<BotWorkbenchScreen bot={state.bot} api={api()} onBack={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'BTC Flow' })).toBeTruthy();
    expect(screen.getByText('Describe your entry and exit rules.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mock strategy graph' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('schemaVersion');
    expect(document.body.textContent).not.toContain('sourcePort');
  });

  it('sends a natural-language requirement and shows safe activity state', async () => {
    const workbenchApi = api();
    const user = userEvent.setup();
    render(<BotWorkbenchScreen bot={state.bot} api={workbenchApi} onBack={vi.fn()} />);
    await screen.findByRole('heading', { name: 'BTC Flow' });

    await user.type(screen.getByLabelText('Message Catbots AI'), 'Use ETF inflow');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(workbenchApi.sendMessage).toHaveBeenCalledWith({ botId: state.bot.id, message: 'Use ETF inflow' });
    expect(await screen.findByText('Use ETF inflow')).toBeTruthy();
  });

  it('selects a node for inspection and requires explicit approval confirmation', async () => {
    const workbenchApi = api();
    const user = userEvent.setup();
    render(<BotWorkbenchScreen bot={state.bot} api={workbenchApi} onBack={vi.fn()} />);
    await screen.findByRole('heading', { name: 'BTC Flow' });

    fireEvent.click(screen.getByRole('button', { name: 'Mock strategy graph' }));
    expect(screen.getByRole('heading', { name: 'Compare' })).toBeTruthy();
    expect(screen.getByText('ETF flow > 0')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Approve v1' }));
    expect(workbenchApi.approveRevision).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect(workbenchApi.approveRevision).toHaveBeenCalledWith({ botId: state.bot.id, version: 1 });
  });
});
