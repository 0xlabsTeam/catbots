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

function context(rsi: number | undefined) {
  return createEvaluationContext({
    evaluatedAt: '2026-09-03T08:15:00.000Z',
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

const triggerInput = { kind: 'interval' as const, occurredAt: '2026-09-03T08:15:00.000Z' };

function filledExecution(): RuntimeExecutionPort {
  return {
    execute: () => ({
      events: [
        { type: 'execution.submitted', metadata: { clientOrderId: 'order-1', authorization: 'must-not-leak' } },
        { type: 'execution.acknowledged', metadata: { venueOrderId: 'venue-1' } },
        { type: 'execution.partially_filled', metadata: { quantity: '0.01' } },
        { type: 'execution.filled', metadata: { quantity: '0.02', price: '60000' } },
      ],
    }),
  };
}

describe('evaluateTrigger', () => {
  it('evaluates Conditions, proposes the Action, and records a complete ordered trace', () => {
    const result = evaluateTrigger({
      compiled: compiledStrategy(), triggerNodeId: 't-15m', triggerInput,
      context: context(25), deployment: { id: 'backtest-1', mode: 'backtest' },
      execution: filledExecution(),
    });

    expect(result.effects).toEqual([expect.objectContaining({
      nodeId: 'a-long', type: 'execution.open_position',
      config: { side: 'long', size: { type: 'equity_percent', value: 5 }, leverage: 2 },
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
      execution: { execute: () => ({ events: [{ type: 'execution.rejected', metadata: { code: 'NO_PRICE' } }] }) },
    });

    expect(result.trace.filter((event) => event.type.startsWith('flow.'))).toEqual([
      expect.objectContaining({ type: 'flow.failed' }),
    ]);
  });
});
