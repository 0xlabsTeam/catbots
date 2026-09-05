import { describe, expect, it, vi } from 'vitest';

import { createBuiltinRegistry } from './builtins';
import { createEvaluationContext } from './evaluation-context';
import { validateStrategy, type CompiledStrategy } from './graph-validator';
import { evaluateTrigger, type RuntimeExecutionPort } from './runtime';
import { parseStrategyDocument } from './strategy-schema';

function compiledStrategy(): CompiledStrategy {
  const document = parseStrategyDocument({
    schemaVersion: '1.0',
    strategy: { id: 'btc-rsi', name: 'BTC RSI', version: 3 },
    nodes: [
      { id: 't-15m', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
      { id: 'c-rsi', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'indicator.rsi', field: 'value' }, operator: 'lt', right: { literal: 30 } } },
      { id: 'c-flat', kind: 'condition', type: 'predicate.position_state', version: 1, config: { state: 'flat', market: 'BTC-PERP' } },
      { id: 'c-all', kind: 'condition', type: 'combine.all', version: 1, config: {} },
      { id: 'a-long', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'equity_percent', value: 5 }, leverage: 2 } },
    ],
    edges: [
      { id: 'e1', source: 't-15m', sourcePort: 'activation', target: 'c-rsi', targetPort: 'activation' },
      { id: 'e2', source: 't-15m', sourcePort: 'activation', target: 'c-flat', targetPort: 'activation' },
      { id: 'e3', source: 'c-rsi', sourcePort: 'result', target: 'c-all', targetPort: 'conditions' },
      { id: 'e4', source: 'c-flat', sourcePort: 'result', target: 'c-all', targetPort: 'conditions' },
      { id: 'e5', source: 'c-all', sourcePort: 'result', target: 'a-long', targetPort: 'condition' },
    ],
  });
  const result = validateStrategy(document, createBuiltinRegistry());
  if (!result.valid) throw new Error('Fixture must compile');
  return result.compiled;
}

function context(rsi: number | undefined, currentMarket = 'BTC-PERP') {
  return createEvaluationContext({
    evaluatedAt: '2026-09-03T08:15:00.000Z',
    currentMarket,
    values: {
      ...(rsi === undefined ? {} : {
        'indicator.rsi': {
          value: { value: rsi }, provider: 'fixture.indicator',
          observedAt: '2026-09-03T08:15:00.000Z', freshnessSeconds: 0,
          quality: { status: 'verified' as const }, integrityHash: 'sha256:rsi',
        },
      }),
      'account.positions': {
        value: [], provider: 'fixture.account',
        observedAt: '2026-09-03T08:15:00.000Z', freshnessSeconds: 0,
        quality: { status: 'verified' as const }, integrityHash: 'sha256:positions',
      },
    },
  });
}

function compiledMarketStrategy(): CompiledStrategy {
  const document = parseStrategyDocument({
    schemaVersion: '2.0',
    strategy: { id: 'eth-rsi', name: 'ETH RSI', version: 1 },
    marketScope: { type: 'dex_universe' },
    nodes: [
      { id: 't-15m', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
      { id: 'c-symbol', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'market.symbol' }, operator: 'eq', right: { literal: 'ETH-PERP' } } },
      { id: 'a-long', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long' } },
    ],
    edges: [
      { id: 'e1', source: 't-15m', sourcePort: 'activation', target: 'c-symbol', targetPort: 'activation' },
      { id: 'e2', source: 'c-symbol', sourcePort: 'result', target: 'a-long', targetPort: 'condition' },
    ],
  });
  const result = validateStrategy(document, createBuiltinRegistry());
  if (!result.valid) throw new Error(`Fixture must compile: ${JSON.stringify(result.errors)}`);
  return result.compiled;
}

function compiledMarketEventStrategy(scope: 'market' | 'dex' = 'market'): CompiledStrategy {
  const document = parseStrategyDocument({
    schemaVersion: '2.0',
    strategy: { id: 'btc-event', name: 'BTC Event', version: 1 },
    marketScope: { type: 'dex_universe' },
    nodes: [
      { id: 't-trade', kind: 'trigger', type: 'trigger.event', version: 1, config: { eventType: 'market.trade', filters: {}, scope } },
      { id: 'c-symbol', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'market.symbol' }, operator: 'eq', right: { literal: 'BTC-PERP' } } },
      { id: 'a-long', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long' } },
    ],
    edges: [
      { id: 'e1', source: 't-trade', sourcePort: 'activation', target: 'c-symbol', targetPort: 'activation' },
      { id: 'e2', source: 'c-symbol', sourcePort: 'result', target: 'a-long', targetPort: 'condition' },
    ],
  });
  const result = validateStrategy(document, createBuiltinRegistry());
  if (!result.valid) throw new Error(`Fixture must compile: ${JSON.stringify(result.errors)}`);
  return result.compiled;
}

const triggerInput = { kind: 'interval' as const, occurredAt: '2026-09-03T08:15:00.000Z' };

function filledExecution(): RuntimeExecutionPort {
  return {
    execute: () => ({
      events: [
        { type: 'risk.approved', metadata: { decision: 'approved', evaluator: 'backtest.simulation' } },
        { type: 'execution.queued', metadata: { effectIdempotencyKey: 'effect-1' } },
        { type: 'execution.submitted', metadata: { clientOrderId: 'order-1', authorization: 'must-not-leak' } },
        { type: 'execution.acknowledged', metadata: { venueOrderId: 'venue-1' } },
        { type: 'execution.partially_filled', metadata: { quantity: '0.01' } },
        { type: 'execution.filled', metadata: { quantity: '0.02', price: '60000' } },
      ],
    }),
  };
}

describe('evaluateTrigger', () => {
  it('requires a market-scoped Event to match the evaluation currentMarket', () => {
    const compiled = compiledMarketEventStrategy();
    const eventInput = {
      kind: 'event' as const,
      event: {
        id: 'trade-1', type: 'market.trade', market: 'BTC-PERP',
        occurredAt: '2026-09-03T08:15:00.000Z', receivedAt: '2026-09-03T08:15:01.000Z',
        source: 'fixture.market', payload: {},
        quality: { status: 'verified' as const, freshnessSeconds: 1 },
      },
    };
    const requestFor = (currentMarket: string) => ({
      compiled,
      triggerNodeId: 't-trade',
      triggerInput: eventInput,
      context: context(25, currentMarket),
      deployment: { id: 'backtest-1', mode: 'backtest' as const },
      execution: filledExecution(),
    });

    expect(() => evaluateTrigger(requestFor('ETH-PERP'))).toThrow(/event market.*currentMarket/i);
    expect(evaluateTrigger(requestFor('BTC-PERP')).effects).toEqual([
      expect.objectContaining({ market: 'BTC-PERP' }),
    ]);

    expect(evaluateTrigger({
      ...requestFor('BTC-PERP'),
      compiled: compiledMarketEventStrategy('dex'),
      triggerInput: { kind: 'event', event: { ...eventInput.event, market: undefined } },
    }).effects).toEqual([expect.objectContaining({ market: 'BTC-PERP' })]);
  });

  it('binds symbol Conditions and proposed Actions to the immutable current market', () => {
    const requestFor = (currentMarket: string) => ({
      compiled: compiledMarketStrategy(),
      triggerNodeId: 't-15m',
      triggerInput,
      context: context(25, currentMarket),
      deployment: { id: 'backtest-1', mode: 'backtest' as const },
      execution: filledExecution(),
    });

    const eth = evaluateTrigger(requestFor('ETH-PERP'));
    const btc = evaluateTrigger(requestFor('BTC-PERP'));

    expect(eth.effects).toEqual([expect.objectContaining({
      market: 'ETH-PERP',
      idempotencyKey: expect.stringContaining('ETH-PERP'),
    })]);
    expect(btc.effects).toHaveLength(0);
  });

  it('rejects an explicit market override on an Action at evaluation time', () => {
    const compiled = compiledMarketStrategy();
    const action = compiled.document.nodes.find((node) => node.id === 'a-long');
    if (!action) throw new Error('Action fixture is missing');
    action.config = { ...action.config, market: 'BTC-PERP' };

    expect(() => evaluateTrigger({
      compiled,
      triggerNodeId: 't-15m',
      triggerInput,
      context: context(25, 'ETH-PERP'),
      deployment: { id: 'backtest-1', mode: 'backtest' },
      execution: filledExecution(),
    })).toThrow(/action.*market/i);
  });

  it('evaluates Conditions, proposes the Action, and records a complete ordered trace', () => {
    const result = evaluateTrigger({
      compiled: compiledStrategy(), triggerNodeId: 't-15m', triggerInput,
      context: context(25), deployment: { id: 'backtest-1', mode: 'backtest' },
      execution: filledExecution(),
    });

    expect(result.effects).toEqual([expect.objectContaining({
      nodeId: 'a-long', type: 'execution.open_position',
      market: 'BTC-PERP',
      config: { side: 'long', size: { type: 'equity_percent', value: 5 }, leverage: 2 },
      idempotencyKey: 't-15m:interval:2026-09-03T08:15:00.000Z:market:BTC-PERP:action:a-long',
    })]);
    expect(result.trace.map((event) => event.type)).toEqual([
      'trigger.received',
      'context.resolution_started',
      'context.resolved',
      'condition.evaluated',
      'condition.evaluated',
      'condition.evaluated',
      'action.proposed',
      'risk.approved',
      'execution.queued',
      'execution.submitted',
      'execution.acknowledged',
      'execution.partially_filled',
      'execution.filled',
      'flow.completed',
    ]);
    expect(result.trace.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(JSON.stringify(result.trace)).not.toMatch(/must-not-leak|authorization/i);
  });

  it.each([
    ['false', 45, false, 'predicate.not_matched'],
    ['unknown', undefined, 'unknown', 'data.missing'],
  ] as const)('suppresses Actions when the controlling result is %s', (_label, rsi, expected, reason) => {
    const execute = vi.fn();
    const result = evaluateTrigger({
      compiled: compiledStrategy(), triggerNodeId: 't-15m', triggerInput,
      context: context(rsi), deployment: { id: 'backtest-1', mode: 'backtest' },
      execution: { execute },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.effects).toEqual([]);
    expect(result.trace.at(-1)).toMatchObject({ type: 'flow.skipped' });
    expect(result.trace).toContainEqual(expect.objectContaining({
      type: 'condition.evaluated',
      nodeId: 'c-rsi',
      details: expect.objectContaining({ result: expected, reason }),
    }));
  });

  it('produces byte-identical IDs and trace content for the same inputs', () => {
    const request = {
      compiled: compiledStrategy(), triggerNodeId: 't-15m', triggerInput,
      context: context(25), deployment: { id: 'backtest-1', mode: 'backtest' as const },
      execution: filledExecution(),
    };

    expect(JSON.stringify(evaluateTrigger(request))).toBe(JSON.stringify(evaluateTrigger(request)));
  });

  it('ends every trace with exactly one terminal flow event when execution rejects', () => {
    const result = evaluateTrigger({
      compiled: compiledStrategy(), triggerNodeId: 't-15m', triggerInput,
      context: context(25), deployment: { id: 'backtest-1', mode: 'backtest' },
      execution: { execute: () => ({ events: [
        { type: 'risk.approved', metadata: { decision: 'approved', evaluator: 'backtest.simulation' } },
        { type: 'execution.queued', metadata: { effectIdempotencyKey: 'effect-1' } },
        { type: 'execution.rejected', metadata: { code: 'NO_PRICE' } },
      ] }) },
    });

    expect(result.trace.filter((event) => event.type.startsWith('flow.'))).toEqual([
      expect.objectContaining({ type: 'flow.failed' }),
    ]);
  });

  it('records a real risk rejection without inventing approval or queue events', () => {
    const rejectingRiskPort: RuntimeExecutionPort = {
      execute: () => ({
        events: [{ type: 'risk.rejected', metadata: { violatedRuleIds: ['max-order-usd'] } }],
      }),
    };

    const result = evaluateTrigger({
      compiled: compiledStrategy(), triggerNodeId: 't-15m', triggerInput,
      context: context(25), deployment: { id: 'paper-1', mode: 'paper' },
      execution: rejectingRiskPort,
    });

    expect(result.trace.map(({ type }) => type)).toContain('risk.rejected');
    expect(result.trace.map(({ type }) => type)).not.toContain('risk.approved');
    expect(result.trace.map(({ type }) => type)).not.toContain('execution.queued');
    expect(result.trace.at(-1)?.type).toBe('flow.failed');
  });

  it('rejects an interval activation that is not on the registered UTC cadence', () => {
    expect(() => evaluateTrigger({
      compiled: compiledStrategy(), triggerNodeId: 't-15m',
      triggerInput: { kind: 'interval', occurredAt: '2026-09-03T08:16:00.000Z' },
      context: context(25), deployment: { id: 'backtest-1', mode: 'backtest' },
      execution: filledExecution(),
    })).toThrow(/does not match trigger/i);
  });

  it('rejects an Event input whose registered type or filters do not match', () => {
    const document = structuredClone(compiledStrategy().document);
    document.nodes[0] = {
      id: 't-event', kind: 'trigger', type: 'trigger.event', version: 1,
      config: { eventType: 'data.etf_flow.updated', filters: { asset: 'BTC' } },
    };
    document.edges = document.edges.map((edge) => (
      edge.source === 't-15m' ? { ...edge, source: 't-event' } : edge
    ));
    const validation = validateStrategy(document, createBuiltinRegistry());
    if (!validation.valid) throw new Error(`Event fixture must compile: ${JSON.stringify(validation.errors)}`);

    expect(() => evaluateTrigger({
      compiled: validation.compiled,
      triggerNodeId: 't-event',
      triggerInput: {
        kind: 'event',
        event: {
          id: 'wrong-event', type: 'market.trade',
          occurredAt: '2026-09-03T08:15:00.000Z', receivedAt: '2026-09-03T08:15:00.000Z',
          source: 'fixture', payload: { asset: 'ETH' },
          quality: { status: 'verified', freshnessSeconds: 0 },
        },
      },
      context: context(25), deployment: { id: 'backtest-1', mode: 'backtest' },
      execution: filledExecution(),
    })).toThrow(/does not match trigger/i);
  });

  it('records context failure and terminates the flow before evaluating Conditions', () => {
    const execute = vi.fn();
    const result = evaluateTrigger({
      compiled: compiledStrategy(), triggerNodeId: 't-15m', triggerInput,
      context: undefined,
      contextFailure: { code: 'DATA_RESOLVER_UNAVAILABLE', message: 'Resolver did not respond' },
      deployment: { id: 'backtest-1', mode: 'backtest' },
      execution: { execute },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.trace.map((event) => event.type)).toEqual([
      'trigger.received', 'context.resolution_started', 'context.failed', 'flow.failed',
    ]);
    expect(result.trace[2]?.details).toEqual({
      code: 'DATA_RESOLVER_UNAVAILABLE', message: 'Resolver did not respond',
    });
  });
});
