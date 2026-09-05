import { describe, expect, it, vi } from 'vitest';

import { createBuiltinRegistry } from './builtins';
import { coordinateEvaluation } from './evaluation-coordinator';
import { createEvaluationContext } from './evaluation-context';
import { validateStrategy, type CompiledStrategy } from './graph-validator';
import type { MarketUniverseSnapshot } from './market-universe';
import type { RuntimeExecutionPort } from './runtime';
import { parseStrategyDocument } from './strategy-schema';

const occurredAt = '2026-09-03T08:15:00.000Z';

function compiledStrategy(scope: 'interval' | 'market-event' | 'dex-event' = 'interval'): CompiledStrategy {
  const event = scope !== 'interval';
  const document = parseStrategyDocument({
    schemaVersion: '2.0',
    strategy: { id: 'dex-momentum', name: 'DEX Momentum', version: 4 },
    marketScope: { type: 'dex_universe' },
    nodes: [
      event
        ? {
            id: 't-market', kind: 'trigger', type: 'trigger.event', version: 1,
            config: { eventType: 'market.trade', filters: {}, scope: scope === 'dex-event' ? 'dex' : 'market' },
          }
        : {
            id: 't-15m', kind: 'trigger', type: 'trigger.interval', version: 1,
            config: { every: '15m', alignment: 'utc' },
          },
      {
        id: 'c-flat', kind: 'condition', type: 'predicate.position_state', version: 2,
        config: { state: 'flat' },
      },
      {
        id: 'a-long', kind: 'action', type: 'execution.open_position', version: 1,
        config: { side: 'long' },
      },
    ],
    edges: [
      {
        id: 'e1', source: event ? 't-market' : 't-15m', sourcePort: 'activation',
        target: 'c-flat', targetPort: 'activation',
      },
      { id: 'e2', source: 'c-flat', sourcePort: 'result', target: 'a-long', targetPort: 'condition' },
    ],
  });
  const validation = validateStrategy(document, createBuiltinRegistry());
  if (!validation.valid) throw new Error(`Fixture must compile: ${JSON.stringify(validation.errors)}`);
  return validation.compiled;
}

function snapshot(
  revision: string,
  markets: readonly (string | Readonly<{ symbol: string; active: boolean }>)[],
): MarketUniverseSnapshot {
  return {
    dex: 'hyperliquid', revision, observedAt: occurredAt,
    markets: markets.map((market) => ({
      ...(typeof market === 'string' ? { symbol: market, active: true } : market),
      sizeDecimals: 4,
      maximumLeverage: 20,
    })),
  };
}

function filledExecution(): RuntimeExecutionPort {
  return {
    execute: () => ({ events: [{ type: 'execution.filled', metadata: { quantity: '1' } }] }),
  };
}

describe('coordinateEvaluation', () => {
  it('fans an interval out to active markets in normalized symbol order with one parent trace', () => {
    const request = {
      compiled: compiledStrategy(),
      triggerNodeId: 't-15m',
      triggerInput: { kind: 'interval' as const, occurredAt },
      universe: snapshot('universe:42', [
        { symbol: ' ETH-PERP ', active: true },
        { symbol: 'SOL-PERP', active: false },
        { symbol: 'BTC-PERP', active: true },
      ]),
      contextFactory: (market: string) => createEvaluationContext({
        evaluatedAt: occurredAt,
        currentMarket: market,
        values: {
          'account.positions': {
            value: [], provider: 'fixture.account', observedAt: occurredAt, freshnessSeconds: 0,
            quality: { status: 'verified' as const }, integrityHash: `positions:${market}`,
          },
        },
      }),
      deployment: { id: 'backtest-42', mode: 'backtest' as const },
      execution: filledExecution(),
    };

    const result = coordinateEvaluation(request);

    expect(result.children.map((child) => child.market)).toEqual(['BTC-PERP', 'ETH-PERP']);
    expect(result.children.every((child) => child.parentTraceId === result.parentTraceId)).toBe(true);
    expect(result.parentTrace.map(({ type }) => type)).toEqual([
      'trigger.received',
      'universe.resolved',
      'market.evaluation_completed',
      'market.evaluation_completed',
      'flow.completed',
    ]);
    expect(result.parentTrace[1]?.details).toMatchObject({
      dex: 'hyperliquid', revision: 'universe:42', observedAt: occurredAt,
    });
    expect(result.parentTrace.slice(2, 4).map(({ details }) => details)).toEqual([
      expect.objectContaining({
        market: 'BTC-PERP', outcome: 'completed', childTraceId: result.children[0]?.evaluation.traceId,
      }),
      expect.objectContaining({
        market: 'ETH-PERP', outcome: 'completed', childTraceId: result.children[1]?.evaluation.traceId,
      }),
    ]);
    expect(new Set(result.children.map(({ evaluation }) => evaluation.traceId)).size).toBe(2);
    expect(result.children.every(({ evaluation }) => (
      evaluation.trace.every(({ traceId }) => traceId === evaluation.traceId)
    ))).toBe(true);
    expect(JSON.stringify(coordinateEvaluation(request))).toBe(JSON.stringify(result));
  });

  it('changes the parent and child trace IDs when the universe revision changes', () => {
    const baseRequest = {
      compiled: compiledStrategy(),
      triggerNodeId: 't-15m',
      triggerInput: { kind: 'interval' as const, occurredAt },
      contextFactory: (market: string) => createEvaluationContext({
        evaluatedAt: occurredAt,
        currentMarket: market,
        values: {
          'account.positions': {
            value: [], provider: 'fixture.account', observedAt: occurredAt, freshnessSeconds: 0,
            quality: { status: 'verified' as const }, integrityHash: `positions:${market}`,
          },
        },
      }),
      deployment: { id: 'backtest-42', mode: 'backtest' as const },
      execution: filledExecution(),
    };

    const revision42 = coordinateEvaluation({
      ...baseRequest, universe: snapshot('universe:42', ['BTC-PERP']),
    });
    const revision43 = coordinateEvaluation({
      ...baseRequest, universe: snapshot('universe:43', ['BTC-PERP']),
    });

    expect(revision42.parentTraceId).not.toBe(revision43.parentTraceId);
    expect(revision42.children[0]?.evaluation.traceId).not.toBe(
      revision43.children[0]?.evaluation.traceId,
    );
  });

  it('rejects duplicate universe symbols after whitespace normalization', () => {
    const contextFactory = vi.fn();

    expect(() => coordinateEvaluation({
      compiled: compiledStrategy(),
      triggerNodeId: 't-15m',
      triggerInput: { kind: 'interval', occurredAt },
      universe: snapshot('universe:duplicate', ['BTC-PERP', ' BTC-PERP ']),
      contextFactory,
      deployment: { id: 'backtest-42', mode: 'backtest' },
      execution: filledExecution(),
    })).toThrow('Duplicate normalized market symbol.');
    expect(contextFactory).not.toHaveBeenCalled();
  });

  it('evaluates a market-scoped Event only for its exact active universe market', () => {
    const event = {
      id: 'trade-eth-1', type: 'market.trade', market: 'ETH-PERP',
      occurredAt, receivedAt: '2026-09-03T08:15:01.000Z', source: 'fixture.market', payload: {},
      quality: { status: 'verified' as const, freshnessSeconds: 1 },
    };

    const result = coordinateEvaluation({
      compiled: compiledStrategy('market-event'),
      triggerNodeId: 't-market',
      triggerInput: { kind: 'event', event },
      universe: snapshot('universe:42', ['BTC-PERP', 'ETH-PERP']),
      contextFactory: (market) => createEvaluationContext({
        evaluatedAt: occurredAt,
        currentMarket: market,
        triggerEvent: event,
        values: {
          'account.positions': {
            value: [], provider: 'fixture.account', observedAt: occurredAt, freshnessSeconds: 0,
            quality: { status: 'verified' as const }, integrityHash: `positions:${market}`,
          },
        },
      }),
      deployment: { id: 'paper-42', mode: 'paper' },
      execution: filledExecution(),
    });

    expect(result.children.map(({ market }) => market)).toEqual(['ETH-PERP']);
    expect(result.children[0]?.evaluation.effects).toEqual([
      expect.objectContaining({ market: 'ETH-PERP' }),
    ]);
  });

  it('skips a market-scoped Event when its market is inactive', () => {
    const event = {
      id: 'trade-doge-1', type: 'market.trade', market: 'DOGE-PERP',
      occurredAt, receivedAt: occurredAt, source: 'fixture.market', payload: {},
      quality: { status: 'verified' as const, freshnessSeconds: 0 },
    };
    const contextFactory = vi.fn();

    const result = coordinateEvaluation({
      compiled: compiledStrategy('market-event'),
      triggerNodeId: 't-market',
      triggerInput: { kind: 'event', event },
      universe: snapshot('universe:42', [{ symbol: 'DOGE-PERP', active: false }]),
      contextFactory,
      deployment: { id: 'paper-42', mode: 'paper' },
      execution: filledExecution(),
    });

    expect(result.children).toHaveLength(0);
    expect(contextFactory).not.toHaveBeenCalled();
    expect(result.parentTrace.at(-1)).toMatchObject({
      type: 'flow.skipped', details: { reason: 'market.not_active_or_present' },
    });
  });

  it('fans an Event out to the active universe only when the trigger scope is dex', () => {
    const event = {
      id: 'trade-dex-1', type: 'market.trade',
      occurredAt, receivedAt: occurredAt, source: 'fixture.market', payload: {},
      quality: { status: 'verified' as const, freshnessSeconds: 0 },
    };

    const result = coordinateEvaluation({
      compiled: compiledStrategy('dex-event'),
      triggerNodeId: 't-market',
      triggerInput: { kind: 'event', event },
      universe: snapshot('universe:42', ['ETH-PERP', 'BTC-PERP']),
      contextFactory: (market) => createEvaluationContext({
        evaluatedAt: occurredAt,
        currentMarket: market,
        triggerEvent: event,
        values: {
          'account.positions': {
            value: [], provider: 'fixture.account', observedAt: occurredAt, freshnessSeconds: 0,
            quality: { status: 'verified' as const }, integrityHash: `positions:${market}`,
          },
        },
      }),
      deployment: { id: 'live-42', mode: 'live' },
      execution: filledExecution(),
    });

    expect(result.children.map(({ market }) => market)).toEqual(['BTC-PERP', 'ETH-PERP']);
  });

  it('isolates a context resolution failure to its market child', () => {
    const execute = vi.fn<RuntimeExecutionPort['execute']>(() => ({
      events: [{ type: 'execution.filled', metadata: { quantity: '1' } }],
    }));

    const result = coordinateEvaluation({
      compiled: compiledStrategy(),
      triggerNodeId: 't-15m',
      triggerInput: { kind: 'interval', occurredAt },
      universe: snapshot('universe:42', ['ETH-PERP', 'BTC-PERP']),
      contextFactory: (market) => {
        if (market === 'ETH-PERP') throw new Error('provider hyperliquid says wallet-secret');
        return createEvaluationContext({
          evaluatedAt: occurredAt,
          currentMarket: market,
          values: {
            'account.positions': {
              value: [], provider: 'fixture.account', observedAt: occurredAt, freshnessSeconds: 0,
              quality: { status: 'verified' as const }, integrityHash: `positions:${market}`,
            },
          },
        });
      },
      deployment: { id: 'backtest-42', mode: 'backtest' },
      execution: { execute },
    });

    expect(result.children.map(({ outcome }) => outcome)).toEqual(['completed', 'failed']);
    expect(result.children.map(({ evaluation }) => ({
      market: evaluation.trace[0]?.market,
      universeRevision: evaluation.trace[0]?.universeRevision,
    }))).toEqual([
      { market: 'BTC-PERP', universeRevision: 'universe:42' },
      { market: 'ETH-PERP', universeRevision: 'universe:42' },
    ]);
    expect(result.children.every((child) => child.evaluation.trace.every((event) => (
      event.market === child.market && event.universeRevision === 'universe:42'
    )))).toBe(true);
    expect(result.children[1]?.evaluation.trace.map(({ type }) => type)).toEqual([
      'trigger.received', 'context.resolution_started', 'context.failed', 'flow.failed',
    ]);
    expect(result.children[1]?.evaluation.trace[2]?.details).toEqual({
      code: 'CONTEXT_RESOLUTION_FAILED', message: 'Market context could not be resolved.',
    });
    expect(JSON.stringify(result)).not.toContain('provider hyperliquid says wallet-secret');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.parentTrace.at(-1)).toMatchObject({
      type: 'flow.failed', details: { failedMarkets: ['ETH-PERP'] },
    });
  });

  it('fails only the selected market child when a market Event context resolves to another market', () => {
    const event = {
      id: 'trade-eth-mismatch', type: 'market.trade', market: 'ETH-PERP',
      occurredAt, receivedAt: occurredAt, source: 'fixture.market', payload: {},
      quality: { status: 'verified' as const, freshnessSeconds: 0 },
    };

    const execute = vi.fn<RuntimeExecutionPort['execute']>();
    const result = coordinateEvaluation({
      compiled: compiledStrategy('market-event'),
      triggerNodeId: 't-market',
      triggerInput: { kind: 'event', event },
      universe: snapshot('universe:42', ['ETH-PERP']),
      contextFactory: () => createEvaluationContext({
        evaluatedAt: occurredAt,
        currentMarket: 'BTC-PERP',
        triggerEvent: event,
        values: {
          'account.positions': {
            value: [], provider: 'fixture.account', observedAt: occurredAt, freshnessSeconds: 0,
            quality: { status: 'verified' as const }, integrityHash: 'positions:BTC-PERP',
          },
        },
      }),
      deployment: { id: 'paper-42', mode: 'paper' },
      execution: { execute },
    });

    expect(result.children).toEqual([
      expect.objectContaining({ market: 'ETH-PERP', outcome: 'failed' }),
    ]);
    expect(result.children[0]?.evaluation.trace.map(({ type }) => type)).toEqual([
      'trigger.received', 'context.resolution_started', 'context.failed', 'flow.failed',
    ]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps interval siblings running when one resolved context is bound to another market', () => {
    const result = coordinateEvaluation({
      compiled: compiledStrategy(),
      triggerNodeId: 't-15m',
      triggerInput: { kind: 'interval', occurredAt },
      universe: snapshot('universe:42', ['ETH-PERP', 'BTC-PERP']),
      contextFactory: () => createEvaluationContext({
        evaluatedAt: occurredAt,
        currentMarket: 'BTC-PERP',
        values: {
          'account.positions': {
            value: [], provider: 'fixture.account', observedAt: occurredAt, freshnessSeconds: 0,
            quality: { status: 'verified' as const }, integrityHash: 'positions:BTC-PERP',
          },
        },
      }),
      deployment: { id: 'backtest-42', mode: 'backtest' },
      execution: filledExecution(),
    });

    expect(result.children.map(({ outcome }) => outcome)).toEqual(['completed', 'failed']);
    expect(result.children[1]?.evaluation.trace[2]?.details).toEqual({
      code: 'CONTEXT_RESOLUTION_FAILED',
      message: 'Market context could not be resolved.',
    });
  });

  it('snapshots every factory result into an independent immutable child context', () => {
    const receivedContexts: Parameters<RuntimeExecutionPort['execute']>[1][] = [];

    coordinateEvaluation({
      compiled: compiledStrategy(),
      triggerNodeId: 't-15m',
      triggerInput: { kind: 'interval', occurredAt },
      universe: snapshot('universe:42', ['BTC-PERP', 'ETH-PERP']),
      contextFactory: (market) => ({
        evaluatedAt: occurredAt,
        currentMarket: market,
        values: {
          'account.positions': {
            value: [], provider: 'fixture.account', observedAt: occurredAt, freshnessSeconds: 0,
            quality: { status: 'verified' as const }, integrityHash: `positions:${market}`,
          },
        },
      }),
      deployment: { id: 'backtest-42', mode: 'backtest' },
      execution: {
        execute: (_effect, context) => {
          receivedContexts.push(context);
          return { events: [{ type: 'execution.filled' }] };
        },
      },
    });

    expect(receivedContexts.map(({ currentMarket }) => currentMarket)).toEqual(['BTC-PERP', 'ETH-PERP']);
    expect(receivedContexts[0]).not.toBe(receivedContexts[1]);
    expect(receivedContexts.every((context) => (
      Object.isFrozen(context)
      && Object.isFrozen(context.values)
      && Object.isFrozen(context.values['account.positions']?.value)
    ))).toBe(true);
  });
});
