import { describe, expect, it } from 'vitest';

import {
  createEvaluationContext,
  type EvaluationValue,
} from './evaluation-context';
import { createBuiltinRegistry } from './builtins';
import {
  combineConditionResults,
  evaluateConditionNode,
  type ConditionResult,
} from './condition-evaluator';
import type { StrategyNode } from './strategy-schema';

function value<T>(input: T, overrides: Partial<EvaluationValue<T>> = {}): EvaluationValue<T> {
  return {
    value: input,
    provider: 'fixture.market',
    observedAt: '2026-09-03T08:00:00.000Z',
    freshnessSeconds: 0,
    quality: { status: 'verified' },
    integrityHash: 'sha256:fixture',
    ...overrides,
  };
}

const compareNode: StrategyNode = {
  id: 'c-rsi',
  kind: 'condition',
  type: 'predicate.compare',
  version: 1,
  config: {
    left: { ref: 'indicator.rsi.14', field: 'value', maxAgeSeconds: 60 },
    operator: 'lt',
    right: { literal: 30 },
  },
};

const knownTrue: ConditionResult = { value: true, reason: 'predicate.matched', inputs: [] };
const knownFalse: ConditionResult = { value: false, reason: 'predicate.not_matched', inputs: [] };
const unknown: ConditionResult = { value: 'unknown', reason: 'data.missing', inputs: [] };

describe('createEvaluationContext', () => {
  it('takes an immutable snapshot instead of retaining caller-owned values', () => {
    const source = value({ value: 25 });
    const context = createEvaluationContext({
      evaluatedAt: '2026-09-03T08:00:30.000Z',
      currentMarket: 'ETH-PERP',
      values: { 'indicator.rsi.14': source },
    });

    source.value.value = 80;

    expect(context.values['indicator.rsi.14']?.value).toEqual({ value: 25 });
    expect(Object.isFrozen(context.values['indicator.rsi.14']?.value)).toBe(true);
  });

  it('binds and freezes a verified market symbol from the current market', () => {
    const context = createEvaluationContext({
      evaluatedAt: '2026-09-03T08:00:30.000Z',
      currentMarket: 'ETH-PERP',
      values: {},
    });

    expect(context.currentMarket).toBe('ETH-PERP');
    expect(context.values['market.symbol']).toMatchObject({
      value: 'ETH-PERP',
      quality: { status: 'verified' },
      freshnessSeconds: 0,
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.values['market.symbol'])).toBe(true);
  });

  it('rejects a caller-supplied market symbol that conflicts with the current market', () => {
    expect(() => createEvaluationContext({
      evaluatedAt: '2026-09-03T08:00:30.000Z',
      currentMarket: 'ETH-PERP',
      values: { 'market.symbol': value('BTC-PERP') },
    })).toThrow(/market\.symbol.*currentMarket/i);
  });
});

describe('evaluateConditionNode', () => {
  it('evaluates a referenced field against a literal and records provenance', () => {
    const context = createEvaluationContext({
      evaluatedAt: '2026-09-03T08:00:30.000Z',
      currentMarket: 'ETH-PERP',
      values: { 'indicator.rsi.14': value({ value: 25 }) },
    });

    expect(evaluateConditionNode(compareNode, context)).toEqual({
      value: true,
      reason: 'predicate.matched',
      inputs: [{
        ref: 'indicator.rsi.14',
        field: 'value',
        value: 25,
        provider: 'fixture.market',
        observedAt: '2026-09-03T08:00:00.000Z',
        freshnessSeconds: 0,
        quality: 'verified',
        integrityHash: 'sha256:fixture',
      }],
    });
  });

  it.each([
    ['missing', {}, 'data.missing'],
    ['stale by quality', { 'indicator.rsi.14': value({ value: 25 }, { quality: { status: 'stale' } }) }, 'data.stale'],
    ['stale by node policy', { 'indicator.rsi.14': value({ value: 25 }, { freshnessSeconds: 61 }) }, 'data.stale'],
    ['unauthorized', { 'indicator.rsi.14': value({ value: 25 }, { quality: { status: 'unauthorized' } }) }, 'data.unauthorized'],
    ['invalid', { 'indicator.rsi.14': value({ value: 25 }, { quality: { status: 'invalid' } }) }, 'data.invalid'],
  ] as const)('returns unknown for %s data', (_label, values, reason) => {
    const context = createEvaluationContext({
      evaluatedAt: '2026-09-03T08:00:30.000Z',
      currentMarket: 'ETH-PERP',
      values,
    });

    expect(evaluateConditionNode(compareNode, context)).toMatchObject({ value: 'unknown', reason });
  });

  it('does not substitute another reference when the requested field is absent', () => {
    const context = createEvaluationContext({
      evaluatedAt: '2026-09-03T08:00:30.000Z',
      currentMarket: 'ETH-PERP',
      values: {
        'indicator.rsi.14': value({ other: 25 }),
        'indicator.rsi.fallback': value({ value: 25 }),
      },
    });

    expect(evaluateConditionNode(compareNode, context)).toMatchObject({
      value: 'unknown',
      reason: 'data.field_missing',
    });
  });

  it.each([
    ['eq', 5, 5, true],
    ['neq', 5, 6, true],
    ['gt', 6, 5, true],
    ['gte', 5, 5, true],
    ['lt', 4, 5, true],
    ['lte', 5, 5, true],
    ['gt', 4, 5, false],
  ] as const)('applies %s without coercing values', (operator, left, right, expected) => {
    const node: StrategyNode = {
      ...compareNode,
      config: { left: { literal: left }, operator, right: { literal: right } },
    };
    const context = createEvaluationContext({
      evaluatedAt: '2026-09-03T08:00:30.000Z',
      currentMarket: 'ETH-PERP',
      values: {},
    });

    expect(evaluateConditionNode(node, context).value).toBe(expected);
  });

  it('evaluates only the current-market position', () => {
    const node: StrategyNode = {
      id: 'c-position',
      kind: 'condition',
      type: 'predicate.position_state',
      version: 2,
      config: { state: 'flat' },
    };
    const context = createEvaluationContext({
      evaluatedAt: '2026-09-03T08:00:30.000Z',
      currentMarket: 'ETH-PERP',
      values: {
        'account.positions': value([{ market: 'BTC-PERP', side: 'long' }]),
      },
    });

    expect(evaluateConditionNode(node, context)).toMatchObject({
      value: true,
      reason: 'predicate.matched',
    });
  });

  it('preserves the explicit market of a legacy position predicate', () => {
    const node: StrategyNode = {
      id: 'c-position',
      kind: 'condition',
      type: 'predicate.position_state',
      version: 1,
      config: { state: 'flat', market: 'BTC-PERP' },
    };
    const context = createEvaluationContext({
      evaluatedAt: '2026-09-03T08:00:30.000Z',
      currentMarket: 'ETH-PERP',
      values: {
        'account.positions': value([{ market: 'BTC-PERP', side: 'long' }]),
      },
    });

    expect(evaluateConditionNode(node, context)).toMatchObject({
      value: false,
      reason: 'predicate.not_matched',
    });
  });

  it('rejects explicit market config in the new position predicate definition', () => {
    const result = createBuiltinRegistry().validateConfig({
      id: 'c-position',
      kind: 'condition',
      type: 'predicate.position_state',
      version: 2,
      config: { state: 'flat', market: 'BTC-PERP' },
    });

    expect(result.success).toBe(false);
  });
});

describe('combineConditionResults', () => {
  it.each([
    ['combine.all', [knownTrue, knownTrue], {}, true, 'combine.all_true'],
    ['combine.all', [knownTrue, unknown], {}, 'unknown', 'combine.indeterminate'],
    ['combine.all', [unknown, knownFalse], {}, false, 'combine.child_false'],
    ['combine.any', [knownFalse, knownFalse], {}, false, 'combine.all_false'],
    ['combine.any', [knownFalse, unknown], {}, 'unknown', 'combine.indeterminate'],
    ['combine.any', [unknown, knownTrue], {}, true, 'combine.child_true'],
    ['combine.not', [knownTrue], {}, false, 'combine.not_true'],
    ['combine.not', [unknown], {}, 'unknown', 'combine.indeterminate'],
    ['combine.at_least', [knownTrue, unknown, knownFalse], { count: 1 }, true, 'combine.threshold_met'],
    ['combine.at_least', [knownTrue, unknown, knownFalse], { count: 2 }, 'unknown', 'combine.indeterminate'],
    ['combine.at_least', [knownTrue, unknown, knownFalse], { count: 3 }, false, 'combine.threshold_unreachable'],
  ] as const)('%s maps its three-valued inputs deterministically', (type, inputs, config, expected, reason) => {
    expect(combineConditionResults(type, inputs, config)).toMatchObject({ value: expected, reason });
  });
});
