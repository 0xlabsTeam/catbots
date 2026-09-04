import { describe, expect, it } from 'vitest';

import {
  AgentToolActivitySchema,
  ApproveStrategyRevisionInputSchema,
  BacktestSummarySchema,
  ChatMessageSchema,
  GetWorkbenchInputSchema,
  SendWorkbenchMessageInputSchema,
  StrategyRevisionSchema,
  TraceDetailSchema,
  WorkbenchStateSchema,
} from './workbench';

const botId = '11111111-1111-4111-8111-111111111111';
const revision = {
  botId,
  strategyId: 'btc-rsi',
  version: 1,
  name: 'BTC RSI',
  status: 'draft',
  createdAt: '2026-09-04T08:00:00.000Z',
  approvedAt: null,
  nodes: [
    {
      id: 't-15m', kind: 'trigger', type: 'trigger.interval', version: 1,
      title: 'Interval', summary: 'Every 15m',
    },
    {
      id: 'c-rsi', kind: 'condition', type: 'predicate.compare', version: 1,
      title: 'Compare', summary: 'RSI(14) < 30',
    },
    {
      id: 'a-open', kind: 'action', type: 'execution.open_position', version: 1,
      title: 'Open position', summary: 'Open BTC long',
    },
  ],
  edges: [
    { id: 'e1', source: 't-15m', sourcePort: 'activation', target: 'c-rsi', targetPort: 'activation' },
    { id: 'e2', source: 'c-rsi', sourcePort: 'result', target: 'a-open', targetPort: 'condition' },
  ],
};

const backtest = {
  id: '22222222-2222-4222-8222-222222222222',
  botId,
  revisionVersion: 1,
  status: 'completed',
  dataSource: 'Bundled sample data',
  startedAt: '2026-09-04T08:01:00.000Z',
  completedAt: '2026-09-04T08:01:01.000Z',
  assumptions: {
    from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z',
    startingCapital: '10000', feeRateBps: 10, slippageBps: 5,
  },
  metrics: {
    returnPercent: 4.2, maximumDrawdownPercent: 1.5, sharpeLike: 1.1,
    winRatePercent: 60, tradeCount: 5, fees: '12.5', funding: '2.1',
  },
  equityCurve: [
    { timestamp: '2026-08-01T00:00:00.000Z', equity: '10000' },
    { timestamp: '2026-09-01T00:00:00.000Z', equity: '10420' },
  ],
  trades: [{
    traceId: 'trace-1', market: 'BTC-PERP', side: 'long',
    openedAt: '2026-08-02T00:00:00.000Z', closedAt: '2026-08-03T00:00:00.000Z',
    entryPrice: '60000', exitPrice: '61000', realizedPnl: '16.67',
  }],
  warnings: ['Sample data is for workflow evaluation only.'],
  traces: [{ traceId: 'trace-1', outcome: 'executed', occurredAt: '2026-08-02T00:00:00.000Z', summary: 'Opened BTC long' }],
  artifactHash: `sha256:${'a'.repeat(64)}`,
};

describe('workbench request contracts', () => {
  it('trims a non-empty user message and rejects an unknown field', () => {
    expect(SendWorkbenchMessageInputSchema.parse({ botId, message: '  Buy when RSI is low  ' })).toEqual({
      botId,
      message: 'Buy when RSI is low',
    });
    expect(SendWorkbenchMessageInputSchema.safeParse({ botId, message: 'hello', apiKey: 'secret' }).success).toBe(false);
  });

  it('requires UUID bot IDs and positive revision versions', () => {
    expect(GetWorkbenchInputSchema.safeParse({ botId: 'not-a-uuid' }).success).toBe(false);
    expect(ApproveStrategyRevisionInputSchema.safeParse({ botId, version: 0 }).success).toBe(false);
  });
});

describe('workbench response contracts', () => {
  it('accepts a graph projection without exposing canonical JSON source', () => {
    const parsed = StrategyRevisionSchema.parse(revision);

    expect(parsed.nodes.map((node) => node.kind)).toEqual(['trigger', 'condition', 'action']);
    expect(parsed).not.toHaveProperty('document');
    expect(parsed).not.toHaveProperty('json');
  });

  it('rejects secret-bearing or unknown revision fields', () => {
    expect(StrategyRevisionSchema.safeParse({ ...revision, apiKey: 'secret' }).success).toBe(false);
    expect(StrategyRevisionSchema.safeParse({ ...revision, version: -1 }).success).toBe(false);
  });

  it('accepts finite Backtest metrics and rejects non-finite results', () => {
    expect(BacktestSummarySchema.parse(backtest).metrics.returnPercent).toBe(4.2);
    expect(BacktestSummarySchema.safeParse({
      ...backtest,
      metrics: { ...backtest.metrics, sharpeLike: Number.POSITIVE_INFINITY },
    }).success).toBe(false);
  });

  it('validates Chat, tool activity, Workbench state, and trace details strictly', () => {
    const message = ChatMessageSchema.parse({
      id: '33333333-3333-4333-8333-333333333333', botId,
      role: 'assistant', content: 'I created a draft strategy.',
      createdAt: '2026-09-04T08:00:01.000Z',
    });
    const activity = AgentToolActivitySchema.parse({
      botId, requestId: '44444444-4444-4444-8444-444444444444',
      phase: 'tool_completed', tool: 'validate_strategy', message: 'Strategy is valid.',
    });
    const state = WorkbenchStateSchema.parse({
      bot: {
        id: botId, name: 'BTC assistant', market: 'BTC-PERP', status: 'draft',
        createdAt: '2026-09-04T08:00:00.000Z', updatedAt: '2026-09-04T08:00:01.000Z',
      },
      currentRevision: revision,
      revisions: [{ version: 1, status: 'draft', createdAt: revision.createdAt, approvedAt: null }],
      messages: [message],
      backtests: [backtest],
    });
    const trace = TraceDetailSchema.parse({
      traceId: 'trace-1', outcome: 'executed',
      events: [{ sequence: 1, type: 'trigger.received', occurredAt: '2026-08-02T00:00:00.000Z', nodeId: 't-15m', summary: 'Interval fired', details: {} }],
    });

    expect(state.currentRevision?.version).toBe(1);
    expect(activity.tool).toBe('validate_strategy');
    expect(trace.events[0]?.sequence).toBe(1);
  });
});
